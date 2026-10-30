from __future__ import annotations
import logging
import socket
from vacuula_server.gen3.commands import send_chunk, build_heartbeat
from vacuula_server.state import robot_connections, abort_pending_requests
from vacuula_server.env import GEN3_TCP_USER_TIMEOUT_S, GEN3_SOCKET_TIMEOUT_S
from vacuula_server.handlers.events import notify_robots_changed
from vacuula_server.gen3.utils import get_robot_serial
from vacuula_server.db import get_session
from vacuula_server.gen3.event_handler import robot_data
from vacuula_server.models.robot import Robot
from sqlalchemy import select
from typing import TYPE_CHECKING
from vacuula_server.generation import get_gen3_robot_data, get_robot_by_serial, Generation
from vacuula_server.conn import RobotConn, Gen2Gen3Conn
if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)

def nucleo_init(req: RouterHandler) -> None:
    """POST /vendors/neato/login - robot commands"""
    if not (serial := get_robot_serial(req)): return

    if not (gen3_data := get_gen3_robot_data(serial)):
        req.send_not_found("Robot not found")
        return

    sock = req.connection
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    if hasattr(socket, "TCP_USER_TIMEOUT"):
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT, GEN3_TCP_USER_TIMEOUT_S * 1000)
    sock.settimeout(GEN3_SOCKET_TIMEOUT_S)

    req.send_response(200)
    req.send_header("Transfer-Encoding", "chunked")
    req.send_header("Connection", "close")
    req.end_headers()

    send_chunk(req.wfile, build_heartbeat())
    conn = RobotConn(serial, Generation.GEN3, Gen2Gen3Conn(gen3_data.password, req.wfile))
    robot_connections[serial] = conn
    logger.info("Robot %s connected", serial)
    notify_robots_changed()

    try:
        while True:
            data = req.rfile.readline()
            if not data:
                logger.info("Robot %s closed the connection (EOF)", serial)
                break
            robot_data(serial, data)
    except Exception as e:
        # log the cause to vacuula.log (previously only printed to stderr): a socket timeout
        # means the robot went silent, ETIMEDOUT means unacknowledged data hit TCP_USER_TIMEOUT
        logger.warning("Robot %s connection ended: %s: %s", serial, type(e).__name__, e)
        logger.debug("Robot %s connection traceback", serial, exc_info=True)
    finally:
        # only the connection that is still registered may unregister itself; if the robot
        # already reconnected, this (old) connection must not touch the new one
        if robot_connections.get(serial) is conn:
            del robot_connections[serial]
            logger.info("Robot %s disconnected", serial)
            notify_robots_changed()
        # requests sent on this connection can never be answered now; fail them right away
        # instead of letting callers wait for COMMAND_TIMEOUT_S
        if aborted := abort_pending_requests(conn):
            logger.info("Failed %d pending request(s) for robot %s", aborted, serial)
