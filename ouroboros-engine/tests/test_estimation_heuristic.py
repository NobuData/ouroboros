"""``heuristic-v0`` — the fixture table, the determinism, and the honesty.

The table below is the ticket's own acceptance criterion — *a fixture table covers every
effort value, every workflow tag, and the needs-human threshold on both sides* — written as
data so that the coverage is something the suite can assert rather than something a reader
has to count. Three tests at the bottom of the first section prove the table is complete;
if a sixth effort or a fifth tag is ever added to the contract, they fail until a row
exercising it exists.

The other three sections are the properties the ticket cares about more than the numbers:

* **Determinism.** The same request produces the same bytes, from two instances, and from
  the same labels in a different order. The last of those is stronger than the ticket asks
  for and is the one that matters in practice: a backlog re-sync reorders labels, and an
  estimator that answered differently afterwards would version an estimate that had not
  changed.
* **Provenance.** ``trace.estimator`` is ``heuristic-v0`` on every path, ``tokens_used`` is
  ``0``, and no constant in this service can reach ``routed_model`` — decision **K10**, and
  the reason the ticket says the estimator must never masquerade as a model.
* **The caller's vocabularies.** Decisions **K5** and **K6**: an installation with different
  workflow tags, differently-named model classes, or one model and nothing else still gets a
  valid answer, and the trace says what it had to fall back to.
"""

import ast
import json
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from ouroboros_engine.estimation import heuristic as heuristic_module
from ouroboros_engine.estimation import signals as signals_module
from ouroboros_engine.estimation.contract import (
    EFFORTS,
    MAX_LABEL_LENGTH,
    MAX_LABELS,
    MAX_MODEL_DEFAULTS,
    MAX_MODEL_LENGTH,
    MAX_SIGNAL_LENGTH,
    MAX_SIGNALS,
    MAX_TAG_LENGTH,
    MAX_TITLE_LENGTH,
    MAX_WORKFLOW_TAGS,
    Effort,
    Estimate,
    EstimateRequest,
    EstimationContext,
    IssueContext,
    Risk,
)
from ouroboros_engine.estimation.estimator import Estimator, honours_context
from ouroboros_engine.estimation.heuristic import (
    HEURISTIC,
    NEEDS_HUMAN_CONFIDENCE_FLOOR,
    NOT_INVOKED,
    HeuristicEstimator,
    confidence_for,
    needs_human,
    offered_tag,
    resolve_model,
    risk_for,
)
from ouroboros_engine.estimation.signals import (
    DEPS_REFRESH,
    DOCS_LOOP,
    FEATURE_LOOP,
    STANDARD_FIX,
    body_effort,
    label_effort,
)

# ---------------------------------------------------------------------------
# The bodies the table is built from
# ---------------------------------------------------------------------------

BUG_BODY = (
    "After entering low-power sleep and waking the BMI270, the I2C bus intermittently "
    "locks up. Recovery requires a full bus reset."
)
DOCS_BODY = "Several typos across the manual."
DEPS_BODY = (
    "zlib 1.2.13 has an out-of-bounds read in the inflate path. Nothing in the firmware "
    "decompresses untrusted input today, but the OTA applier will."
)
FEATURE_BODY = (
    "Field techs want battery state of health without opening the enclosure. Add a GATT "
    "characteristic exposing cycle count, capacity fade and last-charge temperature, and "
    "document the UUIDs in the pairing guide. The characteristic should be readable "
    "without pairing so a technician can triage a unit from the aisle, and notify on "
    "change so the fleet app can keep a running record without polling. The values come "
    "from the fuel gauge's own registers, which are already read once a minute for the "
    "charge controller, so no new bus traffic is needed — only a cache and a "
    "characteristic that reads it."
)
MIGRATION_BODY = (
    "We are three minor versions behind on Zephyr and the 4.2 release moves the device "
    "tree bindings, the Kconfig layout and the west manifest format. Every board file "
    "needs revisiting, the out-of-tree drivers need their bindings regenerated, and the "
    "CI images need rebuilding against the new SDK. The HIL rack will need a full "
    "re-flash cycle before we can trust the results."
)
EPIC_BODY = (
    "The telemetry stack has grown three separate framing layers and two retry policies "
    "that disagree about ordering. " * 40
)
CHECKLIST_BODY = "Split the driver up.\n\n" + "\n".join(
    f"- [ ] step {index}" for index in range(20)
)


