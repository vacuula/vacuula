
from __future__ import annotations
import logging
from sqlalchemy.util import b
from vacuula_server.conn import RobotConn
from vacuula_server.constants import MAPS_DIR
from vacuula_server.db import get_session
from vacuula_server.gen4.data import Gen4Data
from vacuula_server.gen4.map_utils import parse_session
from vacuula_server.models.robot import Robot
from vacuula_server.models.persistent_map import FloorPlan
import threading
from vacuula_server.models.run import Gen4__Run
from vacuula_server.state import PendingRequest, put_drop_oldest, robot_connections
from vacuula_server.handlers.events import notify_robots_changed
from vacuula_server.generation import Generation

from vacuula_server.state import pending_requests, client_connections
from datetime import datetime, timezone
import struct, json
import os
import base64
import json
import io
from PIL import Image
import uuid
import time
from vacuula_server.server_tz import server_timezone

logger = logging.getLogger(__name__)

# todo: better validation of label_serial
def handle_login(rc: RobotConn, msg):
    serial = msg.get("serial", "<unknown>")
    
    if serial == "<unknown>" or rc.gen != Generation.GEN4:
        # fail and show error
        return
    
    rc.serial = serial
    robot_connections[serial] = rc

    ip = rc.conn.socket.getpeername()[0]

    response = {
        "code": 200,
        "session": str(uuid.uuid4()),
        "datetime": now_iso(),
        "body": {
            "ip_address": ip,
            "timezone": server_timezone(),
            "robot_id": serial,
            "user_id": "vacuula-user",
        },
    }
    send_json(rc.conn.socket, response) # TODO cleanup

    slot = PendingRequest()
    req_id, err = robot_send_request(rc, { "ability": "info.robot" }, slot)
    if req_id is None:
        logger.error("Failed to send info.robot request to %s: %s", serial, err)
        return

    slot.event.wait(15) # robot has to respond within this time
    pending_requests.pop(req_id, None)

    if not slot.event.is_set():
        logger.error("Robot, %s, did not respond to info.robot request in time", serial)
        return
    if slot.status != 200:
        logger.error("Robot, %s, rejected info.robot request with status %s", serial, slot.status)
        return

    content = slot.content
    if not content or "body" not in content:
        logger.error("Robot, %s, responded to info.robot request with no body", serial)
        return
    
    label_serial = content["body"].get("serial_number", "")
    if not label_serial:
        logger.error("Robot, %s, responded to info.robot request with no serial_number (label_serial)", serial)
        return

    with get_session() as session:
        exists = session.get(Robot, serial)

        # TODO: should label_serial be allowed0 to change? look into this, just not in initial release
        if not exists:
            session.add(Robot(serial=serial, type="neato.gen4", name=f"gen4-{label_serial}"))
            session.add(Gen4Data(robot=serial, label_serial=label_serial))
            session.commit()

    logger.info("Robot %s logged in with label_serial %s", serial, label_serial)
    notify_robots_changed()


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")



_send_locks = {}
_send_locks_lock = threading.Lock()


def get_send_lock(conn):
    with _send_locks_lock:
        key = id(conn)
        if key not in _send_locks:
            _send_locks[key] = threading.Lock()
        return _send_locks[key]

def send_packet(sock, body_bytes):
    if not isinstance(body_bytes, (bytes, bytearray)):
        raise TypeError("send_packet expects bytes")
    with get_send_lock(sock):
        sock.sendall(struct.pack(">I", len(body_bytes)) + bytes(body_bytes))


def send_json(sock, obj):
    body = json.dumps(obj).encode("utf-8")
    send_packet(sock, body)

def heartbeat_thread(rc: RobotConn):
    while not rc.stop_event.is_set():
        if rc.stop_event.wait(30):
            return
        try:
            send_heartbeat(rc.conn.socket)
        except Exception as e:
            logger.error("heartbeat send failed for %s: %s", rc.serial, e)
            rc.stop_event.set()
            try:
                rc.conn.socket.close()
            except Exception:
                pass
            return


def send_heartbeat(sock):
    send_packet(sock, b"\x06")

def robot_send_request(rc: RobotConn, body: dict, slot=None):
    request_id = str(uuid.uuid4())

    msg = {
        "type": "request",
        "id": request_id,
        "to": {"service": "robot"},
        "body": body,
    }

    if slot is not None:
        slot.conn = rc
        pending_requests[request_id] = slot
    try:
        send_json(rc.conn.socket, msg)
    except Exception as e:
        logger.error("Failed to send request to robot %s: %s", rc.serial, e)
        if slot is not None:
            pending_requests.pop(request_id, None)
        return None, e

    return request_id, None

