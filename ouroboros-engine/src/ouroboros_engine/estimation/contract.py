"""``POST /v0/estimate``'s shapes — the contract that outlives the estimator behind it.

L.1 (`#105 <https://github.com/NobuData/ouroboros/issues/105>`_). Sizing an issue is the
first real thing ``ouroboros-rest`` asks this service to do, and the reason its *shapes*
are a module of their own is that they are the part of it that is not allowed to change:
the heuristic estimator L.2 (`#106 <https://github.com/NobuData/ouroboros/issues/106>`_)
answers this contract, the LLM estimator O.2
(`#123 <https://github.com/NobuData/ouroboros/issues/123>`_) replaces that implementation
and answers the same one, and neither swap is visible to the gateway. Everything in this
file is therefore written for the second of those two estimators rather than for the first.

**The response mirrors K.2's row** (`#100 <https://github.com/NobuData/ouroboros/issues/100>`_,
``issue_estimates``) field for field, so L.3
(`#107 <https://github.com/NobuData/ouroboros/issues/107>`_) persists an answer rather than
translating one:

======================  ==========================================================
response field          ``issue_estimates``
======================  ==========================================================
``effort``              ``effort`` — the same closed vocabulary, CHECK-enforced
``confidence``          ``confidence`` — 0-100, bounds enforced on both sides
``suggested_workflow``  ``suggested_workflow`` — an opaque tag (decision **K5**)
``routed_model``        ``routed_model`` — an opaque identifier (decision **K6**)
``breakdown``           ``breakdown`` jsonb — the same five keys, no more
``risk``                ``risk`` — the same closed vocabulary
``risk_note``           ``risk_note``
``trace``               ``trace`` jsonb, minus ``sized_at``
======================  ==========================================================

The five columns with no field above them are the persister's and never the estimator's:
``id``, ``github_issue_id``, ``version``, ``created_at``, and ``trace.sized_at``. An
estimator does not know which issue row it was called for, cannot know which version its
answer will become, and must not be the thing that decides when the answer was written —
a clock in a response body is a clock two services can disagree about.
``tests/test_estimation_contract.py`` holds that table as data and fails on a drift in
either direction.

**Decision K10 is enforced here as well as at the database.** :attr:`Trace.estimator` is
required and non-empty, so an answer that cannot say what produced it does not get past
the contract boundary — not merely past the ``not null``. Provenance that is only checked
at the last hop is provenance the two hops before it can lose.

**The caller supplies the vocabularies, and the engine may not exceed them.**
:class:`EstimationContext` carries the workflow tags and the model defaults that exist;
:func:`ouroboros_engine.estimation.estimator.honours_context` refuses an answer naming
anything else. That is decisions **K5** and **K6** made structural: this service holds no
list of workflow tags and no list of models, so it cannot invent one, and an estimator
that tried is a failure in this process rather than a value that reaches a row.

**Requests are closed and so are responses**, for the same reason
:mod:`ouroboros_engine.api.tasks` closed the exemplar's: a caller that misspells
``est_tokens`` is told so instead of having it dropped, and an estimator cannot smuggle a
field the specification does not describe. ``/v0`` does allow a field to be *added* to a
response — that is an edit to this file and to ``openapi.yaml`` together, not something an
implementation behind the seam gets to do at runtime.
"""

from typing import Annotated, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: How much work the issue is, as the mockup's *Effort* column renders it and as K.2's
#: CHECK constraint spells it. Lower case: it is a stored value and a filter key, and the
#: table's ``XS`` is a presentation decision the UI makes.
Effort = Literal["xs", "s", "m", "l", "xl"]

#: How likely the change is to break something, as the mockup's regression-risk meter
#: reads it and as K.2's CHECK constraint spells it.
Risk = Literal["low", "medium", "high"]

#: The two vocabularies as data, derived from the types above rather than typed a second
#: time, so the specification's ``enum`` and the database's CHECK are checked against one
#: source (``tests/test_estimation_contract.py``).
EFFORTS: tuple[str, ...] = get_args(Effort)
RISKS: tuple[str, ...] = get_args(Risk)

#: Confidence is a percentage, and the bounds are K.2's.
MIN_CONFIDENCE = 0
MAX_CONFIDENCE = 100

