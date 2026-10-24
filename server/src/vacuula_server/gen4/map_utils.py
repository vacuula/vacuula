"""
parse_maps.py  —  SLAM map parser for robot vacuum cleaning sessions (gen4).

Each cleaning session produces exactly TWO files that must be parsed together:

    FloorMap  (rank_binary)  —  full SLAM floor map  (walls, free space, unknown)
    RunMap    (real_binary)  —  the path the robot actually drove, encoded as
                                 multiple distinct pixel "colors" (e.g. one
                                 value per pass / time-bucket / direction).
                                 It is NOT a walls/free/unknown map, so its
                                 raw pixel values are preserved as-is rather
                                 than being classified into the floor legend.

Both files are the same size/resolution and are zlib-compressed PGM (P5)
images with a metadata comment line ("# Neato metadata: origin_x=... ...").

Usage
-----
    # Parse one session into the current directory:
    python3 parse_maps.py FloorMap.pgm.nz RunMap.pgm.nz

    # Parse into a specific output directory:
    python3 parse_maps.py FloorMap.pgm.nz RunMap.pgm.nz --out ./session_01/

    # Custom output filenames:
    python3 parse_maps.py FloorMap.pgm.nz RunMap.pgm.nz \
        --floor-out floor.json --run-out run.json

Outputs
-------
    floormap.json  —  RLE grid of the floor map (unknown / free / wall)
    runmap.json    —  RLE grid of the path map, raw pixel values preserved
                       (one value per distinct path "color"), same width/
                       height/downsample as the floor map so the two grids
                       line up cell-for-cell for merging downstream.

Importing as a module
---------------------
    from parse_maps import parse_session
    parse_session("FloorMap.pgm.nz", "RunMap.pgm.nz", out_dir="./output/")
"""

from __future__ import annotations
from vacuula_server.storage import storage_path, atomic_write

import argparse
import io
import logging
import json
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image


# =========================================================
# MAP COMPRESSION
# =========================================================
# Groups NxN pixels into one logical cell.
#
# 1 = no reduction (full resolution)
# 2 = 2×2 pixels → 1 cell
# 4 = 4×4 pixels → 1 cell
# 8 = very compressed map
#
# Applied to BOTH maps so their output grids stay aligned cell-for-cell.
#
DOWNSAMPLE = 1

# =========================================================
# PIXEL CLASSIFICATION  (FloorMap / rank_binary only)
# =========================================================
# Grayscale:  0 = black,  255 = white
#
# SLAM floor-map pixel semantics:
#   BLACK (< BLACK_THRESHOLD) → FREE SPACE
#   WHITE (> WHITE_THRESHOLD) → WALL
#   GRAY  (everything else)   → UNKNOWN / UNEXPLORED
#
BLACK_THRESHOLD = 60
WHITE_THRESHOLD = 220

UNKNOWN = 0
FREE    = 1
WALL    = 2

logger = logging.getLogger(__name__)

# ---------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------

def _classify(value: int) -> int:
    if value < BLACK_THRESHOLD:
        return FREE
    if value > WHITE_THRESHOLD:
        return WALL
    return UNKNOWN


def _rle_encode(cells: list[int]) -> list[list[int]]:
    rle     = []
    current = cells[0]
    count   = 1
    for value in cells[1:]:
        if value == current:
            count += 1
        else:
            rle.append([current, count])
            current = value
            count   = 1
    rle.append([current, count])
    return rle


def extract_metadata(data: bytes) -> dict:
    """Parse the '# Neato metadata: origin_x=... origin_y=... resolution=... alignment=...' line."""
    comment = data.split(b'\n')[1].decode("utf-8").strip()
    md = {}
    for tok in comment.replace(",", " ").split():
        if "=" in tok:
            k, _, v = tok.partition("=")
            try:
                if "." in v:
                    md[k] = float(v)
                else:
                    md[k] = int(v)
            except ValueError:
                pass
    return md


