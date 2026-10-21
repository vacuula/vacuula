"""Keep Home Assistant's Web UI shortcut on the configured Vacuula port."""

import json
import logging
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from vacuula_server.env import VACUULA_PORT

logger = logging.getLogger(__name__)


def update_webui_port() -> None:
    """Sync the app's own port metadata without changing its host networking."""
    token = os.environ.get("SUPERVISOR_TOKEN")
    if not token:
        return

    request = Request(
        "http://supervisor/addons/self/options",
        data=json.dumps({"network": {"80/tcp": VACUULA_PORT}}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=5):
            pass
    except OSError as err:
        if isinstance(err, HTTPError):
            err.close()
        logger.warning("Could not update Home Assistant Web UI port: %s", err)
