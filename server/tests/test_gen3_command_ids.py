"""Offline production-command regressions: python3 -m unittest discover -s server/tests -v."""
import importlib.util
import json
from pathlib import Path
import threading
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "src/vacuula_server/gen3/commands.py"


def load_commands():
    # Do not import the package initializer, database, or server bootstrap.
    package = types.ModuleType("vacuula_server")
    package.__path__ = []
    db = types.ModuleType("vacuula_server.db")
    db.__dict__["get_session"] = lambda: None
    generation = types.ModuleType("vacuula_server.generation")
    generation.__dict__["get_robot_by_serial"] = lambda serial: None
    generation.__dict__["get_gen3_robot_data"] = lambda serial: types.SimpleNamespace(password="fixture-password")
    spec = importlib.util.spec_from_file_location("commands_under_test", SOURCE)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    with patch.dict("sys.modules", {
        "vacuula_server": package,
        "vacuula_server.db": db,
        "vacuula_server.generation": generation,
    }):
        spec.loader.exec_module(module)
    return module


def payload(result):
    return json.loads(result[1].split(b"\r\n", 1)[1])


class CommandIdsTest(unittest.TestCase):
    def setUp(self):
        self.commands = load_commands()

    def test_sequential_contract_and_signature(self):
        cmd = {"cmd": "getRobotState", "params": {"label": "café"}}
        for expected in (1, 2, 3):
            result = self.commands.build_command("TEST-SERIAL", cmd)
            self.assertIsInstance(result, list)
            self.assertEqual(result[0], expected)
            self.assertEqual(payload(result), {**cmd, "reqId": str(expected)})
            header, body = result[1].decode().split("\r\n", 1)
            date, signature = header.split("|", 1)
            self.assertEqual(signature, self.commands.hmac_sha256(
                "test-serial\n" + date + "\n" + body, "fixture-password"))
            self.assertIn("café", body)
        self.assertNotIn("reqId", cmd)

    def test_caller_cannot_override_server_request_id(self):
        for supplied in ("external", "1", None, 99):
            with self.subTest(supplied=supplied):
                cmd = {"cmd": "getRobotState", "reqId": supplied}
                result = self.commands.build_command("TEST-SERIAL", cmd)
                self.assertEqual(payload(result)["reqId"], str(result[0]))
                self.assertEqual(cmd["reqId"], supplied)

    def test_concurrent_serialization_preserves_unique_correlation(self):
        barrier = threading.Barrier(2)
        dumps = json.dumps

        def overlapping_dumps(value, **kwargs):
            # Both payload dictionaries exist before either serialization finishes.
            barrier.wait(timeout=5)
            return dumps(value, **kwargs)

        with patch.object(self.commands.json, "dumps", side_effect=overlapping_dumps):
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(
                    lambda serial: self.commands.build_command(serial, {"cmd": "getRobotState"}),
                    ("ROBOT-A", "ROBOT-B")))
        returned = [str(result[0]) for result in results]
        wire = [payload(result)["reqId"] for result in results]
        self.assertEqual(len(set(returned)), 2)
        self.assertEqual(len(set(wire)), 2)
        self.assertEqual(wire, returned)
        # Mirror the handler's pending map and response lookup, in reverse reply order.
        pending = {str(result[0]): serial for serial, result in zip(("ROBOT-A", "ROBOT-B"), results)}
        for serial, result in reversed(list(zip(("ROBOT-A", "ROBOT-B"), results))):
            self.assertEqual(pending.pop(payload(result)["reqId"]), serial)
        self.assertEqual(pending, {})


if __name__ == "__main__":
    unittest.main()
