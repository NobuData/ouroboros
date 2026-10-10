"""The harness's smaller parts: tools, the reply protocol, notes, estimates, the model caller."""

import io
import json
from urllib import error

import pytest

from dryrun_fakes import (
    ARBITRATION,
    DRY_RUN,
    PATCHED,
    SHA,
    RecordedEstimates,
    RecordingReader,
)
from ouroboros_engine.control_plane.client import ControlPlaneClient
from ouroboros_engine.control_plane.contract import INTERNAL_KEY_HEADER
from ouroboros_engine.copilot.gateway import GatewayError
from ouroboros_engine.dryrun.estimates import (
    EstimateUnavailableError,
    HttpReplayEstimates,
    read_stage,
)
from ouroboros_engine.dryrun.guard import GuardAudit
from ouroboros_engine.dryrun.model import (
    MAX_OUTPUT_TOKENS,
    GatewayStageCaller,
    StageCall,
)
from ouroboros_engine.dryrun.notes import (
    MINUS,
    TIMES,
    budget_note,
    diff_note,
    llm_note,
    plan_note,
    plural,
    review_note,
    terminal_note,
    tokens_label,
)
from ouroboros_engine.dryrun.protocol import (
    MAX_CALLS_PER_REPLY,
    MAX_ITEMS,
    Nit,
    StageReport,
    parse_reply,
    system_prompt,
)
from ouroboros_engine.dryrun.tools import MAX_READ_CHARS, ToolSet
from ouroboros_engine.dryrun.workspace import ReadCache, VirtualWorkspace
from ouroboros_engine.investigation.model import ModelFailureError
from ouroboros_engine.workflows.dsl import (
    BackToQueueOptions,
    NeedsReviewOptions,
    OpenPrAutomergeOptions,
    TermConfig,
)

# -- tools ------------------------------------------------------------------------------


def toolset(files=None):
    reader = RecordingReader(files)
    space = VirtualWorkspace(reader, ReadCache(), "o/r", SHA)
    estimates = RecordedEstimates()
    return (
        ToolSet(space, estimates, GuardAudit(), dry_run=DRY_RUN, stage_key="s"),
        space,
        estimates,
    )


def test_read_file_returns_the_text_and_cuts_a_long_one():
    tools, _, _ = toolset({"long.txt": "x" * (MAX_READ_CHARS + 10), "a.txt": "hello\n"})

    assert tools.call("read_file", {"path": "a.txt"}).content == "hello\n"
    long = tools.call("read_file", {"path": "long.txt"}).content
    assert long.endswith(f"\n[cut: {MAX_READ_CHARS + 10} characters in all]")
    assert len(long) < MAX_READ_CHARS + 60


def test_read_file_says_why_it_could_not():
    tools, _, _ = toolset()

    missing = tools.call("read_file", {"path": "nope.c"})
    untyped = tools.call("read_file", {"path": 7})

    assert (missing.ok, missing.content, missing.blocked) == (
        False,
        "no such file at the pinned commit",
        None,
    )
    assert (untyped.ok, untyped.content) == (False, "`path` must be a string.")


def test_list_dir_and_search_render_for_a_model():
    tools, _, _ = toolset()

    assert tools.call("list_dir", {}).content == "README.md\ndrivers/\ntests/"
    assert tools.call("search", {"query": "lostarb", "path": "drivers"}).content == (
        f"{ARBITRATION}:3: if (err & CAN_ERR_LOSTARB) {{\n"
        "drivers/can/can.h:1: #define CAN_ERR_LOSTARB 0x02"
    )
    assert tools.call("search", {"query": "Kconfig"}).content == "drivers/can/Kconfig"
    assert tools.call("search", {"query": "zzz"}).content == "No matches."
    assert tools.call("search", {"query": "  "}).content == "A search needs a query."


def test_edit_file_drafts_into_the_overlay_and_says_it_is_simulated():
    tools, space, _ = toolset()

    done = tools.call("edit_file", {"path": ARBITRATION, "content": PATCHED})
    gone = tools.call("edit_file", {"path": "README.md", "delete": True})
    vague = tools.call("edit_file", {"path": "x.c"})

    assert done.content == (
        f"Drafted {ARBITRATION} in the simulated diff. The repository is untouched."
    )
    assert gone.content == (
        "Deleted README.md in the simulated diff. The repository is untouched."
    )
    assert vague.content.startswith("edit_file needs `content`")
    assert tools.writes == 2
    assert space.changed_paths() == ["README.md", ARBITRATION]


