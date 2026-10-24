"""
parse_maps.py  —  SLAM map parser for robot vacuum cleaning sessions (gen3).

Each cleaning session produces exactly TWO files that must be parsed together:

    FloorMap.png  —  full SLAM floor map  (walls, free space, unknown)
    RunMap.png    —  the path the robot actually drove, plus a dock location
                     marker (special pixel values 100 / 200).
                     It is NOT a walls/free/unknown map, so its raw pixel
                     values are preserved as-is rather than being classified
                     into the floor legend.

Usage
-----
    # Parse one session into the current directory:
    python3 parse_maps.py FloorMap.png RunMap.png

    # Parse into a specific output directory:
    python3 parse_maps.py FloorMap.png RunMap.png --out ./session_01/

    # Custom output filenames:
    python3 parse_maps.py FloorMap.png RunMap.png \
        --floor-out floor.json --run-out run.json

Outputs
-------
    floormap.json  —  RLE grid of the floor map (unknown / free / wall)
                       + embedded dock coordinates
    runmap.json    —  RLE grid of the path map, raw pixel values preserved
                       (one legend entry per distinct value), same width/
                       height/downsample as the floor map so the two grids
                       line up cell-for-cell for merging downstream.

Importing as a module
---------------------
    from parse_maps import parse_session
    parse_session("FloorMap.png", "RunMap.png", out_dir="./output/")
"""

from __future__ import annotations
from vacuula_server.storage import storage_path, atomic_write

import json
import logging
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
# PIXEL CLASSIFICATION  (FloorMap only)
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

# =========================================================
# DOCK DETECTION
# =========================================================
# The RunMap encodes the dock with two special pixel values
# that never appear in normal map data:
#
#   100  →  dark-gray  (top 4×4 block of dock marker)
#   200  →  light-gray (bottom 4×4 block of dock marker)
#
# Their combined centroid gives the dock position, which is
# embedded in floormap.json so consumers always have it.
#
DOCK_MARKER_LABELS = {100: "dock_marker_top", 200: "dock_marker_bottom"}
DOCK_MARKER_VALUES = set(DOCK_MARKER_LABELS)

# =========================================================
# RUNMAP LEGEND  (labels only — pixel values are never remapped)
# =========================================================
# The RunMap is NOT classified into unknown/free/wall. Every distinct raw
# pixel value in the image is kept and listed in the output legend.
# Recognised values get a readable name; any other value is one of the
# robot's path "colors" (one per pass / time-bucket / direction) and is
# named  path_value_<N>.
#
#   128   →  background  (untouched canvas — the robot never went here)
#   100   →  dock_marker_top      (see DOCK DETECTION)
#   200   →  dock_marker_bottom
#   other →  path_value_<N>       (the robot drove here)
#
RUN_BACKGROUND_VALUE = 128

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


def _run_label(value: int) -> str:
    if value == RUN_BACKGROUND_VALUE:
        return "background"
    if value in DOCK_MARKER_LABELS:
        return DOCK_MARKER_LABELS[value]
    return f"path_value_{value}"


def _load_pixels(image_path: str | Path) -> tuple[np.ndarray, str]:
    """
    Load a PNG as a 2D integer array WITHOUT remapping its values.

    8-bit ("L") and 16-bit ("I;16" / "I") grayscale are kept exactly as
    stored. Anything else (palette / RGB / RGBA) is flattened to grayscale.

    Returns (pixels[height, width], source_mode).
    """
    img  = Image.open(image_path)
    mode = img.mode
    if mode not in ("L", "I;16", "I"):
        img = img.convert("L")
    return np.array(img).astype(np.int32), mode


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
# Dock detection  (always reads the RunMap)
# ---------------------------------------------------------

def detect_dock(run_path: str | Path) -> dict | None:
    """
    Scan a RunMap image for dock-marker pixels (values 100 and 200),
    compute their combined centroid, and return both pixel and
    normalised [0, 1] coordinates.

    Returns None if no marker pixels are found.
    """
    arr, _ = _load_pixels(run_path)
    H, W   = arr.shape

    mask   = np.isin(arr, list(DOCK_MARKER_VALUES))
    coords = np.argwhere(mask)   # shape (N, 2): [[row/y, col/x], ...]

    if len(coords) == 0:
        return None

    # Per-block bounding boxes (one entry per marker value)
    blocks: dict[int, dict] = {}
    for val in sorted(DOCK_MARKER_VALUES):
        bc = np.argwhere(arr == val)
        if len(bc):
            blocks[val] = {
                "pixel_count": int(len(bc)),
                "pixel_x_min": int(bc[:, 1].min()),
                "pixel_x_max": int(bc[:, 1].max()),
                "pixel_y_min": int(bc[:, 0].min()),
                "pixel_y_max": int(bc[:, 0].max()),
            }

    cy = float(coords[:, 0].mean())
    cx = float(coords[:, 1].mean())

    return {
        "pixel_x":             round(cx, 2),
        "pixel_y":             round(cy, 2),
        "normalised_x":        round(cx / (W - 1), 6),
        "normalised_y":        round(cy / (H - 1), 6),
        "marker_pixel_values": sorted(DOCK_MARKER_VALUES),
        "marker_pixel_count":  int(len(coords)),
        "marker_blocks":       blocks,
        "source_image_width":  W,
        "source_image_height": H,
    }