@dataclass(frozen=True)
class Case:
    """One row of the fixture table: an issue, and every field of the answer it gets.

    Attributes:
        name: What the row is for, and the id pytest reports it under.
        title: The issue title.
        body: The description, or ``None``.
        labels: The label names.
        effort: The effort expected.
        confidence: The confidence expected, exactly. Written out rather than compared
            against a recomputation of the formula, so a change to a constant shows up as a
            table of numbers that moved rather than as a test that still passes.
        workflow: The workflow tag expected.
        risk: The risk expected.
    """

    name: str
    title: str
    body: str | None
    labels: tuple[str, ...]
    effort: Effort
    confidence: int
    workflow: str
    risk: Risk

    @property
    def issue(self) -> IssueContext:
        """The row as a request's issue block.

        Returns:
            A valid :class:`~ouroboros_engine.estimation.contract.IssueContext`.
        """
        return IssueContext(
            number=485,
            title=self.title,
            body=self.body,
            labels=list(self.labels),
            repo="acme-robotics/helios-firmware",
        )

    @property
    def sized(self) -> bool:
        """Which side of the needs-human floor this row falls on.

        Returns:
            ``True`` when L.3 would mark the issue ``sized`` rather than ``needs_human``.
        """
        return self.confidence >= NEEDS_HUMAN_CONFIDENCE_FLOOR


#: Every effort, every workflow tag, both sides of the floor, and both directions a label
#: can move the risk. The first five rows are the mockup's own issues
#: (``docs/mockups/03-issues.html``); the rest are the shapes the mockup has no example of.
TABLE: tuple[Case, ...] = (
    Case(
        name="xs-docs",
        title="Typo sweep in operator manual + pairing guide",
        body=DOCS_BODY,
        labels=("docs", "good-first-issue"),
        effort="xs",
        confidence=98,
        workflow=DOCS_LOOP,
        risk="low",
    ),
    Case(
        name="s-dependency-bump",
        title="Bump zlib from 1.2.13 to 1.3.1",
        body=DEPS_BODY,
        labels=("dependencies",),
        effort="s",
        confidence=98,
        workflow=DEPS_REFRESH,
        risk="low",
    ),
    Case(
        name="m-bug",
        title="Watchdog reset on I²C bus lockup",
        body=BUG_BODY,
        labels=("bug", "i2c", "watchdog"),
        effort="m",
        confidence=77,
        workflow=STANDARD_FIX,
        risk="medium",
    ),
    Case(
        name="l-feature",
        title="Expose battery health over BLE GATT service",
        body=FEATURE_BODY,
        labels=("enhancement", "ble"),
        effort="l",
        confidence=77,
        workflow=FEATURE_LOOP,
        risk="high",
    ),
    Case(
        name="xl-migration",
        title="Migrate build system to Zephyr RTOS 4.2",
        body=MIGRATION_BODY,
        labels=("tech-debt", "zephyr"),
        effort="xl",
        confidence=60,
        workflow=DEPS_REFRESH,
        risk="high",
    ),
    Case(
        name="xl-epic-agreed-on",
        title="Rewrite the telemetry stack",
        body=EPIC_BODY,
        labels=("epic",),
        effort="xl",
        confidence=98,
        workflow=STANDARD_FIX,
        risk="high",
    ),
    Case(
        name="xl-from-a-long-checklist",
        title="Split the sensor driver",
        body=CHECKLIST_BODY,
        labels=("refactor",),
        effort="xl",
        confidence=60,
        workflow=STANDARD_FIX,
        risk="high",
    ),
    Case(
        name="no-label-this-estimator-knows",
        title="Frames drop under load",
        body=BUG_BODY,
        labels=("telemetry",),
        effort="s",
        confidence=68,
        workflow=STANDARD_FIX,
        risk="low",
    ),
    Case(
        name="no-description",
        title="Watchdog reset on I²C bus lockup",
        body=None,
        labels=("bug",),
        effort="m",
        confidence=59,
        workflow=STANDARD_FIX,
        risk="medium",
    ),
    Case(
        name="risk-raised-by-a-label",
        title="Session token leaks into the debug log",
        body=BUG_BODY,
        labels=("bug", "security"),
        effort="m",
        confidence=77,
        workflow=STANDARD_FIX,
        risk="high",
    ),
    Case(
        name="risk-lowered-by-a-label",
        title="Restructure the tuning guide",
        body=FEATURE_BODY,
        labels=("enhancement", "documentation"),
        effort="l",
        confidence=77,
        workflow=DOCS_LOOP,
        risk="medium",
    ),
)

