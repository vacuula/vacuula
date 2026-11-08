from __future__ import annotations

import logging
import threading
from vacuula_server.constants import APP_VERSION
from vacuula_server.db import check_db_is_up_to_date
from vacuula_server.env import GEN3_ENABLED, GEN4_ENABLED, HA_INGRESS, MDNS_ENABLED
import vacuula_server.gen3.init 
import vacuula_server.gen4.init
import vacuula_server.handlers.init
from vacuula_server.handlers.init_ha_ingress import start as start_ha_ingress
from vacuula_server.handlers.setup import MDNSAdvertiser, ensure_ssl_certificate
from vacuula_server.logger import setup_logging

# welcome to the source code for vacuula. sorry for it being a mess, a cleanup effort is on the way.
# the big unexpected differances between the robot generations and wanting to release something as fast as
# possible has resulted in this. Please don't judge to hard lol
# some major todos i have in mind that i come to think of writing this:
# - better logging system for what is going on

setup_logging()
logger = logging.getLogger(__name__)

def main():
    logger.info("Starting Vacuula Server %s", APP_VERSION)
    check_db_is_up_to_date()
    ensure_ssl_certificate()
    if GEN3_ENABLED:
        threading.Thread(target=vacuula_server.gen3.init.start, daemon=True).start()
    if GEN4_ENABLED:
        threading.Thread(target=vacuula_server.gen4.init.start, daemon=True).start()

    threading.Thread(target=vacuula_server.handlers.init.start, daemon=True).start()
    if HA_INGRESS:
        threading.Thread(target=start_ha_ingress, daemon=True).start()

    mdns: MDNSAdvertiser | None = None
    if MDNS_ENABLED:
        mdns = MDNSAdvertiser()
        mdns.start()

    try:
        while True:
            threading.Event().wait(1)
    except KeyboardInterrupt:
        logger.info("Server stopping")
    finally:
        if mdns is not None:
            mdns.stop()
        logger.info("Server stopped")



if __name__ == "__main__":
    main()