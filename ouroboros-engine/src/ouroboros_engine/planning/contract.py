"""``POST /v0/plan``'s shapes — the contract that outlives the planner behind it.

AL.1 (`#277 <https://github.com/NobuData/ouroboros/issues/277>`_). Turning an outcome into
a batch of tickets is what the planning page promises, and the honest version of it needs a
model — which needs the invocation gateway (AF.2,
`#235 <https://github.com/NobuData/ouroboros/issues/235>`_), which is v2. Roadmap decision
**N2** takes the third way out of that: **a versioned contract, implemented twice.** This
module is the contract. :mod:`ouroboros_engine.planning.outline_planner` is the first
implementation and AN.1 (`#289 <https://github.com/NobuData/ouroboros/issues/289>`_) is the
second, and the whole point is that nothing upstream of here can tell which one answered
except by reading :attr:`Plan.planner`.

So everything in this file is written for the *second* planner rather than for the first,
the way :mod:`ouroboros_engine.estimation.contract` was written for O.2's estimator. The
shape is published as ``schemas/plan/v0.json`` — above both modules, because ``ouroboros-rest``
(AL.4, `#280 <https://github.com/NobuData/ouroboros/issues/280>`_) persists what comes back
— and ``tests/test_planning_golden.py`` holds these models to it.

**What this contract deliberately does not carry is a size.** Decision **N3**: drafts are
sized by the *existing* estimation pipeline, so there is one sizer in the product and the
page's ``✓ all sized`` means what it says. A draft here has no effort, no confidence and no
cost, and the card's totals are computed downstream from real estimates rather than from
something a planner guessed alongside a title.

**The caller supplies the vocabulary, and the planner may not exceed it.** Exactly decision
**K5** again: :attr:`PlanningContext.workflow_tags` is what the installation has, and
:func:`ouroboros_engine.planning.planner.honours_context` refuses a batch naming anything
else. This service holds no list of workflow tags, so it cannot invent one.

**A batch is internally consistent before it leaves the process.** :class:`Plan` refuses
duplicate local keys, a dependency on a key that is not in the batch, and a draft that
depends on itself. Those are not the parser's rules — they are the *contract's*, so that
AN.1's planner is held to them too, and so that a malformed batch fails here rather than at
AK.2's foreign key several hops later.

**Local keys are the batch's own names, never a tracker's.** ``OTA-1`` means nothing outside
the batch it was drafted in; the tracker's number does not exist until AL.3 pushes it. That
is why dependencies travel as local keys and why the prefix is the caller's to choose.

Requests and responses are both closed, like every shape under ``/v0``: a caller that
misspells ``outline`` is told so rather than having it dropped and getting a single draft
back with a note wondering where the outline went.
"""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: How long a narrative may be. It is what someone typed into the page's *Describe the
#: outcome, not the tasks* box, so the bound is a generous paragraph rather than a limit
#: anybody writing in good faith would meet.
MAX_NARRATIVE_LENGTH = 16_384

#: How long an outline may be. Twice the narrative: it is a structured document, and the
#: nested detail under a dozen bullets adds up faster than prose does.
MAX_OUTLINE_LENGTH = 32_768

#: The longest title a draft may carry. GitHub's own cap, and the same number
#: :mod:`ouroboros_engine.estimation.contract` bounds a mirrored issue title at — a draft
#: becomes one of those when AL.3 pushes it, so a title this contract accepted and the
#: tracker would refuse is a batch that fails half way through a push.
MAX_TITLE_LENGTH = 256

#: The longest body a draft may carry, which is GitHub's issue-body cap.
MAX_BODY_LENGTH = 65_536

#: How many drafts one batch may hold. A planning batch is a page of work someone reviews
#: row by row before pushing it; a thousand-row batch is a runaway planner rather than a
#: plan, and this is where that is noticed.
MAX_DRAFTS = 200

#: How many dependencies one draft may declare. Generous against the mockup's shape (two)
#: and bounded because every edge is a row AK.2 stores and an edge AL.3 has to create.
MAX_DEPENDENCIES = 64

#: How many workflow tags a caller may offer and how long each may be — the same bounds the
#: estimation contract uses, because it is the same vocabulary, offered by the same caller
#: for the same reason (decision **K5**).
MAX_WORKFLOW_TAGS = 64
MAX_TAG_LENGTH = 64

#: The longest milestone name. A tracker's milestone title, carried through so the batch
#: knows which one it is for; opaque to this service, which never resolves it.
MAX_MILESTONE_LENGTH = 255

#: What a local-key prefix looks like: upper-case, starting with a letter, short enough to
#: read in the mockup's 52-pixel id column. ``OTA``, ``BLE``, ``HELIOS2``.
LOCAL_KEY_PREFIX_PATTERN = r"^[A-Z][A-Z0-9]{0,11}$"

#: What a local key looks like — the prefix, a hyphen, and a 1-based position in the batch.
#: Written as a pattern rather than trusted because :class:`Draft` is also what AN.1 fills
#: in, and a planner that numbered from zero or emitted ``OTA-01`` would produce keys the
#: mockup's rows and AK.1's rows disagree about.
LOCAL_KEY_PATTERN = r"^[A-Z][A-Z0-9]{0,11}-[1-9][0-9]{0,3}$"

