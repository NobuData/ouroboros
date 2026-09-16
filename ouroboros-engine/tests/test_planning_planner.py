"""``outline-v0`` — the batch it draws, the edges it refuses to draw, and its determinism.

:mod:`tests.test_planning_outline` owns what the parser *reads*; this file owns what the
planner *decides*. The acceptance criteria the issue names are here: the mockup's outcome
with an outline fixture yields six drafts carrying the mockup's dependency shape, the same
input always produces the same batch, provenance is always ``outline-v0``, and narrative-only
input produces one draft and a guidance note rather than a fabricated decomposition.

The last of those is the one worth reading twice. It is easy to write a planner that answers
*something* for every input, and the whole of decision **N2** is that this one must not: an
outline it cannot read is a note, never five plausible-sounding tickets.
"""

import ast
from pathlib import Path

import pytest

from ouroboros_engine.planning import outline as outline_module
from ouroboros_engine.planning import outline_planner as planner_module
from ouroboros_engine.planning.contract import (
    MAX_TITLE_LENGTH,
    Plan,
    PlanningContext,
    PlanRequest,
)
from ouroboros_engine.planning.outline_planner import (
    NARRATIVE_ONLY_NOTE,
    NO_BULLETS_NOTE,
    OUTLINE_PLANNER,
    SEQUENCE_NOTE,
    OutlinePlanner,
)
from ouroboros_engine.planning.planner import (
    Planner,
    PlannerContractError,
    honours_context,
)

TAGS = ["feature-loop", "hil-verify", "docs-loop", "standard-fix"]

NARRATIVE = "We need OTA updates to survive power loss mid-flash."


def plan_for(
    outline: str | None,
    *,
    narrative: str = NARRATIVE,
    tags: list[str] | None = None,
    prefix: str = "OTA",
) -> Plan:
    """Draft a batch from one outline.

    Args:
        outline: The outline, or ``None`` for a narrative-only request.
        narrative: The outcome.
        tags: The workflow tags the caller offers.
        prefix: The local-key prefix.

    Returns:
        The plan.
    """
    request = PlanRequest(
        narrative=narrative,
        outline=outline,
        context=PlanningContext(
            workflow_tags=tags or TAGS,
            milestone="Helios 2.1",
            local_key_prefix=prefix,
        ),
    )
    return OutlinePlanner().plan(request)


def keys(plan: Plan) -> list[str]:
    """Every local key in a batch, in order."""
    return [draft.local_key for draft in plan.drafts]


def dependencies(plan: Plan) -> dict[str, list[str]]:
    """Each draft's dependencies, keyed by local key."""
    return {draft.local_key: draft.dependencies for draft in plan.drafts}


# ---------------------------------------------------------------------------
# The mockup's own batch — the issue's headline acceptance criterion
# ---------------------------------------------------------------------------


def test_the_mockup_s_outline_yields_its_six_drafts(plan_request: PlanRequest) -> None:
    plan = OutlinePlanner().plan(plan_request)

    assert len(plan.drafts) == 6
    assert keys(plan) == ["OTA-1", "OTA-2", "OTA-3", "OTA-4", "OTA-5", "OTA-6"]


def test_the_mockup_s_drafts_carry_the_mockup_s_dependency_shape(
    plan_request: PlanRequest,
) -> None:
    # Mockup 09's own notes: OTA-1 and OTA-2 each `blocks OTA-3`, OTA-3 and OTA-4 each
    # `blocks OTA-5`. Read from the other end — which is the direction a dependency is
    # stored and pushed in — that is this.
    plan = OutlinePlanner().plan(plan_request)

    assert dependencies(plan) == {
        "OTA-1": [],
        "OTA-2": [],
        "OTA-3": ["OTA-1", "OTA-2"],
        "OTA-4": [],
        "OTA-5": ["OTA-3", "OTA-4"],
        "OTA-6": [],
    }


def test_the_mockup_s_drafts_carry_the_mockup_s_workflow_tags(
    plan_request: PlanRequest,
) -> None:
    plan = OutlinePlanner().plan(plan_request)

    assert [draft.suggested_workflow for draft in plan.drafts] == [
        "feature-loop",
        "feature-loop",
        "feature-loop",
        "feature-loop",
        "hil-verify",
        "docs-loop",
    ]


