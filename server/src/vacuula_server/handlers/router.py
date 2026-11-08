from __future__ import annotations
from http.server import BaseHTTPRequestHandler
import logging
from vacuula_server.constants import BASE_DIR
from vacuula_server.handlers.route_matcher import BrainslugHandler, BEEHIVE_ROUTES, NUCLEO_ROUTES, APP_ROUTES, S3_ROUTES
import json
import socket
import uuid

from pathlib import Path
import mimetypes
WEB_ROOT = BASE_DIR / "web"
WEB_ROOT_RESOLVED = WEB_ROOT.resolve()

SERVER_BOOT_ID = f"\"{uuid.uuid4().hex[:12]}\""

logger = logging.getLogger(__name__)


def _is_within_web_root(path: Path) -> bool:
    """True if `path` resolves to something inside WEB_ROOT."""
    try:
        path.relative_to(WEB_ROOT_RESOLVED)
        return True
    except ValueError:
        return False


class RouterHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        """Override to add CORS headers to app responses"""
        if (self.path.startswith("/api/")):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        super().end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight requests"""
        self.send_ok()

    def log_message(self, format, *args):
        logger.info("%s - - [%s] %s" % (self.client_address[0], self.log_date_time_string(), format % args))

    def read_data(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self.send_bad_request("Invalid Content-Length header")
            return None
        if content_length == 0:
            return b""
        return self.rfile.read(content_length)

    def read_json(self) -> dict | None:
        data = self.read_data()
        if data is None:
            return None
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            self.send_bad_request("Invalid JSON body")
            return None

    # Serve index.html and other files once per boot
    # Serve files from assets folder with long long cache
    # hash will change on update, and since index.html is checked per boot, will be good
    def serve_web(self):
        relative = self.path.split("?", 1)[0]
        requested = (WEB_ROOT / relative.lstrip("/")).resolve()

        if not _is_within_web_root(requested):
            self.send_not_found()
            return

        if not requested.is_file():
            if Path(relative).suffix == "":
                requested = WEB_ROOT_RESOLVED / "index.html"
            else:
                self.send_not_found()
                return

        parts = requested.relative_to(WEB_ROOT_RESOLVED).parts
        is_hashed_asset = len(parts) > 1 and parts[0] == "assets"

        if is_hashed_asset:
            cache_control = "public, max-age=31536000, immutable"
        else:
            cache_control = "no-cache"
            inm = self.headers.get("If-None-Match")
            if inm and SERVER_BOOT_ID in (tag.strip() for tag in inm.split(",")):
                self.send_response(304)
                self.send_header("ETag", SERVER_BOOT_ID)
                self.send_header("Cache-Control", cache_control)
                self.send_header("Content-Length", "0")
                self.send_header("Connection", "close")
                self.end_headers()
                return

        try:
            content = requested.read_bytes()
        except OSError:
            self.send_internal_error("Was not able to read files for webserver, did you build the frontend?")
            return

        content_type, _ = mimetypes.guess_type(str(requested))
        content_type = content_type or "application/octet-stream"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("ETag", SERVER_BOOT_ID)
        self.send_header("Cache-Control", cache_control)
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(content)
        self.wfile.flush()


    # Routing logic
    def route(self):
        accept = self.headers.get("Accept", "")
        
        if self.path.startswith("/api/"):
            return BrainslugHandler(APP_ROUTES, self)
        elif accept == "application/vnd.neato.beehive.v1+json":
            return BrainslugHandler(BEEHIVE_ROUTES, self)
        elif accept == "application/vnd.neato.cometa.v1":
            return BrainslugHandler(NUCLEO_ROUTES, self)
        elif self.path == "/" and self.command == "POST":
            return BrainslugHandler(S3_ROUTES, self)
        elif self.path == "/web" or self.path.startswith("/web/"):
            self.send_response(301)
            self.send_header("Location", "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
        else:
            self.serve_web()

    def do_POST(self):
        self.route()

    def do_GET(self):
        self.route()

    def do_PUT(self):
        self.route()

    def do_DELETE(self):
        self.route()

    def send_response_data(self, content, close=True, status=200, content_type="application/json", cache_control: str | None = None, content_disposition: str | None = None):
        if isinstance(content, (dict, list)):
            content = json.dumps(content).encode("utf-8")
        elif isinstance(content, str):
            content = content.encode("utf-8")

        self.send_response(status)

        self.send_header("Content-Type", content_type)
        if cache_control is not None:
            self.send_header("Cache-Control", cache_control)
        if content_disposition is not None:
            self.send_header("Content-Disposition", content_disposition)
        self.send_header("Content-Length", str(len(content)))
        if close:
            self.send_header("Connection", "close")
        self.end_headers()

        self.wfile.write(content)
        self.wfile.flush()

        if not close:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def send_text(self, data: bytes):
        self.send_response_data(data, close=True, status=200, content_type="text/plain; charset=utf-8", cache_control="no-store")

    def download_text(self, data: bytes, filename: str, content_type: str = "text/plain; charset=utf-8"):
        self.send_response_data(data, close=True, status=200, content_type=content_type, content_disposition=f'attachment; filename="{filename}"')

    def send_error_response(self, status, message):
        self.send_response_data({"error": message}, True, status=status)

    # Success helpers
    def send_ok(self, data=None, close=True):
        self.send_response_data(data if data is not None else "OK", close, status=200)

    def send_created(self, data=None, close=True):
        self.send_response_data(data if data is not None else "Created",close, status=201)

    # Error helpers
    def send_bad_request(self, message="Bad Request"):
        self.send_error_response(400, message)

    def send_unauthorized(self, message="Unauthorized"):
        self.send_error_response(401, message)

    def send_not_found(self, message="Not Found"):
        self.send_error_response(404, message)

    def send_internal_error(self, message="Internal Server Error"):
        self.send_error_response(500, message)