#: The longest a planner's name may be — ``outline-v0``, or AN.1's ``llm-v1 · <model>``.
MAX_PLANNER_LENGTH = 64

#: How many notes a plan may carry, and how long each may be. A note is a sentence the page
#: renders as guidance (AM.2, `#284 <https://github.com/NobuData/ouroboros/issues/284>`_),
#: so the bound is a paragraph and the count is what a reader would actually read.
MAX_NOTES = 32
MAX_NOTE_LENGTH = 512


class PlanningContext(BaseModel):
    """What the installation has, told to the engine rather than assumed by it.

    Decision **K5**, in the same shape the estimation contract states it: a workflow tag is
    an opaque string this service ascribes no meaning to, and the set of them belongs to the
    installation. So the caller sends them, and a batch naming anything outside them is
    refused before it leaves the process
    (:func:`ouroboros_engine.planning.planner.honours_context`).

    Attributes:
        workflow_tags: Every workflow tag the installation has, as the mockup's draft rows
            show one — ``feature-loop``, ``hil-verify``, ``docs-loop``. Required and
            non-empty: :attr:`Draft.suggested_workflow` is required, so a request offering
            no tags has no batch this contract can answer with, and that is a ``422`` rather
            than drafts carrying a tag the caller cannot use. **The order matters**, and it
            is the caller's: the first tag is the one a draft with no marker of its own
            takes — see :mod:`ouroboros_engine.planning.outline_planner`.
        milestone: Which milestone the batch is for — the mockup's *Milestone: Helios 2.1*.
            Carried so a draft knows what it belongs to; opaque to this service, which
            neither resolves it nor checks it exists. ``None`` for a batch drafted without
            one, stated rather than implied by a missing key.
        local_key_prefix: What the batch's own keys are prefixed with — ``OTA`` for the
            mockup's ``OTA-1…6``. The caller's choice, because a local key is a name inside
            one batch and this service has no basis for inventing one.
    """

    # Closed, like every request under /v0 — see the module docstring.
    model_config = ConfigDict(extra="forbid")

    workflow_tags: list[
        Annotated[str, Field(min_length=1, max_length=MAX_TAG_LENGTH)]
    ] = Field(
        min_length=1,
        max_length=MAX_WORKFLOW_TAGS,
        examples=[["feature-loop", "hil-verify", "docs-loop", "standard-fix"]],
    )
    milestone: str | None = Field(
        max_length=MAX_MILESTONE_LENGTH, examples=["Helios 2.1"]
    )
    local_key_prefix: str = Field(pattern=LOCAL_KEY_PREFIX_PATTERN, examples=["OTA"])


class PlanRequest(BaseModel):
    """The body of a ``POST /v0/plan`` request.

    Three fields, and the split between the first two is the whole of decision **N2**. The
    narrative is the outcome somebody described; the outline is the structure they were
    willing to commit to. A planner that has both can decompose the work deterministically.
    A planner that has only the first **cannot**, and this contract's answer to that is one
    draft and a note rather than five plausible-sounding inventions — which is the failure
    mode the staging exists to avoid.

    Attributes:
        narrative: The outcome, in the author's own words — the page's *Describe the
            outcome, not the tasks*. Required and non-empty: it is the thing being planned,
            and an outline without one is a list of tasks nobody stated a reason for.
        outline: The structure, as a markdown outline. ``None`` for a request that offers
            none, which is a supported request rather than a malformed one — see
            :class:`Plan.notes`. What the v0 parser reads out of it is
            :mod:`ouroboros_engine.planning.outline`.
        context: The vocabulary a batch may use, the milestone it is for, and the prefix its
            keys carry.
    """

    model_config = ConfigDict(extra="forbid")

    narrative: str = Field(
        min_length=1,
        max_length=MAX_NARRATIVE_LENGTH,
        examples=[
            "We need OTA updates to survive power loss mid-flash: staged A/B "
            "partitions, checksum verification before swap, automatic rollback, and a "
            "recovery beacon over BLE if both slots are bad."
        ],
    )
    outline: str | None = Field(
        max_length=MAX_OUTLINE_LENGTH,
        examples=[
            "- Partition table for A/B slots  blocks: OTA-3\n"
            "- Checksum verification before commit  [hil-verify]"
        ],
    )
    context: PlanningContext