def test_the_mockup_s_batch_needs_no_explanation(plan_request: PlanRequest) -> None:
    # An outline this planner can read completely produces no notes. Notes are for what it
    # could not do, so a batch that earns none is the signal that nothing was lost.
    assert OutlinePlanner().plan(plan_request).notes == []


# ---------------------------------------------------------------------------
# Provenance — decision K10
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "outline", [None, "", "   ", "- A task", "1. A task\n2. Another"]
)
def test_provenance_is_always_recorded(outline: str | None) -> None:
    assert plan_for(outline).planner == OUTLINE_PLANNER


def test_the_planner_names_itself_the_same_way_the_batch_does() -> None:
    assert OutlinePlanner().name == OUTLINE_PLANNER


# ---------------------------------------------------------------------------
# Narrative only — one draft and a note, never an invention
# ---------------------------------------------------------------------------


def test_a_narrative_without_an_outline_yields_exactly_one_draft() -> None:
    plan = plan_for(None)

    assert len(plan.drafts) == 1


def test_a_narrative_without_an_outline_is_told_what_to_do_about_it() -> None:
    assert plan_for(None).notes == [NARRATIVE_ONLY_NOTE]


def test_the_single_draft_carries_the_narrative_rather_than_a_guess() -> None:
    plan = plan_for(None)

    assert plan.drafts[0].body == NARRATIVE
    assert plan.drafts[0].local_key == "OTA-1"


def test_an_outline_holding_no_list_degrades_the_same_way_and_says_so() -> None:
    # A different failure from sending none at all — there was text and none of it was a
    # bullet — so the caller is told that specifically, then told what to do about it.
    plan = plan_for("We should probably do this in stages.")

    assert len(plan.drafts) == 1
    assert plan.notes == [NO_BULLETS_NOTE, NARRATIVE_ONLY_NOTE]


def test_an_outline_of_nameless_bullets_degrades_rather_than_drafting_nothing() -> None:
    plan = plan_for("- [docs]\n- [hil-verify]")

    assert len(plan.drafts) == 1
    assert plan.notes == [NO_BULLETS_NOTE, NARRATIVE_ONLY_NOTE]


def test_a_long_narrative_keeps_its_whole_text_in_the_body() -> None:
    narrative = "Sentence one. " * 60

    plan = plan_for(None, narrative=narrative)

    assert plan.drafts[0].body == narrative.strip()
    assert len(plan.drafts[0].title) <= MAX_TITLE_LENGTH


# ---------------------------------------------------------------------------
# Local keys
# ---------------------------------------------------------------------------


def test_keys_are_assigned_by_position() -> None:
    assert keys(plan_for("- First\n- Second\n- Third")) == ["OTA-1", "OTA-2", "OTA-3"]


def test_keys_carry_the_prefix_the_caller_asked_for() -> None:
    assert keys(plan_for("- First", prefix="HELIOS2")) == ["HELIOS2-1"]


def test_a_nameless_bullet_does_not_consume_a_key() -> None:
    # Otherwise the batch numbers 1, 3, 4 and every annotation an author wrote against the
    # third bullet points at the wrong ticket.
    assert keys(plan_for("- First\n- [docs]\n- Third")) == ["OTA-1", "OTA-2"]


# ---------------------------------------------------------------------------
# Dependencies — both directions, and nothing invented
# ---------------------------------------------------------------------------


def test_blocks_points_the_edge_at_the_named_draft() -> None:
    plan = plan_for("- Groundwork  blocks: OTA-2\n- Dependent work")

    assert dependencies(plan) == {"OTA-1": [], "OTA-2": ["OTA-1"]}


def test_after_points_the_edge_at_this_draft() -> None:
    plan = plan_for("- Groundwork\n- Dependent work  after: OTA-1")

    assert dependencies(plan) == {"OTA-1": [], "OTA-2": ["OTA-1"]}


def test_an_unordered_list_gets_no_edges_it_was_not_given() -> None:
    plan = plan_for("- First\n- Second\n- Third")

    assert all(draft.dependencies == [] for draft in plan.drafts)
    assert plan.notes == []