def test_build_and_run_tests_are_replay_stubs():
    tools, _, estimates = toolset()

    built = tools.call("build", {})
    tested = tools.call("run_tests", {"filter": "can"})

    assert built.content.startswith(
        "Replayed from history, nothing was run: est. 4m 02s"
    )
    assert "insufficient history" in tested.content
    assert estimates.asked == [
        (DRY_RUN, "build", None, None),
        (DRY_RUN, "test", None, None),
    ]


def test_a_stub_with_no_estimate_says_so_and_invents_nothing():
    tools, _, estimates = toolset()
    estimates.fail = EstimateUnavailableError("estimator_unreachable", "down")

    outcome = tools.call("build", {})

    assert (outcome.ok, outcome.content) == (
        False,
        "No estimate is available (estimator_unreachable).",
    )


# -- the reply protocol -----------------------------------------------------------------


def test_the_system_prompt_states_the_rules_and_lists_only_real_tools():
    prompt = system_prompt()

    assert "DRY RUN" in prompt
    assert "Nothing is written to the repository" in prompt
    for name in ("read_file", "list_dir", "search", "edit_file", "build", "run_tests"):
        assert f"- {name}(" in prompt
    assert "```tool" in prompt
    assert "```result" in prompt
    assert system_prompt() == prompt


def test_calls_and_a_result_are_read_in_order():
    reply = parse_reply(
        "Let me look.\n"
        '```tool\n{"tool": "read_file", "arguments": {"path": "a.c"}}\n```\n'
        "and\n"
        '  ```tool\n{"tool": "search",\n "arguments": {"query": "x"}}\n  ```\n'
        '```result\n{"summary": " Done. ", "verdict": "approve"}\n```\n'
    )

    assert [(c.tool, c.arguments) for c in reply.calls] == [
        ("read_file", {"path": "a.c"}),
        ("search", {"query": "x"}),
    ]
    assert reply.report == StageReport(summary="Done.", verdict="approve")
    assert reply.dropped == 0


def test_prose_alone_is_no_call_and_no_report():
    reply = parse_reply("I think the bug is in arbitration.c.\n```c\nint x;\n```")

    assert (reply.calls, reply.report) == ((), None)


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ("{not json", "The tool block was not valid JSON."),
        ('["read_file"]', 'A tool block is {"tool": name, "arguments": {…}}.'),
        ('{"arguments": {}}', 'A tool block is {"tool": name, "arguments": {…}}.'),
        ('{"tool": 7}', 'A tool block is {"tool": name, "arguments": {…}}.'),
    ],
)
def test_a_tool_block_that_does_not_parse_is_kept_as_an_error(body, message):
    reply = parse_reply(f"```tool\n{body}\n```")

    assert [(c.tool, c.error) for c in reply.calls] == [("", message)]


def test_too_many_calls_in_one_reply_are_dropped_and_counted():
    block = '```tool\n{"tool": "list_dir", "arguments": {}}\n```\n'

    reply = parse_reply(block * (MAX_CALLS_PER_REPLY + 3))

    assert len(reply.calls) == MAX_CALLS_PER_REPLY
    assert reply.dropped == 3


def test_an_unclosed_fence_yields_nothing():
    assert parse_reply('```tool\n{"tool": "list_dir"}').calls == ()


def test_a_result_is_read_field_by_field_and_bounded():
    report = parse_reply(
        "```result\n"
        + json.dumps(
            {
                "summary": 7,
                "steps": ["one", "", 3, " two "] + ["s"] * 40,
                "would_touch": "a.c",
                "verdict": "ship it",
                "nits": [
                    "bare",
                    {"kind": "Style", "text": "Rename."},
                    {"kind": "two words", "text": "Odd kind."},
                    {"kind": "style"},
                    7,
                ],
            }
        )
        + "\n```"
    ).report

    assert report.summary == ""
    assert report.steps[:2] == ("one", "two")
    assert len(report.steps) == MAX_ITEMS
    assert report.would_touch == ()
    assert report.verdict is None
    assert report.nits == (
        Nit(kind="", text="bare"),
        Nit(kind="style", text="Rename."),
        Nit(kind="", text="Odd kind."),
    )


