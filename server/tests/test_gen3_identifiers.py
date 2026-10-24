"""Synthetic Gen3 protocol fixtures; no robot or production data is accessed."""
from __future__ import annotations

from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import io
import json
import logging
from pathlib import Path
import queue
import tarfile
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote

from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

logging.getLogger().addHandler(logging.NullHandler())

from vacuula_server import db
from vacuula_server.gen3.handlers import beehive, s3_upload
from vacuula_server.handlers import app
from vacuula_server.handlers.router import RouterHandler
from vacuula_server.models.persistent_map import PersistentMap
from vacuula_server.models.robot import Robot
from vacuula_server.models.run import Gen3__Run
from vacuula_server.storage import component

from test_storage_security import archive, multipart


# The first timestamp is the format reported in PR #48's Gen3 review. The
# fractional and midnight cases exercise the same punctuation with distinct IDs.
GEN3_SERIAL = "00000000-0000-4000-8000-000000000003"
GEN3_RUN_IDS = (
    "2026-10-20T13:49:10Z",
    "2026-10-20T13:49:10.123Z",
    "2026-10-21T00:00:00Z",
)
GEN3_HEADERS = {
    "Accept": "application/vnd.neato.beehive.v1+json",
    "Authorization": f"NEATOBOT {GEN3_SERIAL}:synthetic-signature",
}