#: The vocabularies most of this suite offers: the roadmap's four workflow tags, and a model
#: for the documentation class of work beside a default. Deliberately *not* a model per tag —
#: a caller with a partial map is the normal case, and the fallback has to be exercised by
#: the table rather than only by the tests written for it.
CONTEXT = EstimationContext(
    workflow_tags=[STANDARD_FIX, DOCS_LOOP, FEATURE_LOOP, DEPS_REFRESH],
    model_defaults={"default": "claude-fable-5", "docs": "claude-haiku-4-5"},
)


@pytest.fixture
def estimator() -> HeuristicEstimator:
    """The estimator ``create_app`` installs.

    Returns:
        A :class:`ouroboros_engine.estimation.heuristic.HeuristicEstimator`.
    """
    return HeuristicEstimator()


def request_for(case: Case, context: EstimationContext = CONTEXT) -> EstimateRequest:
    """Turn a table row into a request.

    Args:
        case: The row.
        context: The vocabularies to offer.

    Returns:
        A valid :class:`~ouroboros_engine.estimation.contract.EstimateRequest`.
    """
    return EstimateRequest(issue=case.issue, context=context)


def cases() -> list[pytest.param]:
    """The table as pytest parameters, each named by its row.

    Returns:
        One parameter per row, so a failure names the shape that broke rather than an index.
    """
    return [pytest.param(case, id=case.name) for case in TABLE]


# ---------------------------------------------------------------------------
# The fixture table
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", cases())
def test_the_table_is_what_the_estimator_says(
    estimator: HeuristicEstimator, case: Case
) -> None:
    estimate = estimator.estimate(request_for(case))

    assert estimate.effort == case.effort
    assert estimate.confidence == case.confidence
    assert estimate.suggested_workflow == case.workflow
    assert estimate.risk == case.risk


def test_the_table_covers_every_effort() -> None:
    # The ticket's first acceptance criterion, asserted rather than counted by hand.
    assert {case.effort for case in TABLE} == set(EFFORTS)


def test_the_table_covers_every_workflow_tag() -> None:
    assert {case.workflow for case in TABLE} == set(CONTEXT.workflow_tags)


def test_the_table_covers_both_sides_of_the_needs_human_threshold() -> None:
    assert {case.sized for case in TABLE} == {True, False}


@pytest.mark.parametrize("case", cases())
def test_every_row_is_an_answer_the_caller_could_use(
    estimator: HeuristicEstimator, case: Case
) -> None:
    # Decisions K5 and K6 over the whole table: the route runs this check on every answer,
    # and a row that failed it would be a 500 rather than an estimate.
    honours_context(estimator.estimate(request_for(case)), CONTEXT)


# ---------------------------------------------------------------------------
# The two cases the ticket names
# ---------------------------------------------------------------------------


def test_a_documentation_issue_sizes_xs_on_the_docs_loop(
    estimator: HeuristicEstimator,
) -> None:
    # The mockup's `#488`, and the design's own numbers: XS at 98% on `docs-loop`.
    case = next(row for row in TABLE if row.name == "xs-docs")

    estimate = estimator.estimate(request_for(case))

    assert estimate.effort == "xs"
    assert estimate.suggested_workflow == DOCS_LOOP
    assert estimate.confidence == 98
    assert not needs_human(estimate)


def test_a_migration_issue_sizes_xl_with_low_confidence(
    estimator: HeuristicEstimator,
) -> None:
    # The mockup's `#490`. The design shows XL at 61% and *needs human*; what matters here
    # is the effort, the tag, and that the confidence lands under the floor — the rules read
    # this issue as three different jobs, which is exactly the case a person should see.
    case = next(row for row in TABLE if row.name == "xl-migration")

    estimate = estimator.estimate(request_for(case))

    assert estimate.effort == "xl"
    assert estimate.suggested_workflow == DEPS_REFRESH
    assert estimate.confidence < NEEDS_HUMAN_CONFIDENCE_FLOOR
    assert needs_human(estimate)


# ---------------------------------------------------------------------------
# `files` is empty, and says so
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", cases())
def test_no_row_claims_to_know_which_files_are_touched(
    estimator: HeuristicEstimator, case: Case
) -> None:
    assert estimator.estimate(request_for(case)).breakdown.files == []


