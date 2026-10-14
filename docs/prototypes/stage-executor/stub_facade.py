"""A stub Anthropic Messages-format facade that plays a scripted model.

DH.1 (#1302) prototype. It stands where DH.2's facade will (``ANTHROPIC_BASE_URL``): the
harness sends it real ``POST /v1/messages`` requests and it answers each with the next
scripted assistant turn, streamed as server-sent events exactly as the Messages API frames
them. No provider is called and no key is held — the credential the harness presents is
recorded (its presence, never its value) and otherwise ignored.

Which turn to play is the number of ``tool_use`` blocks already in the request's history —
each scripted turn makes at most one call. Counting ``assistant`` messages does not work: a
resumed session replays its history with one message per content block, so a turn of text
and a call becomes two messages.

A request that offers no ``Write`` tool is the harness's own side traffic (a title, a probe)
and gets a one-word answer; every request, side or main, is logged for the ADR.
"""

import json
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

#: The model id the stub claims to be.
STUB_MODEL = "claude-sonnet-5-5"


@dataclass
class Turn:
    """One scripted assistant turn: optional text, then optional tool calls."""

    text: str | None = None
    tools: list[tuple[str, dict[str, Any]]] = field(default_factory=list)


@dataclass
class Facade:
    """The stub's script and everything it saw."""

    script: list[Turn]
    requests: list[dict[str, Any]] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def answer(
        self, body: dict[str, Any], headers: dict[str, str]
    ) -> list[dict[str, Any]]:
        """Pick the content blocks for one request and log what was asked."""
        tools = [tool.get("name") for tool in body.get("tools") or []]
        main = "Write" in tools
        assistant_turns = sum(
            1
            for m in body.get("messages", [])
            if m["role"] == "assistant" and isinstance(m.get("content"), list)
            for block in m["content"]
            if block.get("type") == "tool_use"
        )
        with self.lock:
            self.requests.append(
                {
                    "at": time.monotonic(),
                    "main": main,
                    "turn": assistant_turns,
                    "messages": len(body.get("messages", [])),
                    "tools": tools,
                    "stream": bool(body.get("stream")),
                    "model": body.get("model"),
                    "anthropic_version": headers.get("anthropic-version"),
                    "anthropic_beta": headers.get("anthropic-beta"),
                    "credential_presented": bool(
                        headers.get("x-api-key") or headers.get("authorization")
                    ),
                }
            )
        if not main:
            return [{"type": "text", "text": "ok"}]
        if assistant_turns >= len(self.script):
            return [{"type": "text", "text": "Done."}]
        turn = self.script[assistant_turns]
        blocks: list[dict[str, Any]] = []
        if turn.text:
            blocks.append({"type": "text", "text": turn.text})
        for index, (name, tool_input) in enumerate(turn.tools):
            blocks.append(
                {
                    "type": "tool_use",
                    "id": f"toolu_{assistant_turns:02d}_{index}",
                    "name": name,
                    "input": tool_input,
                }
            )
        return blocks


def _sse(blocks: list[dict[str, Any]], input_tokens: int) -> Iterator[bytes]:
    """Frame content blocks as the Messages API's stream."""

    def event(name: str, data: dict[str, Any]) -> bytes:
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
            start = {"type": "text", "text": ""}
            delta = {"type": "text_delta", "text": block["text"]}
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
    """Start the stub on a free loopback port, in a daemon thread."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: object) -> None:
            return

        def do_POST(self) -> None:
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length)
            headers = {k.lower(): v for k, v in self.headers.items()}
            path = self.path.split("?", 1)[0]
            if path != "/v1/messages":
                with facade.lock:
                    facade.requests.append({"at": time.monotonic(), "path": path})
                self.send_response(404)
                self.end_headers()
                return
            body = json.loads(raw)
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
            with facade.lock:
                facade.requests.append({"at": time.monotonic(), "path": self.path})
            self.send_response(404)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
