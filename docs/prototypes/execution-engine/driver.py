"""#155 (T.1) prototype driver: kill the engine mid-stage, start it again, measure the recovery.

The driver hosts what survives an engine crash: the journal and its supervisor
(``journal.py``, standing in for ``ouroboros-rest``) and the scripted model behind a stub
facade (DH.1's ``stub_facade.py``). The engine (``engine.py``) is a child process in its own
process group, so ``SIGKILL`` takes the harness CLI down with it, as a container kill would.

Scenarios — each a fresh sandbox, journal and config directory:

``baseline``         no kill; the reference counts every other scenario is compared with
``k1-plan-call``     killed while the native ``plan`` stage waits on its model call
``k2-between-tools`` killed inside the harness session, between two tool calls, as soon as
                     the second model call starts; ``k2-between-tools@<ms>`` waits that many
                     milliseconds first (the model call is held for 3 s, so the kill still
                     lands inside it) — how long does the harness take to persist its session?
``k3-after-tool``    killed after a tool ran and before its result reached the journal
``k4-gate-wait``     killed while the run waits days (here: seconds) on the human gate
``k5-lost-session``  as k2, but the run's ``CLAUDE_CONFIG_DIR`` does not survive the restart
``k6-zombie``        the engine is frozen (``SIGSTOP``) past the stale threshold, a second
                     engine takes the run over, then the first is thawed (``SIGCONT``)

Results go to ``results/<scenario>.json`` and a summary line per scenario is printed.
"""

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "stage-executor"))

from journal import Journal, serve  # noqa: E402
from stub_facade import Facade, Turn  # noqa: E402
from stub_facade import serve as serve_facade  # noqa: E402

STALE_S = 2.0
SCENARIOS = [
    "baseline",
    "k1-plan-call",
    "k2-between-tools",
    "k3-after-tool",
    "k4-gate-wait",
    "k5-lost-session",
    "k6-zombie",
]


def script(sandbox: Path) -> list[Turn]:
    """The implement stage's scripted model: read, write, write, done."""
    s = str(sandbox)
    return [
        Turn("Reading the README.", [("Read", {"file_path": f"{s}/README.md"})]),
        Turn(
            None,
            [
                (
                    "Write",
                    {
                        "file_path": f"{s}/src/greet.py",
                        "content": "def greet():\n    return 'hi'\n",
                    },
                )
            ],
        ),
        Turn(
            None,
            [
                (
                    "Write",
                    {
                        "file_path": f"{s}/src/test_greet.py",
                        "content": "from greet import greet\n",
                    },
                )
            ],
        ),
        Turn("Done."),
    ]


class Engine:
    """One engine process."""

    def __init__(self, env: dict[str, str], holder: str, port: int) -> None:
        """Start it and wait for ``ready``. Its stderr goes to ``<root>/<holder>.log``."""
        self.holder = holder
        self.log = (Path(env["OURO_PROTO_ROOT"]) / f"{holder}.log").open("w")
        self.proc = subprocess.Popen(  # noqa: S603 — this interpreter, this file
            [sys.executable, str(HERE / "engine.py")],
            env={**env, "OURO_PROTO_HOLDER": holder, "OURO_PROTO_PORT": str(port)},
            stdout=subprocess.PIPE,
            stderr=self.log,
            start_new_session=True,
            text=True,
        )
        self.started = time.time()
        assert self.proc.stdout is not None
        assert self.proc.stdout.readline().strip() == "ready"
        self.ready_ms = round((time.time() - self.started) * 1000)

    def signal(self, sig: int) -> None:
        """Signal the whole process group: the engine and its harness CLI."""
        os.killpg(self.proc.pid, sig)

    def kill(self) -> None:
        """SIGKILL, and reap."""
        if self.proc.poll() is None:
            self.signal(signal.SIGKILL)
            self.proc.wait()


