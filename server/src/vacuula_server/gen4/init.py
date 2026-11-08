from __future__ import annotations
import logging
from vacuula_server.env import GEN4_PORT, HOST_IP
from vacuula_server.handlers.events import notify_robots_changed
from vacuula_server.tls import CERT, KEY
import threading
import socket, ssl, struct, json
from vacuula_server.generation import Generation
from vacuula_server.conn import RobotConn, Gen4Conn
from vacuula_server.gen4.handlers import handle_login, robot_response, heartbeat_thread, robot_event, roboot_request
from vacuula_server.state import robot_connections

logger = logging.getLogger(__name__)

ROBOT_SOCKET_TIMEOUT_S = 20

def start():
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((HOST_IP, GEN4_PORT))
        sock.listen(5)
        logger.info("Gen4 listening on %s:%d", HOST_IP, GEN4_PORT)

        while True:
            client, addr = sock.accept()
            client.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            client.setsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT, 20_000)

            try:
                tls = ctx.wrap_socket(client, server_side=True)
            except ssl.SSLError as e:
                logger.error("TLS handshake failed from %s: %s", addr, e)
                client.close()
                continue

            threading.Thread(target=handle_robot, args=(tls, addr), daemon=True).start()



def recv_packet(sock):
    hdr = b""
    while len(hdr) < 4:
        try:
            chunk = sock.recv(4 - len(hdr))
        except TimeoutError:
            continue
        if not chunk:
            return None
        hdr += chunk
    (n,) = struct.unpack(">I", hdr)
    if n == 0:
        return b""
    if n > 10 * 1024 * 1024:
        return None
    data = b""
    while len(data) < n:
        try:
            chunk = sock.recv(min(65536, n - len(data)))
        except TimeoutError:
            continue
        if not chunk:
            return None
        data += chunk
    return data


def handle_robot(conn, addr):
    rc = RobotConn("<unknown>", Generation.GEN4, Gen4Conn(conn))
    conn.settimeout(ROBOT_SOCKET_TIMEOUT_S)

    try:
        json_count = 0
        while True:

            raw = recv_packet(conn)
            if raw is None:
                break

            if raw == b"\x06":
                logger.debug("heartbeat from %s", rc.serial or addr)
                continue
            if raw == b"\x00":
                logger.info("CLOSE from %s", rc.serial or addr)
                break

            try:
                msg = json.loads(raw)
            except Exception as e:
                logger.warning("non-JSON packet from %s: %s raw=%r", rc.serial or addr, e, raw[:80])
                continue

            json_count += 1 # TODO: verify and remove that a counter does not need to be here, after initial release
            if json_count == 1 and "signature" in msg:
                threading.Thread(target=handle_login, args=(rc, msg), daemon=True).start()
                hb_t = threading.Thread(target=heartbeat_thread, args=(rc,), daemon=True)
                hb_t.start()
                continue

            msg_id = msg.get("id")
            msg_type = msg.get("type")
            if msg_type == "event":
                robot_event(rc, msg)
            elif msg_type == "response":
                robot_response(rc, msg)
            elif msg_type == "request":
                threading.Thread(target=roboot_request, args=(rc, msg_id, msg), daemon=True).start()
            else:
                logger.warning("unknown msg type %r from %s: %s", msg_type, rc.serial or addr, json.dumps(msg)[:200])

    except Exception as e:
        logger.error("error handling robot %s: %s", rc.serial or addr, e)
        import traceback
        traceback.print_exc()
    finally:
        rc.stop_event.set()
        del robot_connections[rc.serial]
        logger.info("Robot %s disconnected", rc.serial or addr)
        notify_robots_changed()
        try:
            conn.close()
        except Exception:
            logger.error("error closing connection for robot %s", rc.serial or addr)
            pass

