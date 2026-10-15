r"""The DH.2 (#1303) compatibility run: the real harness through the real facade.

The Claude Agent SDK this prototype pins (``claude-agent-sdk==0.2.167``, the version DH.3 ships
against) runs one multi-turn, tool-using session with ``ANTHROPIC_BASE_URL`` pointed at
``ouroboros-rest``'s Anthropic Messages-format facade and a **run-scoped credential** as its
``ANTHROPIC_API_KEY``. The provider key lives in REST's vault and is a canary: the run fails if it
appears anywhere on the engine's side of the line.

Two modes:

* **Recorded** (default): ``stub_facade.py`` stands behind REST as the Anthropic API on
  ``--stub-port``; start REST with ``anthropic-redirect.mjs`` preloaded (see that file).
* **Real** (``--real``): REST calls Anthropic for real; the connection holds a real key, and
  ``--canary`` is that key. Manual, never CI.

Checks, each recorded in ``results/facade-compat[.real].json``:

1. the session completes, through at least one ``Read`` and one ``Write``;
2. the canary is in none of: this process's environment, the harness's options, every
   descendant process's environment and arguments (read from ``/proc`` while it runs), the
   harness's stderr, its config directory and its working tree;
3. the harness's own per-model totals reconcile with the facade's usage rows;
4. after revocation, the same credential is refused.

Usage::

    OURO_ENGINE_SHARED_SECRET=… ./facade_compat.sh --rest http://127.0.0.1:4303 \\
        --run <run id> --alias coder-max --stage implement --canary <the provider key>
"""

import argparse
import asyncio
import json
import os
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, ResultMessage
from stub_facade import Facade, Turn, serve

HERE = Path(__file__).resolve().parent
HARNESS_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"]


