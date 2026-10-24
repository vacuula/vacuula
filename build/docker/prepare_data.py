"""Prepare a legacy data volume before importing or running the server.

Only ownership changes: contents, modes, certificates, and database schema are
left intact. Directory FDs and O_NOFOLLOW prevent following uploaded links.
This module intentionally has no application or third-party imports.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import sys
import tempfile

APP_UID = APP_GID = 10001
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK


def prepare_directory(path: Path) -> int:
    path.mkdir(mode=0o700, exist_ok=True)
    changed = 0
    with_fd = os.open(path, DIRECTORY_FLAGS)
    device = os.fstat(with_fd).st_dev

    def visit(fd: int) -> None:
        nonlocal changed
        info = os.fstat(fd)
        if info.st_dev != device:
            raise ValueError("Nested filesystems in the data directory are unsupported")
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError("Unsupported special file in data directory")
        if (info.st_uid, info.st_gid) != (APP_UID, APP_GID):
            if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise ValueError("Refusing to change ownership of a multiply-linked data file")
            os.fchown(fd, APP_UID, APP_GID)
            changed += 1
        if stat.S_ISDIR(info.st_mode):
            for name in sorted(os.listdir(fd)):
                child = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISLNK(child.st_mode):
                    continue
                if not (stat.S_ISDIR(child.st_mode) or stat.S_ISREG(child.st_mode)):
                    raise ValueError("Unsupported special file in data directory")
                flags = DIRECTORY_FLAGS if stat.S_ISDIR(child.st_mode) else FILE_FLAGS
                child_fd = os.open(name, flags, dir_fd=fd)
                try:
                    visit(child_fd)
                finally:
                    os.close(child_fd)

    try:
        visit(with_fd)
    finally:
        os.close(with_fd)
    return changed


def prepare_options(source: Path) -> Path | None:
    """Keep Supervisor-owned options readable without chowning HA's /data."""
    try:
        fd = os.open(source, FILE_FLAGS)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Home Assistant options must be a regular file")
        content = stream.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024 or not isinstance(json.loads(content), dict):
        raise ValueError("Home Assistant options must be a JSON object of at most 1 MiB")
    directory = Path(tempfile.mkdtemp(prefix="vacuula-options-"))
    path = directory / "options.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(content)
        os.fchown(stream.fileno(), APP_UID, APP_GID)
    os.chown(directory, APP_UID, APP_GID)
    return path


def main() -> None:
    try:
        changed = prepare_directory(Path("/server/data"))
        options = prepare_options(Path(os.environ.get("HA_OPTIONS_PATH", "/data/options.json")))
    except (OSError, ValueError) as error:
        print(f"Vacuula startup preparation failed: {error}", file=sys.stderr)
        print("Server not started. Check that its data volume is writable and startup has CHOWN/DAC_OVERRIDE capabilities.", file=sys.stderr)
        raise SystemExit(1)
    print(f"Vacuula data ready for UID/GID 10001; updated {changed} ownership entries.", file=sys.stderr)
    if options is not None:
        print(options)


if __name__ == "__main__":
    main()
