"""A scripted Anthropic Messages-format facade, for the Claude Agent executor's tests.

Copied from DH.1's prototype (``docs/prototypes/stage-executor/stub_facade.py``) for DH.3
(#1308). It stands where DH.2's facade stands — the harness's ``ANTHROPIC_BASE_URL`` — and
answers each ``POST …/v1/messages`` with the next scripted assistant turn, streamed exactly as
the Messages API frames it. No provider is called.

**It keys on content, not message counts** (the ADR's note): the turn to play is the number
of ``tool_use`` blocks already in the request's history, because a resumed session replays
its history with one message per content block. A request that offers no ``Write`` tool is
the harness's own side traffic and gets a one-word answer.

Every request is logged — tools offered, the credential presented, and the text of the
user turns — so a test can assert what the harness sent.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

#: The model id the stub answers as.
STUB_MODEL = "claude-sonnet-5-5"


@dataclass
class Turn:
    """One scripted assistant turn: optional text, then optional tool calls.

    Attributes:
        text: What the model says first, if anything.
        tools: ``(name, input)`` per tool call.
    """

    text: str | None = None
    tools: list[tuple[str, dict[str, Any]]] = field(default_factory=list)


def _user_texts(messages: list[dict[str, Any]]) -> list[str]:
    """Every text a user turn carries in a request's history.

    Args:
        messages: The request's ``messages``.

    Returns:
        The texts, in order.
    """
    texts: list[str] = []
    for message in messages:
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, str):
            texts.append(content)
            continue
        for block in content or []:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(str(block.get("text", "")))
    return texts


@dataclass
class Facade:
    """The script, and everything the stub saw.

    Attributes:
        script: The model's turns.
        requests: One record per request.
        lock: Guards ``requests``.
        delay: Seconds to hold a main request, given its turn — so a test can land a
            crash during a model call. ``None`` answers at once.
        refuse: An HTTP status to refuse every request with (``401``: a revoked or
            unknown credential), or ``None`` to answer.
    """

    script: list[Turn]
    requests: list[dict[str, Any]] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)
    delay: Callable[[int], float] | None = None
    refuse: int | None = None

    def main_requests(self) -> list[dict[str, Any]]:
        """The requests that offered the file tools — the session's own turns.

        Returns:
            Those records, in arrival order.
        """
        with self.lock:
            return [r for r in self.requests if r.get("main")]

    def answer(
        self, body: dict[str, Any], headers: dict[str, str]
    ) -> list[dict[str, Any]]:
        """Pick the content blocks for one request, and log it.

        Args:
            body: The request body.
            headers: Its headers, lower-cased.

        Returns:
            The assistant's content blocks.
        """
        tools = [tool.get("name") for tool in body.get("tools") or []]
        main = "Write" in tools
        messages = body.get("messages", [])
        turn = sum(
            1
            for message in messages
            if message["role"] == "assistant"
            and isinstance(message.get("content"), list)
            for block in message["content"]
            if block.get("type") == "tool_use"
        )
        with self.lock:
            self.requests.append(
                {
                    "main": main,
                    "turn": turn,
                    "tools": tools,
                    "model": body.get("model"),
                    "credential": headers.get("x-api-key")
                    or headers.get("authorization"),
                    "user_texts": _user_texts(messages),
                    "history": json.dumps(messages),
                    "messages": len(messages),
                }
            )
        if main and self.delay is not None:
            time.sleep(self.delay(turn))
        if not main:
            return [{"type": "text", "text": "ok"}]
        if turn >= len(self.script):
            return [{"type": "text", "text": "Done."}]
        scripted = self.script[turn]
        blocks: list[dict[str, Any]] = []
        if scripted.text:
            blocks.append({"type": "text", "text": scripted.text})
        for index, (name, tool_input) in enumerate(scripted.tools):
            blocks.append(
                {
                    "type": "tool_use",
                    "id": f"toolu_{turn:02d}_{index}",
                    "name": name,
                    "input": tool_input,
                }
            )
        return blocks


def _sse(blocks: list[dict[str, Any]], input_tokens: int) -> Iterator[bytes]:
    """Frame content blocks as the Messages API's event stream.

    Args:
        blocks: The content.
        input_tokens: The usage to report.

    Yields:
        One server-sent event at a time.
    """

    def event(name: str, data: dict[str, Any]) -> bytes:
        """One event.

        Args:
            name: Its name.
            data: Its payload.

        Returns:
            The framed bytes.
        """
        return f"event: {name}\ndata: {json.dumps(data)}\n\n".encode()

    output_tokens = sum(len(json.dumps(block)) // 4 for block in blocks) or 1
    stop = "tool_use" if any(b["type"] == "tool_use" for b in blocks) else "end_turn"
    yield event(
        "message_start",
        {
            "type": "message_start",
            "message": {
                "id": f"msg_stub_{time.monotonic_ns()}",
                "type": "message",
                "role": "assistant",
                "model": STUB_MODEL,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": input_tokens, "output_tokens": 1},
            },
        },
    )
    for index, block in enumerate(blocks):
        if block["type"] == "text":
            start: dict[str, Any] = {"type": "text", "text": ""}
            delta: dict[str, Any] = {"type": "text_delta", "text": block["text"]}
        else:
            start = {
                "type": "tool_use",
                "id": block["id"],
                "name": block["name"],
                "input": {},
            }
            delta = {
                "type": "input_json_delta",
                "partial_json": json.dumps(block["input"]),
            }
        yield event(
            "content_block_start",
            {"type": "content_block_start", "index": index, "content_block": start},
        )
        yield event(
            "content_block_delta",
            {"type": "content_block_delta", "index": index, "delta": delta},
        )
        yield event(
            "content_block_stop", {"type": "content_block_stop", "index": index}
        )
    yield event(
        "message_delta",
        {
            "type": "message_delta",
            "delta": {"stop_reason": stop, "stop_sequence": None},
            "usage": {"output_tokens": output_tokens},
        },
    )
    yield event("message_stop", {"type": "message_stop"})


def serve(facade: Facade) -> ThreadingHTTPServer:
    """Start the stub on a free loopback port, in a daemon thread.

    Args:
        facade: The script and the request log.

    Returns:
        The server; ``server_address[1]`` is its port. Any path ending ``/v1/messages`` is
        the Messages route, so a base URL with a prefix (the facade's) works.
    """

    class Handler(BaseHTTPRequestHandler):
        """Answers the Messages route; 404 for anything else."""

        def log_message(self, *_: object) -> None:
            """Stay quiet."""

        def do_POST(self) -> None:
            """Answer one Messages request, streamed or not."""
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length)
            headers = {k.lower(): v for k, v in self.headers.items()}
            path = self.path.split("?", 1)[0]
            if not path.endswith("/v1/messages"):
                with facade.lock:
                    facade.requests.append({"path": path})
                self.send_response(404)
                self.end_headers()
                return
            body = json.loads(raw)
            if facade.refuse is not None:
                refusal = json.dumps(
                    {
                        "type": "error",
                        "error": {
                            "type": "authentication_error",
                            "message": "credential_revoked",
                        },
                    }
                ).encode()
                with facade.lock:
                    facade.requests.append({"path": path, "refused": facade.refuse})
                self.send_response(facade.refuse)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(refusal)))
                self.end_headers()
                self.wfile.write(refusal)
                return
            blocks = facade.answer(body, headers)
            input_tokens = len(raw) // 4
            if body.get("stream"):
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.end_headers()
                for chunk in _sse(blocks, input_tokens):
                    self.wfile.write(chunk)
                    self.wfile.flush()
                return
            payload = {
                "id": "msg_stub",
                "type": "message",
                "role": "assistant",
                "model": STUB_MODEL,
                "content": blocks,
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": input_tokens, "output_tokens": 1},
            }
            data = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            """Refuse, and log the path."""
            with facade.lock:
                facade.requests.append({"path": self.path})
            self.send_response(404)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
