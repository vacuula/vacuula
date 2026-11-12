from __future__ import annotations
import re

from vacuula_server.constants import MINIMUM_INSTALLER_VERSION

# Version format: X.X.X[-bX][+build info]
_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-b(\d+))?(?:\+([0-9A-Za-z.-]+))?$")

def parse_version(v: str) -> tuple:
    m = _VERSION_RE.match(v.strip())
    if not m:
        return (-999, -999, -999, float("-inf"))
    major, minor, patch, beta = m.group(1, 2, 3, 4)
    # real version comes before beta
    beta_rank = int(beta) if beta is not None else float("inf")
    return (int(major), int(minor), int(patch), beta_rank)


def is_robot_outdated(installed_with: str) -> bool:
    if 'dev' in installed_with:
        return False # If you are messing with dev versions, I expect you to know what you are doing!
    return parse_version(installed_with) < parse_version(MINIMUM_INSTALLER_VERSION)