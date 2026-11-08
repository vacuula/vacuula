from __future__ import annotations
from http.server import ThreadingHTTPServer
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from vacuula_server.constants import DATA_DIR, LOG_BACKUP_COUNT
from vacuula_server.env import LOG_LEVEL

def get_log_file_path() -> Path:
    return DATA_DIR / "vacuula.log"

def setup_logging() -> None:
    root_logger = logging.getLogger()
    root_logger.setLevel(LOG_LEVEL)

    # Avoid duplicate handlers.
    if root_logger.handlers:
        return

    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console = logging.StreamHandler(sys.stderr)
    console.setLevel(LOG_LEVEL)
    console.setFormatter(formatter)
    root_logger.addHandler(console)


    log_file = get_log_file_path()
    handler = RotatingFileHandler(
        log_file,
        maxBytes=2 * 1024 * 1024,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )

    handler.setLevel(LOG_LEVEL)
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

def get_log_files() -> list[Path]:
    base = get_log_file_path()
    files = [base.with_name(f"{base.name}.{i}") for i in range(LOG_BACKUP_COUNT, 0, -1)]
    files.append(base)
    return [f for f in files if f.exists()]


logger = logging.getLogger(__name__)


class LoggingThreadingHTTPServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        logger.exception(
            "Unhandled exception while processing HTTP request from %s",
            client_address,
        )