def test_a_result_that_is_not_an_object_is_no_report_and_the_last_valid_one_wins():
    assert parse_reply("```result\n[1, 2]\n```").report is None
    assert parse_reply("```result\nnope\n```").report is None
    twice = parse_reply(
        '```result\n{"summary": "first"}\n```\n```result\n{"summary": "second"}\n```'
    )
    assert twice.report.summary == "second"


# -- notes ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tokens", "label"),
    [
        (0, "0 tokens"),
        (999, "999 tokens"),
        (1000, "1k tokens"),
        (1499, "1k tokens"),
        (1500, "2k tokens"),
        (84000, "84k tokens"),
        (83600, "84k tokens"),
    ],
)
def test_tokens_are_labelled_the_way_the_card_prints_them(tokens, label):
    assert tokens_label(tokens) == label


def test_plural():
    assert (plural(1, "step"), plural(0, "step"), plural(3, "file")) == (
        "1 step",
        "0 steps",
        "3 files",
    )


def test_the_diff_note_uses_a_true_minus_sign():
    assert diff_note(41, 9, 84000) == f"diff drafted +41 {MINUS}9 (below) · 84k tokens"
    assert MINUS == "\N{MINUS SIGN}"
    assert TIMES == "\N{MULTIPLICATION SIGN}"


def _review(verdict, *kinds):
    return StageReport(
        verdict=verdict, nits=tuple(Nit(kind=k, text="t") for k in kinds)
    )


@pytest.mark.parametrize(
    ("reports", "note"),
    [
        ([_review("approve")], "approves"),
        ([_review("request_changes")], "requests changes"),
        ([_review("approve", "style")], "approves · 1 style nit"),
        (
            [_review("approve", "style"), _review("approve")],
            "both approve · 1 style nit",
        ),
        ([_review("approve"), _review("approve")], "both approve"),
        ([_review("approve"), _review("request_changes")], "1 of 2 approve"),
        ([_review("request_changes"), _review("request_changes")], "none of 2 approve"),
        ([_review("approve")] * 3, "all 3 approve"),
        (
            [_review("approve", "style", "style"), _review("approve", "style")],
            "both approve · 3 style nits",
        ),
        ([_review("approve", "style", "naming")], "approves · 2 nits"),
        ([_review("approve", "")], "approves · 1 nit"),
    ],
)
def test_review_notes(reports, note):
    assert review_note(reports) == note


def test_plan_notes():
    assert plan_note(StageReport(steps=("a",))) == "1 step"
    assert plan_note(StageReport(steps=("a", "b", "c"), would_touch=("x.c",))) == (
        "3 steps · would touch x.c"
    )
    assert plan_note(
        StageReport(steps=("a", "b"), would_touch=("x.c", "y.c", "z.c"))
    ) == ("2 steps · would touch x.c +2 more")


def test_a_model_stages_note_follows_what_it_did_in_a_fixed_order():
    plan = StageReport(steps=("a", "b"), would_touch=("x.c",), verdict="approve")
    common = {"added": 0, "removed": 0, "files_read": 4, "tokens": 12000}

    # A write outranks everything; then a verdict; then steps; then reads; then nothing.
    assert llm_note([plan], wrote=True, **{**common, "added": 5, "removed": 2}) == (
        f"diff drafted +5 {MINUS}2 (below) · 12k tokens"
    )
    assert llm_note([plan], wrote=False, **common) == "approves"
    assert llm_note([StageReport(steps=("a",))], wrote=False, **common) == "1 step"
    assert llm_note([StageReport()], wrote=False, **common) == "mapped 4 files"
    assert llm_note([StageReport()], wrote=False, **{**common, "files_read": 1}) == (
        "mapped 1 file"
    )
    assert llm_note([StageReport()], wrote=False, **{**common, "files_read": 0}) == (
        "completed · 12k tokens"
    )
    # Two stages sharing a row are a review only when both gave a verdict.
    assert llm_note([_review("approve"), StageReport()], wrote=False, **common) == (
        "mapped 4 files"
    )


