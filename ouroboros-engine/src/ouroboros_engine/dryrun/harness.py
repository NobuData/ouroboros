"""The deep dry-run harness: real models, and nothing else real (CD.2, #560).

One :meth:`DryRunHarness.run` walks a draft for a ticket and yields what happens as it
happens. Mockup 20's safety strip is this module's three collaborators:

* **Simulated writes** — every tool acts on a :class:`~.workspace.VirtualWorkspace`; edits
  land in its overlay and the overlay becomes the diff artifact. Nothing is flushed.
* **Replayed infra** — an infrastructure stage is one question to the estimator
  (:mod:`.estimates`); its answer is the row. No model produces a duration.
* **Real models** — a model stage runs its own prompt through the invocation gateway
  (:mod:`.model`) with the alias routing resolved and the knowledge assembled for it.

**How a draft is walked.** Stages are visited in a topological order of the document's
non-loop edges. A stage is *reached* when an edge into it is taken; a branch whose condition
is false is not, and the stage it led to is recorded ``skipped`` with the clause that
decided it. Conditions over the change's paths are tested against the simulated diff as it
stands at that moment — a prior stage's output — and everything else against the ticket.
Loop edges are not walked: a dry run makes one pass.

**Skipping is a result, not a failure.** Besides a branch not taken, a model stage whose
route did not resolve (a task kind the catalog does not have yet — decision W7) is skipped
with its warning, and the walk continues past it.

**Three ways to end.** ``complete``; ``budget_stopped`` when a token or spend cap is reached,
with every row so far kept and the rest ``not_reached``; ``failed`` when a stage fails, the
definition does not validate, the git host cannot be read — or the tool boundary had to
refuse anything at all, because a dry run whose guards were tested is not one to trust.

Parallel model stages that share a title and their predecessors share a row — the card's
doubled review row.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Final

from pydantic import BaseModel

from ouroboros_engine.investigation.model import CallUsage, ModelFailureError
from ouroboros_engine.workflows.contract import findings_from
from ouroboros_engine.workflows.dsl import (
    InfraConfig,
    LlmConfig,
    PathsPredicate,
    TermConfig,
    WorkflowDocument,
    WorkflowEdge,
    WorkflowNode,
)
from ouroboros_engine.workflows.predicates import (
    Evaluation,
    evaluate_predicate,
    evaluate_trigger,
)
from ouroboros_engine.workflows.validate import validate_workflow_document

from .contract import (
    MAX_ARTIFACT_BYTES,
    DryRunArtifact,
    DryRunDone,
    DryRunEvent,
    DryRunRepository,
    DryRunRequest,
    DryRunResult,
    DryRunSubject,
    GuardBlocked,
    PathChange,
    StageFinished,
    StageHow,
    StagePlan,
    StageResult,
    StageStarted,
    StageVerdict,
)
from .estimates import EstimateUnavailableError, InfraKind, ReplayEstimates
from .guard import GuardAudit
from .model import StageCall, StageCaller
from .notes import (
    TIMES,
    budget_note,
    llm_note,
    plural,
    terminal_note,
)
from .protocol import StageReport, parse_reply, system_prompt
from .tools import ToolSet
from .workspace import (
    GithubReader,
    ReadCache,
    RepositoryReader,
    VirtualWorkspace,
    WorkspaceError,
    glob_matches,
)

#: The most turns one model stage may take before it is failed as unfinished.
MAX_ROUNDS: Final = 16

#: The most characters of the simulated diff a later stage is shown in its context.
MAX_CONTEXT_DIFF: Final = 24_000

#: The most characters of an excerpt artifact.
MAX_EXCERPT: Final = 8_000

_SLUG = re.compile(r"[a-z0-9]+")
_PLACEHOLDER = re.compile(r"\{\{\s*issue\.(title|key|body|labels)\s*\}\}")


def github_reader(repository: DryRunRepository) -> RepositoryReader:
    """Make the reader a dry run uses in production.

    Args:
        repository: Where to read, and with what.

    Returns:
        A :class:`~.workspace.GithubReader` bound to the pinned commit.
    """
    return GithubReader(
        repository.api_url, repository.slug, repository.pinned_sha, repository.token
    )


@dataclass(slots=True)
class _Spend:
    """What some span of the run has used.

    Attributes:
        tokens: Input and output tokens.
        cents: What the priced calls cost.
        priced: Whether any call reported a cost at all.
    """

    tokens: int = 0
    cents: float = 0.0
    priced: bool = False

    def add(self, usage: list[CallUsage]) -> None:
        """Count some usage.

        Args:
            usage: What a call's hops consumed.
        """
        for hop in usage:
            self.tokens += hop.input_tokens + hop.output_tokens
            if hop.cost_cents is not None:
                self.cents += hop.cost_cents
                self.priced = True


@dataclass(slots=True)
class _Outcome:
    """How one model stage ended.

    Attributes:
        report: What it handed in, when it finished.
        spend: What it used.
        failure: Why it failed, when it did.
        budget: The note of the cap that stopped it, when one did.
    """

    report: StageReport | None = None
    spend: _Spend = field(default_factory=_Spend)
    failure: str | None = None
    budget: str | None = None


def deep_evaluate(
    predicate: BaseModel, ticket: DryRunSubject, workspace: VirtualWorkspace
) -> Evaluation:
    """Test a predicate with everything a deep dry run knows.

    Args:
        predicate: A parsed predicate.
        ticket: The ticket.
        workspace: The workspace, for the paths the simulated diff changes.

    Returns:
        A paths predicate tested for real against the simulated diff; any other predicate as
        the structural walk tests it.
    """
    if not isinstance(predicate, PathsPredicate):
        return evaluate_predicate(predicate, ticket)

    globs = ", ".join(f"`{glob}`" for glob in predicate.globs)
    hits = [
        path
        for path in workspace.changed_paths()
        if any(glob_matches(glob, path) for glob in predicate.globs)
    ]
    if hits:
        clause = f"the simulated diff changes `{hits[0]}`, which matches {globs}"
    else:
        clause = f"no path the simulated diff changes matches {globs}"
    return Evaluation(
        holds=bool(hits) == (predicate.op == "any"), assumed=False, clause=clause
    )


def stage_order(document: WorkflowDocument) -> list[WorkflowNode]:
    """Order a document's stages so that each comes after everything that leads to it.

    Args:
        document: A validated document.

    Returns:
        A topological order of the non-loop edges, ties broken by document order. Stages a
        cycle of non-loop edges would hold back — which a validated document does not have
        — follow in document order rather than being lost.
    """
    index = {node.id: position for position, node in enumerate(document.nodes)}
    waiting = {node.id: 0 for node in document.nodes}
    for edge in document.edges:
        if edge.kind != "loop":
            waiting[edge.to] += 1

    ready = sorted(
        (n for n, count in waiting.items() if count == 0), key=index.__getitem__
    )
    order: list[str] = []
    while ready:
        current = ready.pop(0)
        order.append(current)
        for edge in document.edges:
            if edge.kind == "loop" or edge.from_ != current:
                continue
            waiting[edge.to] -= 1
            if waiting[edge.to] == 0:
                ready.append(edge.to)
        ready.sort(key=index.__getitem__)

    seen = set(order)
    order.extend(node.id for node in document.nodes if node.id not in seen)
    nodes = {node.id: node for node in document.nodes}
    return [nodes[node_id] for node_id in order]


def infra_kind(node: WorkflowNode) -> InfraKind:
    """Decide whether an infrastructure stage is a build or a test run.

    The DSL does not say, so the stage's own name does: a stage whose id or title has
    ``test`` as a word is a test run, and anything else is a build.

    Args:
        node: An infrastructure stage.

    Returns:
        ``test`` or ``build``.
    """
    words = _SLUG.findall(f"{node.id} {node.title}".lower())
    return "test" if any(word in ("test", "tests") for word in words) else "build"


class DryRunHarness:
    """Runs deep dry runs. Holds no state between runs but the read cache."""

    def __init__(
        self,
        caller: StageCaller,
        estimates: ReplayEstimates,
        *,
        cache: ReadCache | None = None,
        reader_factory: Callable[[DryRunRepository], RepositoryReader] = github_reader,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        """Make a harness.

        Args:
            caller: How a model stage calls its model.
            estimates: Where infrastructure stages are estimated.
            cache: The read cache, shared by every run of this harness.
            reader_factory: How a repository becomes a reader; a test supplies its own.
            clock: The time, for the rows' stamps and the run's duration.
        """
        self._caller = caller
        self._estimates = estimates
        self._cache = cache if cache is not None else ReadCache()
        self._reader_factory = reader_factory
        self._clock = clock

    def run(self, request: DryRunRequest) -> Iterator[DryRunEvent]:
        """Run one dry run.

        Args:
            request: The dry run.

        Yields:
            ``stage_started`` and ``stage_finished`` per row, ``guard_blocked`` whenever the
            tool boundary refuses a call, and exactly one ``done`` last.
        """
        started = self._clock()
        verdict = validate_workflow_document(request.definition)
        if verdict.document is None:
            yield DryRunDone(
                result=DryRunResult(
                    dry_run=request.dry_run,
                    status="failed",
                    failure_reason="the workflow definition does not validate",
                    findings=findings_from(verdict),
                    duration_ms=_elapsed(started, self._clock()),
                )
            )
            return

        workspace = VirtualWorkspace(
            self._reader_factory(request.repository),
            self._cache,
            request.repository.slug,
            request.repository.pinned_sha,
        )
        run = _Run(
            request=request,
            document=verdict.document,
            workspace=workspace,
            caller=self._caller,
            estimates=self._estimates,
            clock=self._clock,
            started=started,
        )
        yield from run.execute()


class _Run:
    """The state of one dry run while it is walked."""

    def __init__(
        self,
        *,
        request: DryRunRequest,
        document: WorkflowDocument,
        workspace: VirtualWorkspace,
        caller: StageCaller,
        estimates: ReplayEstimates,
        clock: Callable[[], datetime],
        started: datetime,
    ) -> None:
        """Start a run.

        Args:
            request: The dry run.
            document: Its validated definition.
            workspace: Its virtual workspace.
            caller: How a model stage calls its model.
            estimates: Where infrastructure stages are estimated.
            clock: The time.
            started: When the run began.
        """
        self.request = request
        self.document = document
        self.workspace = workspace
        self.caller = caller
        self.estimates = estimates
        self.clock = clock
        self.started = started
        self.audit = GuardAudit()
        self.spend = _Spend()
        self.rows: list[StageResult] = []
        self.reports: list[tuple[WorkflowNode, StageReport]] = []
        self.reached: set[str] = set()
        self.unreached: dict[str, str] = {}
        self.halt: tuple[str, str] | None = None
        self.outgoing: dict[str, list[WorkflowEdge]] = {
            n.id: [] for n in document.nodes
        }
        self.incoming: dict[str, frozenset[str]] = {}
        sources: dict[str, set[str]] = {n.id: set() for n in document.nodes}
        for edge in document.edges:
            if edge.kind != "loop":
                self.outgoing[edge.from_].append(edge)
                sources[edge.to].add(edge.from_)
        self.incoming = {
            node_id: frozenset(found) for node_id, found in sources.items()
        }

    # -- the walk -----------------------------------------------------------------------

    def execute(self) -> Iterator[DryRunEvent]:
        """Walk the document and end with the result.

        Yields:
            The run's events.
        """
        for group in self._groups():
            recorded = len(self.rows)
            try:
                yield from self._visit(group)
            except WorkspaceError as unreadable:
                # The git host stopped answering under a stage: the stage fails, with its
                # row, and nothing after it is reached.
                reason = f"the repository could not be read: {unreadable.message}"
                self._stop("failed", reason)
                if len(self.rows) == recorded and group[0].type not in (
                    "trigger",
                    "flow",
                ):
                    how = (
                        "llm"
                        if isinstance(group[0].config, LlmConfig)
                        else "deterministic"
                    )
                    yield self._row(group, "failed", how, reason)
        yield DryRunDone(result=self._result())

    def _groups(self) -> list[list[WorkflowNode]]:
        """Put the stages in order, with parallel same-titled model stages side by side.

        Returns:
            The rows-to-be: each a list of one stage, or of several resolved model stages
            that share a title and exactly the same predecessors.
        """
        groups: list[list[WorkflowNode]] = []
        for node in stage_order(self.document):
            last = groups[-1] if groups else None
            if (
                last is not None
                and self._groupable(node)
                and self._groupable(last[0])
                and last[0].title == node.title
                and self.incoming[last[0].id] == self.incoming[node.id]
            ):
                last.append(node)
            else:
                groups.append([node])
        return groups

    def _groupable(self, node: WorkflowNode) -> bool:
        """Whether a stage may share a row: a model stage whose route resolved."""
        return isinstance(node.config, LlmConfig) and self._plan(node).alias is not None

    def _visit(self, group: list[WorkflowNode]) -> Iterator[DryRunEvent]:
        """Visit one row's stages.

        Args:
            group: The stages the row stands for.

        Yields:
            The row's events.
        """
        first = group[0]
        if first.type == "trigger":
            self._fire(first)
            return
        if first.type == "flow":
            if first.id in self.reached and self.halt is None:
                self._follow(first)
            return

        if first.id not in self.reached:
            if self.halt is None:
                reason = self.unreached.get(
                    first.id, "nothing on the walk leads to this stage"
                )
                yield self._row(group, "skipped", "skipped", reason, skip_reason=reason)
            else:
                yield self._row(group, "not_reached", "deterministic", "")
            return
        if isinstance(first.config, TermConfig):
            yield self._row(
                group, "not_reached", "deterministic", terminal_note(first.config)
            )
            return
        if self.halt is not None:
            yield self._row(group, "not_reached", "deterministic", "")
            return

        if isinstance(first.config, InfraConfig):
            yield from self._infra(first, first.config)
        else:
            yield from self._llm(group)
        if self.halt is None:
            for node in group:
                self._follow(node)

    def _fire(self, trigger: WorkflowNode) -> None:
        """Test the trigger; when it fires, the walk starts.

        Args:
            trigger: The trigger node.
        """
        fired = evaluate_trigger(self.document.trigger, self.request.ticket)
        if fired.holds:
            self.reached.add(trigger.id)
            self._follow(trigger)
            return
        reason = f"the trigger does not fire for {self.request.ticket.external_key}"
        for node in self.document.nodes:
            self.unreached[node.id] = reason

    def _follow(self, node: WorkflowNode) -> None:
        """Decide every edge out of a stage that was reached.

        Args:
            node: The stage.
        """
        for edge in self.outgoing[node.id]:
            evaluation = (
                None
                if edge.condition is None
                else deep_evaluate(edge.condition, self.request.ticket, self.workspace)
            )
            if evaluation is None or evaluation.holds:
                self.reached.add(edge.to)
            else:
                self.unreached.setdefault(
                    edge.to,
                    f"the branch from `{edge.from_}` is not taken, because "
                    f"{evaluation.clause}",
                )

    # -- infrastructure: replayed -------------------------------------------------------

    def _infra(self, node: WorkflowNode, config: InfraConfig) -> Iterator[DryRunEvent]:
        """Estimate an infrastructure stage from history.

        Args:
            node: The stage.
            config: Its pool and command.

        Yields:
            The row's events.
        """
        began = self.clock()
        yield self._started([node])
        try:
            replayed = self.estimates.estimate(
                self.request.dry_run,
                infra_kind(node),
                runner_pool=config.runner_pool,
                command=config.command,
            )
        except EstimateUnavailableError as unavailable:
            note = f"no replay estimate: {unavailable.code}"
            self._stop(
                "failed",
                f"stage `{node.id}` could not be estimated ({unavailable.code})",
            )
            yield self._row([node], "failed", "deterministic", note, began=began)
            return
        yield self._row(
            [node],
            "ok",
            "replayed",
            replayed.note,
            metrics=replayed.metrics,
            began=began,
        )

    # -- model stages: real -------------------------------------------------------------

    def _llm(self, group: list[WorkflowNode]) -> Iterator[DryRunEvent]:
        """Run one row of model stages.

        Args:
            group: One stage, or several resolved ones sharing the row.

        Yields:
            The row's events.
        """
        first = group[0]
        plan = self._plan(first)
        if plan.alias is None:
            reason = (
                plan.warnings[0]
                if plan.warnings
                else f"no route resolves for stage `{first.id}` — its task kind or alias "
                "is not in the catalog yet"
            )
            yield self._row(group, "skipped", "skipped", reason, skip_reason=reason)
            return

        capped = self._run_cap()
        if capped is not None:
            self._stop("budget_stopped", capped)
            yield self._row(group, "not_reached", "deterministic", "")
            return

        began = self.clock()
        yield self._started(group)
        before = {
            path: (added, removed)
            for path, added, removed in self.workspace.line_counts()
        }
        read_from = len(self.workspace.read_log)
        spend = _Spend()
        reports: list[StageReport] = []
        missing: list[str] = []
        note: str | None = None
        verdict: StageVerdict = "ok"

        for node in group:
            config = node.config
            if not isinstance(
                config, LlmConfig
            ):  # pragma: no cover - groups hold model stages
                continue
            node_plan = self._plan(node)
            if config.skill is not None and not node_plan.skill_resolved:
                missing.append(config.skill)
            outcome = yield from self._stage(node, config, node_plan)
            spend.tokens += outcome.spend.tokens
            spend.cents += outcome.spend.cents
            spend.priced = spend.priced or outcome.spend.priced
            if outcome.budget is not None:
                verdict, note = "failed", outcome.budget
                self._stop("budget_stopped", f"stage `{node.id}` {outcome.budget}")
                break
            if outcome.failure is not None or outcome.report is None:
                verdict, note = (
                    "failed",
                    outcome.failure or "the stage handed in nothing",
                )
                self._stop("failed", f"stage `{node.id}` failed: {note}")
                break
            reports.append(outcome.report)
            self.reports.append((node, outcome.report))

        after = {
            path: (added, removed)
            for path, added, removed in self.workspace.line_counts()
        }
        touched = sorted(
            path
            for path in before.keys() | after.keys()
            if before.get(path) != after.get(path)
        )
        added = sum(a for a, _ in after.values()) - sum(a for a, _ in before.values())
        removed = sum(r for _, r in after.values()) - sum(r for _, r in before.values())
        read = len(set(self.workspace.read_log[read_from:]))

        metrics: dict[str, Any] = {"tokens": spend.tokens}
        if spend.priced:
            metrics["cost_cents"] = math.ceil(spend.cents)
        if touched:
            metrics.update(
                files_touched=len(touched),
                simulated_writes=len(touched),
                lines_added=max(added, 0),
                lines_removed=max(removed, 0),
            )
        elif read:
            metrics["files_touched"] = read

        if note is None:
            note = llm_note(
                reports,
                added=max(added, 0),
                removed=max(removed, 0),
                wrote=bool(touched),
                files_read=read,
                tokens=spend.tokens,
                missing_skills=missing,
            )
        yield self._row(group, verdict, "llm", note, metrics=metrics, began=began)

    def _stage(
        self, node: WorkflowNode, config: LlmConfig, plan: StagePlan
    ) -> Generator[DryRunEvent, None, _Outcome]:
        """Run one model stage to its report, a failure, or a cap.

        Args:
            node: The stage.
            config: Its prompt and limits.
            plan: Its resolved alias and knowledge.

        Yields:
            ``guard_blocked`` for each call the tool boundary refuses.

        Returns:
            How the stage ended.
        """
        tools = ToolSet(
            self.workspace,
            self.estimates,
            self.audit,
            dry_run=self.request.dry_run,
            stage_key=node.id,
        )
        outcome = _Outcome()
        token_cap = _lower(config.limits.token_budget, self.request.budget.stage_tokens)
        messages: list[dict[str, str]] = [
            {"role": "user", "content": self._context(node, config, plan)}
        ]

        for _ in range(MAX_ROUNDS):
            outcome.budget = (
                self._stage_cap(outcome.spend, token_cap) or self._run_cap()
            )
            if outcome.budget is not None:
                return outcome
            try:
                answer = self.caller.call(
                    StageCall(
                        dry_run=self.request.dry_run,
                        stage_key=node.id,
                        alias=plan.alias or "",
                        system=system_prompt(),
                        messages=tuple(messages),
                        cost_cap_cents=self._cost_left(outcome.spend),
                        resolution_version=plan.resolution_version,
                    )
                )
            except ModelFailureError as failed:
                self._count(outcome.spend, failed.usage)
                if failed.over_budget:
                    outcome.budget = (
                        self._stage_cap(outcome.spend, token_cap)
                        or self._run_cap()
                        or "stopped: spend cap reached"
                    )
                else:
                    outcome.failure = f"model call failed: {failed.code}"
                return outcome
            self._count(outcome.spend, answer.usage)

            reply = parse_reply(answer.text)
            if not reply.calls:
                outcome.report = reply.report or StageReport(
                    summary=answer.text.strip()[:1000]
                )
                return outcome

            results: list[str] = []
            for call in reply.calls:
                if call.error is not None:
                    results.append(f"[tool block] {call.error}")
                    continue
                done = tools.call(call.tool, call.arguments)
                if done.blocked is not None:
                    yield GuardBlocked(
                        guard=done.blocked.guard,
                        call=done.blocked.call,
                        stage_key=done.blocked.stage_key,
                    )
                results.append(
                    f"[{call.tool}] {'ok' if done.ok else 'refused'}\n{done.content}"
                )
            if reply.dropped:
                results.append(
                    f"[{reply.dropped} more tool blocks were ignored: too many]"
                )
            if reply.report is not None:
                outcome.report = reply.report
                return outcome
            messages.append({"role": "assistant", "content": answer.text})
            messages.append({"role": "user", "content": "\n\n".join(results)})

        outcome.failure = f"did not finish within {MAX_ROUNDS} turns"
        return outcome

    def _context(self, node: WorkflowNode, config: LlmConfig, plan: StagePlan) -> str:
        """Build what a stage is told: the ticket, its task, its knowledge, and what came before.

        Args:
            node: The stage.
            config: Its prompt.
            plan: Its knowledge.

        Returns:
            The stage's first message.
        """
        ticket = self.request.ticket
        values = {
            "title": ticket.title,
            "key": ticket.external_key,
            "body": ticket.body,
            "labels": ", ".join(ticket.labels),
        }
        task = _PLACEHOLDER.sub(
            lambda match: values[match.group(1)], config.prompt_template
        )
        parts = [
            f"# Ticket {ticket.external_key}: {ticket.title}",
            f"Labels: {', '.join(ticket.labels) or '(none)'}",
            ticket.body or "(no description)",
            f"# Your stage: {node.title}",
            task,
        ]
        if plan.manifest:
            parts += ["# Knowledge", plan.manifest]
        if self.reports:
            parts.append("# Earlier stages")
            for earlier, report in self.reports:
                parts.append(_recap(earlier, report))
        diff = self.workspace.diff()
        if diff:
            shown = diff[:MAX_CONTEXT_DIFF]
            cut = (
                "" if len(diff) <= MAX_CONTEXT_DIFF else "\n[diff cut; read the files]"
            )
            parts += [
                "# Simulated diff so far (in memory; reads show these changes)",
                shown + cut,
            ]
        return "\n\n".join(parts)

    # -- budgets ------------------------------------------------------------------------

    def _count(self, stage: _Spend, usage: list[CallUsage]) -> None:
        """Count usage against the stage and the run."""
        stage.add(usage)
        self.spend.add(usage)

    def _stage_cap(self, stage: _Spend, token_cap: int | None) -> str | None:
        """The note of a stage cap that has been reached, if one has."""
        if token_cap is not None and stage.tokens >= token_cap:
            return budget_note("stage", "token", stage.tokens, token_cap)
        cost_cap = self.request.budget.stage_cost_cents
        if cost_cap is not None and stage.cents >= cost_cap:
            return budget_note("stage", "cost", math.ceil(stage.cents), cost_cap)
        return None

    def _run_cap(self) -> str | None:
        """The note of a run cap that has been reached, if one has."""
        budget = self.request.budget
        if budget.run_tokens is not None and self.spend.tokens >= budget.run_tokens:
            return budget_note("run", "token", self.spend.tokens, budget.run_tokens)
        if (
            budget.run_cost_cents is not None
            and self.spend.cents >= budget.run_cost_cents
        ):
            return budget_note(
                "run", "cost", math.ceil(self.spend.cents), budget.run_cost_cents
            )
        return None

    def _cost_left(self, stage: _Spend) -> int | None:
        """What is left of the tighter spend cap, in whole cents, for the gateway to hold."""
        budget = self.request.budget
        left = [
            cap - used
            for cap, used in (
                (budget.stage_cost_cents, stage.cents),
                (budget.run_cost_cents, self.spend.cents),
            )
            if cap is not None
        ]
        return max(0, math.floor(min(left))) if left else None

    # -- rows and the result ------------------------------------------------------------

    def _plan(self, node: WorkflowNode) -> StagePlan:
        """What was resolved for a stage; nothing resolved when the request has no entry."""
        return self.request.stages.get(node.id) or StagePlan()

    def _stop(self, status: str, reason: str) -> None:
        """End the walk: every later stage is not reached. The first reason stands."""
        if self.halt is None:
            self.halt = (status, reason)

    def _identity(self, group: list[WorkflowNode]) -> tuple[str, str]:
        """A row's key and display name.

        Args:
            group: The stages the row stands for.

        Returns:
            The stage's own id and title for one stage; for several, the title's slug (or
            the first id when that is taken or empty) and the title with its count.
        """
        first = group[0]
        if len(group) == 1:
            return first.id, first.title
        slug = "-".join(_SLUG.findall(first.title.lower()))[:64].strip("-")
        taken = {row.stage_key for row in self.rows} | {
            n.id for n in self.document.nodes
        }
        key = slug if slug and slug not in taken - {first.id} else first.id
        return key, f"{first.title} {TIMES}{len(group)}"

    def _started(self, group: list[WorkflowNode]) -> StageStarted:
        """The event for a row that has begun."""
        key, name = self._identity(group)
        return StageStarted(seq=len(self.rows) + 1, stage_key=key, display_name=name)

    def _row(
        self,
        group: list[WorkflowNode],
        verdict: StageVerdict,
        how: StageHow,
        note: str,
        *,
        metrics: dict[str, Any] | None = None,
        skip_reason: str | None = None,
        began: datetime | None = None,
    ) -> StageFinished:
        """Record a row and make its event.

        Args:
            group: The stages it stands for.
            verdict: What happened.
            how: How the result was produced.
            note: Its note line.
            metrics: Its metrics.
            skip_reason: Why it was skipped.
            began: When work on it began; ``None`` for a row no work was done for.

        Returns:
            The ``stage_finished`` event.
        """
        key, name = self._identity(group)
        row = StageResult(
            seq=len(self.rows) + 1,
            stage_key=key,
            display_name=name,
            nodes=[node.id for node in group],
            verdict=verdict,
            how=how,
            note=note,
            metrics=metrics or {},
            skip_reason=skip_reason,
            started_at=began,
            finished_at=None if began is None else self.clock(),
        )
        self.rows.append(row)
        return StageFinished(stage=row)

    def _result(self) -> DryRunResult:
        """Assemble the whole result.

        Returns:
            The result, ``failed`` whenever the guard audit is not empty.
        """
        status, reason = self.halt or ("complete", None)
        if not self.audit.clean:
            blocked = (
                f"the tool boundary refused {plural(len(self.audit), 'call')}; a dry run "
                "whose guards had to hold is not trusted"
            )
            status, reason = (
                "failed",
                blocked if reason is None else f"{blocked}; {reason}",
            )

        try:
            artifacts = self._artifacts()
        except WorkspaceError as unreadable:
            artifacts = []
            status = "failed"
            reason = reason or f"the repository could not be read: {unreadable.message}"

        return DryRunResult(
            dry_run=self.request.dry_run,
            status=status,  # type: ignore[arg-type]
            failure_reason=reason,
            stages=self.rows,
            artifacts=artifacts,
            guard_audit=self.audit.entries(),
            guards_clean=self.audit.clean,
            tokens=self.spend.tokens,
            cost_cents=math.ceil(self.spend.cents) if self.spend.priced else None,
            duration_ms=_elapsed(self.started, self.clock()),
            workspace_notes=list(self.workspace.notes),
            fetches=self.workspace.fetches,
        )

    def _artifacts(self) -> list[DryRunArtifact]:
        """Build the artifacts: the overlay diff, and excerpts of the plan and the reviews.

        Returns:
            The artifacts that have content.
        """
        artifacts: list[DryRunArtifact] = []
        diff = self.workspace.diff()
        if diff:
            artifacts.append(
                _artifact(
                    "overlay_diff",
                    diff,
                    [
                        PathChange(path=path, added=added, removed=removed)
                        for path, added, removed in self.workspace.line_counts()
                    ],
                )
            )
        plan = "\n\n".join(
            f"{node.title}\n"
            + "\n".join(f"{n}. {s}" for n, s in enumerate(report.steps, 1))
            for node, report in self.reports
            if report.steps
        )
        if plan:
            artifacts.append(_artifact("plan_excerpt", plan[:MAX_EXCERPT], []))
        reviews = "\n\n".join(
            f"{node.id}: {report.verdict}"
            + (f"\n{report.summary}" if report.summary else "")
            + "".join(f"\n- {nit.kind or 'nit'}: {nit.text}" for nit in report.nits)
            for node, report in self.reports
            if report.verdict is not None
        )
        if reviews:
            artifacts.append(_artifact("review_excerpt", reviews[:MAX_EXCERPT], []))
        return artifacts


def _recap(node: WorkflowNode, report: StageReport) -> str:
    """Tell a later stage what an earlier one concluded.

    Args:
        node: The earlier stage.
        report: What it handed in.

    Returns:
        A short block: its summary, steps, files and verdict, whichever it gave.
    """
    lines = [f"## {node.title} ({node.id})"]
    if report.summary:
        lines.append(report.summary)
    lines.extend(f"{number}. {step}" for number, step in enumerate(report.steps, 1))
    if report.would_touch:
        lines.append("Would touch: " + ", ".join(report.would_touch))
    if report.verdict is not None:
        lines.append(f"Verdict: {report.verdict}")
    lines.extend(f"- {nit.kind or 'nit'}: {nit.text}" for nit in report.nits)
    return "\n".join(lines)


def _artifact(kind: str, content: str, summary: list[PathChange]) -> DryRunArtifact:
    """Bound an artifact to V111's size, saying so when it is cut.

    Args:
        kind: Which artifact.
        content: Its whole text.
        summary: Per-file counts, for a diff.

    Returns:
        The artifact: whole, or cut at the last line that fits with ``truncated`` set and
        ``original_bytes`` the size it had.
    """
    raw = content.encode("utf-8")
    if len(raw) <= MAX_ARTIFACT_BYTES:
        kept = content
    else:
        cut = raw[:MAX_ARTIFACT_BYTES].decode("utf-8", errors="ignore")
        kept = cut[: cut.rfind("\n") + 1] or cut
    return DryRunArtifact(
        kind=kind,  # type: ignore[arg-type]
        content=kept,
        truncated=len(raw) > MAX_ARTIFACT_BYTES,
        original_bytes=len(raw),
        path_summary=summary,
    )


def _lower(*caps: int | None) -> int | None:
    """The lowest of the caps that are set, or ``None`` when none is."""
    present = [cap for cap in caps if cap is not None]
    return min(present) if present else None


def _elapsed(start: datetime, end: datetime) -> int:
    """Whole milliseconds between two instants, never negative."""
    return max(0, round((end - start).total_seconds() * 1000))
