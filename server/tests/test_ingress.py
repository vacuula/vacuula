import importlib.util
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / "src/vacuula_server/handlers"


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SOURCE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IngressTests(unittest.TestCase):
    def test_assigned_ingress_port_preserves_public_port(self):
        ingress = load_module("ingress", "ingress.py")
        opener = Mock()
        opener.open.return_value = io.BytesIO(
            b'{"result":"ok","data":{"ingress":true,"ingress_port":62345}}'
        )
        handler = Mock()
        public_server = Mock()
        modules = {
            "vacuula_server.handlers.router": SimpleNamespace(RouterHandler=handler),
            "vacuula_server.handlers.ingress": ingress,
            "vacuula_server.env": SimpleNamespace(HOST_IP="0.0.0.0", VACUULA_PORT=81),
            "vacuula_server.logger": SimpleNamespace(LoggingThreadingHTTPServer=public_server),
        }
        with (
            patch.dict(sys.modules, modules),
            patch.dict("os.environ", {"SUPERVISOR_TOKEN": "test-token"}),
            patch.object(ingress, "build_opener", return_value=opener),
            patch.object(ingress, "IngressHTTPServer") as ingress_server,
            patch("threading.Thread"),
        ):
            load_module("listener_init", "init.py").start()

        public_server.assert_called_once_with(("0.0.0.0", 81), handler)
        ingress_server.assert_called_once_with(("0.0.0.0", 62345), handler)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "http://supervisor/addons/self/info")
        self.assertEqual(request.get_header("Authorization"), "Bearer test-token")


if __name__ == "__main__":
    unittest.main()