def call(
    method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]
) -> tuple[int, Any]:
    """One HTTP call; the status and the parsed body."""
    if not url.startswith(("http://", "https://")):
        raise ValueError(f"not an http address: {url}")
    data = None if body is None else json.dumps(body).encode()
    # The scheme is checked above, so S310's file: and custom schemes cannot reach urlopen.
    request = urllib.request.Request(  # noqa: S310
        url,
        data=data,
        method=method,
        headers={"content-type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None


def descendants(root: int) -> list[int]:
    """Every process under ``root``, read from ``/proc``."""
    parents: dict[int, int] = {}
    for entry in Path("/proc").iterdir():
        if entry.name.isdigit():
            try:
                fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
                parents[int(entry.name)] = int(fields[1])
            except (OSError, IndexError, ValueError):
                continue
    found, frontier = [], [root]
    while frontier:
        parent = frontier.pop()
        children = [pid for pid, ppid in parents.items() if ppid == parent]
        found += children
        frontier += children
    return found


def process_leaks(canary: str) -> list[str]:
    """Descendant processes whose environment or arguments hold the canary."""
    leaks = []
    for pid in descendants(os.getpid()):
        for name in ("environ", "cmdline"):
            try:
                if canary.encode() in (Path("/proc") / str(pid) / name).read_bytes():
                    leaks.append(f"pid {pid} {name}")
            except OSError:
                continue
    return leaks


def tree_leaks(root: Path, canary: str) -> list[str]:
    """Files under ``root`` that hold the canary."""
    return [
        str(path)
        for path in root.rglob("*")
        if path.is_file() and canary.encode() in path.read_bytes()
    ]


async def run(args: argparse.Namespace) -> dict[str, Any]:
    """The whole run, as a JSON-ready report."""
    secret = os.environ["OURO_ENGINE_SHARED_SECRET"]
    internal = {"x-ouro-internal-key": secret}
    report: dict[str, Any] = {"mode": "real" if args.real else "recorded", "checks": {}}

    if not args.real:
        work = Path(tempfile.mkdtemp(prefix="facade-script-"))
        stub = Facade(
            script=[
                Turn(
                    "Reading.",
                    [("Read", {"file_path": str(work / "tree" / "README.md")})],
                ),
                Turn(
                    None,
                    [
                        (
                            "Write",
                            {
                                "file_path": str(work / "tree" / "src" / "summary.txt"),
                                "content": "A greeting service.\n",
                            },
                        )
                    ],
                ),
                Turn("Done."),
            ]
        )
        serve(stub, args.stub_port)
    else:
        work = Path(tempfile.mkdtemp(prefix="facade-real-"))
        stub = None

    tree, config = work / "tree", work / "config"
    tree.mkdir(parents=True)
    config.mkdir()
    (tree / "README.md").write_text("# greet\n\nA tiny greeting service.\n")

    status, minted = call(
        "POST",
        f"{args.rest}/internal/harness/credentials",
        {"run": args.run, "stage": args.stage, "alias": args.alias, "attempt": 1},
        internal,
    )
    if status != 201:
        raise SystemExit(f"minting failed: {status} {minted}")
    token = minted["token"]
    report["credential"] = {
        key: minted[key] for key in ("id", "run", "stage", "alias", "expiresAt")
    }

    stderr: list[str] = []
    seen_leaks: list[str] = []
    options = ClaudeAgentOptions(
        cwd=str(tree),
        tools=HARNESS_TOOLS,
        permission_mode="acceptEdits",
        setting_sources=[],
        max_turns=8,
        model=args.alias,
        stderr=stderr.append,
        env={
            "ANTHROPIC_BASE_URL": f"{args.rest}/internal/harness/anthropic",
            "ANTHROPIC_API_KEY": token,
            "ANTHROPIC_SMALL_FAST_MODEL": args.alias,
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": args.alias,
            "ANTHROPIC_DEFAULT_SONNET_MODEL": args.alias,
            "ANTHROPIC_DEFAULT_OPUS_MODEL": args.alias,
            "ANTHROPIC_CUSTOM_HEADERS": f"x-ouroboros-run: {args.run}",
            "CLAUDE_CONFIG_DIR": str(config),
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        },
    )

    started = time.monotonic()
    result: ResultMessage | None = None
    async with ClaudeSDKClient(options=options) as client:
        await client.query(
            "Read README.md, then write a one-line summary of it to src/summary.txt. Use the tools."
        )
        async for message in client.receive_response():
            seen_leaks += process_leaks(args.canary)
            if isinstance(message, ResultMessage):
                result = message

    if result is None:
        raise SystemExit("the harness ended without a result")
    report["session"] = {
        "wall_clock_ms": round((time.monotonic() - started) * 1000),
        "subtype": result.subtype,
        "num_turns": result.num_turns,
        "usage": result.usage,
        "model_usage": result.model_usage,
    }
    wrote = (tree / "src" / "summary.txt").exists()
    report["checks"]["session_completed"] = (
        result.subtype == "success" and not result.is_error
    )
    report["checks"]["used_read_and_write"] = wrote and result.num_turns >= 3

    leaks = sorted(set(seen_leaks))
    if args.canary in json.dumps(dict(os.environ)):
        leaks.append("this process's environment")
    if args.canary in json.dumps(options.env):
        leaks.append("the harness's options")
    leaks += [
        f"stderr line {i}" for i, line in enumerate(stderr) if args.canary in line
    ]
    leaks += tree_leaks(tree, args.canary) + tree_leaks(config, args.canary)
    report["canary_leaks"] = leaks
    report["checks"]["canary_absent"] = not leaks

    reported = {
        model: {
            "inputTokens": usage.get("inputTokens", 0),
            "outputTokens": usage.get("outputTokens", 0),
            "cacheReadInputTokens": usage.get("cacheReadInputTokens", 0),
            "cacheCreationInputTokens": usage.get("cacheCreationInputTokens", 0),
        }
        for model, usage in (result.model_usage or {}).items()
    }
    status, reconciliation = call(
        "POST",
        f"{args.rest}/internal/harness/credentials/{minted['id']}/reconcile",
        {"models": reported},
        internal,
    )
    report["reconciliation"] = reconciliation
    report["checks"]["usage_reconciles"] = status == 200 and reconciliation["matches"]

    status, _ = call(
        "DELETE",
        f"{args.rest}/internal/harness/credentials/{minted['id']}",
        None,
        internal,
    )
    status, refused = call(
        "POST",
        f"{args.rest}/internal/harness/anthropic/v1/messages",
        {
            "model": args.alias,
            "max_tokens": 8,
            "messages": [{"role": "user", "content": "hi"}],
        },
        {"x-api-key": token, "anthropic-version": "2023-06-01"},
    )
    report["checks"]["revoked_refused"] = (
        status == 401 and refused["ouroboros"]["code"] == "credential_revoked"
    )

    if stub is not None:
        report["upstream_requests"] = len(stub.requests)
        report["checks"]["upstream_saw_provider_key"] = all(
            entry.get("credential_presented", True) for entry in stub.requests
        )
    return report


def main() -> None:
    """Parse the arguments, run, write the report, and fail on any failed check."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rest", required=True)
    parser.add_argument("--run", required=True)
    parser.add_argument("--stage", default="implement")
    parser.add_argument("--alias", default="coder-max")
    parser.add_argument("--canary", required=True, help="the provider key REST holds")
    parser.add_argument("--stub-port", type=int, default=9410)
    parser.add_argument("--real", action="store_true")
    args = parser.parse_args()

    report = asyncio.run(run(args))
    out = (
        HERE
        / "results"
        / ("facade-compat.real.json" if args.real else "facade-compat.json")
    )
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["checks"], indent=2))
    if not all(report["checks"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