#: What a repository is called: ``owner/name``, which is GitHub's own ``full_name`` and
#: what the mockup's head shows. The parts are GitHub's charset for a login and a
#: repository name; the pattern exists so a caller that sent only the name is refused
#: rather than having an estimator read an owner out of nothing.
REPO_PATTERN = r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$"

#: The longest ``owner/name`` GitHub can produce: a login is at most 39 characters, a
#: repository name at most 100, and the separator is one. Bounded for the same reason the
#: title is - this is mirrored content, and a field with no ceiling is one a caller finds
#: the ceiling of.
MAX_REPO_LENGTH = 140

#: GitHub's own caps on the fields this service mirrors — a title, a body, the number of
#: labels on an issue and the length of a label's name. Written as bounds rather than
#: trusted, because an estimator's cost is a function of how much text it is handed and
#: an unbounded body is the field a caller would discover that through.
MAX_TITLE_LENGTH = 256
MAX_BODY_LENGTH = 65_536
MAX_LABELS = 100
MAX_LABEL_LENGTH = 50

#: How many workflow tags and model defaults a caller may offer, and how long each may be.
#: Both vocabularies are opaque to this service (decisions **K5**, **K6**) so only their
#: size is constrained — a bound is not a meaning.
MAX_WORKFLOW_TAGS = 64
MAX_TAG_LENGTH = 64
MAX_MODEL_DEFAULTS = 64
MAX_MODEL_LENGTH = 128

#: Bounds on what an estimate may say. These guard *this* service's own answer rather than
#: a caller's request: every one of them is a field K.2 stores and something renders, and a
#: breakdown carrying a thousand file paths is a bug in an estimator rather than an
#: estimate a panel can show.
MAX_FILES = 200
MAX_PATH_LENGTH = 4_096
MAX_RISK_NOTE_LENGTH = 1_024
MAX_ESTIMATOR_LENGTH = 64
MAX_SIGNALS = 64
MAX_SIGNAL_LENGTH = 256

#: An upper bound on the numbers in a breakdown: a token count, a cycle-time bound in
#: minutes, and the whole-job estimate M.3's queue write reads. High enough that no real
#: estimate approaches it and low enough that a unit slip — seconds written where minutes
#: were meant, or a token count multiplied twice — fails here instead of being persisted.
MAX_TOKENS = 100_000_000
MAX_MINUTES = 100_000


class IssueContext(BaseModel):
    """The issue being sized, as much of it as an estimator reads.

    Mirrors K.1's ``github_issues`` row (`#99
    <https://github.com/NobuData/ouroboros/issues/99>`_) for the five fields sizing
    depends on, and nothing else from it: an estimator has no business with
    ``sizing_status``, ``synced_at`` or the row's identifiers, and a field it cannot use
    is a field the gateway would have to keep sending.

    Attributes:
        number: The issue's number within its repository. Not a database id — this
            contract names an issue the way GitHub and the mockup do, so a payload can
            be read against the page it came from.
        title: The issue title, as GitHub holds it.
        body: The issue description in full, or ``None`` for an issue opened without
            one. Nullable rather than defaulted to ``""`` because K.1's column is
            nullable for the same reason: GitHub makes no distinction between an empty
            description and no description, and this contract does not invent one.
            Required rather than optional, so "the issue has no body" is something the
            caller states rather than something a missing key implies.
        labels: GitHub's label *names*, the way K.1 stores them — ``["bug", "i2c"]``.
            The heuristic estimator's strongest signal, and empty for most issues.
        repo: ``owner/name``. An estimator reads it for provenance and for the
            repository-shaped signals O.2 will have; v0 does not branch on it.
    """

    # Closed, like every request in this contract — see the module docstring.
    model_config = ConfigDict(extra="forbid")

    number: int = Field(ge=1, examples=[485])
    title: str = Field(
        min_length=1,
        max_length=MAX_TITLE_LENGTH,
        examples=["I2C bus lockup after IMU sleep/wake cycle"],
    )
    body: str | None = Field(
        max_length=MAX_BODY_LENGTH,
        examples=[
            "After entering low-power sleep and waking the BMI270, the I2C bus "
            "intermittently locks up."
        ],
    )
    labels: list[Annotated[str, Field(min_length=1, max_length=MAX_LABEL_LENGTH)]] = (
        Field(max_length=MAX_LABELS, examples=[["bug", "i2c", "watchdog"]])
    )
    repo: str = Field(
        pattern=REPO_PATTERN,
        max_length=MAX_REPO_LENGTH,
        examples=["acme-robotics/helios-firmware"],
    )


