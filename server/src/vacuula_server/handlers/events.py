from __future__ import annotations
import json
import logging
import queue
import threading

from sqlalchemy import select

from vacuula_server.db import get_session
from vacuula_server.gen3.data import Gen3Data
from vacuula_server.gen4.data import Gen4Data
from vacuula_server.models.robot import Robot
from vacuula_server.state import put_drop_oldest, robot_connections

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

KEEPALIVE_S = 15

CLIENT_QUEUE_MAX = 100       # frames buffered per client before the oldest is dropped

_clients: list = []          # one bounded Queue per connected event-stream client
_lock = threading.Lock()

logger = logging.getLogger(__name__)


# TODO: since this function runs quite a lot, look into if it needs to be optimized!
def robots_snapshot() -> dict:
    """Robot list with connection status, keyed by serial (also used by GET /app/robots)."""
    with get_session() as session:
        robots = session.execute(select(Robot)).scalars().all()
        installed_with_map = {
            robot: installed_with
            for robot, installed_with in session.execute(select(Gen3Data.robot, Gen3Data.installed_with))
        }
        labels = {
            robot: label
            for robot, label in session.execute(select(Gen4Data.robot, Gen4Data.label_serial))
        }

    return {
        robot.serial: {
            "type": robot.type,
            "connected": robot.serial in robot_connections,
            "name": robot.name,
            **({"label_serial": labels.get(robot.serial)} if robot.type == "neato.gen4" else {}),
            **({"installed_with": installed_with_map.get(robot.serial)} if robot.type == "neato.gen3" else {}),
        }
        for robot in robots
    }


def _frame(event: str, data) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode("utf-8")


def broadcast(event: str, data) -> None:
    frame = _frame(event, data)
    with _lock:
        clients = list(_clients)
    for q in clients:
        put_drop_oldest(q, frame)


def notify_robots_changed() -> None:
    """Call after a robot connects, disconnects or is renamed."""
    try:
        broadcast("robots", robots_snapshot())
    except Exception as e:
        logger.warning("robots event not sent: %s: %s", type(e).__name__, e)


def get_events(req: "RouterHandler") -> None:
    """GET /app/events - SSE stream of server-wide events."""
    req.send_response(200)
    req.send_header("Content-Type", "text/event-stream")
    req.send_header("Cache-Control", "no-cache")
    req.send_header("Connection", "keep-alive")
    req.end_headers()

    q: queue.Queue = queue.Queue(maxsize=CLIENT_QUEUE_MAX)

    with _lock:
        _clients.append(q)
    try:
        req.wfile.write(_frame("robots", robots_snapshot()))
        req.wfile.flush()
        while True:
            try:
                frame = q.get(timeout=KEEPALIVE_S)
            except queue.Empty:
                frame = b": keepalive\n\n"
            req.wfile.write(frame)
            req.wfile.flush()
    except OSError:
        pass # client went away (reload, tab closed, phone in background)
    finally:
        with _lock:
            if q in _clients:
                _clients.remove(q)