class Draft(BaseModel):
    """One drafted ticket — a row of the mockup's *DRAFT — 6 TICKETS* list.

    It is deliberately **not** a ticket. Nothing has been created anywhere; AK.1 stores this
    as a ``ticket_drafts`` row that exists before any tracker knows about it (decision
    **N1**), and AL.3 is what turns an approved one into an issue.

    Attributes:
        local_key: The batch's own name for this draft — ``OTA-3``. Unique within the batch,
            and the only thing :attr:`dependencies` may name. It is assigned by position and
            never by content, so the same input produces the same keys every time.
        title: The mockup's ``ttl`` column — one line, and what becomes the issue title.
        body: The draft's description, and what becomes the issue body. **Empty is a real
            answer**: an outline bullet with no detail under it has nothing more to say, and
            an empty body is honest where an invented paragraph would not be. Present as
            ``""`` rather than omitted, for the reason ``breakdown.files`` is ``[]`` rather
            than absent — a missing key reads as an older schema.
        suggested_workflow: Which workflow the draft should run under — the mockup's ``tag``
            chip. Always one of :attr:`PlanningContext.workflow_tags`, always.
        dependencies: The local keys this draft is **blocked by**, in batch order. The
            mockup's ``blocks OTA-3`` note on ``OTA-1`` is this list on ``OTA-3``, which is
            the direction AK.2 stores and the direction GitHub's own
            ``dependencies/blocked_by`` takes. Empty for a draft nothing blocks.
    """

    model_config = ConfigDict(extra="forbid")

    local_key: str = Field(pattern=LOCAL_KEY_PATTERN, examples=["OTA-3"])
    title: str = Field(
        min_length=1,
        max_length=MAX_TITLE_LENGTH,
        examples=["Rollback state machine on failed boot confirmation"],
    )
    body: str = Field(
        max_length=MAX_BODY_LENGTH,
        examples=["- restore the previous slot\n- emit a telemetry event"],
    )
    suggested_workflow: str = Field(
        min_length=1, max_length=MAX_TAG_LENGTH, examples=["feature-loop"]
    )
    dependencies: list[Annotated[str, Field(pattern=LOCAL_KEY_PATTERN)]] = Field(
        max_length=MAX_DEPENDENCIES, examples=[["OTA-1", "OTA-2"]]
    )


class Plan(BaseModel):
    """The body of a ``POST /v0/plan`` response — one draft batch, and what produced it.

    The shape AN.1 answers with too, unchanged. That is the acceptance criterion this whole
    module exists for, and ``schemas/plan/v0.json`` is where it is written down so both
    implementations can be held to it from their own suites.

    Attributes:
        drafts: The batch, in the order the page lists it. May hold exactly one draft — see
            :attr:`notes`.
        planner: What produced this batch — ``outline-v0`` today, ``llm-v1 · <model>`` when
            AN.1 lands. **Decision K10's honesty rule**: required and non-empty, so a batch
            that cannot say what produced it does not get past this boundary. A reader
            branches on this rather than on which build answered, and the page renders it
            rather than a hard-coded *estimator v3*.
        notes: Sentences for the person who asked, rendered by AM.2 as designed guidance
            rather than as an error. This is where narrative-only degradation is *explained*
            instead of being disguised: one draft plus *add an outline* is an honest answer,
            and the note is what makes it one rather than a batch that silently lost five
            tickets. Empty when there is nothing to say.
    """

    model_config = ConfigDict(extra="forbid")

    drafts: list[Draft] = Field(min_length=1, max_length=MAX_DRAFTS)
    planner: str = Field(
        min_length=1, max_length=MAX_PLANNER_LENGTH, examples=["outline-v0"]
    )
    notes: list[Annotated[str, Field(min_length=1, max_length=MAX_NOTE_LENGTH)]] = (
        Field(max_length=MAX_NOTES, examples=[[]])
    )

    @model_validator(mode="after")
    def _keys_are_unique(self) -> "Plan":
        """Refuse a batch that names the same draft twice.

        Returns:
            The validated plan.

        Raises:
            ValueError: If two drafts share a local key. Every dependency in the batch is
                resolved by that key, so a duplicate makes an edge ambiguous — and AK.1's
                uniqueness constraint would refuse the batch after it had been shown to
                somebody as a plan.
        """
        keys = [draft.local_key for draft in self.drafts]
        duplicated = sorted({key for key in keys if keys.count(key) > 1})
        if duplicated:
            message = f"local keys are not unique within the batch: {duplicated}"
            raise ValueError(message)
        return self

    @model_validator(mode="after")
    def _dependencies_resolve_within_the_batch(self) -> "Plan":
        """Refuse an edge that points outside the batch, or at itself.

        A local key means nothing outside the batch it was drafted in, so an edge naming one
        that is not here cannot be stored and cannot be pushed. Refusing it in the contract
        is what stops a planner — this one, or AN.1's — from emitting a batch whose graph
        only looks complete.

        Returns:
            The validated plan.

        Raises:
            ValueError: If a draft depends on a key no draft in the batch carries, or on
                itself. Both name the offending draft, because the caller is told nothing
                and the operator reading the log has to find it.
        """
        keys = {draft.local_key for draft in self.drafts}
        for draft in self.drafts:
            if draft.local_key in draft.dependencies:
                message = f"{draft.local_key} depends on itself"
                raise ValueError(message)

            dangling = sorted(set(draft.dependencies) - keys)
            if dangling:
                message = (
                    f"{draft.local_key} depends on {dangling}, which "
                    "is not in the batch"
                )
                raise ValueError(message)
        return self
