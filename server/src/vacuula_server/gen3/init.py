from __future__ import annotations

import logging
import threading

from vacuula_server.env import GEN3_PORT, HOST_IP
from vacuula_server.handlers.router import RouterHandler
from vacuula_server.tls import TLSThreadingHTTPServer, create_ssl_context

logger = logging.getLogger(__name__)


def start():
    # TLS handshakes run in request threads, never in the accept loop.
    context = create_ssl_context()
    https_server_1 = TLSThreadingHTTPServer(
        (HOST_IP, GEN3_PORT), RouterHandler, ssl_context=context
    )
    https_1_thread = threading.Thread(target=https_server_1.serve_forever, daemon=True)
    https_1_thread.start()
    logger.info("Gen3 listening on https://%s:%d", HOST_IP, GEN3_PORT)