def test_a_numbered_list_is_read_as_a_sequence() -> None:
    plan = plan_for("1. First\n2. Second\n3. Third")

    assert dependencies(plan) == {
        "OTA-1": [],
        "OTA-2": ["OTA-1"],
        "OTA-3": ["OTA-2"],
    }


def test_an_inferred_sequence_is_disclosed() -> None:
    # The one place this planner draws an edge nobody typed, so it is the one place it has
    # to say so. An edge that appears from nowhere is what decision N2 exists to prevent.
    assert SEQUENCE_NOTE in plan_for("1. First\n2. Second").notes


def test_a_dependency_on_a_key_outside_the_batch_is_ignored_and_named() -> None:
    plan = plan_for("- Audit  blocks: OTA-9\n- Beacon")

    assert all(draft.dependencies == [] for draft in plan.drafts)
    assert any("OTA-9" in note for note in plan.notes)


def test_a_forward_reference_past_the_end_of_the_batch_does_not_fail_the_request() -> (
    None
):
    # `blocks:` names the far end, so the key that falls outside the batch can be the one
    # being blocked rather than the one blocking — the ordinary way an author gets this
    # wrong, and it has to be a note rather than an exception.
    plan = plan_for("- Only bullet  blocks: OTA-4")

    assert len(plan.drafts) == 1
    assert any("OTA-4" in note for note in plan.notes)


def test_a_draft_pointed_at_itself_is_ignored_and_named() -> None:
    plan = plan_for("- Only bullet  blocks: OTA-1")

    assert plan.drafts[0].dependencies == []
    assert any("itself" in note for note in plan.notes)


def test_a_cycle_is_drafted_as_written_and_reported() -> None:
    # The author wrote both edges and this planner does not silently redraw their plan; it
    # says the cycle is there, which is a better place to find out than a tracker's refusal
    # half way through a push.
    plan = plan_for("- One  blocks: OTA-2\n- Two  blocks: OTA-1")

    assert dependencies(plan) == {"OTA-1": ["OTA-2"], "OTA-2": ["OTA-1"]}
    assert any("cycle" in note for note in plan.notes)


def test_dependencies_are_listed_in_batch_order() -> None:
    plan = plan_for("- A  blocks: OTA-3\n- B  blocks: OTA-3\n- C")

    assert plan.drafts[2].dependencies == ["OTA-1", "OTA-2"]


# ---------------------------------------------------------------------------
# Workflow tags — matched against the caller's, never invented
# ---------------------------------------------------------------------------


def test_a_marker_that_is_a_tag_is_the_tag() -> None:
    assert plan_for("- Test it  [hil-verify]").drafts[0].suggested_workflow == (
        "hil-verify"
    )


def test_a_marker_that_is_a_word_inside_a_tag_resolves_to_it() -> None:
    assert plan_for("- Write it up  [docs]").drafts[0].suggested_workflow == "docs-loop"


def test_a_marker_nobody_has_is_ignored_and_named() -> None:
    plan = plan_for("- Audit it  [security-sweep]")

    assert plan.drafts[0].suggested_workflow == TAGS[0]
    assert any("security-sweep" in note for note in plan.notes)


def test_a_draft_with_no_marker_takes_the_tag_the_caller_offered_first() -> None:
    # Not a default this service holds — it holds no list of tags — but the caller's own
    # first choice, which is the only ranking available to something that ascribes a tag no
    # meaning.
    reordered = ["docs-loop", "feature-loop"]

    assert plan_for("- A task", tags=reordered).drafts[0].suggested_workflow == (
        "docs-loop"
    )


def test_every_suggestion_is_one_the_caller_offered(plan_request: PlanRequest) -> None:
    plan = OutlinePlanner().plan(plan_request)

    assert all(
        draft.suggested_workflow in plan_request.context.workflow_tags
        for draft in plan.drafts
    )


# ---------------------------------------------------------------------------
# Titles and bodies
# ---------------------------------------------------------------------------


def test_detail_under_a_bullet_becomes_its_body() -> None:
    plan = plan_for("- Rollback\n  - restore the slot\n  - emit telemetry")

    assert plan.drafts[0].body == "- restore the slot\n- emit telemetry"


def test_a_bullet_with_no_detail_gets_an_empty_body() -> None:
    # Honest where an invented paragraph would not be.
    assert plan_for("- A task").drafts[0].body == ""