def test_the_absence_of_files_is_stated_rather_than_omitted(
    estimator: HeuristicEstimator,
) -> None:
    # The ticket is explicit: the response says `files` is empty rather than leaving the key
    # out, because N.5 renders the absence and a missing key reads as an older schema.
    body = json.loads(estimator.estimate(request_for(TABLE[0])).model_dump_json())

    assert "files" in body["breakdown"]
    assert body["breakdown"]["files"] == []


@pytest.mark.parametrize("case", cases())
def test_every_row_carries_a_breakdown_the_queue_can_plan_with(
    estimator: HeuristicEstimator, case: Case
) -> None:
    breakdown = estimator.estimate(request_for(case)).breakdown

    assert breakdown.est_tokens > 0
    assert breakdown.est_minutes > 0
    assert breakdown.cycle_min <= breakdown.cycle_max


def test_the_breakdown_grows_with_the_effort() -> None:
    # Not a tautology about the table: it is what stops a typo in one row of
    # `EFFORT_BUDGETS` from making an XL cheaper than an L.
    budgets = [heuristic_module.EFFORT_BUDGETS[effort] for effort in EFFORTS]

    assert [budget.est_tokens for budget in budgets] == sorted(
        budget.est_tokens for budget in budgets
    )
    assert [budget.est_minutes for budget in budgets] == sorted(
        budget.est_minutes for budget in budgets
    )


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", cases())
def test_the_same_request_produces_the_same_bytes(
    estimator: HeuristicEstimator, case: Case
) -> None:
    first = estimator.estimate(request_for(case)).model_dump_json()
    second = estimator.estimate(request_for(case)).model_dump_json()

    assert first == second


@pytest.mark.parametrize("case", cases())
def test_two_estimators_answer_identically(case: Case) -> None:
    # Stateless by construction: an instance that had accumulated anything would show up
    # here, and versioned estimates are only meaningful if a difference means something.
    mine = HeuristicEstimator().estimate(request_for(case)).model_dump_json()
    yours = HeuristicEstimator().estimate(request_for(case)).model_dump_json()

    assert mine == yours


@pytest.mark.parametrize("case", cases())
def test_the_order_the_labels_arrived_in_changes_nothing(
    estimator: HeuristicEstimator, case: Case
) -> None:
    # Stronger than "same input, same output", and the one that matters: K.4's backlog sync
    # re-reads labels from GitHub, and an estimator that answered differently after a
    # reorder would version an estimate for an issue that had not changed.
    forwards = estimator.estimate(request_for(case)).model_dump_json()
    reversed_case = replace(case, labels=tuple(reversed(case.labels)))
    backwards = estimator.estimate(request_for(reversed_case)).model_dump_json()

    assert forwards == backwards


@pytest.mark.parametrize("module", [heuristic_module, signals_module])
def test_the_estimator_imports_nothing_that_could_make_it_non_deterministic(
    module: object,
) -> None:
    # The determinism above is a property of today's code; this is what keeps it one. A
    # clock, a random source, the environment or the filesystem cannot be imported into
    # either module without failing here, which is a cheaper thing to notice than a
    # re-estimate that changed for no reason.
    forbidden = {
        "datetime",
        "os",
        "pathlib",
        "random",
        "secrets",
        "time",
        "uuid",
    }
    source = Path(module.__file__ or "").read_text(encoding="utf-8")

    imported: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imported.add(node.module.split(".")[0])

    assert not imported & forbidden, f"{module.__name__} imports {imported & forbidden}"


# ---------------------------------------------------------------------------
# Provenance — decision K10
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", cases())
def test_every_answer_names_the_heuristic(
    estimator: HeuristicEstimator, case: Case
) -> None:
    trace = estimator.estimate(request_for(case)).trace

    assert trace.estimator == HEURISTIC == estimator.name == "heuristic-v0"


@pytest.mark.parametrize("case", cases())
def test_no_answer_claims_to_have_spent_tokens(
    estimator: HeuristicEstimator, case: Case
) -> None:
    # `trace.tokens_used` is what producing the estimate cost. A rule engine invoked nothing,
    # and `0` is the true answer rather than a missing field.
    assert estimator.estimate(request_for(case)).trace.tokens_used == 0


