from __future__ import annotations
import logging
from vacuula_server.env import GEN3_PORT, HOST_IP
from vacuula_server.handlers.router import RouterHandler
from vacuula_server.logger import LoggingThreadingHTTPServer
from vacuula_server.tls import create_ssl_context
import threading
import threading

logger = logging.getLogger(__name__)

def start():
    # HTTPS server on gen3 port
    context = create_ssl_context()
    https_server_1 = LoggingThreadingHTTPServer((HOST_IP, GEN3_PORT), RouterHandler)
    https_server_1.socket = context.wrap_socket(https_server_1.socket, server_side=True)
    https_1_thread = threading.Thread(target=https_server_1.serve_forever, daemon=True)
    https_1_thread.start()
    logger.info("Gen3 listening on https://%s:%d", HOST_IP, GEN3_PORT)