class EstimationContext(BaseModel):
    """The vocabularies that exist, told to the engine rather than assumed by it.

    Decisions **K5** and **K6**: a workflow tag and a routed model are opaque strings
    this service ascribes no meaning to, and the set of them is the installation's rather
    than the estimator's. So the caller sends them, and an answer naming anything outside
    them is refused before it leaves the process
    (:func:`ouroboros_engine.estimation.estimator.honours_context`).

    Both are required and non-empty. A request offering no tags has no answer this
    contract can give — :attr:`Estimate.suggested_workflow` is required — so it is a
    ``422`` rather than an estimate with a field the caller cannot use.

    Attributes:
        workflow_tags: Every workflow tag the installation has, as the mockup's tag chip
            shows one: ``standard-fix``, ``docs-loop``, ``feature-loop``. Opaque, so only
            their number and length are bounded — a tag's shape is the control plane's
            business.
        model_defaults: The models an estimate may route to, keyed by the caller's own
            name for the class of work each is the default for. A map rather than a list
            because that is what the caller has (L.2 reads a label-to-model default out
            of it), and the values are what :attr:`Estimate.routed_model` must be one of.
    """

    model_config = ConfigDict(extra="forbid")

    workflow_tags: list[
        Annotated[str, Field(min_length=1, max_length=MAX_TAG_LENGTH)]
    ] = Field(
        min_length=1,
        max_length=MAX_WORKFLOW_TAGS,
        examples=[["standard-fix", "docs-loop", "feature-loop", "deps-refresh"]],
    )
    model_defaults: dict[
        Annotated[str, Field(min_length=1, max_length=MAX_TAG_LENGTH)],
        Annotated[str, Field(min_length=1, max_length=MAX_MODEL_LENGTH)],
    ] = Field(
        min_length=1,
        max_length=MAX_MODEL_DEFAULTS,
        examples=[{"default": "claude-fable-5", "docs": "claude-haiku-4-5"}],
    )


class EstimateRequest(BaseModel):
    """The body of a ``POST /v0/estimate`` request.

    Two blocks, and the split is the contract's whole argument about who knows what: the
    issue is the *problem*, and the context is what the installation happens to be
    configured with. An estimator reads both and invents neither.

    Attributes:
        issue: The issue to size.
        context: The vocabularies an answer may use.
    """

    model_config = ConfigDict(extra="forbid")

    issue: IssueContext
    context: EstimationContext


class Breakdown(BaseModel):
    """The *AI Work Breakdown* panel, as data — K.2's ``breakdown`` jsonb exactly.

    Five keys and no more. The panel renders four of them; the fifth,
    :attr:`est_minutes`, is what M.3's queue write reads, which is why it is a stored
    number rather than something a reader recomputes from the cycle range.

    Attributes:
        files: The paths an estimator believes the work touches, as the panel's
            *Estimated files touched* list. **Empty is a real answer**: the heuristic v0
            cannot know files, and the mockup renders their absence rather than guessing
            — so this is a list that may have nothing in it, never a promise.
        est_tokens: How many model tokens the *work* is expected to cost. Not what the
            estimate cost — that is :attr:`Trace.tokens_used`, and confusing the two
            makes a sizing look a thousand times more expensive than it was.
        cycle_min: The optimistic end of the wall-clock range, in minutes.
        cycle_max: The pessimistic end, in minutes. Never below ``cycle_min``.
        est_minutes: The single number the queue plans with, in minutes. Deliberately
            *not* constrained to the cycle range: K.2's own example carries a 12-18
            minute cycle beside 23 estimated minutes, because a job's wall clock includes
            what happens either side of the model's part of it.
    """

    model_config = ConfigDict(extra="forbid")

    files: list[Annotated[str, Field(min_length=1, max_length=MAX_PATH_LENGTH)]] = (
        Field(
            max_length=MAX_FILES,
            examples=[["drivers/i2c_recovery.c", "tests/unit/test_i2c_lockup.c"]],
        )
    )
    est_tokens: int = Field(ge=0, le=MAX_TOKENS, examples=[180_000])
    cycle_min: int = Field(ge=0, le=MAX_MINUTES, examples=[12])
    cycle_max: int = Field(ge=0, le=MAX_MINUTES, examples=[18])
    est_minutes: int = Field(ge=0, le=MAX_MINUTES, examples=[23])

    @model_validator(mode="after")
    def _range_is_ordered(self) -> "Breakdown":
        """Refuse a cycle range that runs backwards.

        Returns:
            The validated breakdown.

        Raises:
            ValueError: If ``cycle_max`` is below ``cycle_min``. The panel renders the
                two as ``12-18 min``; reversed, it reads as a range no schedule can be
                built from, and nothing downstream would notice.
        """
        if self.cycle_max < self.cycle_min:
            message = (
                f"cycle_max ({self.cycle_max}) is below cycle_min ({self.cycle_min})"
            )
            raise ValueError(message)
        return self


