"""Real loopback TLS regressions; no robot, external service or installed certs."""

import socket
import ssl
import subprocess
import tempfile
import threading
import unittest
import warnings
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, cast
from unittest.mock import patch

from vacuula_server import tls
from vacuula_server.gen3 import init as gen3


class EchoHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        cast(Any, self.server).handler_timeouts.append(self.connection.gettimeout())
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


class TLSServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix="vacuula-tls-")
        cls.addClassCleanup(cls.scratch.cleanup)
        directory = Path(cls.scratch.name)
        cls.cert = directory / "cert.pem"
        cls.key = directory / "key.pem"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(cls.key),
                "-out",
                str(cls.cert),
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=IP:127.0.0.1",
            ],
            check=True,
            capture_output=True,
            timeout=10,
            umask=0o077,
        )
        cls.client_context = ssl.create_default_context(cafile=str(cls.cert))

    @contextmanager
    def running_server(self, handshake_timeout=0.25, request_timeout=None):
        # Exercise start(), including its bind address and TLS configuration.
        # The fallback deliberately runs this same test on unmodified upstream.
        server_name = (
            "TLSThreadingHTTPServer"
            if hasattr(gen3, "TLSThreadingHTTPServer")
            else "LoggingThreadingHTTPServer"
        )
        server_class = getattr(gen3, server_name)
        servers = []
        threads = []
        entered_accept = threading.Event()

        class ObservedServer(server_class):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.handshake_timeout = handshake_timeout
                self.workers = []
                self.requests = []
                self.errors = []
                self.handler_timeouts = []
                servers.append(self)

            def get_request(self):
                entered_accept.set()
                request, address = super().get_request()
                request.settimeout(request_timeout)
                return request, address

            def shutdown_request(self, request):
                self.requests.append(request)
                return super().shutdown_request(request)

            def process_request_thread(self, request, address):
                self.workers.append(threading.current_thread())
                self.requests.append(request)
                return super().process_request_thread(request, address)

            def handle_error(self, request, address):
                self.errors.append(address)

            def serve_forever(self, *args, **kwargs):
                threads.append(threading.current_thread())
                return super().serve_forever(poll_interval=0.01)

        with (
            patch.object(gen3, server_name, ObservedServer),
            patch.object(gen3, "HOST_IP", "127.0.0.1"),
            patch.object(gen3, "GEN3_PORT", 0),
            patch.object(gen3, "RouterHandler", EchoHandler),
            patch.object(tls, "CERT", self.cert),
            patch.object(tls, "KEY", self.key),
            warnings.catch_warnings(),
        ):
            # Upstream deliberately allows TLSv1 for legacy robots; unchanged.
            warnings.simplefilter("ignore", DeprecationWarning)
            gen3.start()
            server = servers[0]
            try:
                self.assertEqual(server.server_address[0], "127.0.0.1")
                yield server, entered_accept
            finally:
                server.shutdown()
                server.server_close()
                for thread in threads + server.workers:
                    thread.join(timeout=2)
                    self.assertFalse(thread.is_alive(), "TLS server thread leaked")
                self.assertEqual(server.socket.fileno(), -1)
                for request in server.requests:
                    self.assertEqual(request.fileno(), -1, "accepted socket leaked")
                self.assertEqual(server.errors, [], "unexpected worker exception")

    def connect_tls(self, server):
        raw = socket.create_connection(server.server_address, timeout=1)
        try:
            return self.client_context.wrap_socket(raw, server_hostname="127.0.0.1")
        except BaseException:
            raw.close()
            raise

    def assert_echo(self, client, body=b"normal request"):
        client.sendall(
            b"POST / HTTP/1.0\r\nContent-Length: "
            + str(len(body)).encode()
            + b"\r\n\r\n"
            + body
        )
        self.assert_response(client, body)

    def assert_response(self, client, body):
        response = bytearray()
        while data := client.recv(4096):
            response.extend(data)
        self.assertIn(b"200 OK", response)
        self.assertEqual(bytes(response).split(b"\r\n\r\n", 1)[1], body)

    def test_handshake_timeout_does_not_limit_request_body_reads(self):
        with (
            self.running_server() as (server, _),
            self.connect_tls(server) as client,
        ):
            client.sendall(b"POST / HTTP/1.0\r\nContent-Length: 4\r\n\r\na")
            client.settimeout(0.6)  # Longer than the 0.25s handshake deadline.
            with self.assertRaises(TimeoutError):
                client.recv(1)
            client.sendall(b"bcd")
            client.settimeout(1)
            self.assert_response(client, b"abcd")

    def test_existing_request_timeout_is_restored(self):
        with self.running_server(request_timeout=0.75) as (server, _):
            with self.connect_tls(server) as client:
                self.assert_echo(client)
            self.assertEqual(server.handler_timeouts, [0.75])

    def assert_bad_peer_isolated(self, payload):
        with self.running_server() as (server, _):
            with socket.create_connection(server.server_address, timeout=1) as bad:
                bad.sendall(payload)
                try:
                    received = bytearray()
                    while data := bad.recv(1024):
                        received.extend(data)
                        self.assertLess(len(received), 4096)
                    self.assertNotIn(b"HTTP/", received)
                except ConnectionResetError:
                    pass  # TLS may close with unread plaintext still buffered.
            with self.connect_tls(server) as client:
                self.assert_echo(client)

    def test_plaintext_peer_is_disconnected_without_affecting_tls(self):
        self.assert_bad_peer_isolated(b"GET / HTTP/1.0\r\n\r\n")

    def test_invalid_tls_peer_is_disconnected_without_affecting_tls(self):
        # A complete TLS record with an invalid handshake message type.
        self.assert_bad_peer_isolated(b"\x16\x03\x03\x00\x04\xff\x00\x00\x00")

    def test_incomplete_tls_peer_is_disconnected_without_affecting_tls(self):
        self.assert_bad_peer_isolated(b"\x16\x03\x03\x00\x01\x00")

    def test_early_disconnect_does_not_affect_next_tls_client(self):
        with self.running_server() as (server, _):
            with socket.create_connection(server.server_address, timeout=1):
                pass
            with self.connect_tls(server) as client:
                self.assert_echo(client)

    def test_silent_peer_is_disconnected_after_handshake_timeout(self):
        with (
            self.running_server() as (server, entered_accept),
            socket.create_connection(server.server_address, timeout=1) as silent,
        ):
            self.assertTrue(entered_accept.wait(1))
            try:
                self.assertEqual(silent.recv(1), b"")
            except TimeoutError:
                self.fail("silent TLS handshake was not bounded")

    def test_silent_peer_does_not_block_second_tls_client(self):
        # Keep the first socket silent beyond the second client's deadline.
        with (
            self.running_server(handshake_timeout=5) as (server, entered_accept),
            socket.create_connection(server.server_address, timeout=1),
        ):
            self.assertTrue(entered_accept.wait(1))
            try:
                client = self.connect_tls(server)
            except TimeoutError:
                self.fail("silent first peer blocked the second TLS handshake")
            with client:
                self.assert_echo(client)


if __name__ == "__main__":
    unittest.main()
