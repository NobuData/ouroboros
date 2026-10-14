"""The run journal and its supervisor — a stand-in for ``ouroboros-rest``'s run plane.

#155 (T.1) prototype. The engine never talks to the database (``docs/ARCHITECTURE.md`` § 2),
so under option A every durable fact about a run lives behind the control plane's internal
API, as it already does for research investigations (``POST .../start`` claims or resumes,
``.../checkpoint`` saves). This module is that API reduced to what the interpreter needs,
over SQLite so the prototype needs no server. Durability of the store is not what is being
tested — Postgres already provides it; the *engine's* recovery is.

What it adds to AP.1's six operations, and so what #160 needs from ``ouroboros-rest``:

* **claim with an epoch** (``POST /runs/{id}/start``): a run is held by one engine at a
  time. Every claim increments ``epoch``; every engine write carries it, and a write with a
  stale epoch is refused ``409 fenced`` — the guard against a paused engine waking up after
  its run was handed to another.
* **heartbeat** (``POST /runs/{id}/heartbeat``): how the supervisor tells a live holder from
  a dead one.
* **checkpoint** (``PUT /runs/{id}/checkpoint``): a stage executor's ``Checkpoint``.
* **position**: where in the graph the run stands, and its status.
* **the supervisor**: a run that is ``queued``, or ``running`` with a heartbeat older than
  ``stale_s``, is submitted to the engine again — the investigation runner's model.

Events are ordered by ``hint`` exactly as AP.1 orders them: a hint that does not exceed the
last accepted one is refused, never reordered.
"""

import json
import sqlite3
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

SCHEMA = """
create table if not exists runs (
  id text primary key,
  status text not null,            -- queued | running | waiting_gate | completed | halted | failed
  position text not null,
  epoch integer not null default 0,
  holder text,
  heartbeat_at real,
  last_hint integer not null default 0
);
create table if not exists stages (
  run_id text, key text, attempt integer, status text, checkpoint text,
  primary key (run_id, key)
);
create table if not exists events (
  run_id text, hint integer, kind text, body text, epoch integer, at real,
  primary key (run_id, hint)
);
create table if not exists gates (run_id text, key text, decision text, primary key (run_id, key));
create table if not exists refusals (run_id text, reason text, epoch integer, at real);
create table if not exists submits (run_id text, at real, answer text);
"""


