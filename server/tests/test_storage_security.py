"""Storage regression tests use temporary directories and never contact robots."""
from __future__ import annotations

import io
import logging
from pathlib import Path
import tarfile
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from http.server import ThreadingHTTPServer
from http.client import HTTPConnection

logging.getLogger().addHandler(logging.NullHandler())

from vacuula_server.storage import atomic_write, component, storage_path
from vacuula_server.gen3.handlers import beehive, s3_upload as uploads
from vacuula_server.gen4 import handlers as gen4
from vacuula_server.gen3 import map_utils as gen3_maps
from vacuula_server.gen4 import map_utils as gen4_maps
from vacuula_server.handlers.router import RouterHandler


def archive(entries):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, content, kind in entries:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.size = len(content) if kind == tarfile.REGTYPE else 0
            info.linkname = "../outside"
            tar.addfile(info, io.BytesIO(content) if info.isfile() else None)
    return buffer.getvalue()


def multipart(serial="robot-123", job="job-123", filename="upload.tgz", kind="logs", content=b"sentinel"):
    fields = {"key": serial, "signature": job, "AWSAccessKeyId": kind}
    parts = [f'--boundary\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
             for key, value in fields.items()]
    parts.append(f'--boundary\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n\r\n'.encode()
                 + content + b"\r\n--boundary--\r\n")
    return b"".join(parts)


class StorageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.uploads = self.root / "uploads"
        self.patch = patch.object(uploads, "UPLOADS_DIR", self.uploads)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def upload(self, **kwargs):
        req = Mock(headers={"Content-Type": "multipart/form-data; boundary=boundary"})
        req.read_data.return_value = multipart(**kwargs)
        uploads.s3_upload(req)
        return req

    def test_rejects_invalid_components(self):
        for value in ("", ".", "..", "/tmp/file", "../file", "a/b", "a\\b", "a%2fb", "a\x00b", None, 42, "a" * 129):
            with self.subTest(value=value), self.assertRaises(ValueError):
                component(value)

    def test_accepts_existing_serial_uuid_and_filenames(self):
        for value in ("0123AB01C12345678", "robot-123", "abcd-1234-ef01", "FloorMap.png", "rank_binary.pgm.nz"):
            self.assertEqual(component(value), value)

    def test_upload_rejects_traversal_in_every_field(self):
        for key in ("serial", "job", "filename"):
            for value in ("../escape", str(self.root / "outside"), "a/b", "a\\b"):
                with self.subTest(key=key, value=value):
                    req = self.upload(**{key: value})
                    req.send_bad_request.assert_called_once()
                    req.send_created.assert_not_called()
        self.assertFalse((self.root / "outside").exists())

    def test_logs_use_server_filename_and_atomic_replace(self):
        req = self.upload(filename="client.log")
        req.send_created.assert_called_once()
        destination = self.uploads / "logs/robot-123/job-123/upload.bin"
        self.assertEqual(destination.read_bytes(), b"sentinel")
        self.assertFalse(destination.with_name("client.log").exists())
        self.upload(content=b"replacement")
        self.assertEqual(destination.read_bytes(), b"replacement")
        self.assertEqual(list(destination.parent.glob(".upload-*")), [])

    def test_upload_rejects_symlinked_directory(self):
        self.uploads.mkdir()
        (self.uploads / "logs").symlink_to(self.root, target_is_directory=True)
        self.upload().send_bad_request.assert_called_once()
        self.assertFalse((self.root / "robot-123").exists())

    def test_atomic_replace_does_not_follow_destination_link(self):
        outside = self.root / "outside"
        outside.write_bytes(b"original")
        target = self.root / "target"
        target.symlink_to(outside)
        atomic_write(target, b"replacement")
        self.assertEqual(outside.read_bytes(), b"original")
        self.assertFalse(target.is_symlink())

    def test_safe_path_rejects_destination_link(self):
        (self.root / "link").symlink_to(self.root / "outside")
        with self.assertRaises(ValueError):
            storage_path(self.root, "link")

    def test_valid_gen3_map_archive(self):
        content = archive([(name, b"fixture", tarfile.REGTYPE) for name in
                           ("./FloorMap.png", "./RunMap.png", "./manifest.json")])
        req = self.upload(kind="maps", content=content)
        req.send_created.assert_called_once()
        folder = self.uploads / "maps/robot-123/job-123"
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["FloorMap.png", "RunMap.png", "manifest.json"])

    def test_archive_is_validated_before_writing_members(self):
        for name, kind in (("../outside", tarfile.REGTYPE), ("/tmp/outside", tarfile.REGTYPE),
                           ("link", tarfile.SYMTYPE), ("hardlink", tarfile.LNKTYPE),
                           ("device", tarfile.CHRTYPE), ("pipe", tarfile.FIFOTYPE)):
            with self.subTest(name=name, kind=kind):
                content = archive([("FloorMap.png", b"valid", tarfile.REGTYPE), (name, b"bad", kind)])
                req = self.upload(kind="maps", content=content)
                req.send_bad_request.assert_called_once()
                self.assertFalse((self.uploads / "maps/robot-123/job-123/FloorMap.png").exists())

    def test_archive_has_expanded_size_and_member_limits(self):
        content = archive([("FloorMap.png", b"1234", tarfile.REGTYPE)])
        with patch.object(uploads, "MAX_ARCHIVE_BYTES", 3):
            self.upload(kind="maps", content=content).send_bad_request.assert_called_once()
        content = archive([("a", b"a", tarfile.REGTYPE), ("b", b"b", tarfile.REGTYPE)])
        with patch.object(uploads, "MAX_ARCHIVE_MEMBERS", 1):
            self.upload(kind="maps", content=content).send_bad_request.assert_called_once()

    def test_gen3_upload_init_rejects_unsafe_group_id(self):
        req = Mock(headers={"Authorization": "NEATOBOT robot-123:unverified"})
        req.read_json.return_value = {"group_id": "../outside"}
        beehive.upload_init(req, "maps")
        req.send_bad_request.assert_called_once()

    def test_gen3_upload_init_keeps_legacy_response_contract(self):
        req = Mock(headers={"Authorization": "NEATOBOT robot-123:unverified"})
        req.read_json.return_value = {"group_id": "job-123"}
        beehive.upload_init(req, "maps")
        result = req.send_created.call_args.args[0]
        self.assertEqual(result["id"], "job-123")
        self.assertEqual(result["params"]["signature"], "job-123")

    def test_gen4_rejects_map_escape_before_writing(self):
        robot = Mock(serial="robot-123")
        for serial, rank in (("../outside", "valid"), ("robot-123", "../outside"), ("robot-123", str(self.root / "outside"))):
            robot.serial = serial
            data = {"body": {"rank_uuid": rank, "map": {"rank_binary": "eA==", "real_binary": "eA=="}}}
            with patch.object(gen4, "MAPS_DIR", self.root / "maps"):
                self.assertEqual(gen4.maps_create(robot, data)[1], 400)
        self.assertFalse((self.root / "outside").exists())

    def test_gen4_valid_payload_writes_expected_files(self):
        data = {"body": {"rank_uuid": "job-123", "map": {"rank_binary": "cmFuaw==", "real_binary": "cmVhbA=="}}}
        with patch.object(gen4, "MAPS_DIR", self.root / "maps"), patch.object(gen4, "parse_session", side_effect=RuntimeError("stop before database")):
            with self.assertRaisesRegex(RuntimeError, "stop before database"):
                gen4.maps_create(Mock(serial="robot-123"), data)
        self.assertEqual((self.root / "maps/robot-123/job-123/rank_binary.pgm.nz").read_bytes(), b"rank")
        self.assertEqual((self.root / "maps/robot-123/job-123/real_binary.pgm.nz").read_bytes(), b"real")

    def test_generated_map_json_cannot_overwrite_symlink_target(self):
        source = self.root / "source"
        source.write_bytes(b"fixture")
        outside = self.root / "outside"
        outside.write_bytes(b"original")
        output = self.root / "output"
        output.mkdir()
        (output / "floormap.json").symlink_to(outside)
        for parser in (gen3_maps, gen4_maps):
            with self.subTest(parser=parser.__name__), patch.object(parser, "_parse_floor_map", return_value={}):
                with patch.object(gen3_maps, "detect_dock", return_value=None):
                    with self.assertRaises(ValueError):
                        parser.parse_session(source, source, output)
            self.assertEqual(outside.read_bytes(), b"original")

    def test_http_rejects_unsafe_route_before_dispatch(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), RouterHandler)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        for path in ("/api/robot/../run/job", "/api/robot/robot/run/../../outside", "/api/robot/robot/maps/a%2fb"):
            with self.subTest(path=path):
                connection = HTTPConnection(*server.server_address, timeout=3)
                self.addCleanup(connection.close)
                connection.request("GET", path)
                response = connection.getresponse()
                self.assertEqual(response.status, 400)
                response.read()


if __name__ == "__main__":
    unittest.main()
