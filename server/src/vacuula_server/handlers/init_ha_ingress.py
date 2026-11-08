from __future__ import annotations
import logging
import re
from vacuula_server.handlers.router import RouterHandler
import json
import threading
import urllib.request

from vacuula_server.env import HA_SUPERVISOR_TOKEN, HOST_IP
from vacuula_server.logger import LoggingThreadingHTTPServer

logger = logging.getLogger(__name__)

def start():
    # Vacuula server for HA Ingress
    logging.info("HA Ingress enabled, finding out port to listen on...")
    if HA_SUPERVISOR_TOKEN is None:
        logger.error("HA_SUPERVISOR_TOKEN is not set, cannot start Vacuula server for HA Ingress.")
        return

    ha_ingress_port, err = get_ha_ingress_port()
    if err is not None or ha_ingress_port is None:
        logger.error("Failed to get HA Ingress port: %s", err)
        return

    http_server = LoggingThreadingHTTPServer((HOST_IP, ha_ingress_port), RouterHandler)
    http_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    http_thread.start()

    logger.info("Vacuula Server for HA Ingress is listening on http://%s:%d", HOST_IP, ha_ingress_port)



def get_ha_ingress_port():
    req = urllib.request.Request(
        "http://supervisor/addons/self/info",
        headers={"Authorization": f"Bearer {HA_SUPERVISOR_TOKEN}"},
    )

    try:
        with urllib.request.urlopen(req) as response:
            port = json.load(response)["data"].get("ingress_port")
            return int(port), None
    except Exception as e:
        return None, e
