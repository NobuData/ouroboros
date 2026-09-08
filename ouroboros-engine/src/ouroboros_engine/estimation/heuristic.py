"""``heuristic-v0`` — real estimates for every issue, without an AI stack behind them.

L.2 (`#106 <https://github.com/NobuData/ouroboros/issues/106>`_), and the whole of its
argument is in the name it writes into every trace. The MVP needs the estimation pipeline
running before the model stack exists (hard truth #2 of the intake roadmap), and a rule
engine over labels, titles and body shape is enough to keep it running — **provided it
never masquerades as a model.** So the provenance is `heuristic-v0`, unconditionally and
from one constant; ``trace.tokens_used`` is ``0``, which is the true cost of an estimate
nothing was invoked for; and ``breakdown.files`` is empty, because v0 cannot know which
files an issue touches and the panel that renders it (N.5) shows that absence rather than a
list somebody would act on.

:mod:`ouroboros_engine.estimation.signals` holds the rules; this module is the arithmetic
that combines them and the tables that turn an effort into everything else:

===================  ==========================================================
answer               reached from
===================  ==========================================================
``effort``           the strongest of the four rules that spoke
``confidence``       how many of them agreed, less the spread and what was missing
``suggested_workflow``  a label→tag classification, held to the tags the caller offered
``routed_model``     a key in the caller's ``model_defaults`` — *resolved*, never invoked
``breakdown``        :data:`EFFORT_BUDGETS`, keyed by effort, with no files
``risk``             :data:`EFFORT_RISK`, raised or lowered by one label
``risk_note``        the sentence that says which of those happened, and what was not read
``trace``            every rule's own line, in the order the rules ran
===================  ==========================================================

**The estimator invents no vocabulary.** Decisions **K5** and **K6** put the workflow tags
and the models in the caller's request, and this estimator only ever *prefers*: it
classifies an issue as wanting ``docs-loop``, and if the installation has no such tag it
falls back through ``standard-fix`` to whatever was offered first, saying so in the trace.
:func:`ouroboros_engine.estimation.estimator.honours_context` is what makes that structural
rather than remembered, and it runs on every answer this class produces.

**Resolved, never invoked.** The routing amendment on `#106` (Z.4,
`#197 <https://github.com/NobuData/ouroboros/issues/197>`_, decision **M6**) attaches an
honesty constraint to the model: the estimator *resolves* a route and does not call one,
and the trace must never read as though it had. Two things enforce it here — the
``routed-model`` signal says ``resolved, not invoked`` in those words, and ``tokens_used``
is ``0``. The other half of that amendment is the gateway's: L.3
(`#107 <https://github.com/NobuData/ouroboros/issues/107>`_) is what will fill
``model_defaults`` from ``POST /api/v1/routing/simulate`` rather than from a configuration
file, and nothing in this module changes when it does — the map is already the caller's.

**Deterministic by construction.** No clock, no randomness, no environment, no I/O, and no
iteration over anything unordered. The same request produces the same bytes, which is what
makes a re-estimate that *changes* something a signal rather than noise;
``tests/test_estimation_heuristic.py`` asserts it over the whole fixture table and by
reading this module's imports.

**Calibration, and what it is not.** The constants are set against the mockup's own nine
issues (``docs/mockups/03-issues.html``), which is the only table of real sizings this
project has. The estimator reproduces the design's **effort** on eight of the nine and its
**workflow tag** on all nine; its ``#488`` — a two-label documentation issue — comes out at
``xs``/``98``/``docs-loop``, the design's own numbers, and its ``#490`` — ``tech-debt`` plus
*Migrate build system to Zephyr RTOS 4.2* — comes out ``xl`` well under the floor, where the
design shows ``61`` and *needs human*. Those two are the ticket's acceptance criteria and
``tests/test_estimation_heuristic.py`` holds them row by row.

The design's other **percentages** are deliberately not reproduced, and could not honestly
be: read the mockup's own trace line and they were produced by a model that had three
similar closed issues, a driver map and a HIL test index to read. This estimator has a
label and a character count. What the constants are tuned for instead is the boundary that
matters: an ordinary issue — one label this estimator knows, and a description somebody
wrote — clears :data:`NEEDS_HUMAN_CONFIDENCE_FLOOR` and keeps the pipeline moving, while
the three shapes that are guesses fall under it. Those are an issue with no label the
tables recognise, an issue opened with no description at all, and an issue whose rules read
it as two different jobs — which is the one that catches ``#490``.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from ouroboros_engine.estimation.contract import (
    MAX_CONFIDENCE,
    MIN_CONFIDENCE,
    RISKS,
    Breakdown,
    Effort,
    Estimate,
    EstimateRequest,
    EstimationContext,
    IssueContext,
    Risk,
    Trace,
)
from ouroboros_engine.estimation.signals import (
    DEPS_REFRESH,
    DOCS_LOOP,
    EFFORT_RULES,
    FEATURE_LOOP,
    LABEL_RULE,
    RISK_LOWERING_LABELS,
    RISK_RAISING_LABELS,
    STANDARD_FIX,
    EffortSignal,
    effort_ordinal,
    has_description,
    risk_label,
    strongest,
    workflow_signal,
)

#: What this estimator writes into ``trace.estimator`` — decision **K10**, and the string
#: L.3, an operator and the *Estimation trace* panel all read. One constant, referenced
#: once, so there is no code path that can emit anything else: an estimator that could be
#: talked into naming a model it did not use is the masquerade the decision exists to
#: prevent.
HEURISTIC = "heuristic-v0"

# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------

#: Where confidence starts before any rule has agreed with any other. Chosen with
#: :data:`AGREEMENT_WEIGHT` so that the ceiling is 98 rather than 100: a rule engine that
#: has read a label, a title and a character count is never certain, and a round 100 in the
#: column beside a model's estimate would be claiming it was.
BASE_CONFIDENCE = 68

#: How much perfect agreement between the rules that spoke is worth. Scaled by the fraction
#: of them that voted for the answer, so two rules agreeing is worth what three are — what
#: is being measured is consensus, and :data:`NO_LABEL_SIGNAL_PENALTY` is what measures how
#: much there was to reach a consensus about.
AGREEMENT_WEIGHT = 30

#: Charged per step between the highest and lowest vote. Rules that disagree by two steps
#: of the scale have not merely failed to agree — they have read the same issue as two
#: different jobs, and that is worth more doubt than a near miss.
SPREAD_PENALTY = 6

#: Charged when the issue was opened with nothing to read. The body rule still votes (``xs``
#: — see :func:`~ouroboros_engine.estimation.signals.body_effort`), and without this an
#: empty issue whose one other signal happened to agree would be reported as confidently
#: sized.
NO_DESCRIPTION_PENALTY = 12

#: Charged when no label is in :data:`~ouroboros_engine.estimation.signals.LABEL_EFFORT`.
#: The largest penalty here, because labels are the strongest thing this estimator reads:
#: an unlabelled issue with a paragraph of description has exactly one signal, and one
#: signal always "agrees with itself". Set so that such an issue lands just under
#: :data:`NEEDS_HUMAN_CONFIDENCE_FLOOR`: a length of prose with nothing to corroborate it is
#: the case a person should look at, and without this it would score the ceiling.
NO_LABEL_SIGNAL_PENALTY = 30

#: Below this, the estimate is a hedge rather than an answer and the issue wants a person —
#: the ``needs_human`` outcome of K.2's ``sizing_status``, which is a real result and not an
#: error.
#:
#: **The transition is L.3's to make, not this estimator's.** There is no ``needs_human``
#: field in the L.1 contract on purpose: an estimator says how sure it is and the
#: orchestrator decides what that means, because the floor is an installation's policy and
#: will move. This constant is what that policy is *calibrated against* — the value the
#: tables above were tuned for, published so L.3 and this module cannot drift apart in
#: silence — and :func:`needs_human` applies it. The mockup's own table puts the boundary
#: here too: its ``#490`` sits at 61 and needs a human, its ``#487`` at 71 and does not.
NEEDS_HUMAN_CONFIDENCE_FLOOR = 70

# ---------------------------------------------------------------------------
# What an effort costs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EffortBudget:
    """The *AI Work Breakdown* numbers one effort implies.

    Attributes:
        est_tokens: What the *work* is expected to cost in model tokens — never what the
            estimate cost, which is ``trace.tokens_used`` and is ``0`` here.
        cycle_min: The optimistic end of the wall-clock range, in minutes.
        cycle_max: The pessimistic end, in minutes.
        est_minutes: The single number M.3's queue write plans with, in minutes.
    """

    est_tokens: int
    cycle_min: int
    cycle_max: int
    est_minutes: int


#: What each effort is expected to cost, and the one place any of these numbers is written.
#:
#: The ``m`` row is the mockup's own ``#485`` panel — 180k tokens and 23 estimated minutes —
#: and the rest are scaled from it. The **cycle ranges are deliberately wider than the
#: design's**: the panel shows ``12-18 min`` because a model that had read three similar
#: closed issues said so, and a rule engine that has read a label and a character count is
#: entitled to the same floor and a later ceiling. Widening the top of the range is what
#: "conservative" means for an estimator whose confidence is already reported separately.
EFFORT_BUDGETS: Mapping[Effort, EffortBudget] = {
    "xs": EffortBudget(est_tokens=20_000, cycle_min=3, cycle_max=8, est_minutes=6),
    "s": EffortBudget(est_tokens=60_000, cycle_min=6, cycle_max=16, est_minutes=12),
    "m": EffortBudget(est_tokens=180_000, cycle_min=12, cycle_max=32, est_minutes=23),
    "l": EffortBudget(est_tokens=420_000, cycle_min=30, cycle_max=80, est_minutes=55),
    "xl": EffortBudget(
        est_tokens=900_000, cycle_min=90, cycle_max=240, est_minutes=160
    ),
}

#: The regression risk an effort carries before any label is read. Size is the only thing
#: this estimator knows that correlates with blast radius at all — it cannot see the code,
#: the tests or what depends on what — so the mapping is coarse on purpose and the note
#: beside it says so.
EFFORT_RISK: Mapping[Effort, Risk] = {
    "xs": "low",
    "s": "low",
    "m": "medium",
    "l": "high",
    "xl": "high",
}

#: The sentence every risk note ends with. It is the honest half of the field: a risk level
#: with no rationale is a colour nobody can argue with, and this says exactly what was not
#: read before the colour was chosen.
RISK_CAVEAT = (
    "heuristic-v0 reads an issue's labels and text only — not the code, its tests, or how "
    "much depends on it — so this is where a reviewer starts rather than what the change "
    "measures."
)

# ---------------------------------------------------------------------------
# Which model
# ---------------------------------------------------------------------------

#: The ``model_defaults`` keys each workflow tag is looked up under, before
#: :data:`DEFAULT_MODEL_KEY`. The caller names the classes of work it has models for
#: (decision **K6**) and this is the estimator's guess at what it called them — a guess,
#: because the keys are the caller's; a miss falls through rather than failing.
WORKFLOW_MODEL_KEYS: Mapping[str, tuple[str, ...]] = {
    DOCS_LOOP: ("docs", "documentation"),
    DEPS_REFRESH: ("deps", "dependencies"),
    FEATURE_LOOP: ("feature", "features"),
    STANDARD_FIX: ("fix", "standard"),
}

#: The key every classification falls back to. The one key a caller is likely to have, and
#: the L.1 contract's own example carries it.
DEFAULT_MODEL_KEY = "default"

#: Rule names for the three signals this module adds to the four the rules produce, plus
#: the two it adds only when something is worth saying.
EFFORT_SIGNAL = "effort"
CONFIDENCE_SIGNAL = "confidence"
RISK_SIGNAL = "risk"
MODEL_SIGNAL = "routed-model"
WORKFLOW_FALLBACK_SIGNAL = "workflow-fallback"
NEEDS_HUMAN_SIGNAL = "needs-human"

#: The words the routing amendment requires and the reason this constant exists rather than
#: the phrase being typed at its one call site: a test asserts that every estimate this
#: module produces carries it, so the honesty constraint is checked rather than remembered.
NOT_INVOKED = "resolved, not invoked"


def _rounded_share(weight: int, part: int, whole: int) -> int:
    """``weight * part / whole``, rounded half up, in integers only.

    Floating point would be deterministic too, but it would be deterministic in a way that
    depends on the platform's rounding rather than on anything written here — and this
    number reaches a persisted column. Integers keep the arithmetic on the page.

    Args:
        weight: What a full share is worth.
        part: How much of the whole was earned.
        whole: The denominator. Never zero — the body rule always votes.

    Returns:
        The share, rounded to the nearest integer with halves going up.
    """
    return (2 * weight * part + whole) // (2 * whole)


def confidence_for(
    voted: tuple[EffortSignal, ...], issue: IssueContext
) -> tuple[int, str]:
    """How much the estimator trusts its own answer, and the phrase that explains it.

    Four terms, and each one is a different kind of doubt. *Agreement* is how many of the
    rules that spoke voted for the answer. *Spread* is how far apart the ones that did not
    were — two rules a step apart have nearly agreed, two rules two steps apart have read
    the same issue as two different jobs. The two penalties are for what was not there to
    read at all: an issue with no description, and an issue whose labels this estimator
    recognises none of. That last one is the largest, because a single rule always agrees
    with itself, and without it an unlabelled issue with a paragraph in it would score the
    ceiling on the strength of its character count alone.

    Args:
        voted: Every rule that voted, in rule order. Never empty — the body rule always
            votes.
        issue: The issue being sized, read for what was *not* in it.

    Returns:
        The confidence, clamped to the contract's 0-100, and the terms that produced it as
        one comma-separated phrase for the trace.

    Raises:
        ValueError: If ``voted`` is empty. That would mean the body rule abstained, which
            is a bug in this service rather than an issue nothing can be said about, and an
            exception says so where a default would hide it.
    """
    if not voted:
        message = "confidence needs at least one signal"
        raise ValueError(message)

    ordinals = [effort_ordinal(signal.effort) for signal in voted]
    top = max(ordinals)
    agreeing = ordinals.count(top)
    spread = top - min(ordinals)

    score = (
        BASE_CONFIDENCE
        + _rounded_share(AGREEMENT_WEIGHT, agreeing, len(ordinals))
        - SPREAD_PENALTY * spread
    )
    terms = [f"{agreeing} of {len(voted)} agree", f"spread {spread}"]

    if not has_description(issue):
        score -= NO_DESCRIPTION_PENALTY
        terms.append("no description")

    if not any(signal.rule == LABEL_RULE for signal in voted):
        score -= NO_LABEL_SIGNAL_PENALTY
        terms.append("no label signal")

    return max(MIN_CONFIDENCE, min(MAX_CONFIDENCE, score)), ", ".join(terms)


def offered_tag(preferred: str, context: EstimationContext) -> tuple[str, str | None]:
    """Hold a preferred workflow tag to the ones the caller said exist.

    Decision **K5**: the tags are the installation's, so a classification is a preference
    and this is what turns it into an answer. Three steps, and every one of them is a tag
    the caller offered — the estimator has no way to return one that was not.

    Args:
        preferred: What :func:`~ouroboros_engine.estimation.signals.workflow_signal`
            classified the issue as.
        context: The vocabularies the request offered. ``workflow_tags`` is non-empty; the
            contract refuses a request whose is not.

    Returns:
        The tag to answer with, and a trace line when it is not the preferred one — because
        an installation whose tags this estimator does not know about should be able to see
        that in the trace rather than infer it from an estimate that looks fine.
    """
    if preferred in context.workflow_tags:
        return preferred, None

    fallback = (
        STANDARD_FIX
        if STANDARD_FIX in context.workflow_tags
        else context.workflow_tags[0]
    )
    line = f"{WORKFLOW_FALLBACK_SIGNAL}: {preferred!r} was not offered -> {fallback}"
    return fallback, line


def resolve_model(tag: str, context: EstimationContext) -> tuple[str, str]:
    """Pick the model for a classification out of the caller's own defaults.

    Decision **K6**, and the routing amendment's honesty constraint. What happens here is a
    *lookup in a map the caller sent* — the estimator holds no models, calls nothing, and
    spends no tokens — so the trace line says :data:`NOT_INVOKED` in those words. When L.3
    fills that map from the routing resolution (Z.4, #197) instead of from configuration,
    this function is unchanged: the map was always the caller's.

    Keys are matched case-insensitively, since they are the caller's own naming and
    ``Docs`` meaning ``docs`` is not a distinction worth failing over.

    Args:
        tag: The workflow tag already held to the caller's offer.
        context: The vocabularies the request offered. ``model_defaults`` is non-empty; the
            contract refuses a request whose is not.

    Returns:
        The model to answer with — always one of ``model_defaults``' *values*, never one of
        its keys — and the ``routed-model:`` signal line saying which key produced it.
    """
    candidates = (*WORKFLOW_MODEL_KEYS.get(tag, ()), DEFAULT_MODEL_KEY)
    # Reversed, so that a caller who sent both `docs` and `Docs` gets the one they wrote
    # first: a later key would otherwise overwrite an earlier one in this map, and which of
    # two keys wins should be the caller's order rather than dictionary construction's.
    lowered = {name.lower(): name for name in reversed(list(context.model_defaults))}

    for candidate in candidates:
        name = lowered.get(candidate)
        if name is not None:
            line = f'{MODEL_SIGNAL}: model_defaults["{name}"] -> {NOT_INVOKED}'
            return context.model_defaults[name], line

    # `next(iter(...))` rather than `list(...)[0]`: JSON parsing preserves the caller's
    # insertion order, so this is the first default they wrote rather than an arbitrary one.
    first = next(iter(context.model_defaults))
    offered = "/".join(candidates)
    line = (
        f"{MODEL_SIGNAL}: no {offered} key, so "
        f'model_defaults["{first}"] -> {NOT_INVOKED}'
    )
    return context.model_defaults[first], line


def risk_for(effort: Effort, issue: IssueContext) -> tuple[Risk, str, str]:
    """How likely the change is to break something, why, and the line that records it.

    Effort sets the level and one label may move it a step. A raiser beats a lowerer: a
    ``security`` issue also labelled ``good-first-issue`` is still a security issue, and
    resolving that the other way round is the kind of arithmetic nobody wants to discover
    from a postmortem.

    Args:
        effort: The effort already chosen.
        issue: The issue being sized.

    Returns:
        The risk, the ``risk_note`` a reviewer reads under the meter, and the ``risk:``
        trace line.
    """
    base = EFFORT_RISK[effort]
    raiser = risk_label(issue, RISK_RAISING_LABELS)
    lowerer = risk_label(issue, RISK_LOWERING_LABELS) if raiser is None else None

    level = RISKS.index(base)
    if raiser is not None:
        level = min(level + 1, len(RISKS) - 1)
    elif lowerer is not None:
        level = max(level - 1, 0)
    # `RISKS` is `Risk`'s own values in order (the contract derives it from the type), so
    # this index is always one of them — the clamps above are what guarantee it.
    risk = RISKS[level]

    clause = ""
    mover = raiser if raiser is not None else lowerer
    if mover is not None:
        moves, move = ("raises", "raise") if raiser is not None else ("lowers", "lower")
        clause = (
            f', and the "{mover}" label {moves} it to {risk}'
            if risk != base
            else f', and the "{mover}" label can {move} it no further'
        )

    note = f"{effort.upper()}-sized work starts at {base} regression risk{clause}. "
    line = f"{RISK_SIGNAL}: {effort} effort{clause} -> {risk}"
    return risk, note + RISK_CAVEAT, line


def needs_human(estimate: Estimate, floor: int = NEEDS_HUMAN_CONFIDENCE_FLOOR) -> bool:
    """Whether this estimate is a hedge that wants a person rather than an answer.

    Advisory, and deliberately a function rather than a field: the L.1 contract has no
    ``needs_human`` because the transition belongs to L.3's state machine
    (``unsized → estimating → sized | needs_human``). This is the same comparison, written
    once, so the engine's fixtures and the orchestrator's floor are calibrated against one
    number instead of two.

    Args:
        estimate: Any estimate — this reads only its confidence, so it answers the same
            question about the LLM estimator's answers as about this one.
        floor: The confidence below which a person is wanted.
            :data:`NEEDS_HUMAN_CONFIDENCE_FLOOR` unless an installation says otherwise.

    Returns:
        ``True`` when the confidence is under the floor.
    """
    return estimate.confidence < floor


class HeuristicEstimator:
    """The rule engine L.2 installs — deterministic, honest about being one.

    Stateless: every answer is a function of the request alone, so one instance serves
    every request and two instances cannot disagree. That is not an optimisation, it is the
    determinism the ticket asks for — an estimator that remembered anything between calls
    could answer differently the second time an issue was re-estimated with no change to
    it, and the whole point of versioned estimates is that such a difference means
    something.

    Attributes:
        name: :data:`HEURISTIC`. Read by the route for its log line and written into every
            trace.
    """

    name = HEURISTIC

    def estimate(self, request: EstimateRequest) -> Estimate:
        """Size one issue from its labels, its title and the shape of its body.

        Args:
            request: The validated request — the issue, and the vocabularies an answer may
                use.

        Returns:
            A complete :class:`~ouroboros_engine.estimation.contract.Estimate`. Its
            ``suggested_workflow`` and ``routed_model`` are always ones the request
            offered, its ``breakdown.files`` is always empty, its ``trace.tokens_used`` is
            always ``0``, and its ``trace.estimator`` is always :data:`HEURISTIC`.
        """
        issue = request.issue
        context = request.context

        # The four rules, in the order their lines appear in the trace. `body_effort` never
        # abstains, so `voted` is never empty and every aggregate below has a denominator.
        voted = tuple(
            signal for rule in EFFORT_RULES if (signal := rule(issue)) is not None
        )
        effort = strongest(signal.effort for signal in voted)
        confidence, confidence_terms = confidence_for(voted, issue)

        workflow = workflow_signal(issue)
        tag, fallback_line = offered_tag(workflow.tag, context)
        model, model_line = resolve_model(tag, context)
        risk, risk_note, risk_line = risk_for(effort, issue)

        signals = [signal.line for signal in voted]
        plural = "signal" if len(voted) == 1 else "signals"
        signals.append(
            f"{EFFORT_SIGNAL}: strongest of {len(voted)} {plural} -> {effort}"
        )
        signals.append(f"{CONFIDENCE_SIGNAL}: {confidence_terms} -> {confidence}")
        signals.append(workflow.line)
        if fallback_line is not None:
            signals.append(fallback_line)
        signals.append(model_line)
        signals.append(risk_line)
        if confidence < NEEDS_HUMAN_CONFIDENCE_FLOOR:
            signals.append(
                f"{NEEDS_HUMAN_SIGNAL}: {confidence} is below the "
                f"{NEEDS_HUMAN_CONFIDENCE_FLOOR} confidence floor"
            )

        budget = EFFORT_BUDGETS[effort]
        return Estimate(
            effort=effort,
            confidence=confidence,
            suggested_workflow=tag,
            routed_model=model,
            breakdown=Breakdown(
                # Empty, always, and present rather than omitted: v0 cannot know which
                # files an issue touches, and N.5 renders the absence honestly. A guess
                # here would be the one field of an estimate somebody acts on directly.
                files=[],
                est_tokens=budget.est_tokens,
                cycle_min=budget.cycle_min,
                cycle_max=budget.cycle_max,
                est_minutes=budget.est_minutes,
            ),
            risk=risk,
            risk_note=risk_note,
            trace=Trace(
                estimator=self.name,
                # Zero, and true: nothing was invoked. `trace.tokens_used` is what
                # producing the estimate cost, not what the work will cost — that is
                # `breakdown.est_tokens` — and a rule engine costs nothing.
                tokens_used=0,
                signals=signals,
            ),
        )