def test_the_provenance_is_not_a_model_the_caller_named(
    estimator: HeuristicEstimator,
) -> None:
    # The masquerade decision K10 exists to prevent, tried the only way it could happen:
    # a caller whose model map is full of plausible provenance strings.
    context = EstimationContext(
        workflow_tags=[DOCS_LOOP],
        model_defaults={"default": "claude-sonnet-5", "docs": "heuristic-v0"},
    )

    estimate = estimator.estimate(request_for(TABLE[0], context))

    # The caller's value is answered with, unchanged — and the provenance is still this
    # estimator's own constant rather than whatever the map happened to hold.
    assert estimate.routed_model == "heuristic-v0"
    assert estimate.trace.estimator == HEURISTIC
    assert "claude-sonnet-5" not in estimate.model_dump_json()


@pytest.mark.parametrize("case", cases())
def test_every_trace_says_the_model_was_resolved_and_not_invoked(
    estimator: HeuristicEstimator, case: Case
) -> None:
    # The routing amendment's honesty constraint (Z.4, #197 — decision M6): this estimator
    # resolves a route, it does not call one, and a trace that read otherwise would be the
    # claim the amendment forbids.
    signals = estimator.estimate(request_for(case)).trace.signals

    routed = [line for line in signals if line.startswith("routed-model:")]
    assert len(routed) == 1
    assert routed[0].endswith(NOT_INVOKED)
    assert NOT_INVOKED == "resolved, not invoked"


@pytest.mark.parametrize("case", cases())
def test_a_trace_names_rules_rather_than_quoting_the_issue(
    estimator: HeuristicEstimator, case: Case
) -> None:
    # Decision K10 asks for rule-name signals. It is also what keeps mirrored GitHub content
    # out of a jsonb column that gets rendered — the body is read for its length, never
    # copied.
    signals = estimator.estimate(request_for(case)).trace.signals

    assert signals, "an estimate with no signals explains nothing"
    if case.body:
        assert not any(case.body[:24] in line for line in signals)


@pytest.mark.parametrize("case", cases())
def test_a_row_under_the_floor_says_so_in_its_trace(
    estimator: HeuristicEstimator, case: Case
) -> None:
    # `needs_human` is a real outcome and not an error, so the reason it happened belongs
    # in the trace beside everything else — L.3 acts on the confidence, a person reads this.
    signals = estimator.estimate(request_for(case)).trace.signals
    flagged = [line for line in signals if line.startswith("needs-human:")]

    assert bool(flagged) is not case.sized
    if flagged:
        assert str(case.confidence) in flagged[0]
        assert str(NEEDS_HUMAN_CONFIDENCE_FLOOR) in flagged[0]


# ---------------------------------------------------------------------------
# The caller's vocabularies — decisions K5 and K6
# ---------------------------------------------------------------------------


def test_an_installation_without_the_preferred_tag_still_gets_an_answer(
    estimator: HeuristicEstimator,
) -> None:
    context = EstimationContext(
        workflow_tags=[STANDARD_FIX], model_defaults={"default": "claude-fable-5"}
    )

    estimate = estimator.estimate(request_for(TABLE[0], context))

    assert estimate.suggested_workflow == STANDARD_FIX
    assert any("workflow-fallback:" in line for line in estimate.trace.signals)


def test_an_installation_with_none_of_the_four_tags_gets_the_first_it_offered(
    estimator: HeuristicEstimator,
) -> None:
    # The last resort, and it still comes out of the offer: this service holds no list of
    # tags, so there is nothing else it could answer with.
    context = EstimationContext(
        workflow_tags=["triage", "deep-work"],
        model_defaults={"default": "claude-fable-5"},
    )

    estimate = estimator.estimate(request_for(TABLE[0], context))

    assert estimate.suggested_workflow == "triage"
    honours_context(estimate, context)


def test_the_model_comes_from_the_key_for_the_classification(
    estimator: HeuristicEstimator,
) -> None:
    estimate = estimator.estimate(request_for(TABLE[0]))

    assert estimate.routed_model == "claude-haiku-4-5"
    assert 'model_defaults["docs"]' in " ".join(estimate.trace.signals)


def test_a_classification_with_no_key_of_its_own_falls_back_to_the_default(
    estimator: HeuristicEstimator,
) -> None:
    estimate = estimator.estimate(request_for(TABLE[2]))

    assert estimate.routed_model == "claude-fable-5"
    assert 'model_defaults["default"]' in " ".join(estimate.trace.signals)