def robot_response(rc: RobotConn, data: dict):
    reqId = data.get("id")
    slot = pending_requests.get(reqId)
    if slot is not None:
        slot.fulfill(data, data["code"])


def robot_event(rc: RobotConn, data: dict):
    # broadcast to all clients subscribed to this robot
    clients_subscribed = [
        c for c in client_connections
        if c["serial"] == rc.serial
    ]

    msg = json.dumps({
        "serial": rc.serial,
        "type": "neato.gen4",
        "data": data,
        "ts": time.time()
    }) + "\n"
    frame = f"data: {msg}\n\n".encode()

    for client in clients_subscribed:
        put_drop_oldest(client["queue"], frame)



def get_image_size(decoded: bytes):
    im = Image.open(io.BytesIO(decoded))
    im.load()
    return im.size  # (width, height) -> (2000, 2000)

def maps_create(rc: RobotConn, data: dict):
    logger.info("Received maps.create from robot %s", rc.serial)
    body = data["body"]

    compressed = base64.b64decode(body["map"]["rank_binary"])

    folder = MAPS_DIR / rc.serial / str(body['rank_uuid'])
    upload_file = os.path.join(folder, 'rank_binary.pgm.nz')

    try:
        os.makedirs(folder, exist_ok=True)
        with open(upload_file, 'wb') as f:
            f.write(compressed)
    except Exception:
        logger.error("Failed to save file for robot %s, rank_uuid %s", rc.serial, body['rank_uuid'])
        return

    compressed = base64.b64decode(body["map"]["real_binary"])

    folder = MAPS_DIR / rc.serial / str(body['rank_uuid'])
    upload_file = os.path.join(folder, 'real_binary.pgm.nz')

    try:
        os.makedirs(folder, exist_ok=True)
        with open(upload_file, 'wb') as f:
            f.write(compressed)

        with open(os.path.join(folder, 'msg.json'), 'w') as f:
            json.dump(data, f)
    except Exception:
        logger.error("Failed to save file for robot %s, rank_uuid %s", rc.serial, body['rank_uuid'])
        return

    job_folder = f"{MAPS_DIR}/{rc.serial}/{body['rank_uuid']}"
    floor_map_path = f"{job_folder}/rank_binary.pgm.nz"
    run_map_path = f"{job_folder}/real_binary.pgm.nz"
    floormap_meta, _ = parse_session(floor_map_path, run_map_path, job_folder)

    with get_session() as session:
        session.add(FloorPlan(
            id=body['rank_uuid'],
            robot=rc.serial,
            name="(unnamed)",
            promoted=False,
            base=(body["robot"]["base"]["x"], body["robot"]["base"]["y"], body["robot"]["base"]["dir"]),
            origin=(body["map"]["origin"]["x"], body["map"]["origin"]["y"]),
            resolution=floormap_meta["metadata"]["resolution"],
            alignment=floormap_meta["metadata"]["alignment"],
            imgsize=floormap_meta["img_size"],
            created_at=body["timing"]["end"],
            in_maps_list=False
        ))

        session.add(Gen4__Run(
            id=body['rank_uuid'],
            robot=rc.serial,
            floorplan=body["rank_uuid"],
            started_by=body["started_by"],
            battery_consumed=body["battery_consumed"],
            runs=body["runs"],
            timing=body["timing"],
            cleaning_complete=body["cleaning_complete"]
        ))

        session.commit()
    
    return { "floorplan": False }, 201


# TODO: implement all services robot uses
request_map = {
    "maps.create": maps_create,
}


# TODO: clean this up and test all paths more thoroughly but not in initial release
def roboot_request(rc: RobotConn, msg_id: str, data: dict):
    service = data["to"]["service"]
    handler = request_map.get(service)
    if handler is None:
        # TODO: after initial release
        return

    try:
        response_body, response_code = handler(rc, data)
    except Exception:
        logger.exception("request failed for %s", rc.serial)
        response_body, response_code = {}, 500
    try:
        response = {
            "type": "response",
            "id": msg_id,
            "code": response_code,
            "body": response_body,
        }
        send_json(rc.conn.socket, response) # TODO
    except Exception:
        logger.warning("could not send response to %s", rc.serial)

