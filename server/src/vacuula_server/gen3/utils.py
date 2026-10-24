
from __future__ import annotations
import typing
from vacuula_server.storage import component
if typing.TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

def extract_robot_serial(auth_header: str) -> str:
    """Extract robot ID from Authorization header"""
    if not auth_header.startswith("NEATOBOT "):
        return ""
    token = auth_header[len("NEATOBOT "):]
    parts = token.split(":")
    if len(parts) < 2:
        return ""
    try:
        return component(parts[0])
    except ValueError:
        return ""

def get_robot_serial(req: RouterHandler):
    serial = extract_robot_serial(req.headers.get("Authorization", ""))
    if not serial:
        req.send_bad_request("No robot serial")
        return None
    return serial

