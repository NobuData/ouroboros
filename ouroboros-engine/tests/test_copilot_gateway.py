"""The urllib gateway against a real socket: a stream, the 501, a refusal, nothing listening."""

import json
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from ouroboros_engine.control_plane.client import ControlPlaneRequest
from ouroboros_engine.control_plane.contract import INVOCATION_NOT_IMPLEMENTED
from ouroboros_engine.copilot.contract import (
    GATEWAY_REFUSED,
    GATEWAY_UNAVAILABLE,
    GATEWAY_UNREACHABLE,
)
from ouroboros_engine.copilot.gateway import GatewayError, UrllibGateway

_LINES = [
    {"kind": "delta", "hop": 0, "text": "hi"},
    {"kind": "done", "hop": 0, "finish_reason": "stop"},
]


class _Handler(BaseHTTPRequestHandler):
    mode = "stream"
    seen: list[dict] = []  # noqa: RUF012 - reset per test by the server fixture

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length)) if length else {}
        type(self).seen.append(
            {"path": self.path, "headers": dict(self.headers), "body": body}
        )
        if self.mode == "501":
            self._refuse(501, INVOCATION_NOT_IMPLEMENTED, "AF.2 answers this.")
            return
        if self.mode == "403":
            self._refuse(403, "provider_not_leasable", "No.")
            return
        if self.mode == "html":
            payload = b"<html>gateway</html>"
            self.send_response(502)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        for line in _LINES:
            chunk = (json.dumps(line) + "\n").encode()
            self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
            self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")

    def _refuse(self, status: int, code: str, message: str) -> None:
        payload = json.dumps({"code": code, "message": message, "details": {}}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: object) -> None:
        """Keep the test output quiet."""


@pytest.fixture
def server() -> Iterator[HTTPServer]:
    _Handler.seen = []
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd
    finally:
        httpd.shutdown()
        httpd.server_close()


def _request(httpd: HTTPServer) -> ControlPlaneRequest:
    return ControlPlaneRequest(
        method="POST",
        url=f"http://127.0.0.1:{httpd.server_port}/internal/llm/invoke",
        headers={"X-Ouro-Internal-Key": "k", "Accept": "application/x-ndjson"},
        json={"alias": "coder-max", "payload": {}, "runCtx": {"run": "s"}},
        accept="application/x-ndjson",
    )


def test_a_streamed_answer_arrives_line_by_line(server: HTTPServer) -> None:
    _Handler.mode = "stream"
    lines = list(UrllibGateway(timeout=5).stream(_request(server)))

    assert [json.loads(line) for line in lines] == _LINES
    [seen] = _Handler.seen
    assert seen["path"] == "/internal/llm/invoke"
    assert seen["headers"]["X-Ouro-Internal-Key"] == "k"
    assert seen["headers"]["Content-Type"] == "application/json"
    assert seen["body"]["alias"] == "coder-max"


def test_the_501_before_af2_is_gateway_unavailable(server: HTTPServer) -> None:
    _Handler.mode = "501"
    with pytest.raises(GatewayError) as refused:
        list(UrllibGateway(timeout=5).stream(_request(server)))
    assert refused.value.code == GATEWAY_UNAVAILABLE
    assert "#235" in refused.value.message


def test_another_refusal_carries_its_code(server: HTTPServer) -> None:
    _Handler.mode = "403"
    with pytest.raises(GatewayError) as refused:
        list(UrllibGateway(timeout=5).stream(_request(server)))
    assert refused.value.code == GATEWAY_REFUSED
    assert "provider_not_leasable" in refused.value.message
    assert "No." in refused.value.message


def test_a_refusal_outside_the_envelope_is_named_by_status(server: HTTPServer) -> None:
    _Handler.mode = "html"
    with pytest.raises(GatewayError) as refused:
        list(UrllibGateway(timeout=5).stream(_request(server)))
    assert refused.value.code == GATEWAY_REFUSED
    assert "HTTP 502" in refused.value.message


def test_nothing_listening_is_unreachable() -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    outgoing = ControlPlaneRequest(
        method="POST",
        url=f"http://127.0.0.1:{port}/internal/llm/invoke",
        headers={},
        json={},
    )
    with pytest.raises(GatewayError) as refused:
        list(UrllibGateway(timeout=1).stream(outgoing))
    assert refused.value.code == GATEWAY_UNREACHABLE
