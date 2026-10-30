from __future__ import annotations
from vacuula_server.conn import RobotConn
from typing import Dict
import json
import threading, queue
from contextlib import suppress

# robot_connections: List[RobotConn]  = []
robot_connections: Dict[str, RobotConn] = {}


# client_connection:
# - client id
# - connection itself
client_connections = []


class PendingRequest:
    __slots__ = ("conn", "content", "event", "status")

    def __init__(self):
        self.event = threading.Event()
        self.content = None
        self.status = None
        # connection the request was sent on; set by the sender so the request can be
        # failed fast if exactly that connection dies (see abort_pending_requests)
        self.conn: RobotConn | None = None

    def fulfill(self, content, status):
        self.content = content
        self.status = status
        self.event.set()

# pending_requests:
# - req_id --> PendingRequest
pending_requests: dict[str, PendingRequest] = {}

def abort_pending_requests(conn: RobotConn, status: int = 503, message: str = "Robot disconnected") -> int:
    """Fail every request still waiting on `conn` (a connection that just died).

    Matches on the connection object, not the serial: if the robot already reconnected,
    requests sent on the new connection must not be touched by the old one's cleanup.
    """
    payload = json.dumps({"error": message}).encode("utf-8")
    aborted = 0
    for slot in list(pending_requests.values()):
        if slot.conn is conn and not slot.event.is_set():
            slot.fulfill(payload, status)
            aborted += 1
    return aborted

def put_drop_oldest(q: queue.Queue, item: bytes) -> None:
    try:
        q.put_nowait(item)
    except queue.Full:
        with suppress(queue.Empty):
            q.get_nowait()
        with suppress(queue.Full):
            q.put_nowait(item)