class Gen3IdentifierTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.uploads = self.root / "uploads"
        self.maps = self.uploads / "maps"
        self.engine = create_engine(f"sqlite:///{self.root / 'test.db'}")
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions.begin() as session:
            session.add(Robot(serial=GEN3_SERIAL, type="neato.gen3", name="Gen3 fixture"))
        for target, attribute, value in (
            (db, "SessionLocal", self.sessions),
            (app, "MAPS_DIR", self.maps),
            (beehive, "MAPS_DIR", self.maps),
            (s3_upload, "UPLOADS_DIR", self.uploads),
        ):
            patcher = patch.object(target, attribute, value)
            patcher.start()
            self.addCleanup(patcher.stop)

        completed = self.completed = queue.Queue()

        class TestRouter(RouterHandler):
            def finish(self):
                try:
                    super().finish()
                finally:
                    completed.put(None)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), TestRouter)
        self.server.handle_error = Mock()
        self.addCleanup(self.server.server_close)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 3)
        self.addCleanup(self.server.shutdown)

    def request(self, method, path, body=None, headers=None):
        headers = dict(headers or {})
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        connection = HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            status, data = response.status, response.read()
            connection.close()
            # upload_finish sends its acknowledgement before parsing/committing.
            # Wait for the whole handler before inspecting files or the database.
            self.completed.get(timeout=5)
            self.server.handle_error.assert_not_called()
            return status, data
        finally:
            connection.close()

    def initialize(self, run_id, kind="maps"):
        status, data = self.request("POST", f"/{kind}/upload_jobs",
                                    {"group_id": run_id}, GEN3_HEADERS)
        self.assertEqual(status, 201, data)
        result = json.loads(data)
        self.assertEqual(result["id"], run_id)
        self.assertEqual(result["params"]["key"], GEN3_SERIAL)
        self.assertEqual(result["params"]["signature"], run_id)
        return result["params"]

    def upload(self, parameters, content=b"synthetic log"):
        body = multipart(serial=parameters["key"], job=parameters["signature"],
                         kind=parameters["AWSAccessKeyId"],
                         filename=parameters["signature"] + ".tgz", content=content)
        return self.request("POST", "/", body,
                            {"Content-Type": "multipart/form-data; boundary=boundary"})

    def map_archive(self, run_id):
        floor = Image.new("L", (20, 20), 255)
        run = Image.new("L", (20, 20), 1)
        run.putpixel((5, 5), 100)
        run.putpixel((6, 5), 200)
        entries = []
        for name, image in (("FloorMap.png", floor), ("RunMap.png", run)):
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            entries.append(("./" + name, buffer.getvalue(), tarfile.REGTYPE))
        manifest = {"robot_serial": GEN3_SERIAL,
                    "run": {"id": run_id, "valid_as_persistent_map": True}}
        entries.append(("./manifest.json", json.dumps(manifest).encode(), tarfile.REGTYPE))
        return archive(entries)

    def test_timestamp_identifiers_are_valid_components(self):
        for run_id in GEN3_RUN_IDS:
            with self.subTest(run_id=run_id):
                self.assertEqual(component(run_id), run_id)

    def test_timestamp_map_upload_finalize_and_history_over_http(self):
        for index, run_id in enumerate(GEN3_RUN_IDS, 1):
            with self.subTest(run_id=run_id):
                parameters = self.initialize(run_id)
                status, data = self.upload(parameters, self.map_archive(run_id))
                self.assertEqual(status, 201, data)
                for job in (run_id, quote(run_id, safe="")):
                    status, data = self.request("PUT", f"/maps/upload_jobs/{job}",
                                                {"success": True}, GEN3_HEADERS)
                    self.assertEqual(status, 200, data)

                with self.sessions() as session:
                    saved = session.get(Gen3__Run, run_id)
                    self.assertIsNotNone(saved)
                    self.assertEqual(saved.run["id"], run_id)
                    self.assertEqual(session.get(PersistentMap, run_id).robot, GEN3_SERIAL)

                folder = self.maps / GEN3_SERIAL / run_id
                for endpoint, filename in (("maps", "floormap.json"), ("run", "runmap.json")):
                    expected = json.loads((folder / filename).read_bytes())
                    for job in (run_id, quote(run_id, safe="")):
                        status, data = self.request("GET", f"/api/robot/{GEN3_SERIAL}/{endpoint}/{job}")
                        self.assertEqual(status, 200, data)
                        actual = json.loads(data)
                        for key in ("width", "height", "rle"):
                            self.assertEqual(actual[key], expected[key])
                for endpoint in ("runs", "maps"):
                    status, data = self.request("GET", f"/api/robot/{GEN3_SERIAL}/{endpoint}")
                    self.assertEqual(status, 200, data)
                    records = json.loads(data)
                    self.assertEqual(len(records), index)
                    self.assertIn(run_id, [record["id"] for record in records])

    def test_timestamp_log_upload_and_finalize_over_http(self):
        for run_id in GEN3_RUN_IDS:
            with self.subTest(run_id=run_id):
                parameters = self.initialize(run_id, "logs")
                status, data = self.upload(parameters)
                self.assertEqual(status, 201, data)
                destination = self.uploads / "logs" / GEN3_SERIAL / run_id / "upload.bin"
                self.assertEqual(destination.read_bytes(), b"synthetic log")
                for job in (run_id, quote(run_id, safe="")):
                    status, data = self.request("PUT", f"/logs/upload_jobs/{job}",
                                                {"success": True}, GEN3_HEADERS)
                    self.assertEqual(status, 201, data)

    def test_timestamp_with_traversal_is_rejected_at_each_http_boundary(self):
        run_id = GEN3_RUN_IDS[0]
        invalid_ids = (f"../{run_id}", f"{run_id}/../../outside", f"{run_id}\\..\\outside")
        for invalid in invalid_ids:
            with self.subTest(run_id=invalid):
                status, data = self.request("POST", "/maps/upload_jobs",
                                            {"group_id": invalid}, GEN3_HEADERS)
                self.assertEqual(status, 400, data)
                parameters = {"key": GEN3_SERIAL, "signature": invalid, "AWSAccessKeyId": "logs"}
                status, data = self.upload(parameters)
                self.assertEqual(status, 400, data)
                for job in (invalid, quote(invalid, safe="")):
                    status, data = self.request("PUT", f"/maps/upload_jobs/{job}",
                                                {"success": True}, GEN3_HEADERS)
                    self.assertEqual(status, 400, data)
                    for endpoint in ("maps", "run"):
                        status, data = self.request("GET", f"/api/robot/{GEN3_SERIAL}/{endpoint}/{job}")
                        self.assertEqual(status, 400, data)
        self.assertFalse(self.uploads.exists())

    def test_percent_encoded_identifiers_are_decoded_only_in_url_paths_once(self):
        encoded = quote(GEN3_RUN_IDS[0], safe="")
        # JSON identifiers are literal protocol values, not URL-encoded values.
        status, data = self.request("POST", "/maps/upload_jobs",
                                    {"group_id": encoded}, GEN3_HEADERS)
        self.assertEqual(status, 400, data)
        for invalid in (quote(encoded, safe=""), "%252e%252e%252foutside"):
            for endpoint in ("maps", "run"):
                status, data = self.request("GET", f"/api/robot/{GEN3_SERIAL}/{endpoint}/{invalid}")
                self.assertEqual(status, 400, data)

    def test_timestamp_cannot_select_a_symlinked_upload_directory(self):
        run_id = GEN3_RUN_IDS[0]
        parameters = self.initialize(run_id)
        outside = self.root / "outside"
        outside.mkdir()
        serial_folder = self.maps / GEN3_SERIAL
        serial_folder.mkdir(parents=True)
        (serial_folder / run_id).symlink_to(outside, target_is_directory=True)
        status, data = self.upload(parameters, self.map_archive(run_id))
        self.assertEqual(status, 400, data)
        self.assertEqual(list(outside.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
