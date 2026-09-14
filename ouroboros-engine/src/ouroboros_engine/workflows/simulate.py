"""R.2's dry-run simulator — a deterministic walk of a workflow graph that spends nothing.

`#144 <https://github.com/NobuData/ouroboros/issues/144>`_. The studio's *Dry run with issue
#485* is not a preview animation: it is this, a walk of the definition with the trigger tested
against the ticket and every routing decision explained. It answers *is this workflow
structurally sound, and where would this ticket go?* in milliseconds — and it is the pre-check
the deep dry run (#562) runs before it invokes anything.

**Zero model calls, zero provider calls.** The simulator explains structure and routing; it
does not do work. Nothing in this package imports a client, a socket or an estimator, and
``tests/test_workflows_simulate.py`` asserts that rather than trusting this sentence.

The walk, exactly
=================

1. **The definition is validated first**, by the same validator ``/v0/workflows/validate``
   answers with. A document that does not validate is answered with its findings and no walk:
   a walk over a graph whose edges may have no endpoints would be a walk over the simulator's
   guesses.
2. **The walk starts at the trigger**, whose conditions are tested against the ticket. When
   they do not hold, no run starts: the trigger is the only step, and every edge out of it is
   reported as not taken.
3. **Stages are visited breadth-first, and each stage's edges in document order.** That order
   is the whole of the determinism: no set is iterated and no clock is read, so the same
   document and ticket produce the same walk in every process
   (``tests/test_workflows_simulate.py`` runs it under different hash seeds to prove it).
4. **An edge is followed when it is taken**: a ``default`` edge always is, a ``branch`` edge
   when its condition holds. A stage already reached is highlighted again but never walked
   twice.
5. **A fork reports every branch**, taken or not — a dry run should show the road not taken —
   and a gate is annotated with what it requires. The DSL's forks differ in treatment, not in
   routing (``docs/WORKFLOW_DSL.md`` § 4.4): what is taken is always what the *edges* say.
6. **A loop is reported, never walked**, with the retry bound the stage it returns to declares
   (``limits.max_retries``). Walking it would revisit a stage the walk has already explained.
7. **A ``checks`` condition is assumed green**, because check results come from a run
   (:mod:`ouroboros_engine.workflows.predicates`). Every such evaluation is marked ``assumed``.

The same semantics are what the Build Analyzer's counterfactual simulation (#523) reuses rather
than reimplementing, which is why the walk is a function of the typed document and nothing else.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from .contract import (
    DryRunEdge,
    DryRunStep,
    DryRunTicket,
    EdgeRef,
    NodeVerdict,
    StepVerdict,
    WorkflowDryRun,
    findings_from,
)
from .dsl import (
    FlowConfig,
    InfraConfig,
    LlmConfig,
    OpenPrAutomergeOptions,
    TermConfig,
    TriggerConfig,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
)
from .predicates import (
    Evaluation,
    describe_predicate,
    describe_trigger,
    evaluate_predicate,
    evaluate_trigger,
)
from .validate import validate_workflow_document


@dataclass(frozen=True, slots=True)
class _Report:
    """An edge's outcome, and what it says about the stage it arrives at."""

    #: The edge as the caller receives it.
    edge: DryRunEdge
    #: Why the edge does not bring the walk to its target, as a clause — read only when it
    #: does not, to explain a stage the walk never reached.
    reason: str


@dataclass(frozen=True, slots=True)
class _Visit:
    """One stage the walk reached."""

    #: The step as the caller receives it.
    step: DryRunStep
    #: The outcome of every edge out of the stage, in document order.
    reports: tuple[_Report, ...]


def dry_run(definition: object, ticket: DryRunTicket) -> WorkflowDryRun:
    """Validate a definition and, when it is valid, walk it for a ticket.

    Args:
        definition: The document, as it arrived — parsed JSON, not trusted to be anything.
        ticket: The ticket to walk it for.

    Returns:
        The findings and no walk when the document does not validate; otherwise no findings and
        the walk.
    """
    verdict = validate_workflow_document(definition)
    if verdict.document is None:
        return WorkflowDryRun(
            findings=findings_from(verdict), steps=[], verdicts=[], highlight_path=[]
        )
    return walk(verdict.document, ticket)