class Trace(BaseModel):
    """Where the estimate came from — K.2's ``trace`` jsonb, minus its clock.

    The collapsible *Estimation trace* under the panel, and the reason re-estimation is
    auditable at all: an estimate that cannot say what produced it is an estimate nobody
    can compare against the next one.

    ``sized_at`` is K.2's and not this contract's. The estimator does not own the clock —
    the row's writer does — and a timestamp in a response body is one two services can
    disagree about.

    Attributes:
        estimator: What produced this — ``heuristic-v0`` for L.2, a model identifier for
            O.2. **Decision K10**: required and non-empty here as well as ``not null``
            there, so provenance cannot be lost on the way to the row.
        tokens_used: What producing *this estimate* cost, in model tokens. ``0`` for an
            estimator that called no model, which is the honest answer for a rule engine
            rather than a missing field.
        signals: What the answer was reached from, one line each — a rule name for the
            heuristic, a retrieved neighbour for O.2. The trace's second line in the
            mockup, and empty rather than absent when an estimator has nothing to show.
    """

    model_config = ConfigDict(extra="forbid")

    estimator: str = Field(
        min_length=1, max_length=MAX_ESTIMATOR_LENGTH, examples=["heuristic-v0"]
    )
    tokens_used: int = Field(ge=0, le=MAX_TOKENS, examples=[41_000])
    signals: list[Annotated[str, Field(min_length=1, max_length=MAX_SIGNAL_LENGTH)]] = (
        Field(
            max_length=MAX_SIGNALS,
            examples=[["3 similar closed issues", "driver map", "HIL test index"]],
        )
    )


class Estimate(BaseModel):
    """The body of a ``POST /v0/estimate`` response — one version of K.2's row.

    Every field is a column or a jsonb key of ``issue_estimates``, and the five that are
    not here are the persister's; the module docstring holds the table both directions
    are checked against.

    Attributes:
        effort: How much work this is, from the closed vocabulary K.2 enforces.
        confidence: How much the estimator trusts its own answer, 0-100. L.3 reads it
            against a floor and routes a low one to ``needs_human`` — so a hedge is
            expressed here rather than by refusing to answer.
        suggested_workflow: Which workflow tag should run it. One of the tags the request
            offered, always.
        routed_model: Which model it should run on. One of the request's
            ``model_defaults`` values, always.
        breakdown: The *AI Work Breakdown* panel's numbers.
        risk: How likely the change is to break something, from the closed vocabulary.
        risk_note: The sentence under the meter, saying why. Required and non-empty: a
            risk level with no rationale is a colour nobody can argue with, and this is
            the field a reviewer reads before overriding an estimate.
        trace: What produced the estimate, and from what.
    """

    model_config = ConfigDict(extra="forbid")

    effort: Effort = Field(examples=["m"])
    confidence: int = Field(ge=MIN_CONFIDENCE, le=MAX_CONFIDENCE, examples=[92])
    suggested_workflow: str = Field(
        min_length=1, max_length=MAX_TAG_LENGTH, examples=["standard-fix"]
    )
    routed_model: str = Field(
        min_length=1, max_length=MAX_MODEL_LENGTH, examples=["claude-fable-5"]
    )
    breakdown: Breakdown
    risk: Risk = Field(examples=["low"])
    risk_note: str = Field(
        min_length=1,
        max_length=MAX_RISK_NOTE_LENGTH,
        examples=[
            "Isolated to the I²C driver path; full HIL coverage exists for bus recovery."
        ],
    )
    trace: Trace