def test_a_missing_skill_adds_a_clause_once_per_skill():
    note = llm_note(
        [StageReport()],
        added=0,
        removed=0,
        wrote=False,
        files_read=4,
        tokens=1,
        missing_skills=["advisory-db", "advisory-db", "sbom"],
    )

    assert note == (
        "mapped 4 files · skill advisory-db skipped (not defined yet)"
        " · skill sbom skipped (not defined yet)"
    )


def test_terminal_notes_are_conditional():
    assert terminal_note(TermConfig("needs_review", NeedsReviewOptions())) == (
        "would open DRAFT PR · not merged (policy)"
    )
    assert terminal_note(TermConfig("back_to_queue", BackToQueueOptions())) == (
        "would return the ticket to the queue · not performed"
    )
    assert (
        terminal_note(
            TermConfig(
                "open_pr_automerge",
                OpenPrAutomergeOptions(merge_method="squash", delete_branch=True),
            )
        )
        == "would open PR · would auto-merge (squash) · not performed"
    )


def test_budget_notes():
    assert budget_note("stage", "token", 104000, 100000) == (
        "stopped: stage token cap reached (104k of 100k tokens)"
    )
    assert (
        budget_note("run", "cost", 52, 50)
        == "stopped: run cost cap reached ($0.52 of $0.50)"
    )


# -- estimates over HTTP ----------------------------------------------------------------

STAGE = {
    "how": "replayed",
    "note": "est. 4m 02s (214 similar builds)",
    "metrics": {"estimate_ms": 242000, "sample_count": 214},
}


class _Opener:
    def __init__(self, answer):
        self.answer = answer
        self.requests = []

    def open(self, prepared, timeout=None):  # noqa: ARG002 - urllib's signature
        self.requests.append(prepared)
        if isinstance(self.answer, Exception):
            raise self.answer
        return io.BytesIO(self.answer)


def _estimates(answer) -> tuple[HttpReplayEstimates, _Opener]:
    client = HttpReplayEstimates("http://rest:4000/", "key")
    client._opener = _Opener(answer)
    return client, client._opener


def test_an_estimate_is_one_post_with_the_internal_key_and_the_stage_is_passed_on():
    client, opener = _estimates(json.dumps({"estimate": {}, "stage": STAGE}).encode())

    stage = client.estimate(
        DRY_RUN, "build", runner_pool="pool-a", command="west build"
    )

    sent = opener.requests[0]
    assert sent.get_method() == "POST"
    assert (
        sent.full_url
        == f"http://rest:4000/internal/dry-runs/{DRY_RUN}/replay-estimates"
    )
    assert sent.get_header(INTERNAL_KEY_HEADER.capitalize()) == "key"
    assert json.loads(sent.data) == {
        "kind": "build",
        "runnerPool": "pool-a",
        "command": "west build",
    }
    assert (stage.note, stage.metrics) == (STAGE["note"], STAGE["metrics"])


def test_a_test_estimate_sends_no_command_and_absent_fields_are_omitted():
    client, opener = _estimates(json.dumps({"stage": STAGE}).encode())

    client.estimate(DRY_RUN, "test", runner_pool=None, command="west twister")
    client.estimate(DRY_RUN, "build", runner_pool=None, command=None)

    assert [json.loads(r.data) for r in opener.requests] == [
        {"kind": "test"},
        {"kind": "build"},
    ]


def test_estimator_failures_are_named_and_carry_the_envelopes_code():
    refused = error.HTTPError(
        "http://rest", 422, "no", {}, io.BytesIO(b'{"code": "replay_pool_required"}')
    )
    bare = error.HTTPError("http://rest", 500, "no", {}, io.BytesIO(b"<html>"))

    for answer, code in [
        (refused, "replay_pool_required"),
        (bare, "http_500"),
        (error.URLError("down"), "estimator_unreachable"),
        (TimeoutError(), "estimator_unreachable"),
        (b"not json", "estimator_unreachable"),
        (
            b'{"stage": {"how": "llm", "note": "4m", "metrics": {}}}',
            "estimator_contract",
        ),
    ]:
        client, _ = _estimates(answer)
        with pytest.raises(EstimateUnavailableError) as failed:
            client.estimate(DRY_RUN, "build", runner_pool="p", command=None)
        assert failed.value.code == code


