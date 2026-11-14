from __future__ import annotations
import hashlib
import hmac
import itertools
import json
import logging
import time
from datetime import datetime, timezone
from vacuula_server.generation import get_gen3_robot_data

logger = logging.getLogger(__name__)

def hmac_sha256(message: str, secret: str) -> str:
    signature = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return signature


def rfc822_date() -> str:
    # Format like: Tue, 04 Dec 2025 19:55:03 GMT
    return datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")


def sign_cmd(robot_serial: str, cmd: str):
    date = rfc822_date()

    gen3_data = get_gen3_robot_data(robot_serial)
    if not gen3_data:
        logger.error("Gen3 data not found for serial %s", robot_serial)
        return ""
    password = gen3_data.password

    if not password:
        logger.warning("No password found for robot %s, using empty string", robot_serial)
        password = ""

    payload = (
        robot_serial.lower() + "\n" +
        date + "\n" +
        cmd
    )

    signature = hmac_sha256(payload, password).lower()

    return date + "|" + signature + "\r\n" + cmd


_req_counter = itertools.count(1)

def send_chunk(wfile, payload_bytes):
    chunk = f"{len(payload_bytes):X}\r\n".encode() + payload_bytes + b"\r\n"
    wfile.write(chunk)
    wfile.flush()


def build_heartbeat():
    return json.dumps({
        "heartbeat": 60,
        "epoch": int(time.time())
    }).encode()


def build_command(robot_serial: str, cmd: dict):
    req_num = next(_req_counter)

    payload = json.dumps({
        "reqId": str(req_num),
        **cmd
    }, ensure_ascii=False)

    return [req_num, sign_cmd(robot_serial, payload).encode()]