def _read_pgm_pixels(decoded: bytes) -> dict:
    """
    Parse a decompressed binary PGM (P5) buffer directly, preserving full
    pixel fidelity (including 16-bit values), instead of routing through
    PIL's 8-bit "L" mode. Used for the path map, where distinct pixel
    values carry meaning (different path "colors") and must not be lossy.

    Returns {"width", "height", "maxval", "bytes_per_pixel", "pixels"}
    where "pixels" is a 2D numpy array of shape (height, width).
    """
    if not decoded.startswith(b"P5"):
        raise ValueError("Not a binary PGM (P5) file after decompression")

    pos = 2

    def _skip_ws(p):
        while p < len(decoded) and decoded[p:p + 1] in b" \t\r\n":
            p += 1
        return p

    def _skip_ws_and_comments(p):
        while True:
            p = _skip_ws(p)
            if p < len(decoded) and decoded[p:p + 1] == b"#":
                nl = decoded.find(b"\n", p)
                p = (nl + 1) if nl != -1 else len(decoded)
            else:
                break
        return p

    def _read_token(p):
        p = _skip_ws_and_comments(p)
        start = p
        while p < len(decoded) and decoded[p:p + 1] not in b" \t\r\n":
            p += 1
        return decoded[start:p], p

    tok, pos = _read_token(pos)
    width = int(tok)
    tok, pos = _read_token(pos)
    height = int(tok)
    tok, pos = _read_token(pos)
    maxval = int(tok)
    pos += 1  # single whitespace byte separates maxval from the binary blob

    bytes_per_pixel = 1 if maxval < 256 else 2
    expected = width * height * bytes_per_pixel
    pixel_bytes = decoded[pos:pos + expected]
    if len(pixel_bytes) < expected:
        raise ValueError(
            f"Truncated pixel data: expected {expected} bytes, got {len(pixel_bytes)}"
        )

    if bytes_per_pixel == 1:
        pixels = np.frombuffer(pixel_bytes, dtype=np.uint8).astype(np.int32)
    else:
        pixels = np.frombuffer(pixel_bytes, dtype=">u2").astype(np.int32)  # big-endian

    pixels = pixels.reshape((height, width))

    return {
        "width": width,
        "height": height,
        "maxval": maxval,
        "bytes_per_pixel": bytes_per_pixel,
        "pixels": pixels,
    }


def _downsample_majority(arr: np.ndarray, downsample: int) -> np.ndarray:
    """
    Downsample a 2D integer array by NxN majority vote (most frequent raw
    value in each block). Keeps full value fidelity — no collapsing into a
    fixed set of classes — so it works for the path map's arbitrary set of
    distinct "color" values, not just floor/wall/unknown.
    """
    if downsample == 1:
        return arr

    h, w = arr.shape
    new_h, new_w = h // downsample, w // downsample
    out = np.zeros((new_h, new_w), dtype=arr.dtype)
    for gy in range(new_h):
        for gx in range(new_w):
            block = arr[gy * downsample:(gy + 1) * downsample,
                        gx * downsample:(gx + 1) * downsample]
            vals, counts = np.unique(block, return_counts=True)
            out[gy, gx] = vals[np.argmax(counts)]
    return out


# ---------------------------------------------------------
# FloorMap parser  (rank_binary)
# ---------------------------------------------------------

def _parse_floor_map(image_path: str | Path, map_type: str = "floor") -> dict:
    """
    Parse the FloorMap (rank_binary) PGM into an RLE-compressed dict of
    unknown / free / wall cells.
    """
    with open(image_path, "rb") as f:
        compressed = f.read()
    decoded  = zlib.decompress(compressed)
    metadata = extract_metadata(decoded)
    img      = Image.open(io.BytesIO(decoded)).convert("L")
    width, height = img.size
    pixels        = img.load()

    new_w = width  // DOWNSAMPLE
    new_h = height // DOWNSAMPLE
    cells: list[int] = []

    for gy in range(new_h):
        for gx in range(new_w):
            counts = {UNKNOWN: 0, FREE: 0, WALL: 0}
            for dy in range(DOWNSAMPLE):
                for dx in range(DOWNSAMPLE):
                    raw = pixels[gx * DOWNSAMPLE + dx,
                                 gy * DOWNSAMPLE + dy]
                    counts[_classify(raw)] += 1
            cells.append(max(counts, key=counts.get))

    rle = _rle_encode(cells)

    return {
        "width":      new_w,
        "height":     new_h,
        "downsample": DOWNSAMPLE,
        "map_type":   map_type,
        "legend":     {"0": "unknown", "1": "free", "2": "wall"},
        "rle":        rle,
        "metadata":   metadata,
        "img_size":   img.size,
    }


