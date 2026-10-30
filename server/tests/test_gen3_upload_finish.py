"""Offline regressions: python3 -m unittest discover -s server/tests -v.

Load the complete production handler and serial helper without starting the
server. Unused ORM/image-processing imports are bootstrap seams; no third-party
packages, database, network, or robot are needed.
"""

import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch


SOURCE = Path(__file__).resolve().parents[1] / "src" / "vacuula_server"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def bootstrap_module(name, **attributes):
    module = types.ModuleType(name)
    module.__dict__.update(attributes)
    return module


class Request:
    headers = {"Authorization": "NEATOBOT test-robot:unused"}

    def __init__(self, success):
        self.success = success
        self.responses = []

    def read_json(self):
        return {"success": self.success}

    def send_bad_request(self, message):
        self.responses.append((400, message))

    def send_created(self):
        self.responses.append((201, None))

    def send_ok(self):
        self.responses.append((200, None))

    def send_internal_error(self):
        self.responses.append((500, None))


class UploadFinishTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.parse_session = Mock(side_effect=AssertionError("unexpected map parsing"))
        self.get_session = Mock(side_effect=AssertionError("unexpected database access"))
        self.db_commit = Mock(side_effect=AssertionError("unexpected database commit"))
        modules = {}
        for name in ("vacuula_server", "vacuula_server.gen3",
                     "vacuula_server.gen3.handlers", "vacuula_server.models"):
            modules[name] = bootstrap_module(name, __path__=[])
        imports = {
            "vacuula_server.constants": {"MAPS_DIR": self.folder.name},
            "vacuula_server.gen3.data": {"Gen3Data": object},
            "vacuula_server.gen3.map_utils": {"parse_session": self.parse_session},
            "vacuula_server.db": {"get_session": self.get_session,
                                  "db_commit": self.db_commit},
            "vacuula_server.models.robot": {"Robot": object},
            "vacuula_server.models.persistent_map": {"PersistentMap": object},
            "vacuula_server.models.run": {"Gen3__Run": object},
            "sqlalchemy": {"select": Mock(side_effect=AssertionError("unexpected query"))},
        }
        for name, attributes in imports.items():
            modules[name] = bootstrap_module(name, **attributes)
        isolation = patch.dict(sys.modules, modules)
        isolation.start()
        self.addCleanup(isolation.stop)
        load_module("vacuula_server.gen3.utils", SOURCE / "gen3" / "utils.py")
        self.handler = load_module(
            "vacuula_server.gen3.handlers.beehive",
            SOURCE / "gen3" / "handlers" / "beehive.py",
        )

    def assert_no_processing(self):
        self.parse_session.assert_not_called()
        self.get_session.assert_not_called()
        self.db_commit.assert_not_called()

    def test_failed_map_completion_sends_only_bad_request(self):
        request = Request(False)
        self.handler.upload_finish(request, "maps", "test-job")
        self.assertEqual(request.responses, [(400, "You said upload failed?")])
        self.assert_no_processing()

    def test_failed_log_completion_sends_only_bad_request(self):
        request = Request(False)
        self.handler.upload_finish(request, "logs", "test-job")
        self.assertEqual(request.responses, [(400, "You said upload failed?")])
        self.assert_no_processing()

    def test_successful_log_completion_still_sends_created(self):
        request = Request(True)
        self.handler.upload_finish(request, "logs", "test-job")
        self.assertEqual(request.responses, [(201, None)])
        self.assert_no_processing()


if __name__ == "__main__":
    unittest.main()