def wait_for(predicate, timeout: float = 30.0, every: float = 0.05) -> bool:  # noqa: ANN001
    """Poll until ``predicate()`` is true."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(every)
    return False


def free_port() -> int:
    """A free loopback port."""
    import socket  # noqa: PLC0415

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def run(name: str) -> dict[str, Any]:  # noqa: C901, PLR0912, PLR0915 — a script, read top to bottom
    """Run one scenario and measure it."""
    scenario, _, wait_ms = name.partition("@")
    kill_delay_s = int(wait_ms or 0) / 1000
    root = Path(tempfile.mkdtemp(prefix="ouro-t1-"))
    sandbox = root / "sandbox"
    (sandbox / "src").mkdir(parents=True)
    (sandbox / "README.md").write_text("# sandbox\n\nAdd greet() to src/greet.py.\n")
    (root / "claude").mkdir()
    (root / "tool-runs.log").touch()

    hold = {"plan": 3.0 if scenario == "k1-plan-call" else 0.0}
    hold_turn = (
        1 if scenario in ("k2-between-tools", "k5-lost-session", "k6-zombie") else None
    )
    released = threading.Event()

    def delay(main: bool, turn: int) -> float:
        if not main:
            if hold["plan"]:
                value, hold["plan"] = (
                    hold["plan"],
                    0.0,
                )  # only the first plan call is slow
                return value
            return 0.0
        if hold_turn is not None and turn == hold_turn and not released.is_set():
            released.set()  # only the first time; the resumed session is not held
            return 3.0
        return 0.0

    facade = Facade(script(sandbox), delay=delay)
    facade_server = serve_facade(facade)
    journal = Journal(str(root / "journal.sqlite3"), STALE_S)
    journal_server = serve(journal)
    engine_url = [f"http://127.0.0.1:{free_port()}"]
    stop = threading.Event()
    threading.Thread(
        target=journal.supervise, args=(engine_url, stop), daemon=True
    ).start()

    env = {
        **os.environ,
        "OURO_PROTO_JOURNAL": f"http://127.0.0.1:{journal_server.server_address[1]}",
        "OURO_PROTO_FACADE": f"http://127.0.0.1:{facade_server.server_address[1]}",
        "OURO_PROTO_ROOT": str(root),
    }
    if scenario == "k3-after-tool":
        env["OURO_PROTO_SLOW_POST_TOOL"] = "src/greet.py"

    def state() -> dict[str, Any]:
        with journal.lock:
            return journal.state("run-1")

    def tool_runs() -> list[dict[str, Any]]:
        return [
            json.loads(line)
            for line in (root / "tool-runs.log").read_text().splitlines()
        ]

    port = int(engine_url[0].rsplit(":", 1)[1])
    engines = [Engine(env, "engine-1", port)]
    started = time.time()
    with journal.lock:
        journal.handle("POST", "/runs", {"id": "run-1", "position": "plan"})

    killed_at: float | None = None
    note = ""
    if scenario == "k1-plan-call":
        wait_for(lambda: any(not r.get("main") for r in facade.requests))
    elif scenario in ("k2-between-tools", "k5-lost-session", "k6-zombie"):
        wait_for(
            lambda: any(r.get("main") and r.get("turn") == 1 for r in facade.requests)
        )
    elif scenario == "k3-after-tool":
        wait_for(lambda: any(r["path"].endswith("src/greet.py") for r in tool_runs()))
    elif scenario == "k4-gate-wait":
        wait_for(lambda: state()["status"] == "waiting_gate")

    time.sleep(kill_delay_s)
    if scenario == "k6-zombie":
        engines[0].signal(signal.SIGSTOP)
        killed_at = time.time()
        frozen = engines[0]
        # A second engine on its own port; the supervisor now submits there.
        port2 = free_port()
        engine_url[0] = f"http://127.0.0.1:{port2}"
        engines.append(Engine(env, "engine-2", port2))
        wait_for(lambda: state()["holder"] == "engine-2", timeout=20)
        time.sleep(1.0)
        frozen.signal(signal.SIGCONT)
        note = "engine-1 thawed after engine-2 took the run"
    elif scenario != "baseline":
        engines[0].kill()
        killed_at = time.time()
        if scenario == "k5-lost-session":
            shutil.rmtree(root / "claude" / "run-1", ignore_errors=True)
        engines.append(Engine(env, "engine-2", port))

    # The person approves the gate whenever the run reaches it.
    wait_for(
        lambda: state()["status"] in ("waiting_gate", "completed", "failed", "halted"),
        timeout=60,
    )
    if state()["status"] == "waiting_gate":
        with journal.lock:
            journal.handle(
                "POST", "/runs/run-1/gate", {"key": "review", "decision": "approve"}
            )
    finished = wait_for(
        lambda: state()["status"] in ("completed", "failed", "halted"), timeout=60
    )
    elapsed_ms = round((time.time() - started) * 1000)
    time.sleep(1.5)  # let a thawed zombie try its writes
    stop.set()
    final = state()
    for engine in engines:
        engine.kill()

    with journal.lock:
        events = journal._q(
            "select hint, kind, body, epoch, at from events where run_id='run-1' order by hint"
        )
        refusals = journal._q("select reason, epoch from refusals")
        submits = journal._q("select at, answer from submits")
    bodies = [json.loads(b) for _, _, b, _, _ in events]
    after_kill = [at for _, _, _, _, at in events if killed_at and at > killed_at]
    first_submit_after = [
        at
        for at, answer in submits
        if killed_at and at > killed_at and answer == "accepted"
    ]
    requested = Counter(
        (
            b["request"]["tool"],
            Path(b["request"]["paths"][0]).name if b["request"]["paths"] else "",
        )
        for b in bodies
        if b["kind"] == "tool_request"
    )
    ran = Counter((r["tool"], Path(r["path"]).name) for r in tool_runs())
    resumed_requests = [r["messages"] for r in facade.requests if r.get("main")]
    result = {
        "scenario": name,
        "kill_delay_ms": int(wait_ms or 0),
        "completed": finished and final["status"] == "completed",
        "final_status": final["status"],
        "stages": {
            k: {"attempt": v["attempt"], "status": v["status"]}
            for k, v in final["stages"].items()
        },
        "epoch": final["epoch"],
        "elapsed_ms": elapsed_ms,
        "engine_ready_ms": [e.ready_ms for e in engines],
        "stale_threshold_ms": int(STALE_S * 1000),
        "kill_to_resubmit_ms": round((first_submit_after[0] - killed_at) * 1000)
        if first_submit_after
        else None,
        "kill_to_first_event_ms": round((after_kill[0] - killed_at) * 1000)
        if after_kill
        else None,
        "model_calls": {
            "plan": sum(1 for r in facade.requests if not r.get("main")),
            "implement": sum(1 for r in facade.requests if r.get("main")),
        },
        "implement_request_message_counts": resumed_requests,
        "tool_requests_journaled": {
            f"{t} {p}": n for (t, p), n in sorted(requested.items())
        },
        "tools_actually_run": {f"{t} {p}": n for (t, p), n in sorted(ran.items())},
        "tools_run_by": dict(Counter(r["holder"] for r in tool_runs())),
        "events": dict(Counter(b["kind"] for b in bodies)),
        "event_epochs": dict(Counter(str(e) for _, _, _, e, _ in events)),
        "refusals": dict(Counter(r for r, _ in refusals)),
        "files": {
            str(p.relative_to(sandbox)): p.read_text()
            for p in sorted(sandbox.rglob("*"))
            if p.is_file()
        },
        "note": note,
    }
    facade_server.shutdown()
    journal_server.shutdown()
    if os.environ.get("OURO_PROTO_KEEP"):
        result["kept"] = str(root)
    else:
        shutil.rmtree(root, ignore_errors=True)
    return result


def main() -> None:
    """Run the named scenarios (default: all) and write their results."""
    parser = argparse.ArgumentParser()
    parser.add_argument("scenarios", nargs="*", default=SCENARIOS)
    args = parser.parse_args()
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    for scenario in args.scenarios:
        result = run(scenario)
        (
            out / f"{scenario.replace('@', '-at-')}ms.json"
            if "@" in scenario
            else out / f"{scenario}.json"
        ).write_text(json.dumps(result, indent=2) + "\n")
        print(
            json.dumps(
                {
                    k: result[k]
                    for k in (
                        "scenario",
                        "completed",
                        "final_status",
                        "stages",
                        "kill_to_resubmit_ms",
                        "kill_to_first_event_ms",
                        "model_calls",
                        "tools_actually_run",
                        "refusals",
                    )
                }
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