# ---------------------------------------------------------
# RunMap / path parser  (real_binary)
# ---------------------------------------------------------

def _parse_path_map(image_path: str | Path, map_type: str = "path") -> dict:
    """
    Parse the RunMap (real_binary) PGM into an RLE-compressed dict, same
    shape as the floor map's output, but WITHOUT classifying pixels into
    unknown/free/wall. This map encodes the path the robot actually drove
    using multiple distinct pixel values (different "colors" per pass /
    time-bucket / direction), so every distinct raw value is preserved and
    listed in "legend" instead of being collapsed into 3 classes.
    """
    with open(image_path, "rb") as f:
        compressed = f.read()
    decoded  = zlib.decompress(compressed)
    metadata = extract_metadata(decoded)
    header   = _read_pgm_pixels(decoded)

    grid = _downsample_majority(header["pixels"], DOWNSAMPLE)
    new_h, new_w = grid.shape
    cells = grid.reshape(-1).tolist()
    rle   = _rle_encode(cells)

    distinct_values = sorted(int(v) for v in np.unique(grid))
    legend = {str(v): f"path_value_{v}" for v in distinct_values}

    return {
        "width":                new_w,
        "height":               new_h,
        "downsample":           DOWNSAMPLE,
        "map_type":             map_type,
        "legend":               legend,
        "rle":                  rle,
        "metadata":             metadata,
        "img_size":             [header["width"], header["height"]],
        "source_maxval":        header["maxval"],
        "source_bytes_per_pixel": header["bytes_per_pixel"],
    }


# ---------------------------------------------------------
# Public API  —  always call with BOTH maps
# ---------------------------------------------------------

def parse_session(
    floor_map_path: str | Path,
    run_map_path:   str | Path,
    out_dir:        str | Path = ".",
    floor_out:      str        = "floormap.json",
    run_out:        str        = "runmap.json",
) -> tuple[dict, dict]:
    """
    Parse a cleaning session: FloorMap (rank_binary) + RunMap (real_binary)
    must be provided together — they're the same size/resolution and are
    written out as two separate but aligned JSON grids so a frontend can
    merge/overlay them later.

    Parameters
    ----------
    floor_map_path  Path to the FloorMap (rank_binary) file
    run_map_path    Path to the RunMap (real_binary) file
    out_dir         Directory where both JSON files are written
    floor_out       Filename for the floor map JSON
    run_out         Filename for the path map JSON

    Returns
    -------
    (floor_data, run_data)  — the two dicts that were written to disk
    """
    floor_map_path = Path(floor_map_path)
    run_map_path   = Path(run_map_path)
    out_dir        = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for p in (floor_map_path, run_map_path):
        if not p.exists():
            raise FileNotFoundError(f"Map file not found: {p}")

    logger.debug("Parsing FloorMap: %s", floor_map_path)
    floor_data = _parse_floor_map(floor_map_path, map_type="floor")
    floor_file = storage_path(out_dir, floor_out)
    atomic_write(floor_file, json.dumps(floor_data).encode("utf-8"))
    # _print_summary(floor_file, floor_data)

    logger.debug("Parsing RunMap: %s", run_map_path)
    run_data = _parse_path_map(run_map_path, map_type="path")
    run_file = storage_path(out_dir, run_out)
    atomic_write(run_file, json.dumps(run_data).encode("utf-8"))
    # _print_summary(run_file, run_data)

    logger.info("Session parsed successfully: %s", out_dir)
    return floor_data, run_data


# def _print_summary(path: Path, data: dict) -> None:
#     print(f"  Saved      : {path}")
#     print(f"  Grid       : {data['width']} x {data['height']}")
#     print(f"  RLE entries: {len(data['rle'])}")
#     print(f"  Legend     : {data['legend']}")
#     print(f"  Metadata   : {data['metadata']}")
