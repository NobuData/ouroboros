"""The transport, against a real HTTP server on loopback: what it sends and what it retries."""

import json
import threading
from collections.abc import Iterator
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from ouroboros_engine.control_plane.client import ControlPlaneRequest
from ouroboros_simulator.transport import HttpTransport, TransportError


class _Recorder:
    """What the server received, and the answers it has left to give."""

    def __init__(self) -> None:
        """Start with nothing received and a plain ``200`` to give."""
        self.received: list[tuple[str, str, dict[str, str], bytes]] = []
        self.answers: list[tuple[int, bytes]] = []


@pytest.fixture
def server() -> Iterator[tuple[str, _Recorder]]:
    recorder = _Recorder()

    class Handler(BaseHTTPRequestHandler):
        def _answer(self) -> None:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            recorder.received.append(
                (self.command, self.path, dict(self.headers), body)
            )
            status, payload = (
                recorder.answers.pop(0) if recorder.answers else (200, b'{"ok": true}')
            )
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        do_POST = _answer  # noqa: N815 - the stdlib's naming
        do_PUT = _answer  # noqa: N815 - the stdlib's naming

        def log_message(self, *_: object) -> None:
            return

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}", recorder
    finally:
        httpd.shutdown()
        httpd.server_close()


def _request(base: str, method: str = "POST") -> ControlPlaneRequest:
    return ControlPlaneRequest(
        method=method,
        url=f"{base}/internal/runs/r/events",
        headers={
            "X-Ouro-Internal-Key": "k",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        json={"idempotencyKey": "sim-1", "events": []},
    )


def test_it_sends_the_method_the_headers_and_the_json_body(
    server: tuple[str, _Recorder],
) -> None:
    base, recorder = server

    answer = HttpTransport().send(_request(base, "PUT"))

    assert answer.status == HTTPStatus.OK
    assert answer.body == {"ok": True}
    method, path, headers, body = recorder.received[0]
    assert method == "PUT"
    assert path == "/internal/runs/r/events"
    assert headers["X-Ouro-Internal-Key"] == "k"
    assert json.loads(body) == {"idempotencyKey": "sim-1", "events": []}


def test_a_refusal_is_an_answer_not_an_exception(server: tuple[str, _Recorder]) -> None:
    base, recorder = server
    recorder.answers.append((409, b'{"code": "events_out_of_order"}'))

    answer = HttpTransport().send(_request(base))

    assert answer.status == HTTPStatus.CONFLICT
    assert answer.body == {"code": "events_out_of_order"}
    assert len(recorder.received) == 1, "a refusal is not retried"


def test_a_gateway_failure_is_retried_with_the_same_idempotency_key(
    server: tuple[str, _Recorder],
) -> None:
    base, recorder = server
    recorder.answers += [(503, b""), (502, b"<html>")]
    waits: list[float] = []

    answer = HttpTransport(backoff=0.5, sleep=waits.append).send(_request(base))

    assert answer.status == HTTPStatus.OK
    bodies = [json.loads(body)["idempotencyKey"] for *_, body in recorder.received]
    assert bodies == ["sim-1", "sim-1", "sim-1"]
    assert waits == [0.5, 1.0], "backoff doubles"


def test_it_gives_up_after_its_attempts(server: tuple[str, _Recorder]) -> None:
    base, recorder = server
    recorder.answers += [(504, b"")] * 3

    with pytest.raises(TransportError, match="after 3 attempts: HTTP 504"):
        HttpTransport(sleep=lambda _: None).send(_request(base))


def test_an_unreachable_control_plane_is_a_transport_error() -> None:
    transport = HttpTransport(attempts=2, timeout=1, sleep=lambda _: None)

    with pytest.raises(TransportError, match="URLError"):
        transport.send(_request("http://127.0.0.1:9"))


def test_a_body_that_is_not_a_json_object_reads_as_empty(
    server: tuple[str, _Recorder],
) -> None:
    base, recorder = server
    recorder.answers += [(500, b"<html>oops</html>"), (200, b"[1, 2]"), (200, b"")]

    bodies = [HttpTransport().send(_request(base)).body for _ in range(3)]

    assert bodies == [{}, {}, {}]


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://host/x"])
def test_only_http_and_https_are_ever_opened(url: str) -> None:
    request = ControlPlaneRequest(method="POST", url=url, headers={}, json={})

    with pytest.raises(ValueError, match="http or https"):
        HttpTransport().send(request)


def test_at_least_one_attempt_is_required() -> None:
    with pytest.raises(ValueError, match="attempts"):
        HttpTransport(attempts=0)