def test_a_title_too_long_for_the_contract_is_cut_and_kept_in_the_body() -> None:
    long_title = "Rework " + "the whole update path " * 20

    plan = plan_for(f"- {long_title}")

    assert len(plan.drafts[0].title) == MAX_TITLE_LENGTH
    assert plan.drafts[0].title.endswith("…")
    assert plan.drafts[0].body.startswith("Rework the whole update path")


# ---------------------------------------------------------------------------
# What is reported rather than swallowed
# ---------------------------------------------------------------------------


def test_prose_before_the_first_bullet_is_reported() -> None:
    plan = plan_for("Here is what I think:\n- Audit the bootloader")

    assert len(plan.drafts) == 1
    assert any("before the first bullet" in note for note in plan.notes)


def test_an_annotation_on_an_indented_line_is_reported() -> None:
    plan = plan_for("- Beacon\n    blocks: OTA-2\n- Second")

    assert plan.drafts[1].dependencies == []
    assert any("own line" in note for note in plan.notes)


def test_a_nameless_bullet_is_reported() -> None:
    plan = plan_for("- First\n- [docs]")

    assert any("no text" in note for note in plan.notes)


# ---------------------------------------------------------------------------
# The contract check the route runs on every answer
# ---------------------------------------------------------------------------


class FixedPlanner:
    """A planner that answers with whatever a test handed it."""

    name = "fixed-for-test"

    def __init__(self, plan: Plan) -> None:
        """Hold the answer to give.

        Args:
            plan: What every call returns.
        """
        self._plan = plan

    def plan(self, request: PlanRequest) -> Plan:  # noqa: ARG002
        """Answer with the held plan.

        Args:
            request: Ignored — the point is that the answer does not depend on it.

        Returns:
            The plan this was built with.
        """
        return self._plan


def test_the_installed_planner_satisfies_the_protocol() -> None:
    assert isinstance(OutlinePlanner(), Planner)


def test_a_batch_within_the_offer_is_accepted(plan_request: PlanRequest) -> None:
    plan = OutlinePlanner().plan(plan_request)

    honours_context(plan, plan_request.context)


def test_a_planner_that_invents_a_workflow_tag_is_refused(
    plan_request: PlanRequest,
) -> None:
    plan = OutlinePlanner().plan(plan_request)
    invented = plan.model_copy(
        update={
            "drafts": [
                plan.drafts[0].model_copy(
                    update={"suggested_workflow": "made-up-loop"}
                ),
                *plan.drafts[1:],
            ]
        }
    )

    with pytest.raises(PlannerContractError, match="made-up-loop"):
        honours_context(invented, plan_request.context)


def test_a_planner_that_keys_outside_the_prefix_is_refused(
    plan_request: PlanRequest,
) -> None:
    # The caller asked for OTA because that is what its rows, its page and its push will
    # say, and every dependency in the batch is resolved by these keys.
    plan = plan_for("- First\n- Second", prefix="TASK")

    with pytest.raises(PlannerContractError, match="TASK"):
        honours_context(plan, plan_request.context)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "outline",
    [
        None,
        "- First\n- Second  blocks: OTA-1",
        "1. First\n2. Second",
        "- A  [docs]\n- B  [nope]  blocks: OTA-9",
    ],
)
def test_the_same_request_produces_the_same_bytes(outline: str | None) -> None:
    assert plan_for(outline).model_dump_json() == plan_for(outline).model_dump_json()


def test_two_planners_answer_identically(plan_request: PlanRequest) -> None:
    # Stateless by construction: an instance that had accumulated anything would show up
    # here, and a regenerate is only meaningful if a difference means something.
    mine = OutlinePlanner().plan(plan_request).model_dump_json()
    yours = OutlinePlanner().plan(plan_request).model_dump_json()

    assert mine == yours


@pytest.mark.parametrize("module", [outline_module, planner_module])
def test_the_planner_imports_nothing_that_could_make_it_non_deterministic(
    module: object,
) -> None:
    # The determinism above is a property of today's code; this is what keeps it one. A
    # clock, a random source, the environment or the filesystem cannot be imported into
    # either module without failing here, which is cheaper to notice than a re-draft that
    # changed for no reason.
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
