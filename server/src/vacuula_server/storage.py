"""Keep robot-controlled names inside application-owned storage.

See server/docs/identifiers.md for generation-specific compatibility examples.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import tempfile


def component(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,127}", value):
        raise ValueError("Invalid storage identifier")
    return value


def storage_path(root: Path, *parts: str) -> Path:
    root = root.resolve()
    path = root
    for part in parts:
        path = path / component(part)
        if path.is_symlink():
            raise ValueError("Storage links are not permitted")
    if not path.resolve().is_relative_to(root):
        raise ValueError("Path outside storage directory")
    return path


def atomic_write(path: Path, data: bytes) -> None:
    """Replace the directory entry rather than following a destination symlink."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".upload-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