def walk(document: WorkflowDocument, ticket: DryRunTicket) -> WorkflowDryRun:
    """Walk a validated document for a ticket.

    Args:
        document: A document the validator accepted — exactly one trigger, unique ids, every
            edge's endpoints resolved. This function relies on all three.
        ticket: The ticket to walk it for.

    Returns:
        The ordered walk, a verdict per stage and the edges to highlight.
    """
    nodes = {node.id: node for node in document.nodes}
    outgoing: dict[str, list[WorkflowEdge]] = {node.id: [] for node in document.nodes}
    for edge in document.edges:
        outgoing[edge.from_].append(edge)

    trigger = next(node for node in document.nodes if node.type == "trigger")
    reached_from: dict[str, str | None] = {trigger.id: None}
    unreached_because: dict[str, str] = {}
    pending = deque([trigger.id])
    steps: list[DryRunStep] = []
    highlight: list[EdgeRef] = []

    while pending:
        node = nodes[pending.popleft()]
        visit = _visit(node, outgoing[node.id], document, nodes, ticket)
        steps.append(visit.step)

        for report in visit.reports:
            edge = report.edge
            if edge.outcome != "taken":
                unreached_because.setdefault(edge.to, report.reason)
                continue
            highlight.append(EdgeRef(from_=edge.from_, to=edge.to))
            if edge.to not in reached_from:
                reached_from[edge.to] = node.id
                pending.append(edge.to)

    verdicts = [
        _verdict(node, document, steps, reached_from, unreached_because)
        for node in document.nodes
    ]
    return WorkflowDryRun(
        findings=[], steps=steps, verdicts=verdicts, highlight_path=highlight
    )


def _visit(
    node: WorkflowNode,
    edges: list[WorkflowEdge],
    document: WorkflowDocument,
    nodes: dict[str, WorkflowNode],
    ticket: DryRunTicket,
) -> _Visit:
    """Explain one stage the walk reached, and decide every edge out of it.

    Args:
        node: The stage.
        edges: Every edge out of it, in document order.
        document: The whole document, for the root trigger.
        nodes: Every stage by id, for a loop's retry bound.
        ticket: The ticket.

    Returns:
        The step and the outcome of each edge.

    Raises:
        TypeError: If the node carries a config the DSL does not define — which a validated
            document cannot.
    """
    evaluation: Evaluation | None = None
    blocked: str | None = None

    match node.config:
        case TriggerConfig():
            evaluation = evaluate_trigger(document.trigger, ticket)
            annotation = describe_trigger(document.trigger)
            if not evaluation.holds:
                blocked = f"the trigger does not fire for {ticket.external_key}"
        case LlmConfig() as config:
            annotation = _llm_annotation(config)
        case InfraConfig() as config:
            annotation = _infra_annotation(config)
        case FlowConfig() as config:
            evaluation = evaluate_predicate(config.predicate, ticket)
            annotation = _flow_annotation(config)
        case TermConfig() as config:
            annotation = _term_annotation(config)
        case _:
            message = f"{type(node.config).__name__} is not a workflow node config"
            raise TypeError(message)

    reports = tuple(_report(edge, nodes, ticket, blocked) for edge in edges)
    step = DryRunStep(
        node_id=node.id,
        type=node.type,  # type: ignore[arg-type]
        title=node.title,
        verdict=_step_verdict(node, evaluation, reports),
        annotation=annotation,
        evaluation=None if evaluation is None else evaluation.as_model(),
        edges=[report.edge for report in reports],
    )
    return _Visit(step=step, reports=reports)


def _step_verdict(
    node: WorkflowNode, evaluation: Evaluation | None, reports: tuple[_Report, ...]
) -> StepVerdict:
    """Conclude what a reached stage is.

    Args:
        node: The stage.
        evaluation: The trigger's evaluation, for the trigger.
        reports: The outcome of every edge out of it.

    Returns:
        ``matched`` or ``not_matched`` for the trigger, ``ended`` for a terminal, and otherwise
        ``reached`` when an edge out of it is taken or ``halted`` when none is.
    """
    if node.type == "trigger":
        return (
            "matched" if evaluation is not None and evaluation.holds else "not_matched"
        )
    if node.type == "term":
        return "ended"
    if any(report.edge.outcome == "taken" for report in reports):
        return "reached"
    return "halted"


