"""Keep disabled Gen3 no-go lines on the server.

Gen3 robots store the `enabled` flag of a no-go line but ignore it while
cleaning: a line saved with `enabled: false` still blocks the robot
(vacuula/vacuula#95). The only way to really switch a line off is to not send
it to the robot at all.

So for `setMapBoundaries` the disabled lines are stripped from the command and
kept in a small JSON file per map, and replies to `getMapBoundaries` (and the
echo in `setMapBoundaries` replies) get them added back. To the app it looks
as if the robot kept them.

Stored in MAPS_DIR/<serial>/disabled_boundaries.json as {map_id: [lines]}.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any

from vacuula_server.constants import MAPS_DIR

logger = logging.getLogger(__name__)

FILE_NAME = "disabled_boundaries.json"
_SAFE_PART = re.compile(r"^[A-Za-z0-9:._-]+$")

GET_CMD = "getMapBoundaries"
SET_CMD = "setMapBoundaries"


def _is_disabled_line(boundary: Any) -> bool:
    return (
        isinstance(boundary, dict)
        and boundary.get("type") == "polyline"
        and boundary.get("enabled") is False
    )


_lock = threading.Lock()


def _file(serial: str, base: Path = MAPS_DIR) -> Path | None:
    # One file per robot, keyed by map id: map ids contain ':' which isn't
    # allowed in Windows file names.
    if not _SAFE_PART.match(serial) or ".." in serial:
        return None
    return base / serial / FILE_NAME


def _read_all(path: Path) -> dict[str, list]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        logger.exception("Could not read %s", path)
        return {}


def load(serial: str, map_id: str, base: Path = MAPS_DIR) -> list[dict]:
    path = _file(serial, base)
    if path is None:
        return []
    with _lock:
        lines = _read_all(path).get(map_id, [])
    return [b for b in lines if _is_disabled_line(b)] if isinstance(lines, list) else []


def save(serial: str, map_id: str, lines: list[dict], base: Path = MAPS_DIR) -> None:
    path = _file(serial, base)
    if path is None:
        logger.warning("Refusing to store disabled boundaries for %r", serial)
        return
    with _lock:
        everything = _read_all(path)
        if lines:
            everything[map_id] = lines
        else:
            everything.pop(map_id, None)
        if not everything:
            path.unlink(missing_ok=True)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(everything, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)


def prepare_command(data: dict) -> tuple[dict, list[dict] | None]:
    """Return the command to send to the robot, plus the disabled lines to
    store once the robot accepts it (None if this isn't a boundary save)."""
    params = data.get("params")
    if data.get("cmd") != SET_CMD or not isinstance(params, dict):
        return data, None
    boundaries = params.get("boundaries")
    if not isinstance(params.get("mapId"), str) or not isinstance(boundaries, list):
        return data, None
    disabled = [b for b in boundaries if _is_disabled_line(b)]
    kept = [b for b in boundaries if not _is_disabled_line(b)]
    return {**data, "params": {**params, "boundaries": kept}}, disabled


def handle_reply(serial: str, data: dict, disabled: list[dict] | None, status: int | None,
                 content: Any, base: Path = MAPS_DIR) -> Any:
    """Store the disabled lines after a successful save, and add the stored
    lines back into boundary replies. Returns the (possibly changed) reply."""
    cmd = data.get("cmd")
    params = data.get("params") if isinstance(data.get("params"), dict) else {}
    map_id = params.get("mapId")
    if cmd not in (GET_CMD, SET_CMD) or not isinstance(map_id, str) or status != 200:
        return content

    if cmd == SET_CMD and disabled is not None:
        save(serial, map_id, disabled, base)

    stored = load(serial, map_id, base)
    if not stored:
        return content
    try:
        reply = json.loads(content.decode("utf-8") if isinstance(content, (bytes, bytearray)) else content)
        boundaries = reply["data"]["boundaries"]
        if not isinstance(boundaries, list):
            return content
    except (ValueError, KeyError, TypeError, AttributeError):
        return content

    on_robot = {b.get("id") for b in boundaries if isinstance(b, dict)}
    boundaries.extend(b for b in stored if b.get("id") not in on_robot)
    return json.dumps(reply, ensure_ascii=False).encode("utf-8")