@pytest.mark.parametrize(
    "answer",
    [
        None,
        [],
        {},
        {"stage": None},
        {"stage": {**STAGE, "how": "llm"}},
        {"stage": {**STAGE, "note": "  "}},
        {"stage": {**STAGE, "note": 7}},
        {"stage": {**STAGE, "metrics": []}},
    ],
)
def test_an_answer_without_a_replayed_stage_is_refused_not_completed(answer):
    with pytest.raises(EstimateUnavailableError) as refused:
        read_stage(answer)

    assert refused.value.code == "estimator_contract"


# -- the model caller -------------------------------------------------------------------


class _Gateway:
    def __init__(self, lines=None, failure=None):
        self.lines = lines or []
        self.failure = failure
        self.sent = []

    def stream(self, outgoing):
        self.sent.append(outgoing)
        if self.failure is not None:
            raise self.failure
        for line in self.lines:
            yield json.dumps(line) + "\n"


def _usage(cost=1.5):
    return {
        "kind": "usage",
        "hop": 0,
        "connection": "conn",
        "model": "m",
        "inputTokens": 900,
        "outputTokens": 100,
        "costCents": cost,
    }


DONE = {"kind": "done", "hop": 0, "finishReason": "stop"}


CALL = StageCall(
    dry_run=DRY_RUN,
    stage_key="implement",
    alias="coder-max",
    system="rules",
    messages=({"role": "user", "content": "go"},),
    cost_cap_cents=31,
    resolution_version="z1-v7",
)


def _caller(gateway) -> GatewayStageCaller:
    return GatewayStageCaller(ControlPlaneClient("http://rest:4000", "key"), gateway)


def test_a_stage_call_goes_through_the_gateway_attributed_to_the_dry_run():
    gateway = _Gateway(
        [
            {"kind": "delta", "hop": 0, "text": "Hel"},
            {"kind": "delta", "hop": 0, "text": "lo"},
            _usage(),
            DONE,
        ]
    )

    try:
        answer = _caller(gateway).call(CALL)
    except ModelFailureError as contract:  # pragma: no cover - the fixture's own shape
        pytest.fail(f"the scripted events do not match the invoke contract: {contract}")

    body = gateway.sent[0].json
    assert gateway.sent[0].url == "http://rest:4000/internal/llm/invoke"
    assert body["alias"] == "coder-max"
    assert body["payload"] == {
        "system": "rules",
        "messages": [{"role": "user", "content": "go"}],
        "max_output_tokens": MAX_OUTPUT_TOKENS,
    }
    assert body["runCtx"]["run"] == DRY_RUN
    assert body["runCtx"]["stage"] == "implement"
    assert body["runCtx"]["costCapCents"] == 31
    assert body["runCtx"]["resolutionVersion"] == "z1-v7"
    assert answer.text == "Hello"
    assert [(u.input_tokens, u.output_tokens, u.cost_cents) for u in answer.usage] == [
        (900, 100, 1.5)
    ]


def test_gateway_failures_become_named_model_failures_keeping_usage():
    unavailable = _Gateway(failure=GatewayError("gateway_unavailable", "AF.2"))
    capped = _Gateway(
        [
            _usage(),
            {
                "kind": "error",
                "hop": 0,
                "code": "cost_cap_exceeded",
                "message": "spent",
            },
        ]
    )
    garbage = _Gateway([{"kind": "no-such-event"}])

    with pytest.raises(ModelFailureError) as first:
        _caller(unavailable).call(CALL)
    with pytest.raises(ModelFailureError) as second:
        _caller(capped).call(CALL)
    with pytest.raises(ModelFailureError) as third:
        _caller(garbage).call(CALL)

    assert (first.value.code, first.value.over_budget) == ("gateway_unavailable", False)
    assert (second.value.code, second.value.over_budget) == ("cost_cap_exceeded", True)
    assert len(second.value.usage) == 1
    assert third.value.code == "gateway_refused"
