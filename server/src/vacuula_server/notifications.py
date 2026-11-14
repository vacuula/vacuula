from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert

from vacuula_server.db import get_session
from vacuula_server.models.notification import RobotNotification
from vacuula_server.models.robot import Robot
from vacuula_server.state import client_connections, put_drop_oldest

if TYPE_CHECKING:
    from vacuula_server.conn import RobotConn
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)
MAX_PAYLOAD_BYTES = 16 * 1024
MAX_CURSOR = 2**63 - 1


def _valid_text(value) -> bool:
    return isinstance(value, str) and bool(value.strip()) and len(value) <= 128


def _publish(notification: dict) -> None:
    from vacuula_server.handlers.events import broadcast

    broadcast("notification", notification)
    frame = f"event: notification\ndata: {json.dumps(notification)}\n\n".encode()
    for client in list(client_connections):
        if client["serial"] == notification["robot"]:
            put_drop_oldest(client["queue"], frame)


def robots_notify(rc: RobotConn, data: dict):
    """Accept a Gen4 robots.notify request; acknowledge only after committing it."""
    body = data.get("body")
    request_id = data.get("id")
    if not isinstance(body, dict) or not _valid_text(request_id):
        return {"error": "A request id and object body are required"}, 400
    message_code = body.get("message_code")
    payload = body.get("payload")
    if not _valid_text(message_code):
        return {
            "error": "message_code must be a non-empty string of at most 128 characters"
        }, 400
    if payload is not None and not isinstance(payload, dict):
        return {"error": "payload must be an object or null"}, 400
    try:
        encoded = json.dumps(payload, allow_nan=False).encode("utf-8")
    except ValueError, TypeError, RecursionError:
        return {"error": "payload must contain valid JSON"}, 400
    if len(encoded) > MAX_PAYLOAD_BYTES:
        return {"error": "payload exceeds 16 KiB"}, 413

    with get_session() as session:
        # One atomic insert also handles concurrent retries with the same id.
        notification_id = session.execute(
            insert(RobotNotification)
            .values(
                robot=rc.serial,
                request_id=request_id,
                message_code=message_code,
                payload=payload,
                received_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            )
            .on_conflict_do_nothing(index_elements=["robot", "request_id"])
            .returning(RobotNotification.id)
        ).scalar_one_or_none()
        if notification_id is None:
            return {}, 200
        notification = session.get(RobotNotification, notification_id).as_dict()
        session.commit()

    try:
        _publish(notification)
    except Exception:
        # History is authoritative; a disconnected client can recover it later.
        logger.exception("Could not publish notification %s", notification_id)
    return {}, 200


def get_notifications(req: RouterHandler, serial: str) -> None:
    """Newest-first history, paginated by the last returned notification id."""
    query = parse_qs(urlsplit(req.path).query, keep_blank_values=True)
    try:
        if any(len(query.get(key, [])) > 1 for key in ("limit", "before")):
            raise ValueError
        limit = int(query.get("limit", ["50"])[0])
        before = int(query["before"][0]) if "before" in query else None
        if not 1 <= limit <= 100 or (
            before is not None and not 1 <= before <= MAX_CURSOR
        ):
            raise ValueError
    except ValueError:
        req.send_bad_request(
            "limit must be 1–100; before must be a positive 64-bit notification id"
        )
        return

    with get_session() as session:
        if session.get(Robot, serial) is None:
            req.send_not_found("Robot not found")
            return
        statement = select(RobotNotification).where(RobotNotification.robot == serial)
        if before is not None:
            statement = statement.where(RobotNotification.id < before)
        rows = session.scalars(
            statement.order_by(RobotNotification.id.desc()).limit(limit + 1)
        ).all()
        items = [row.as_dict() for row in rows[:limit]]
    req.send_ok(
        {
            "notifications": items,
            "next_before": items[-1]["id"] if len(rows) > limit else None,
        }
    )