def test_a_caller_whose_keys_are_capitalised_is_still_understood(
    estimator: HeuristicEstimator,
) -> None:
    # The keys are the caller's own naming, and `Docs` meaning `docs` is not a distinction
    # worth answering the wrong model over.
    context = EstimationContext(
        workflow_tags=[DOCS_LOOP], model_defaults={"Docs": "claude-haiku-4-5"}
    )

    assert estimator.estimate(request_for(TABLE[0], context)).routed_model == (
        "claude-haiku-4-5"
    )


def test_a_caller_with_neither_key_gets_the_first_default_it_wrote(
    estimator: HeuristicEstimator,
) -> None:
    context = EstimationContext(
        workflow_tags=[STANDARD_FIX],
        model_defaults={"sizing": "ollama/qwen3-coder", "review": "claude-sonnet-5"},
    )

    estimate = estimator.estimate(request_for(TABLE[2], context))

    assert estimate.routed_model == "ollama/qwen3-coder"
    assert any("no fix/standard/default key" in line for line in estimate.trace.signals)


def test_the_model_is_a_value_of_the_map_and_never_one_of_its_keys(
    estimator: HeuristicEstimator,
) -> None:
    # An estimator reading `model_defaults` the wrong way round would answer with a class of
    # work where a model belongs, and `honours_context` would not catch it if the key
    # happened to look like a model. So it is asserted directly.
    context = EstimationContext(
        workflow_tags=[STANDARD_FIX],
        model_defaults={"claude-fable-5": "ollama/qwen3-coder"},
    )

    assert estimator.estimate(request_for(TABLE[2], context)).routed_model == (
        "ollama/qwen3-coder"
    )


def test_an_installation_with_exactly_one_of_each_still_gets_an_answer(
    estimator: HeuristicEstimator,
) -> None:
    # The smallest request the contract allows: one tag, one model.
    context = EstimationContext(
        workflow_tags=["only-loop"], model_defaults={"only": "only-model"}
    )

    for case in TABLE:
        honours_context(estimator.estimate(request_for(case, context)), context)


# ---------------------------------------------------------------------------
# The pieces, on their own
# ---------------------------------------------------------------------------


def test_confidence_needs_something_to_have_been_read() -> None:
    # The body rule never abstains, so an empty tuple here means a bug in this service
    # rather than an issue nothing can be said about.
    with pytest.raises(ValueError, match="at least one signal"):
        confidence_for((), TABLE[0].issue)


def test_perfect_agreement_is_the_ceiling_and_the_ceiling_is_not_certainty() -> None:
    case = next(row for row in TABLE if row.name == "xs-docs")
    signals = tuple(
        signal
        for signal in (label_effort(case.issue), body_effort(case.issue))
        if signal is not None
    )

    score, terms = confidence_for(signals, case.issue)

    assert score == 98
    assert score < 100, "a rule engine reading three lines of metadata is never certain"
    assert terms == "2 of 2 agree, spread 0"


def test_an_unlabelled_issue_is_scored_below_the_floor() -> None:
    # One signal always agrees with itself, which is why the largest penalty is for having
    # nothing to corroborate it with.
    issue = replace(TABLE[2], labels=()).issue
    signals = (body_effort(issue),)

    score, terms = confidence_for(signals, issue)

    assert score < NEEDS_HUMAN_CONFIDENCE_FLOOR
    assert "no label signal" in terms


def test_a_preferred_tag_the_caller_offered_is_used_unchanged() -> None:
    tag, fallback = offered_tag(DOCS_LOOP, CONTEXT)

    assert tag == DOCS_LOOP
    assert fallback is None


def test_a_preferred_tag_the_caller_lacks_is_reported_in_the_trace() -> None:
    context = EstimationContext(
        workflow_tags=[STANDARD_FIX], model_defaults={"default": "m"}
    )

    tag, fallback = offered_tag(DOCS_LOOP, context)

    assert tag == STANDARD_FIX
    assert fallback is not None
    assert DOCS_LOOP in fallback


def test_resolving_a_model_reports_the_key_it_came_from() -> None:
    model, line = resolve_model(DOCS_LOOP, CONTEXT)

    assert model == "claude-haiku-4-5"
    assert line == 'routed-model: model_defaults["docs"] -> resolved, not invoked'


@pytest.mark.parametrize(
    ("effort", "expected"),
    [("xs", "low"), ("s", "low"), ("m", "medium"), ("l", "high"), ("xl", "high")],
)
def test_risk_starts_at_the_effort(effort: Effort, expected: Risk) -> None:
    issue = replace(TABLE[2], labels=()).issue

    risk, _, _ = risk_for(effort, issue)

    assert risk == expected