# ---------------------------------------------------------
# FloorMap parser
# ---------------------------------------------------------

def _parse_floor_map(
    image_path: str | Path,
    map_type:   str,
    dock_info:  dict | None,
) -> dict:
    """
    Parse the FloorMap image into an RLE-compressed dict of
    unknown / free / wall cells.
    Dock-marker pixels are classified as FREE so they don't
    corrupt the grid.
    """
    img           = Image.open(image_path).convert("L")
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
                    if raw in DOCK_MARKER_VALUES:
                        counts[FREE] += 1
                    else:
                        counts[_classify(raw)] += 1
            cells.append(max(counts, key=counts.get))

    rle = _rle_encode(cells)

    output: dict = {
        "width":      new_w,
        "height":     new_h,
        "downsample": DOWNSAMPLE,
        "map_type":   map_type,
        "legend":     {"0": "unknown", "1": "free", "2": "wall"},
        "rle":        rle,
    }
    if dock_info is not None:
        output["dock"] = dock_info

    return output


# ---------------------------------------------------------
# RunMap / path parser
# ---------------------------------------------------------

def _parse_path_map(image_path: str | Path, map_type: str = "run") -> dict:
    """
    Parse the RunMap image into an RLE-compressed dict, same shape as the
    floor map's output, but WITHOUT classifying pixels into
    unknown/free/wall. This map records where the robot actually drove, so
    every distinct raw pixel value is preserved and listed in "legend"
    (background / dock markers / path_value_<N>) instead of being collapsed
    into 3 classes.

    Dock-marker pixels (100 / 200) are kept as-is and labelled in the
    legend; the dock's coordinates are reported separately by detect_dock().
    """
    pixels, source_mode = _load_pixels(image_path)
    src_h, src_w        = pixels.shape

    grid         = _downsample_majority(pixels, DOWNSAMPLE)
    new_h, new_w = grid.shape
    rle          = _rle_encode(grid.reshape(-1).tolist())

    distinct_values = sorted(int(v) for v in np.unique(grid))
    legend = {str(v): _run_label(v) for v in distinct_values}

    return {
        "width":       new_w,
        "height":      new_h,
        "downsample":  DOWNSAMPLE,
        "map_type":    map_type,
        "legend":      legend,
        "rle":         rle,
        "img_size":    [src_w, src_h],
        "source_mode": source_mode,
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
    Parse a cleaning session: FloorMap + RunMap must be provided together.

    The RunMap is always read first to extract the dock location.
    The dock info is embedded in the FloorMap JSON output. The RunMap is
    then written out as a path grid with its raw pixel values preserved,
    aligned cell-for-cell with the floor grid.

    Parameters
    ----------
    floor_map_path  Path to FloorMap.png
    run_map_path    Path to RunMap.png
    out_dir         Directory where both JSON files are written
    floor_out       Filename for the floor map JSON
    run_out         Filename for the run (path) map JSON

    Returns
    -------
    (floor_data, run_data)  — the two dicts that were written to disk
    """
    floor_map_path = Path(floor_map_path)
    run_map_path   = Path(run_map_path)
    out_dir        = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Validate inputs
    for p in (floor_map_path, run_map_path):
        if not p.exists():
            raise FileNotFoundError(f"Map file not found: {p}")

    # Step 1: detect dock from RunMap
    logger.debug("Detecting dock from RunMap: %s", run_map_path)
    dock = detect_dock(run_map_path)
    if dock:
        logger.debug("Dock detected: %s", dock)
    else:
        logger.warning("No dock marker found in RunMap: %s", run_map_path)

    # Step 2: parse FloorMap  (dock info embedded)
    logger.debug("Parsing FloorMap: %s", floor_map_path)
    floor_data = _parse_floor_map(floor_map_path, map_type="floor", dock_info=dock)
    floor_file = storage_path(out_dir, floor_out)
    atomic_write(floor_file, json.dumps(floor_data).encode("utf-8"))
    # _print_summary(floor_file, floor_data)

    # Step 3: parse RunMap as a path map (raw pixel values preserved)
    logger.debug("Parsing RunMap: %s", run_map_path)
    run_data = _parse_path_map(run_map_path, map_type="run")
    run_file = storage_path(out_dir, run_out)
    atomic_write(run_file, json.dumps(run_data).encode("utf-8"))
    # _print_summary(run_file, run_data)

    logger.debug("Session parsed successfully: floor=%s, run=%s", floor_file, run_file)
    return floor_data, run_data


# def _print_summary(path: Path, data: dict) -> None:
#     print(f"  Saved      : {path}")
#     print(f"  Grid       : {data['width']} x {data['height']}")
#     print(f"  RLE entries: {len(data['rle'])}")
#     print(f"  Legend     : {data['legend']}")
#     if "dock" in data and data["dock"]:
#         d = data["dock"]
#         print(f"  Dock (norm): ({d['normalised_x']}, {d['normalised_y']})")