def _report(
    edge: WorkflowEdge,
    nodes: dict[str, WorkflowNode],
    ticket: DryRunTicket,
    blocked: str | None,
) -> _Report:
    """Decide one edge.

    Args:
        edge: The edge.
        nodes: Every stage by id, for a loop's retry bound.
        ticket: The ticket.
        blocked: Why nothing leaves the edge's source at all — the trigger not firing — or
            ``None`` when the source is on the walk.

    Returns:
        The edge's outcome and the reason it does not reach its target when it does not.
    """
    evaluation = (
        None if edge.condition is None else evaluate_predicate(edge.condition, ticket)
    )
    max_retries: int | None = None

    if edge.kind == "loop":
        max_retries = _retry_bound(nodes[edge.to])
        outcome = "loop"
        explanation = _loop_explanation(edge, evaluation, max_retries)
        reason = f"the loop from `{edge.from_}` is reported rather than walked"
    elif blocked is not None:
        outcome = "not_taken"
        explanation = f"Not taken: {blocked}, so no run starts."
        reason = blocked
    elif evaluation is None:
        outcome = "taken"
        explanation = "Taken: a default edge is always followed."
        reason = ""
    elif evaluation.holds:
        outcome = "taken"
        explanation = f"Taken: {evaluation.clause}."
        reason = ""
    else:
        outcome = "not_taken"
        explanation = f"Not taken: {evaluation.clause}."
        reason = (
            f"the branch from `{edge.from_}` is not taken, because {evaluation.clause}"
        )

    return _Report(
        edge=DryRunEdge(
            from_=edge.from_,
            to=edge.to,
            kind=edge.kind,  # type: ignore[arg-type]
            label=edge.label,
            outcome=outcome,
            explanation=explanation,
            evaluation=None if evaluation is None else evaluation.as_model(),
            max_retries=max_retries,
        ),
        reason=reason,
    )


def _retry_bound(target: WorkflowNode) -> int | None:
    """The retry bound a loop into a stage carries.

    Args:
        target: The stage the loop returns to.

    Returns:
        Its ``limits.max_retries`` when it is a model stage, and ``None`` otherwise — only a
        model stage declares limits.
    """
    config = target.config
    return config.limits.max_retries if isinstance(config, LlmConfig) else None


def _loop_explanation(
    edge: WorkflowEdge, evaluation: Evaluation | None, max_retries: int | None
) -> str:
    """Explain a loop edge: where it returns, what bounds it, and whether it would be followed.

    Args:
        edge: The loop edge.
        evaluation: Its condition's evaluation, or ``None`` when it has none.
        max_retries: The bound from :func:`_retry_bound`.

    Returns:
        Two or three sentences.
    """
    if max_retries is None:
        bound = (
            f"`{edge.to}` declares no retry limit, so nothing in the document bounds it"
        )
    else:
        noun = "retry" if max_retries == 1 else "retries"
        bound = f"it is bounded by the {max_retries} {noun} `{edge.to}` allows"

    sentences = [f"Loops back to `{edge.to}`; {bound}."]
    if evaluation is not None and evaluation.holds:
        sentences.append(f"It would be followed: {evaluation.clause}.")
    elif evaluation is not None:
        sentences.append(f"It would not be followed: {evaluation.clause}.")
    sentences.append("A dry run reports a loop and never walks it.")
    return " ".join(sentences)


def _llm_annotation(config: LlmConfig) -> str:
    """Say what a model stage would do, without doing it.

    Args:
        config: The stage's config.

    Returns:
        One sentence and the statement that nothing was invoked.
    """
    if config.mode == "skill":
        loads = f"loads the skill `{config.skill}` before its prompt"
    else:
        loads = "sends its prompt template directly"

    routing = config.routing
    if routing.pinned_model is not None:
        model = f"on the pinned alias `{routing.pinned_model.alias}`"
    else:
        model = f"on the model the `{routing.inherit_task}` task routes to"

    limits = config.limits
    noun = "retry" if limits.max_retries == 1 else "retries"
    return (
        f"A model stage: {loads}, {model}, with at most {limits.max_retries} {noun} and a "
        f"{limits.token_budget}-token budget. Not invoked — a dry run makes no model call."
    )