class Journal:
    """The store, behind one lock — the prototype's stand-in for a row lock per run."""

    def __init__(self, path: str, stale_s: float) -> None:
        """Open (or create) the store."""
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.execute("pragma journal_mode=wal")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()
        self.stale_s = stale_s

    def _q(self, sql: str, *args: Any) -> list[tuple]:
        return self.db.execute(sql, args).fetchall()

    def _refuse(self, run_id: str, reason: str, epoch: int | None) -> tuple[int, dict]:
        self._q(
            "insert into refusals values (?,?,?,?)", run_id, reason, epoch, time.time()
        )
        return 409, {"code": reason}

    def _fenced(self, run_id: str, epoch: int) -> bool:
        row = self._q("select epoch from runs where id=?", run_id)
        return not row or row[0][0] != epoch

    def state(self, run_id: str) -> dict[str, Any]:
        """Everything known about a run."""
        (status, position, epoch, holder, hb, last_hint) = self._q(
            "select status, position, epoch, holder, heartbeat_at, last_hint from runs where id=?",
            run_id,
        )[0]
        stages = {
            key: {
                "attempt": attempt,
                "status": st,
                "checkpoint": json.loads(cp) if cp else None,
            }
            for key, attempt, st, cp in self._q(
                "select key, attempt, status, checkpoint from stages where run_id=?",
                run_id,
            )
        }
        gates = dict(self._q("select key, decision from gates where run_id=?", run_id))
        return {
            "id": run_id,
            "status": status,
            "position": position,
            "epoch": epoch,
            "holder": holder,
            "heartbeat_at": hb,
            "last_hint": last_hint,
            "stages": stages,
            "gates": gates,
        }

    def handle(self, method: str, path: str, body: dict[str, Any]) -> tuple[int, dict]:
        """Route one request. Returns (status, body)."""
        parts = path.strip("/").split("/")
        with self.lock:
            if method == "POST" and parts == ["runs"]:
                self._q(
                    "insert into runs (id, status, position) values (?, 'queued', ?)",
                    body["id"],
                    body["position"],
                )
                return 201, self.state(body["id"])
            run_id = parts[1]
            op = parts[2] if len(parts) > 2 else ""
            now = time.time()
            if method == "GET" and op == "":
                return 200, self.state(run_id)
            if op == "start":
                st = self.state(run_id)
                live = st["heartbeat_at"] and now - st["heartbeat_at"] < self.stale_s
                if (
                    st["status"] == "running"
                    and live
                    and st["holder"] != body["holder"]
                ):
                    return 409, {"code": "already_running"}
                if st["status"] in ("completed", "halted", "failed", "waiting_gate"):
                    return 409, {"code": f"not_runnable_{st['status']}"}
                self._q(
                    "update runs set epoch=epoch+1, holder=?, heartbeat_at=?, status='running' where id=?",
                    body["holder"],
                    now,
                    run_id,
                )
                return 200, self.state(run_id)
            if op == "gate":
                self._q(
                    "insert or replace into gates values (?,?,?)",
                    run_id,
                    body["key"],
                    body["decision"],
                )
                self._q(
                    "update runs set status='queued' where id=? and status='waiting_gate'",
                    run_id,
                )
                return 200, self.state(run_id)
            epoch = body.get("epoch")
            if self._fenced(run_id, epoch):
                return self._refuse(run_id, "fenced", epoch)
            if op == "heartbeat":
                self._q("update runs set heartbeat_at=? where id=?", now, run_id)
                return 200, {}
            if op == "events":
                last = self._q("select last_hint from runs where id=?", run_id)[0][0]
                for event in body["events"]:
                    if event["hint"] <= last:
                        return self._refuse(run_id, "events_out_of_order", epoch)
                    self._q(
                        "insert into events values (?,?,?,?,?,?)",
                        run_id,
                        event["hint"],
                        event["kind"],
                        json.dumps(event["body"]),
                        epoch,
                        now,
                    )
                    last = event["hint"]
                self._q("update runs set last_hint=? where id=?", last, run_id)
                return 200, {"last_hint": last}
            if op == "stage":
                self._q(
                    "insert into stages (run_id, key, attempt, status, checkpoint) values (?,?,?,?,null) "
                    "on conflict (run_id, key) do update set attempt=excluded.attempt, status=excluded.status, "
                    "checkpoint=case when excluded.attempt = stages.attempt then stages.checkpoint end",
                    run_id,
                    body["key"],
                    body["attempt"],
                    body["status"],
                )
                return 200, {}
            if op == "checkpoint":
                self._q(
                    "update stages set checkpoint=? where run_id=? and key=?",
                    json.dumps(body["checkpoint"]),
                    run_id,
                    body["key"],
                )
                return 200, {}
            if op == "position":
                self._q(
                    "update runs set position=?, status=? where id=?",
                    body["position"],
                    body["status"],
                    run_id,
                )
                return 200, {}
        return 404, {"code": "not_found"}

    def supervise(self, engine_url: list[str], stop: threading.Event) -> None:
        """Submit every run that needs an engine: queued, or running with a stale heartbeat."""
        while not stop.is_set():
            with self.lock:
                now = time.time()
                due = [
                    row[0]
                    for row in self._q(
                        "select id from runs where status='queued' or "
                        "(status='running' and (heartbeat_at is null or ? - heartbeat_at > ?))",
                        now,
                        self.stale_s,
                    )
                ]
            for run_id in due:
                answer = _post(f"{engine_url[0]}/submit", {"run_id": run_id})
                with self.lock:
                    self._q(
                        "insert into submits values (?,?,?)",
                        run_id,
                        time.time(),
                        answer,
                    )
            stop.wait(0.25)


def _post(url: str, body: dict[str, Any]) -> str:
    """POST JSON; the answer's code, or the failure's name. Never raises."""
    request = urllib.request.Request(
        url, json.dumps(body).encode(), {"content-type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=2) as response:  # noqa: S310 — loopback
            return json.loads(response.read() or b"{}").get("code", "ok")
    except Exception as error:  # noqa: BLE001 — an unreachable engine is the normal case here
        return type(error).__name__


def serve(journal: Journal) -> ThreadingHTTPServer:
    """Serve the journal on a free loopback port."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_: object) -> None:
            return

        def _answer(self, method: str) -> None:
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            status, payload = journal.handle(method, self.path, body)
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            self._answer("GET")

        def do_POST(self) -> None:
            self._answer("POST")

        def do_PUT(self) -> None:
            self._answer("PUT")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
