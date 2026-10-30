from __future__ import annotations

from vacuula_server.generation import Generation
from socketserver import StreamRequestHandler
from ssl import SSLSocket
import threading
# Shared robot connection

class Gen2Gen3Conn:
    def __init__(self, password: str, wfile: StreamRequestHandler.wfile):
        self.password = password
        self.wfile = wfile
        self.write_lock = threading.Lock()

class Gen4Conn:
    def __init__(self, socket: SSLSocket):
        self.socket = socket

class RobotConn:
    def __init__(self, serial: str, gen: Generation, conn: Gen2Gen3Conn | Gen4Conn):
        self.serial = serial
        self.gen = gen
        self.conn = conn
        # self.addr = addr

        self.stop_event = threading.Event()

# from dataclasses import dataclass
# from typing import Literal, Union
# from ssl import SSLSocket


# @dataclass
# class Gen2Gen3Conn:
#     password: str
#     wfile: object  # replace with correct type


# @dataclass
# class Gen4Conn:
#     socket: SSLSocket


# @dataclass
# class RobotConn23:
#     gen: Literal[2, 3]
#     serial: str
#     conn: Gen2Gen3Conn


# @dataclass
# class RobotConn4:
#     gen: Literal[4]
#     serial: str
#     conn: Gen4Conn


# RobotConn = Union[RobotConn23, RobotConn4]