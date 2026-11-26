"""Reports a gen3 robot sends on its own: end-of-run stats and push notifications.

Neither changes server state. They are kept on disk (and logged) because they
are the only record of why a run stopped, e.g. a failed floorplan localization.
"""
from __future__ import annotations
import json
import logging
import re
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from vacuula_server.constants import UPLOADS_DIR
from vacuula_server.gen3.utils import get_robot_serial

if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)

REPORTS_DIR = UPLOADS_DIR / "reports"
LOG_PREVIEW_CHARS = 2000


def _keep(serial: str, kind: str, body: bytes, **extra: str) -> None:
    """Append the report to <reports>/<serial>/<kind>.jsonl and log it."""
    text = body.decode("utf-8", errors="replace")
    try:
        payload = json.loads(text) if text else None
    except json.JSONDecodeError:
        payload = text
    entry = {"received_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **extra, "payload": payload}
    logger.info("Robot %s %s %s: %s", serial, kind, extra or "", text[:LOG_PREVIEW_CHARS])
    try:
        folder = REPORTS_DIR / re.sub(r"[^A-Za-z0-9_-]", "_", serial)
        folder.mkdir(parents=True, exist_ok=True)
        with open(folder / f"{kind}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        logger.exception("Could not save %s report for robot %s", kind, serial)


def post_life_stats(req: RouterHandler, run_id: str) -> None:
    """POST /runs/{id}/life_stats - stats the robot sends when a run ends"""
    if (body := req.read_data()) is None: return
    if not (serial := get_robot_serial(req)): return
    _keep(serial, "life_stats", body, run_id=run_id)
    req.send_ok({})


def post_push_notification(req: RouterHandler) -> None:
    """POST /push_notifications - alerts the robot would push to the phone app"""
    if (body := req.read_data()) is None: return
    if not (serial := get_robot_serial(req)): return
    _keep(serial, "push_notifications", body)
    req.send_ok({})
