from __future__ import annotations
import logging
import re
import io
import tarfile
from typing import TYPE_CHECKING

from vacuula_server.constants import UPLOADS_DIR
from vacuula_server.storage import component, storage_path, atomic_write

if TYPE_CHECKING:
    from vacuula_server.handlers.router import RouterHandler

logger = logging.getLogger(__name__)

def parse_multipart_form_data(body: bytes, boundary: str) -> tuple[dict, bytes | None, str | None]:
    boundary_bytes = boundary.encode()
    parts = body.split(b'--' + boundary_bytes)
    form_data = {}
    file_data = None
    filename = None

    for part in parts[1:-1]:
        if not part.strip():
            continue
        try:
            header_end = part.find(b'\r\n\r\n')
            if header_end == -1:
                header_end = part.find(b'\n\n')
                if header_end == -1:
                    continue
                headers_section = part[:header_end].decode('utf-8', errors='ignore')
                content = part[header_end+2:]
            else:
                headers_section = part[:header_end].decode('utf-8', errors='ignore')
                content = part[header_end+4:]
        except Exception:
            continue

        if content.endswith(b'\r\n'):
            content = content[:-2]
        elif content.endswith(b'\n'):
            content = content[:-1]

        disposition_match = re.search(r'name="([^"]+)"', headers_section)
        filename_match = re.search(r'filename="([^"]+)"', headers_section)

        if disposition_match:
            field_name = disposition_match.group(1)
            if filename_match:
                filename = filename_match.group(1)
                file_data = content
                form_data[field_name] = filename
            else:
                try:
                    form_data[field_name] = content.decode('utf-8')
                except Exception:
                    form_data[field_name] = content

    return form_data, file_data, filename


def s3_upload(req: RouterHandler) -> None:
    """POST / - S3 upload endpoint"""
    body = req.read_data()
    if body is None:
        return

    content_type = req.headers.get('Content-Type', '')
    boundary_match = re.search(r'boundary=([^\s;]+)', content_type)
    if not boundary_match:
        logger.error("No boundary in Content-Type")
        req.send_bad_request("No boundary in Content-Type")
        return

    form_data, file_data, filename = parse_multipart_form_data(body, boundary_match.group(1))

    robot_serial = form_data.get('key')           # we store robot serial in key
    upload_type = form_data.get('AWSAccessKeyId') # we store upload type in AWSAccessKeyId
    upload_id = form_data.get('signature')        # we store upload id in signature


    if not robot_serial or not upload_id or upload_type not in ('maps', 'logs'):
        logger.error("Missing or bad robot_serial, upload type or id")
        req.send_bad_request("Missing or bad robot_serial, upload type or id")
        return

    if not file_data or not filename:
        logger.error("Missing file")
        req.send_bad_request("Missing file")
        return

    try:
        component(filename)
        folder = storage_path(UPLOADS_DIR, upload_type, robot_serial, upload_id)
        if upload_type == "logs":
            # The multipart filename never chooses a destination on the server.
            atomic_write(storage_path(folder, "upload.bin"), file_data)
        else:
            save_map_archive(folder, file_data)
    except (ValueError, tarfile.TarError, EOFError):
        req.send_bad_request("Invalid upload paths or map archive")
        return
    except OSError:
        logger.exception("Could not save robot upload")
        req.send_internal_error("Failed to save upload")
        return

    req.send_created()


MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 128


def save_map_archive(folder, data: bytes) -> None:
    # Validate the entire archive before publishing any member. Only flat regular
    # files are needed by the robot protocol; links/devices/directories are refused.
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for index, member in enumerate(archive):
            if index >= MAX_ARCHIVE_MEMBERS:
                raise ValueError("Too many archive members")
            name = member.name.removeprefix("./")
            if member.isdir() and name in ("", "."):
                continue
            component(name)
            if not member.isfile() or member.size < 0 or name in files:
                raise ValueError("Unsupported archive member")
            total += member.size
            if total > MAX_ARCHIVE_BYTES:
                raise ValueError("Archive too large")
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError("Missing archive member")
            with stream:
                content = stream.read(member.size + 1)
            if len(content) != member.size:
                raise ValueError("Truncated archive member")
            storage_path(folder, name)
            files[name] = content
    for name, content in files.items():
        atomic_write(storage_path(folder, name), content)
