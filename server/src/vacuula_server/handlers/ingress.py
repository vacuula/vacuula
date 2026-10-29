from __future__ import annotations

import json
import logging
import os
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

logger = logging.getLogger(__name__)
SUPERVISOR_IP = "172.30.32.2"


def get_ingress_port() -> int | None:
    token = os.environ.get("SUPERVISOR_TOKEN")
    if not token:
        return None

    request = Request(
        "http://supervisor/addons/self/info",
        headers={"Authorization": f"Bearer {token}"},
    )
    opener = build_opener(ProxyHandler({}))
    for attempt in range(3):
        try:
            with opener.open(request, timeout=5) as response:
                result = json.load(response)
            break
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(1)

    if result.get("result") != "ok":
        raise ValueError("Supervisor did not return app information")
    info = result["data"]
    if not info.get("ingress"):
        return None
    port = info.get("ingress_port")
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Supervisor did not assign a valid ingress port")
    return port


class IngressHTTPServer(ThreadingHTTPServer):
    def verify_request(self, request, client_address):
        return client_address[0] == SUPERVISOR_IP


def start_ingress(handler) -> ThreadingHTTPServer | None:
    port = get_ingress_port()
    if port is None:
        return None

    server = IngressHTTPServer(("0.0.0.0", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    logger.info("Vacuula ingress listening on port %d", port)
    return server
