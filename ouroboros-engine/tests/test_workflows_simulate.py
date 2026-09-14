"""The dry-run simulator — the mockup's walk, the road not taken, and what a walk never does.

R.2's acceptance criteria, each asserted rather than assumed:

* the seeded ``standard-fix`` and the seeded ``#485`` yield the mockup's active path;
* an invalid definition is answered with findings anchored to a node, an edge or a path;
* the same input produces the same walk — in this process, and in others with other hash seeds;
* decisions report every branch and loops report their retry bound;
* nothing a dry run executes can reach a model or a provider. This file holds the static half of
  that — no module a dry run runs imports a client, a socket or an estimator — and
  ``tests/test_api_workflows.py`` the runtime half, against spies.

The verdicts' parity with ``ouroboros-rest``'s zod validator is ``tests/test_api_workflows.py``'s
too, over HTTP, beside ``tests/test_workflows_parity.py``'s over the function.
"""

import ast
import json
import os
import subprocess
import sys
from dataclasses import replace
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest

from ouroboros_engine.workflows import simulate
from ouroboros_engine.workflows.contract import (
    DryRunEdge,
    DryRunStep,
    DryRunTicket,
    NodeVerdict,
    WorkflowDryRun,
    WorkflowFinding,
)
from ouroboros_engine.workflows.simulate import dry_run, walk
from ouroboros_engine.workflows.validate import validate_workflow_document
from workflows_golden import CASES, ExpectedCase, read_fixture

#: The four accent edges mockup 04 draws as the executed path — trigger → analyze → decision →
#: plan → implement (``docs/mockups/04-workflow-builder.html``, *executed / active path*).
MOCKUP_ACTIVE_PATH = [
    ("issue-queued", "analyze"),
    ("analyze", "effort-recheck"),
    ("effort-recheck", "plan"),
    ("plan", "implement"),
]

#: Every stage ``#485`` passes through on ``standard-fix``, in the order the walk reaches them.
WALK_485 = [
    "issue-queued",
    "analyze",
    "effort-recheck",
    "plan",
    "implement",
    "build",
    "test",
    "review",
    "checks-green",
    "open-pr",
]

#: A terminal's config, where which terminal it is does not matter.
_NEEDS_REVIEW = {"action": "needs_review", "options": {}}


def _ticket(
    effort: str | None,
    labels: tuple[str, ...] = ("bug",),
    source: str = "github",
) -> DryRunTicket:
    """A ticket keyed ``#485``, with whatever a test varies."""
    return DryRunTicket.model_validate(
        {
            "external_key": "#485",
            "source": source,
            "labels": list(labels),
            "estimate": None if effort is None else {"effort": effort},
        }
    )


def _node(node_id: str, node_type: str, config: dict[str, Any]) -> dict[str, Any]:
    """One node, titled after its id and placed at the origin."""
    return {
        "id": node_id,
        "type": node_type,
        "title": node_id.capitalize(),
        "position": {"x": 0, "y": 0},
        "config": config,
    }