def _infra_annotation(config: InfraConfig) -> str:
    """Say what a build or test stage would do, without doing it.

    Args:
        config: The stage's config.

    Returns:
        One sentence and the statement that nothing was dispatched.
    """
    command = (
        "the repository's default command"
        if config.command is None
        else f"`{config.command}`"
    )
    pool = (
        "the default runner pool"
        if config.runner_pool is None
        else f"the `{config.runner_pool}` runner pool"
    )
    return (
        f"A build stage: runs {command} on {pool}. Not dispatched — a dry run starts no "
        "build."
    )


def _flow_annotation(config: FlowConfig) -> str:
    """Say what a fork decides on, or what a gate requires.

    Args:
        config: The fork's config.

    Returns:
        One or two sentences.
    """
    requirement = describe_predicate(config.predicate)
    if config.kind == "gate":
        return f"A gate. Requires: {requirement}."
    return f"A decision on: {requirement}. Every branch out of it is reported, taken or not."


def _term_annotation(config: TermConfig) -> str:
    """Say how a terminal would end the run, without ending anything.

    Args:
        config: The terminal's config.

    Returns:
        One or two sentences.
    """
    options = config.options
    if isinstance(options, OpenPrAutomergeOptions):
        branch = "deleting" if options.delete_branch else "keeping"
        return (
            "Ends the run by opening a pull request and auto-merging it with a "
            f"`{options.merge_method}` merge, {branch} the branch. Not performed — a dry "
            "run opens nothing."
        )
    if config.action == "back_to_queue":
        return "Ends the run by returning the ticket to the queue."
    return "Ends the run by handing it to a person for review."


def _verdict(
    node: WorkflowNode,
    document: WorkflowDocument,
    steps: list[DryRunStep],
    reached_from: dict[str, str | None],
    unreached_because: dict[str, str],
) -> NodeVerdict:
    """Conclude what the walk says about one stage, walked or not.

    Args:
        node: The stage.
        document: The whole document, for the edges into a stage nothing walked pointed at.
        steps: The walk.
        reached_from: The stage each reached stage was first reached from; ``None`` for the
            trigger.
        unreached_because: For each stage an edge pointed at without bringing the walk there,
            the first reason why.

    Returns:
        The verdict and its explanation.
    """
    step = next((step for step in steps if step.node_id == node.id), None)

    if step is None:
        because = unreached_because.get(node.id) or _only_through(node, document)
        return NodeVerdict(
            node_id=node.id,
            verdict="not_reached",
            explanation=f"Not reached: {because}.",
        )

    if step.evaluation is not None and step.verdict in ("matched", "not_matched"):
        return NodeVerdict(
            node_id=node.id,
            verdict=step.verdict,
            explanation=step.evaluation.explanation,
        )

    origin = f"Reached from `{reached_from[node.id]}`"
    explanations: dict[str, str] = {
        "reached": f"{origin}.",
        "ended": f"{origin}; the simulated run ends here.",
        "halted": f"{origin}, and no edge out of it is taken, so a run would stop here.",
    }
    return NodeVerdict(
        node_id=node.id, verdict=step.verdict, explanation=explanations[step.verdict]
    )


def _only_through(node: WorkflowNode, document: WorkflowDocument) -> str:
    """Explain a stage no reached stage has an edge to: every way in starts off the walk.

    A validated document has every stage reachable from the trigger, so a stage the walk did not
    reach — and that no edge out of a reached stage names — still has edges in. All of them leave
    stages the walk did not reach either, and naming those is the explanation.

    Args:
        node: The stage.
        document: The whole document.

    Returns:
        A clause naming, once each and in document order, the stages its edges leave from.
    """
    sources = dict.fromkeys(edge.from_ for edge in document.edges if edge.to == node.id)
    names = ", ".join(f"`{source}`" for source in sources)
    return f"it is reached only through {names}, which the walk did not reach"
