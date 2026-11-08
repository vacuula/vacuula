import json
import os
import socket
from pathlib import Path
from typing import overload

DOCKER_HOST_NAME = "host.docker.internal"  # this is probably not needed soon?
HA_OPTIONS_PATH = Path(os.environ.get("HA_OPTIONS_PATH", "/data/options.json"))


def _load_ha_options() -> dict:
    """Load Home Assistant add-on options, if running as an add-on."""
    try:
        with HA_OPTIONS_PATH.open() as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"Could not read Home Assistant options at {HA_OPTIONS_PATH}: {e}")


_HA_OPTIONS = _load_ha_options()


def _get_raw(name: str):
    value = os.environ.get(name)
    if value is not None and value.strip() != "":
        return value
    return _HA_OPTIONS.get(name)


def _get_bool_env(name: str, default: bool) -> bool:
    value = _get_raw(name)
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return default
    if isinstance(value, bool):
        return value
    value_lower = str(value).lower()
    if value_lower in ("true", "1", "yes"):
        return True
    elif value_lower in ("false", "0", "no"):
        return False
    raise ValueError(f"{name} must be a boolean (true/false), got {value!r}")


def _get_int_env(name: str, default: int) -> int:
    value = _get_raw(name)
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return default
    try:
        return int(value)
    except (ValueError, TypeError):
        raise ValueError(f"{name} must be an integer, got {value!r}")


@overload
def _get_str_env(name: str, default: str) -> str: ...
@overload
def _get_str_env(name: str, default: str | None) -> str | None: ...
def _get_str_env(name: str, default: str | None) -> str | None:
    value = _get_raw(name)
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return default
    return str(value)

GEN3_PORT: int = _get_int_env("GEN3_PORT", 335)
GEN4_PORT: int = _get_int_env("GEN4_PORT", 3443)
VACUULA_PORT: int = _get_int_env("VACUULA_PORT", 8050)
GEN3_ENABLED: bool = _get_bool_env("GEN3_ENABLED", True)
GEN4_ENABLED: bool = _get_bool_env("GEN4_ENABLED", True)
MDNS_ENABLED: bool = _get_bool_env("MDNS_ENABLED", True)
HOST_IP: str = _get_str_env("HOST_IP", "0.0.0.0")
LOG_LEVEL: str = _get_str_env("LOG_LEVEL", "INFO").upper()

# HA Ingress stuff
# By config.yaml default for this value will be true, but others not running via HA App it never even has to pass this check
# SUPERVISOR_TOKEN is injected, should not be set by user
HA_INGRESS: bool = _get_bool_env("HA_INGRESS", False)
HA_SUPERVISOR_TOKEN: str | None = _get_str_env("SUPERVISOR_TOKEN", None)


# Validations
if len(set([GEN3_PORT, GEN4_PORT, VACUULA_PORT])) != 3:
    raise ValueError(
        "GEN3_PORT, GEN4_PORT and VACUULA_PORT must be unique for the server to work. "
        f"Got GEN3_PORT={GEN3_PORT}, GEN4_PORT={GEN4_PORT}, VACUULA_PORT={VACUULA_PORT}"
    )
if not (100 <= GEN3_PORT <= 999):
    raise ValueError(
        "GEN3_PORT must be in port range (100-999). "
        f"Got GEN3_PORT={GEN3_PORT}"
    )
if not (1 <= GEN4_PORT <= 65535 and 1 <= VACUULA_PORT <= 65535):
    raise ValueError(
        "GEN4_PORT and VACUULA_PORT must be in port range (1-65535). "
        f"Got GEN4_PORT={GEN4_PORT}, VACUULA_PORT={VACUULA_PORT}"
    )


def get_docker_host_ip() -> str | None:
    try:
        return socket.gethostbyname(DOCKER_HOST_NAME)
    except socket.gaierror:
        return None


def get_local_ip() -> str:
    """Return the IP of the local interface used for outbound traffic."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("9.9.9.9", 53))
        return sock.getsockname()[0]
    finally:
        sock.close()


def get_host_ip() -> str:
    if HOST_IP != '0.0.0.0':
        return HOST_IP
    return get_docker_host_ip() or get_local_ip()