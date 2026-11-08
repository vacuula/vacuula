from __future__ import annotations
import logging
from vacuula_server import state
import json
import time
from vacuula_server.state import pending_requests, put_drop_oldest
import typing

logger = logging.getLogger(__name__)

# per-robot temporary buffers
# serial --> size
robot_buffers = {}

def robot_data(serial: str, data: bytes):
    """Handle incoming data from robot"""

    # create robot state if missing
    if serial not in robot_buffers:
        robot_buffers[serial] = int(data, 16)  # hex to int
        return

    msg_size = robot_buffers[serial]

    # remove last two bytes (\r\n)
    data = data[:-2]

    if (chr(data[0]) != '{' and msg_size == 1):
        logger.debug("heartbeat from robot %s", serial)
        return


    try:
        decoded: dict = json.loads(data.decode())
    except Exception as e:
        logger.error("failed to parse JSON from %s: %s", serial, e)
        return

    eventId = decoded.get("eventId")
    reqId = decoded.get("reqId")

    logger.debug("robot_data: serial=%s eventId=%s reqId=%s data=%s", serial, eventId, reqId, data)

    if reqId in pending_requests:
        slot = pending_requests.get(reqId)
        result = decoded.get("result")
        if slot is not None:
            slot.fulfill(data, 200 if result == "ok" else 400)
    elif eventId:
        clients = [c for c in state.client_connections if c["serial"] == serial]
        if clients:  # skip serializing when nobody is listening
            msg = json.dumps({
                "serial": serial,
                "event": eventId,
                "data": decoded,      # parsed dict, not raw bytes
                "ts": time.time(),
            }) + "\n"
            frame = f"data: {msg}\n\n".encode()
            for client in clients:
                put_drop_oldest(client["queue"], frame)


    else:
        logger.error("no eventId or reqId in data from %s", serial)

    del robot_buffers[serial]