def _edge(
    source: str,
    target: str,
    kind: str = "default",
    condition: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One edge, with a condition when one is given."""
    edge: dict[str, Any] = {"from": source, "to": target, "kind": kind}
    if condition is not None:
        edge["condition"] = condition
    return edge


def _document(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]]
) -> dict[str, Any]:
    """A document whose trigger fires for every queued ticket."""
    return {
        "dsl_version": "1.0",
        "trigger": {"event": "ticket_queued", "conditions": {}},
        "nodes": nodes,
        "edges": edges,
    }


def _llm(max_retries: int) -> dict[str, Any]:
    """A model stage's config that routes by task and allows ``max_retries`` retries."""
    return {
        "mode": "prompt",
        "prompt_template": "Fix it.",
        "routing": {"inherit_task": "implement"},
        "limits": {"max_retries": max_retries, "token_budget": 1000},
        "permissions": {"push_fixup": False, "touch_ci": False},
    }


def _simulated(document: dict[str, Any], ticket: DryRunTicket) -> WorkflowDryRun:
    """Walk a document the test expects to be valid, and say so if it is not."""
    simulation = dry_run(document, ticket)
    assert simulation.findings == [], [f.code for f in simulation.findings]
    return simulation


def _pairs(simulation: WorkflowDryRun) -> list[tuple[str, str]]:
    """The highlighted edges, as ``(from, to)`` pairs."""
    return [(edge.from_, edge.to) for edge in simulation.highlight_path]


def _step(simulation: WorkflowDryRun, node_id: str) -> DryRunStep:
    """The step for one stage."""
    return next(step for step in simulation.steps if step.node_id == node_id)


def _out(step: DryRunStep, target: str) -> DryRunEdge:
    """The edge out of a step that arrives at ``target``."""
    return next(edge for edge in step.edges if edge.to == target)


def _verdict(simulation: WorkflowDryRun, node_id: str) -> NodeVerdict:
    """The verdict for one stage."""
    return next(v for v in simulation.verdicts if v.node_id == node_id)


def _recorded(finding: WorkflowFinding) -> dict[str, Any]:
    """A finding reduced to what ``expected.json`` records, in its spelling."""
    entry: dict[str, Any] = {"code": finding.code, "path": finding.path}
    if finding.node_id is not None:
        entry["node"] = finding.node_id
    if finding.edge is not None:
        entry["edge"] = finding.edge.model_dump()
    return entry


# ---------------------------------------------------------------------------
# The mockup: standard-fix, for #485
# ---------------------------------------------------------------------------


def test_the_seeded_canvas_and_the_seeded_485_yield_the_mockups_active_path(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    simulation = _simulated(standard_fix, ticket_485)

    assert _pairs(simulation)[: len(MOCKUP_ACTIVE_PATH)] == MOCKUP_ACTIVE_PATH
    assert _pairs(simulation) == list(pairwise(WALK_485))


def test_the_steps_are_the_walk_in_order(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    simulation = _simulated(standard_fix, ticket_485)

    assert [step.node_id for step in simulation.steps] == WALK_485
    assert simulation.steps[-1].verdict == "ended"


def test_the_trigger_is_tested_against_the_ticket_and_its_estimate(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    trigger = _simulated(standard_fix, ticket_485).steps[0]

    assert trigger.verdict == "matched"
    assert trigger.annotation == "Starts a run when a ticket is queued with effort ≤ M."
    assert trigger.evaluation is not None
    assert trigger.evaluation.explanation == (
        "The trigger fires for #485: #485 is effort M, and M ≤ M."
    )


def test_a_decision_reports_both_branches_and_explains_the_road_not_taken(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    decision = _step(_simulated(standard_fix, ticket_485), "effort-recheck")

    taken, not_taken = _out(decision, "plan"), _out(decision, "split")

    assert decision.annotation == (
        "A decision on: effort ≤ M. Every branch out of it is reported, taken or not."
    )
    assert (taken.outcome, taken.label, taken.explanation) == (
        "taken",
        "≤ M ↓",
        "Taken: #485 is effort M, and M ≤ M.",
    )
    assert (not_taken.outcome, not_taken.label, not_taken.explanation) == (
        "not_taken",
        "> M ↘",
        "Not taken: #485 is effort M, and M is not > M.",
    )
    assert taken.evaluation is not None and taken.evaluation.holds is True
    assert not_taken.evaluation is not None and not_taken.evaluation.holds is False


def test_a_gate_is_annotated_with_its_requirements(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    gate = _step(_simulated(standard_fix, ticket_485), "checks-green")

    assert gate.annotation == (
        "A gate. Requires: the checks `build`, `test`, `review` all passing."
    )
    assert gate.evaluation is not None
    assert gate.evaluation.assumed is True
    assert _out(gate, "open-pr").explanation == (
        "Taken: a dry run has no check results, so it assumes every check passes."
    )


def test_a_loop_is_reported_with_its_retry_bound_and_never_walked(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    simulation = _simulated(standard_fix, ticket_485)
    loop = _out(_step(simulation, "checks-green"), "implement")
    implement = next(
        node for node in standard_fix["nodes"] if node["id"] == "implement"
    )

    assert (loop.kind, loop.outcome) == ("loop", "loop")
    assert loop.max_retries == implement["config"]["limits"]["max_retries"] == 2
    assert ("checks-green", "implement") not in _pairs(simulation)
    assert [step.node_id for step in simulation.steps].count("implement") == 1
    assert loop.explanation == (
        "Loops back to `implement`; it is bounded by the 2 retries `implement` allows. "
        "It would not be followed: a dry run has no check results, so it assumes no check "
        "fails. A dry run reports a loop and never walks it."
    )


def test_only_a_loop_carries_a_retry_bound(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    edges = [
        edge
        for step in _simulated(standard_fix, ticket_485).steps
        for edge in step.edges
    ]

    assert {edge.kind for edge in edges if edge.max_retries is not None} == {"loop"}


def test_every_stage_has_one_verdict_in_document_order(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    simulation = _simulated(standard_fix, ticket_485)

    assert [v.node_id for v in simulation.verdicts] == [
        node["id"] for node in standard_fix["nodes"]
    ]
    assert {v.node_id for v in simulation.verdicts if v.verdict == "not_reached"} == {
        "split",
        "back-to-queue",
    }


def test_the_verdicts_explain_how_each_stage_was_or_was_not_reached(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    simulation = _simulated(standard_fix, ticket_485)

    assert _verdict(simulation, "plan").explanation == "Reached from `effort-recheck`."
    assert _verdict(simulation, "open-pr").explanation == (
        "Reached from `checks-green`; the simulated run ends here."
    )
    assert _verdict(simulation, "split").explanation == (
        "Not reached: the branch from `effort-recheck` is not taken, because #485 is "
        "effort M, and M is not > M."
    )
    assert _verdict(simulation, "back-to-queue").explanation == (
        "Not reached: it is reached only through `split`, which the walk did not reach."
    )


def test_what_a_stage_would_do_is_said_and_not_done(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    simulation = _simulated(standard_fix, ticket_485)

    assert _step(simulation, "analyze").annotation == (
        "A model stage: loads the skill `repo-map` before its prompt, on the pinned alias "
        "`coder-std`, with at most 2 retries and a 200000-token budget. Not invoked — "
        "a dry run makes no model call."
    )
    assert _step(simulation, "implement").annotation == (
        "A model stage: loads the skill `zephyr-conventions` before its prompt, on the model "
        "the `implement` task routes to, with at most 2 retries and a 400000-token budget. "
        "Not invoked — a dry run makes no model call."
    )
    assert _step(simulation, "test").annotation == (
        "A build stage: runs `twister -p native_sim` on the `pool-a` runner pool. Not "
        "dispatched — a dry run starts no build."
    )
    assert _step(simulation, "open-pr").annotation == (
        "Ends the run by opening a pull request and auto-merging it with a `squash` merge, "
        "deleting the branch. Not performed — a dry run opens nothing."
    )


# ---------------------------------------------------------------------------
# Other tickets, other graphs
# ---------------------------------------------------------------------------


def test_a_larger_ticket_takes_the_other_branch(standard_fix: dict) -> None:
    standard_fix["trigger"]["conditions"] = {}

    simulation = _simulated(standard_fix, _ticket("l"))

    assert [step.node_id for step in simulation.steps] == [
        "issue-queued",
        "analyze",
        "effort-recheck",
        "split",
        "back-to-queue",
    ]
    assert _verdict(simulation, "implement").explanation == (
        "Not reached: it is reached only through `plan`, `checks-green`, which the walk "
        "did not reach."
    )


def test_a_trigger_that_does_not_fire_starts_no_run(standard_fix: dict) -> None:
    simulation = _simulated(standard_fix, _ticket("l"))
    trigger = simulation.steps[0]

    assert [step.node_id for step in simulation.steps] == ["issue-queued"]
    assert trigger.verdict == "not_matched"
    assert trigger.edges[0].outcome == "not_taken"
    assert trigger.edges[0].explanation == (
        "Not taken: the trigger does not fire for #485, so no run starts."
    )
    assert simulation.highlight_path == []
    assert _verdict(simulation, "issue-queued").explanation == (
        "The trigger does not fire for #485: #485 is effort L, and L is not ≤ M."
    )
    assert _verdict(simulation, "analyze").explanation == (
        "Not reached: the trigger does not fire for #485."
    )
    assert {v.verdict for v in simulation.verdicts[1:]} == {"not_reached"}


def test_an_unsized_ticket_does_not_fire_an_effort_trigger(standard_fix: dict) -> None:
    simulation = _simulated(standard_fix, _ticket(None))

    assert simulation.steps[0].verdict == "not_matched"
    assert "#485 has no estimate" in _verdict(simulation, "issue-queued").explanation


def test_every_branch_that_holds_is_taken() -> None:
    document = read_fixture("valid/predicate-kinds.json")

    simulation = _simulated(document, _ticket("s", labels=("bug", "regression")))

    assert _pairs(simulation) == [
        ("start", "route"),
        ("route", "small"),
        ("route", "labelled"),
        ("route", "verified"),
    ]
    assert _verdict(simulation, "foreign").explanation == (
        "Not reached: the branch from `route` is not taken, because #485 comes from "
        "`github`, which is excluded."
    )


def test_each_terminal_says_how_it_would_end_the_run() -> None:
    # The fixture's trigger only fires for a GitHub ticket, and every branch holding needs one
    # from elsewhere — so the trigger is opened up and the decision does the choosing.
    document = read_fixture("valid/predicate-kinds.json")
    document["trigger"]["conditions"] = {}

    simulation = _simulated(
        document, _ticket("s", labels=("bug", "regression"), source="gitlab")
    )

    assert {step.node_id: step.annotation for step in simulation.steps[2:]} == {
        "small": "Ends the run by handing it to a person for review.",
        "labelled": "Ends the run by returning the ticket to the queue.",
        "foreign": (
            "Ends the run by opening a pull request and auto-merging it with a `rebase` "
            "merge, keeping the branch. Not performed — a dry run opens nothing."
        ),
        "verified": (
            "Ends the run by opening a pull request and auto-merging it with a `merge` "
            "merge, deleting the branch. Not performed — a dry run opens nothing."
        ),
    }


def test_a_stage_no_edge_leaves_is_halted() -> None:
    document = _document(
        nodes=[
            _node("start", "trigger", {}),
            _node(
                "route", "flow", {"kind": "decision", "predicate": {"kind": "always"}}
            ),
            _node("small", "term", _NEEDS_REVIEW),
            _node("docs", "term", _NEEDS_REVIEW),
        ],
        edges=[
            _edge("start", "route"),
            _edge(
                "route",
                "small",
                "branch",
                {"kind": "effort", "op": "lte", "value": "s"},
            ),
            _edge(
                "route",
                "docs",
                "branch",
                {"kind": "labels", "op": "any", "values": ["docs"]},
            ),
        ],
    )

    simulation = _simulated(document, _ticket("m", labels=("bug",)))
    route = _step(simulation, "route")

    assert route.verdict == "halted"
    assert route.annotation == (
        "A decision on: nothing — the condition always holds. Every branch out of it is "
        "reported, taken or not."
    )
    assert [edge.outcome for edge in route.edges] == ["not_taken", "not_taken"]
    assert _verdict(simulation, "route").explanation == (
        "Reached from `start`, and no edge out of it is taken, so a run would stop here."
    )
    assert _verdict(simulation, "small").explanation == (
        "Not reached: the branch from `route` is not taken, because #485 is effort M, and "
        "M is not ≤ S."
    )


def test_a_stage_two_taken_edges_reach_is_walked_once_and_highlighted_twice() -> None:
    always = {"kind": "decision", "predicate": {"kind": "always"}}
    document = _document(
        nodes=[
            _node("start", "trigger", {}),
            _node("fork", "flow", always),
            _node("side", "flow", always),
            _node("end", "term", _NEEDS_REVIEW),
        ],
        edges=[
            _edge("start", "fork"),
            _edge("fork", "end", "branch", {"kind": "always"}),
            _edge("fork", "side", "branch", {"kind": "always"}),
            _edge("side", "end"),
        ],
    )

    simulation = _simulated(document, _ticket("m"))

    assert [step.node_id for step in simulation.steps] == [
        "start",
        "fork",
        "end",
        "side",
    ]
    assert _pairs(simulation) == [
        ("start", "fork"),
        ("fork", "end"),
        ("fork", "side"),
        ("side", "end"),
    ]
    assert _verdict(simulation, "end").explanation == (
        "Reached from `fork`; the simulated run ends here."
    )


def test_a_loop_into_a_stage_that_declares_no_limit_is_reported_as_unbounded() -> None:
    document = _document(
        nodes=[
            _node("start", "trigger", {}),
            _node("build", "infra", {}),
            _node(
                "gate",
                "flow",
                {"kind": "gate", "predicate": {"kind": "checks", "op": "all_passed"}},
            ),
            _node("done", "term", _NEEDS_REVIEW),
        ],
        edges=[
            _edge("start", "build"),
            _edge("build", "gate"),
            _edge("gate", "done", "branch", {"kind": "checks", "op": "all_passed"}),
            _edge("gate", "build", "loop", {"kind": "always"}),
        ],
    )

    simulation = _simulated(document, _ticket("m"))
    loop = _out(_step(simulation, "gate"), "build")

    assert loop.max_retries is None
    assert loop.explanation == (
        "Loops back to `build`; `build` declares no retry limit, so nothing in the document "
        "bounds it. It would be followed: the condition always holds. A dry run reports a "
        "loop and never walks it."
    )
    assert _step(simulation, "build").annotation == (
        "A build stage: runs the repository's default command on the default runner pool. "
        "Not dispatched — a dry run starts no build."
    )


def test_a_loop_with_no_condition_says_where_it_returns_and_what_bounds_it() -> None:
    document = _document(
        nodes=[
            _node("start", "trigger", {}),
            _node("fix", "llm", _llm(max_retries=1)),
            _node("check", "infra", {}),
            _node("done", "term", _NEEDS_REVIEW),
        ],
        edges=[
            _edge("start", "fix"),
            _edge("fix", "check"),
            _edge("check", "done"),
            _edge("check", "fix", "loop"),
        ],
    )

    simulation = _simulated(document, _ticket("m"))
    loop = _out(_step(simulation, "check"), "fix")

    assert (loop.max_retries, loop.evaluation) == (1, None)
    assert loop.explanation == (
        "Loops back to `fix`; it is bounded by the 1 retry `fix` allows. A dry run reports "
        "a loop and never walks it."
    )
    assert _step(simulation, "fix").annotation == (
        "A model stage: sends its prompt template directly, on the model the `implement` "
        "task routes to, with at most 1 retry and a 1000-token budget. Not invoked — a dry "
        "run makes no model call."
    )


def test_a_stage_a_loop_points_at_first_says_the_loop_is_not_walked() -> None:
    document = _document(
        nodes=[
            _node("start", "trigger", {}),
            _node("again", "infra", {}),
            _node(
                "route", "flow", {"kind": "decision", "predicate": {"kind": "always"}}
            ),
            _node("retry", "infra", {}),
            _node("done", "term", _NEEDS_REVIEW),
        ],
        edges=[
            _edge("start", "again"),
            _edge("start", "route"),
            _edge(
                "route", "retry", "branch", {"kind": "effort", "op": "gt", "value": "m"}
            ),
            _edge("retry", "again"),
            _edge("again", "done"),
            _edge("again", "retry", "loop"),
        ],
    )

    simulation = _simulated(document, _ticket("m"))

    assert _verdict(simulation, "retry").explanation == (
        "Not reached: the loop from `again` is reported rather than walked."
    )


# ---------------------------------------------------------------------------
# Invalid definitions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "case", [case for case in CASES if not case.valid], ids=lambda case: case.name
)
def test_an_invalid_definition_is_answered_with_anchored_findings_and_no_walk(
    case: ExpectedCase, ticket_485: DryRunTicket
) -> None:
    simulation = dry_run(read_fixture(case.document), ticket_485)

    assert [_recorded(finding) for finding in simulation.findings] == list(case.errors)
    assert (simulation.steps, simulation.verdicts, simulation.highlight_path) == (
        [],
        [],
        [],
    )


def test_a_node_config_the_dsl_does_not_define_is_refused(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    document = validate_workflow_document(standard_fix).document
    assert document is not None
    stranger = replace(document.nodes[0], config=object())  # type: ignore[arg-type]

    with pytest.raises(TypeError, match="object is not a workflow node config"):
        walk(replace(document, nodes=(stranger, *document.nodes[1:])), ticket_485)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

#: One dry run in a fresh interpreter: the request on stdin, the answer on stdout.
_SIMULATE_ONCE = """
import json, sys
from ouroboros_engine.workflows.contract import DryRunTicket
from ouroboros_engine.workflows.simulate import dry_run
request = json.load(sys.stdin)
ticket = DryRunTicket.model_validate(request["ticket"])
print(json.dumps(dry_run(request["definition"], ticket).model_dump(mode="json")))
"""


def test_the_same_input_produces_the_same_walk_every_time(
    standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    first = dry_run(standard_fix, ticket_485).model_dump(mode="json")

    for _ in range(25):
        assert dry_run(standard_fix, ticket_485).model_dump(mode="json") == first


@pytest.mark.parametrize("seed", ["0", "1", "4242"])
def test_the_walk_does_not_depend_on_the_process_that_computes_it(
    seed: str, standard_fix: dict, ticket_485: DryRunTicket
) -> None:
    # A different PYTHONHASHSEED reorders every set and every str-keyed hash iteration, so a
    # walk that leaned on one would come back in a different order here.
    request = json.dumps(
        {"definition": standard_fix, "ticket": ticket_485.model_dump(mode="json")}
    )

    completed = subprocess.run(  # noqa: S603 — the interpreter running this suite
        [sys.executable, "-c", _SIMULATE_ONCE],
        input=request,
        capture_output=True,
        text=True,
        check=True,
        env={**os.environ, "PYTHONHASHSEED": seed},
    )

    assert json.loads(completed.stdout) == dry_run(standard_fix, ticket_485).model_dump(
        mode="json"
    )


# ---------------------------------------------------------------------------
# Zero model calls, zero provider calls — the static half
# ---------------------------------------------------------------------------

#: The package a dry run executes, and the router in front of it.
_PACKAGE = Path(simulate.__file__).resolve().parent
_ROUTER = _PACKAGE.parent / "api" / "workflows.py"

#: What a module a dry run executes may not import: this service's two ways out to a model or a
#: provider, and every standard or installed way to open a connection or a process.
_FORBIDDEN = (
    "ouroboros_engine.control_plane",
    "ouroboros_engine.estimation",
    "asyncio",
    "http",
    "httpx",
    "httpx2",
    "requests",
    "socket",
    "ssl",
    "subprocess",
    "urllib",
)


def _imports(path: Path) -> set[str]:
    """Every module a file imports, with relative imports resolved inside its package."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    package = "ouroboros_engine.workflows"
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names.add(f"{package}.{module}" if node.level else module)
    return names


@pytest.mark.parametrize(
    "path", [*sorted(_PACKAGE.glob("*.py")), _ROUTER], ids=lambda path: path.name
)
def test_nothing_a_dry_run_executes_can_reach_a_model_or_a_provider(path: Path) -> None:
    reaching = sorted(
        name
        for name in _imports(path)
        for forbidden in _FORBIDDEN
        if name == forbidden or name.startswith(f"{forbidden}.")
    )

    assert reaching == []


def test_the_import_audit_would_notice_a_forbidden_import(tmp_path: Path) -> None:
    # The audit above passes vacuously if `_imports` reads nothing, so it is shown catching one.
    module = tmp_path / "leaky.py"
    module.write_text(
        "import socket\nfrom ouroboros_engine.control_plane.client import ControlPlaneClient\n",
        encoding="utf-8",
    )

    assert {"socket", "ouroboros_engine.control_plane.client"} <= _imports(module)