def test_a_raising_label_beats_a_lowering_one() -> None:
    # A security issue also labelled `good-first-issue` is still a security issue, and
    # resolving that the other way round is a postmortem waiting to happen.
    issue = replace(TABLE[2], labels=("good-first-issue", "security")).issue

    risk, note, _ = risk_for("m", issue)

    assert risk == "high"
    assert '"security" label raises it to high' in note


def test_a_label_that_cannot_move_the_risk_further_says_so() -> None:
    issue = replace(TABLE[2], labels=("security",)).issue

    risk, note, _ = risk_for("xl", issue)

    assert risk == "high"
    assert "can raise it no further" in note


@pytest.mark.parametrize("case", cases())
def test_every_risk_note_says_what_was_not_read(
    estimator: HeuristicEstimator, case: Case
) -> None:
    # The honest half of the field. A risk level with no rationale is a colour nobody can
    # argue with, and this is the sentence a reviewer reads before overriding an estimate.
    note = estimator.estimate(request_for(case)).risk_note

    assert note.startswith(f"{case.effort.upper()}-sized work starts at ")
    assert heuristic_module.RISK_CAVEAT in note


def test_the_needs_human_floor_is_a_comparison_anyone_can_repeat(
    estimator: HeuristicEstimator,
) -> None:
    at_the_floor = estimator.estimate(request_for(TABLE[0])).model_copy(
        update={"confidence": NEEDS_HUMAN_CONFIDENCE_FLOOR}
    )
    under_it = at_the_floor.model_copy(
        update={"confidence": NEEDS_HUMAN_CONFIDENCE_FLOOR - 1}
    )

    assert not needs_human(at_the_floor)
    assert needs_human(under_it)
    # The floor is L.3's policy, so the comparison takes one.
    assert needs_human(at_the_floor, floor=NEEDS_HUMAN_CONFIDENCE_FLOOR + 1)


# ---------------------------------------------------------------------------
# The seam, and the bounds
# ---------------------------------------------------------------------------


def test_the_heuristic_is_an_estimator(estimator: HeuristicEstimator) -> None:
    assert isinstance(estimator, Estimator)


def test_the_largest_request_the_contract_allows_still_produces_a_valid_estimate(
    estimator: HeuristicEstimator,
) -> None:
    # Every signal line is built from the caller's own strings, and the contract caps how
    # long a trace line may be. This is the request that would find that ceiling: the
    # longest title, the most labels at their longest, the most tags at their longest, and
    # the most model defaults — none of whose keys this estimator knows, so the fallback
    # line, which is the longest one it writes, is the one under test.
    context = EstimationContext(
        workflow_tags=[
            f"{index:0{MAX_TAG_LENGTH}d}" for index in range(MAX_WORKFLOW_TAGS)
        ],
        model_defaults={
            f"{index:0{MAX_TAG_LENGTH}d}": f"{index:0{MAX_MODEL_LENGTH}d}"
            for index in range(MAX_MODEL_DEFAULTS)
        },
    )
    issue = IssueContext(
        number=485,
        title="migrate " * (MAX_TITLE_LENGTH // 8),
        body="- [ ] step\n" * 400,
        labels=[f"{index:0{MAX_LABEL_LENGTH}d}" for index in range(MAX_LABELS)],
        repo="a" * 69 + "/" + "b" * 70,
    )

    # Constructing an `Estimate` is validating one, so reaching the assertions at all is
    # most of the test.
    estimate = estimator.estimate(EstimateRequest(issue=issue, context=context))

    assert isinstance(estimate, Estimate)
    assert len(estimate.trace.signals) <= MAX_SIGNALS
    assert all(len(line) <= MAX_SIGNAL_LENGTH for line in estimate.trace.signals)
    honours_context(estimate, context)


def test_an_issue_with_nothing_in_it_but_a_title_is_still_sizeable(
    estimator: HeuristicEstimator,
) -> None:
    issue = IssueContext(number=1, title="?", body=None, labels=[], repo="a/b")

    estimate = estimator.estimate(EstimateRequest(issue=issue, context=CONTEXT))

    assert estimate.trace.estimator == HEURISTIC
    assert needs_human(estimate), "an issue with nothing in it is not a sized issue"
