import sys
from pathlib import Path


# --------------------------------------------------------------------------
# Application metadata
# --------------------------------------------------------------------------
from vacuula_server._build_version import APP_VERSION
MINIMUM_INSTALLER_VERSION = "1.1.0-b3"

# --------------------------------------------------------------------------
# Application data directories
# --------------------------------------------------------------------------
def _base_dir() -> Path:
    # Inside a venv
    if sys.prefix != sys.base_prefix:
        return Path(sys.prefix).parent
    # fallback working directory
    return Path.cwd()

BASE_DIR = _base_dir()
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
MAPS_DIR = UPLOADS_DIR / "maps"

SSL_DIR = DATA_DIR / "ssl"
CERT = SSL_DIR / "cert.pem"
KEY = SSL_DIR / "privkey.pem"
CERT_CONFIG = BASE_DIR / "ssl" / "vacuula.cnf"

DB_PATH = DATA_DIR / "vacuula.db"
ALEMBIC_INI = BASE_DIR / "alembic.ini"



# --------------------------------------------------------------------------
# Application configuration
# --------------------------------------------------------------------------
LOG_BACKUP_COUNT = 3
LOG_TAIL_LINES = 500

