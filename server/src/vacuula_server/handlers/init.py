from __future__ import annotations
import logging
from vacuula_server.handlers.router import RouterHandler
from vacuula_server.handlers.ingress import start_ingress
import threading

from vacuula_server.env import HOST_IP, VACUULA_PORT
from vacuula_server.logger import LoggingThreadingHTTPServer

logger = logging.getLogger(__name__)

def start():
    # Vacuula server on vacuula port
    http_server = LoggingThreadingHTTPServer((HOST_IP, VACUULA_PORT), RouterHandler)
    http_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    http_thread.start()

    logger.info("Vacuula Server listening on http://%s:%d", HOST_IP, VACUULA_PORT)

    try:
        start_ingress(RouterHandler)
    except Exception:
        logger.exception("Could not start Home Assistant ingress; direct access remains available")
