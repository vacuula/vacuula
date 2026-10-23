from __future__ import annotations

import ssl

from vacuula_server.constants import CERT, KEY
from vacuula_server.logger import LoggingThreadingHTTPServer


class TLSThreadingHTTPServer(LoggingThreadingHTTPServer):
    """Accept TCP connections without doing TLS work in the accept loop."""

    handshake_timeout = 10.0

    def __init__(self, server_address, handler_class, *, ssl_context):
        self.ssl_context = ssl_context
        super().__init__(server_address, handler_class)

    def process_request_thread(self, request, client_address):
        tls_request = None
        request_timeout = request.gettimeout()
        try:
            tls_request = self.ssl_context.wrap_socket(
                request, server_side=True, do_handshake_on_connect=False
            )
            tls_request.settimeout(self.handshake_timeout)
            tls_request.do_handshake()
            # The deadline applies only to TLS, not long-poll/request reads.
            tls_request.settimeout(request_timeout)
        except OSError:
            self.shutdown_request(tls_request if tls_request is not None else request)
            return
        super().process_request_thread(tls_request, client_address)


def create_ssl_context():
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=CERT, keyfile=KEY)

    context.minimum_version = ssl.TLSVersion.TLSv1
    context.set_ciphers("ALL:@SECLEVEL=0")

    return context
