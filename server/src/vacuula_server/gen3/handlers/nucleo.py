from __future__ import annotations
import logging
import socket
import threading
from vacuula_server.gen3.commands import send_chunk, build_heartbeat
from vacuula_server.state import robot_connections
from vacuula_server.handlers.events import notify_robots_changed
from vacuula_server.gen3.utils import get_robot_serial
from vacuula_server.db import get_session
from vacuula_server.gen3.event_handler import robot_data
from vacuula_server.models.robot import Robot
from sqlalchemy import select
from typing import TYPE_CHECKING
from vacuula_server.generation import get_gen3_robot_data, get_robot_by_serial, Generation
from vacuula_server.conn import RobotConn, Gen2Gen3Conn
import traceback
if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)

def nucleo_heartbeat_thread(conn: RobotConn) -> None:
    while not conn.stop_event.is_set():
        if conn.stop_event.wait(30):
            return
        try:
            send_chunk(conn.conn.wfile, build_heartbeat())
        except Exception as e:
            logger.error("Gen3 heartbeat failed for %s: %s", conn.serial, e)
            conn.stop_event.set()
            return

def nucleo_init(req: RouterHandler) -> None:
    """POST /vendors/neato/login - robot commands"""
    if not (serial := get_robot_serial(req)): return

    if not (gen3_data := get_gen3_robot_data(serial)):
        req.send_not_found("Robot not found")
        return

    sock = req.connection
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    if hasattr(socket, "TCP_KEEPIDLE"):
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPIDLE, 60)
    if hasattr(socket, "TCP_KEEPINTVL"):
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 10)
    if hasattr(socket, "TCP_KEEPCNT"):
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 3)
    if hasattr(socket, "TCP_USER_TIMEOUT"):
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT, 20_000)
    sock.settimeout(60)

    req.send_response(200)
    req.send_header("Transfer-Encoding", "chunked")
    req.send_header("Connection", "close")
    req.end_headers()

    send_chunk(req.wfile, build_heartbeat())
    conn = RobotConn(serial, Generation.GEN3, Gen2Gen3Conn(gen3_data.password, req.wfile))
    robot_connections[serial] = conn
    logger.info("Robot %s connected", serial)
    notify_robots_changed()

    hb_t = threading.Thread(target=nucleo_heartbeat_thread, args=(conn,), daemon=True)
    hb_t.start()

    try:
        while True:
            data = req.rfile.readline()
            if not data:
                break
            robot_data(serial, data)
    except Exception:
        traceback.print_exc()
        pass
    finally:
        conn.stop_event.set()
        if robot_connections.get(serial) is conn:
            del robot_connections[serial]
            logger.info("Robot %s disconnected", serial)
            notify_robots_changed()
