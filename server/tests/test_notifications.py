"""Offline protocol, persistence and history tests; no robot is contacted."""

from __future__ import annotations

import json
import logging
import queue
import struct
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.request import urlopen

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker

# Package import initializes logging. Keep tests from creating production log files.
logging.getLogger().addHandler(logging.NullHandler())

from vacuula_server import db
from vacuula_server.gen4 import handlers
from vacuula_server.handlers import events
from vacuula_server.handlers.route_matcher import APP_ROUTES, BrainslugHandler
from vacuula_server.handlers.router import RouterHandler
from vacuula_server.models.notification import RobotNotification
from vacuula_server.models.robot import Robot
from vacuula_server.notifications import get_notifications
from vacuula_server.state import client_connections


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.engine = create_engine(f"sqlite:///{self.directory.name}/test.db")
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.session_patch = patch.object(db, "SessionLocal", self.sessions)
        self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        with self.sessions.begin() as session:
            for serial in ("robot-a", "robot-b"):
                session.add(Robot(serial=serial, type="neato.gen4", name=serial))
        self.robot = SimpleNamespace(
            serial="robot-a", conn=SimpleNamespace(socket=Mock())
        )
        self.global_queue = queue.Queue(maxsize=100)
        self.robot_queue = queue.Queue(maxsize=100)
        self.other_queue = queue.Queue(maxsize=100)
        self.client_patch = patch.object(events, "_clients", [self.global_queue])
        self.client_patch.start()
        self.addCleanup(self.client_patch.stop)
        original = list(client_connections)
        client_connections[:] = [
            {"serial": "robot-a", "queue": self.robot_queue},
            {"serial": "robot-b", "queue": self.other_queue},
        ]
        self.addCleanup(lambda: client_connections.__setitem__(slice(None), original))

    def request(self, request_id="request-1", body=None, robot=None):
        robot = robot or self.robot
        message = {
            "type": "request",
            "id": request_id,
            "to": {"service": "robots.notify"},
            "body": body
            if body is not None
            else {
                "message_code": "nav_floorplan_zone_unreachable",
                "payload": {"zone_name": "Kitchen", "details": {"reason": "blocked"}},
            },
        }
        handlers.roboot_request(robot, request_id, message)
        packet = robot.conn.socket.sendall.call_args.args[0]
        self.assertEqual(struct.unpack(">I", packet[:4])[0], len(packet) - 4)
        response = json.loads(packet[4:])
        self.assertEqual(response["id"], request_id)
        self.assertEqual(response["type"], "response")
        return response

    def history(self, serial="robot-a", query=""):
        req = Mock(path=f"/api/robot/{serial}/notifications{query}")
        get_notifications(req, serial)
        return req

    def count(self):
        with self.sessions() as session:
            return len(session.scalars(select(RobotNotification)).all())

    def test_acknowledges_persists_and_delivers_to_both_streams(self):
        response = self.request()
        self.assertEqual(response["code"], 200)
        self.assertEqual(response["body"], {})
        record = self.history().send_ok.call_args.args[0]["notifications"][0]
        self.assertEqual(record["robot"], "robot-a")
        self.assertEqual(record["payload"]["zone_name"], "Kitchen")
        self.assertTrue(record["received_at"].endswith("Z"))
        self.assertEqual(self.global_queue.get_nowait(), self.robot_queue.get_nowait())
        self.assertTrue(self.other_queue.empty())

    def test_sse_is_named_and_preserves_context(self):
        self.request(
            body={
                "message_code": "future_code",
                "payload": {"zone_name": "Café\nUpstairs"},
            }
        )
        frame = self.global_queue.get_nowait().decode()
        self.assertTrue(frame.startswith("event: notification\ndata: "))
        record = json.loads(frame.split("data: ", 1)[1])
        self.assertEqual(record["message_code"], "future_code")
        self.assertEqual(record["payload"]["zone_name"], "Café\nUpstairs")
        self.assertEqual(frame.count("\n\n"), 1)

    def test_notification_is_committed_before_publishing(self):
        observed = []

        def check_committed(notification):
            with self.sessions() as session:
                stored = session.get(RobotNotification, notification["id"])
                observed.append(
                    (stored.as_dict() if stored is not None else None, notification)
                )

        with patch(
            "vacuula_server.notifications._publish", side_effect=check_committed
        ) as publish:
            self.assertEqual(self.request()["code"], 200)
            publish.assert_called_once()
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0][0], observed[0][1])

    def test_no_subscribers_still_persists_and_acknowledges(self):
        client_connections.clear()
        with patch.object(events, "_clients", []):
            self.assertEqual(self.request()["code"], 200)
        self.assertEqual(self.count(), 1)

    def test_null_and_omitted_payloads_are_accepted(self):
        for index, body in enumerate(
            (
                {"message_code": "routine_cleaning_start"},
                {"message_code": "routine_cleaning_start", "payload": None},
            )
        ):
            self.assertEqual(self.request(str(index), body)["code"], 200)
        self.assertTrue(
            all(
                item["payload"] is None
                for item in self.history().send_ok.call_args.args[0]["notifications"]
            )
        )

    def test_duplicate_request_is_acknowledged_without_rebroadcast(self):
        self.request()
        self.assertEqual(self.request()["code"], 200)
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.global_queue.qsize(), 1)
        self.assertEqual(self.robot_queue.qsize(), 1)

    def test_request_ids_are_scoped_to_robot(self):
        self.request()
        other = SimpleNamespace(serial="robot-b", conn=SimpleNamespace(socket=Mock()))
        self.assertEqual(self.request(robot=other)["code"], 200)
        self.assertEqual(self.count(), 2)

    def test_concurrent_duplicate_is_saved_and_published_once(self):
        def notify(_):
            return handlers.robots_notify(
                self.robot,
                {
                    "id": "same-request",
                    "body": {"message_code": "routine_cleaning_start"},
                },
            )

        with ThreadPoolExecutor(max_workers=8) as executor:
            responses = list(executor.map(notify, range(16)))
        self.assertTrue(all(code == 200 for _, code in responses))
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.global_queue.qsize(), 1)

    def test_repeated_code_with_new_request_id_remains_a_separate_event(self):
        self.request("first")
        self.request("second")
        self.assertEqual(self.count(), 2)

    def test_invalid_notifications_are_rejected_without_delivery(self):
        for body in (
            [],
            "invalid",
            {},
            {"message_code": " "},
            {"message_code": 42},
            {"message_code": "x" * 129},
            {"message_code": "test", "payload": []},
            {"message_code": "test", "payload": {"value": float("nan")}},
        ):
            with self.subTest(body=body):
                self.assertEqual(self.request(body=body)["code"], 400)
        self.assertEqual(self.count(), 0)
        self.assertTrue(self.global_queue.empty())

    def test_invalid_request_id_is_rejected(self):
        for request_id in (None, "", " ", 7, "x" * 129):
            self.assertEqual(self.request(request_id=request_id)["code"], 400)
        self.assertEqual(self.count(), 0)

    def test_oversized_payload_is_rejected(self):
        self.assertEqual(
            self.request(
                body={"message_code": "test", "payload": {"data": "x" * 16384}}
            )["code"],
            413,
        )
        self.assertEqual(self.count(), 0)

    def test_storage_failure_returns_500_and_does_not_publish(self):
        with (
            patch(
                "vacuula_server.notifications.get_session",
                side_effect=RuntimeError("storage unavailable"),
            ),
            patch.object(handlers.logger, "exception") as log,
        ):
            self.assertEqual(self.request()["code"], 500)
            log.assert_called_once()
        self.assertTrue(self.global_queue.empty())

    def test_delivery_failure_still_acknowledges_committed_history(self):
        with (
            patch(
                "vacuula_server.notifications._publish",
                side_effect=RuntimeError("delivery failed"),
            ),
            patch("vacuula_server.notifications.logger.exception") as log,
        ):
            self.assertEqual(self.request()["code"], 200)
            log.assert_called_once()
        self.assertEqual(self.count(), 1)

    def test_full_client_queue_does_not_block_or_lose_history(self):
        for _ in range(100):
            self.robot_queue.put_nowait(b"old")
        self.assertEqual(self.request()["code"], 200)
        self.assertEqual(self.robot_queue.qsize(), 100)
        self.assertEqual(self.count(), 1)

    def test_history_is_persistent_and_pages_do_not_shift_after_new_arrivals(self):
        for index in range(3):
            self.request(str(index))
        first = self.history(query="?limit=2").send_ok.call_args.args[0]
        self.assertEqual([item["id"] for item in first["notifications"]], [3, 2])
        self.assertEqual(first["next_before"], 2)
        self.engine.dispose()  # Reopen connections, rather than using an in-memory cache.
        self.request("new-arrival")
        second = self.history(query="?limit=2&before=2").send_ok.call_args.args[0]
        self.assertEqual([item["id"] for item in second["notifications"]], [1])
        self.assertIsNone(second["next_before"])
        self.assertEqual(
            self.history("robot-b").send_ok.call_args.args[0]["notifications"], []
        )

    def test_bad_history_query_and_unknown_robot(self):
        for query in (
            "?limit=0",
            "?limit=101",
            "?limit=abc",
            "?limit=",
            "?before=-1",
            "?before=0",
            "?before=",
            "?before=9223372036854775808",
            "?limit=1&limit=2",
            "?before=1&before=2",
        ):
            with self.subTest(query=query):
                self.history(query=query).send_bad_request.assert_called_once()
        self.history("unknown").send_not_found.assert_called_once()

    def test_new_route_is_dispatched(self):
        req = Mock(command="GET", path="/api/robot/robot-a/notifications?limit=2")
        BrainslugHandler(APP_ROUTES, req)
        req.send_ok.assert_called_once_with({"notifications": [], "next_before": None})

    def test_history_over_http(self):
        self.request()
        server = ThreadingHTTPServer(("127.0.0.1", 0), RouterHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/api/robot/robot-a/notifications?limit=1"
            with urlopen(url, timeout=5) as response:
                self.assertEqual(response.status, 200)
                result = json.load(response)
            self.assertEqual(
                result["notifications"][0]["message_code"],
                "nav_floorplan_zone_unreachable",
            )
            self.assertIsNone(result["next_before"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


class MigrationTests(unittest.TestCase):
    def test_upgrade_existing_database_and_downgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            url = f"sqlite:///{directory}/migration.db"
            config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
            with patch.object(db, "DATABASE_URL", url):
                command.upgrade(config, "5fe01baecb7b")
                engine = create_engine(url)
                with engine.begin() as connection:
                    connection.execute(
                        Robot.__table__.insert().values(
                            serial="existing", type="neato.gen4", name="Existing robot"
                        )
                    )
                command.upgrade(config, "head")
                self.assertIn("robot_notification", inspect(engine).get_table_names())
                with engine.connect() as connection:
                    self.assertEqual(
                        connection.execute(select(Robot.serial)).scalar_one(),
                        "existing",
                    )
                command.downgrade(config, "5fe01baecb7b")
                self.assertNotIn(
                    "robot_notification", inspect(engine).get_table_names()
                )
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
