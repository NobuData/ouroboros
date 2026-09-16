"""``outline-v0`` — real batches from a real outline, and one honest draft without one.

AL.1 (`#277 <https://github.com/NobuData/ouroboros/issues/277>`_), and the whole of its
argument is in the name it writes into every plan. The planning page needs to work before
the provider stack exists (decision **N2**), and a deterministic parser over a markdown
outline is enough to make it work — **provided it never masquerades as a planner that
understood anything.** So the provenance is ``outline-v0``, unconditionally and from one
constant; a narrative with no outline gets **one** draft and a note saying why, never five
plausible-sounding inventions; and every edge that was inferred rather than written is
disclosed in :attr:`~ouroboros_engine.planning.contract.Plan.notes`.

:mod:`ouroboros_engine.planning.outline` is the reading; this module is the deciding. What
it decides, and the rule behind each:

=========================  ===================================================================
answer                     reached from
=========================  ===================================================================
``local_key``              position in the batch, never content — so the same input re-keys
                           identically and a re-draft can be diffed against the last one
``title``                  the bullet's own text, annotations and markers removed
``body``                   everything indented under the bullet, nesting preserved
``dependencies``           ``blocks:``/``after:`` annotations, plus numbered-list sequencing
``suggested_workflow``     a bracketed marker matched against the caller's tags
``notes``                  every case where this planner did less than the page implies
=========================  ===================================================================

**The planner invents no vocabulary.** Decision **K5** puts the workflow tags in the
caller's request, and this planner only ever *matches*: a marker that is one of the tags
wins, a marker that is a word inside one of them resolves to it, and a marker that is
neither is **ignored and named in a note** rather than turned into a tag nobody has.
:func:`ouroboros_engine.planning.planner.honours_context` makes that structural rather than
remembered, and it runs on every batch this class produces.

**A draft with no marker takes the first tag the caller offered.** Not a default this
service holds — it holds no list of tags and could not have one — but the caller's own
first choice, which is the only ranking available to something that ascribes no meaning to
a tag. It is the same fall-through the heuristic estimator makes for the same reason, and it
is why :attr:`~ouroboros_engine.planning.contract.PlanningContext.workflow_tags` is
documented as an ordered field rather than a set.

**Sequencing is disclosed, not assumed.** An unordered list is a set of tasks and gets no
edges it was not given. A *numbered* list is somebody writing down an order, so each item
depends on the one before it — and the plan says so in a note, because an edge that appears
without having been typed is exactly the kind of thing this staging exists not to do.

**What is not written down is not invented, but it is reported.** An annotation naming a key
that is not in the batch, a marker nobody has, a ``blocks:`` on a nested line, prose before
the first bullet, a bullet with no text: each is ignored and each produces a note. A parser
that silently drops half its input is one nobody can debug, and the page has a designed
place to render these (AM.2, `#284 <https://github.com/NobuData/ouroboros/issues/284>`_).

**Deterministic by construction.** No clock, no randomness, no environment, no I/O, and no
iteration over anything unordered — notes are emitted in a fixed order and every set is
sorted before it is read. ``tests/test_planning_planner.py`` asserts it over the fixture
batches and by reading this module's imports.
"""

from ouroboros_engine.planning.contract import (
    MAX_BODY_LENGTH,
    MAX_TITLE_LENGTH,
    Draft,
    Plan,
    PlanningContext,
    PlanRequest,
)
from ouroboros_engine.planning.outline import Outline, OutlineItem, parse_outline

#: This planner's name, and the value of ``planner`` in every batch it produces. Decision
#: **K10**: provenance is recorded unconditionally, so a deployment that thinks it has the
#: LLM planner finds out here which one it actually has.
OUTLINE_PLANNER = "outline-v0"

#: What a caller is told when they sent a narrative and no structure. The page renders it as
#: guidance beside the single draft (AM.2), which is the designed form of *this is as far as
#: v0 can honestly go*.
NARRATIVE_ONLY_NOTE = (
    "Add a structured outline to split this into multiple tickets, or wait for the "
    "full planner."
)

#: What a caller is told when they sent something under `outline` that held no usable list.
#: It is a different failure from sending none at all — there was structure-shaped text and
#: none of it named a ticket — so it is a different sentence.
NO_BULLETS_NOTE = (
    "The outline held no usable list items, so it could not be split. A ticket is a "
    "line beginning with `-`, `*` or `1.`, followed by its title."
)

#: What a caller is told when edges were drawn from a numbered list rather than written.
SEQUENCE_NOTE = (
    "Numbered items are read as a sequence: each depends on the one before it. Use "
    "`-` bullets for work that can run in parallel."
)

#: The ellipsis a title too long for the contract's bound ends in. The full line survives as
#: the body's first line, so nothing is actually lost.
_ELLIPSIS = "…"


def _truncate(text: str, limit: int) -> str:
    """Hold text to a bound, marking it where it was cut.

    Args:
        text: The text.
        limit: The longest it may be.

    Returns:
        The text unchanged when it fits, and otherwise its first ``limit - 1`` characters
        with an ellipsis. Marked rather than silently shortened: a title ending mid-word is
        something a reviewer should be able to see happened.
    """
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + _ELLIPSIS


def _resolve_workflow(
    markers: tuple[str, ...], context: PlanningContext
) -> tuple[str, list[str]]:
    """Choose a workflow tag for one draft from the markers written beside it.

    Two ways a marker matches, tried in this order for each marker in turn: it *is* one of
    the caller's tags (``[hil-verify]`` against ``hil-verify``), or it is one of the
    hyphen-separated words in one (``[docs]`` against ``docs-loop``). The first marker that
    resolves wins; ties within the second rule go to the caller's own tag order, which is
    the only ranking this service has.

    Args:
        markers: The bracketed markers on the bullet, lower-cased and in written order.
        context: The vocabulary the caller offered.

    Returns:
        The tag to suggest, and every marker that matched nothing. The tag is the caller's
        first when no marker resolved — see the module docstring for why that is the caller's
        default rather than this service's.
    """
    unknown: list[str] = []

    for marker in markers:
        if marker in context.workflow_tags:
            return marker, unknown

        segmented = [tag for tag in context.workflow_tags if marker in tag.split("-")]
        if segmented:
            return segmented[0], unknown

        unknown.append(marker)

    return context.workflow_tags[0], unknown


def _body_for(item: OutlineItem, title: str) -> str:
    """Build one draft's body from the lines indented under its bullet.

    Args:
        item: The outline item.
        title: The title as it will be sent, which may have been truncated.

    Returns:
        The detail lines joined as written, held to the contract's bound. When the title was
        truncated the bullet's full text leads the body, so the whole line is still readable
        somewhere. Empty when the bullet had no detail and its title fitted — an honest
        nothing, rather than a paragraph restating the title.
    """
    lines: list[str] = []
    if title != item.title:
        lines.append(item.title)
    lines.extend(item.detail)
    return _truncate("\n".join(lines), MAX_BODY_LENGTH)


def _dependency_order(keys: set[str], batch: list[str]) -> list[str]:
    """Put a draft's dependencies into the batch's own order.

    Args:
        keys: The keys the draft depends on.
        batch: Every key in the batch, in batch order.

    Returns:
        The dependencies sorted by their position in the batch. Sorted by position rather
        than alphabetically because ``OTA-10`` sorts before ``OTA-2`` as text, and a list
        that reads out of order is one a reviewer distrusts.
    """
    return [key for key in batch if key in keys]


def _has_cycle(edges: dict[str, set[str]], batch: list[str]) -> bool:
    """Say whether the dependency graph closes a loop.

    Args:
        edges: Each key's dependencies.
        batch: Every key in the batch, in batch order, which is the order this walks in so
            the answer does not depend on a set's iteration.

    Returns:
        ``True`` when some draft depends on itself through any chain. The batch is returned
        either way — the author wrote these edges and this planner does not silently redraw
        them — but a note says so, which is a better place to find out than AK.2's constraint
        during a push.
    """
    # Three-colour depth-first search: `visiting` is the current stack, `visited` is
    # everything already cleared. Iterative rather than recursive, because a 200-draft chain
    # is within the contract's bounds and Python's stack is not the place to discover that.
    visited: set[str] = set()

    for root in batch:
        if root in visited:
            continue

        visiting: set[str] = set()
        stack: list[tuple[str, bool]] = [(root, False)]

        while stack:
            key, leaving = stack.pop()
            if leaving:
                visiting.discard(key)
                visited.add(key)
                continue
            if key in visited:
                continue
            if key in visiting:
                return True

            visiting.add(key)
            stack.append((key, True))
            # Sorted by batch order, so the walk is the same in every process.
            stack.extend(
                (dependency, False)
                for dependency in reversed(
                    _dependency_order(edges.get(key, set()), batch)
                )
            )

    return False


def _single_draft(request: PlanRequest, notes: list[str]) -> Plan:
    """Answer a request that could not be decomposed with one draft and an explanation.

    The narrative becomes one ticket: its first line is the title, the whole of it is the
    body. That is the honest reading of *somebody described an outcome and gave no
    structure* — it is one piece of work until somebody says how it divides.

    Args:
        request: The validated request.
        notes: The notes to carry, already in order. The caller has decided which of the
            two degradation sentences applies.

    Returns:
        A :class:`~ouroboros_engine.planning.contract.Plan` with exactly one draft.
    """
    narrative = request.narrative.strip()
    # The first non-blank line, collapsed: a narrative is prose and its opening line is the
    # closest thing to a title it contains. Splitting on sentences instead would cut "e.g."
    # in half, which is a rule that fails on the first real paragraph it meets.
    first_line = next(
        (" ".join(line.split()) for line in narrative.splitlines() if line.strip()),
        narrative,
    )
    title = _truncate(first_line, MAX_TITLE_LENGTH)

    return Plan(
        drafts=[
            Draft(
                local_key=f"{request.context.local_key_prefix}-1",
                title=title,
                body=_truncate(narrative, MAX_BODY_LENGTH),
                suggested_workflow=request.context.workflow_tags[0],
                dependencies=[],
            )
        ],
        planner=OUTLINE_PLANNER,
        notes=notes,
    )


class OutlinePlanner:
    """The planner ``create_app`` installs: a markdown outline in, a draft batch out.

    Stateless and deterministic — two instances answer identically, and one instance answers
    the same request identically however many times it is asked. That is what makes a
    *regenerate* that produces a different batch mean something.

    Attributes:
        name: :data:`OUTLINE_PLANNER`, which is what every plan it produces records as its
            provenance.
    """

    name = OUTLINE_PLANNER

    def plan(self, request: PlanRequest) -> Plan:
        """Draft a batch of tickets from the request's outline, or one from its narrative.

        Args:
            request: The validated request.

        Returns:
            The :class:`~ouroboros_engine.planning.contract.Plan`. Either one draft per
            top-level bullet with the dependencies the outline declared, or — when there is
            no outline to read — a single draft carrying the narrative, plus the note that
            says so.
        """
        outline = parse_outline(request.outline or "")

        # A bullet that was only an annotation or a marker has no title, and a ticket with
        # no name is not a ticket. Dropped before keys are assigned, so the batch numbers
        # 1..n with no gaps.
        usable = [item for item in outline.items if item.title]

        if not usable:
            # Narrative-only, the case decision N2 refuses to fake — and the same answer
            # for an outline whose every bullet was empty, because it is the same
            # situation: there is no structure here to divide the work by. Which sentence
            # leads depends on whether anything was sent under `outline` at all.
            sent_something = bool((request.outline or "").strip())
            notes = [NO_BULLETS_NOTE] if sent_something else []
            notes.append(NARRATIVE_ONLY_NOTE)
            return _single_draft(request, notes)

        return self._from_outline(outline, usable, request.context)

    def _from_outline(
        self, outline: Outline, usable: list[OutlineItem], context: PlanningContext
    ) -> Plan:
        """Turn a parsed outline into a batch.

        Args:
            outline: What the parser read, for the parts of it the notes report on.
            usable: Its items that carry a title, which are the ones that become drafts.
            context: The vocabulary, and the prefix the keys carry.

        Returns:
            The plan.
        """
        skipped = len(outline.items) - len(usable)

        keys = [
            f"{context.local_key_prefix}-{position}"
            for position, _ in enumerate(usable, start=1)
        ]
        key_of = dict(zip(keys, usable, strict=True))
        known = set(keys)

        edges: dict[str, set[str]] = {key: set() for key in keys}
        dangling: set[str] = set()
        self_referential: set[str] = set()

        def add_edge(dependent: str, dependency: str) -> None:
            """Record that ``dependent`` is blocked by ``dependency``.

            **Both ends are checked against the batch**, not just one. ``after: X`` names
            the far end and ``blocks: Y`` names the near one, so either annotation can be
            the one pointing at a key that was never drafted — ``blocks: OTA-9`` in a
            six-bullet outline is the ordinary way an author gets this wrong, and it must be
            an ignored edge with a note rather than a failure inside this process.

            Args:
                dependent: The key that is blocked — the end ``blocks:`` names.
                dependency: The key it is blocked by — the end ``after:`` names.
            """
            outside = {key for key in (dependent, dependency) if key not in known}
            if outside:
                dangling.update(outside)
                return
            if dependent == dependency:
                self_referential.add(dependent)
                return
            edges[dependent].add(dependency)

        sequenced = False
        for position, (key, item) in enumerate(zip(keys, usable, strict=True)):
            # `after: X` — this item is blocked by X. `blocks: Y` — Y is blocked by this
            # item. Both directions are written by authors and both mean one edge.
            for dependency in item.after:
                add_edge(key, dependency)
            for dependent in item.blocks:
                add_edge(dependent, key)

            # The one inferred edge, and only from a numbered list. A numbered item
            # following another numbered item is somebody writing down an order.
            if position > 0 and item.ordered and usable[position - 1].ordered:
                add_edge(key, keys[position - 1])
                sequenced = True

        drafts = [
            self._draft(key, key_of[key], context, _dependency_order(edges[key], keys))
            for key in keys
        ]

        return Plan(
            drafts=drafts,
            planner=OUTLINE_PLANNER,
            notes=self._notes(
                outline=outline,
                skipped=skipped,
                sequenced=sequenced,
                dangling=dangling,
                self_referential=self_referential,
                unknown_markers=self._unknown_markers(usable, context),
                cyclic=_has_cycle(edges, keys),
            ),
        )

    def _draft(
        self,
        key: str,
        item: OutlineItem,
        context: PlanningContext,
        dependencies: list[str],
    ) -> Draft:
        """Build one draft from one outline item.

        Args:
            key: The local key this item was assigned by position.
            item: The outline item.
            context: The vocabulary a suggestion may come from.
            dependencies: The keys it is blocked by, already in batch order.

        Returns:
            The :class:`~ouroboros_engine.planning.contract.Draft`.
        """
        title = _truncate(item.title, MAX_TITLE_LENGTH)
        workflow, _ = _resolve_workflow(item.markers, context)

        return Draft(
            local_key=key,
            title=title,
            body=_body_for(item, title),
            suggested_workflow=workflow,
            dependencies=dependencies,
        )

    def _unknown_markers(
        self, items: list[OutlineItem], context: PlanningContext
    ) -> set[str]:
        """Every bracketed marker that matched no tag the caller offered.

        Args:
            items: The usable outline items.
            context: The vocabulary the caller offered.

        Returns:
            The markers, as a set — the note that renders them sorts it, so the answer does
            not depend on iteration order.
        """
        unknown: set[str] = set()
        for item in items:
            _, unmatched = _resolve_workflow(item.markers, context)
            unknown.update(unmatched)
        return unknown

    def _notes(
        self,
        *,
        outline: Outline,
        skipped: int,
        sequenced: bool,
        dangling: set[str],
        self_referential: set[str],
        unknown_markers: set[str],
        cyclic: bool,
    ) -> list[str]:
        """Say everything this planner did less of than the page implies.

        The order is fixed here rather than emerging from the order things were noticed, so
        the same input produces the same notes in the same positions — a plan is compared
        against the last one, and a list that reshuffles is a diff nobody can read.

        Args:
            outline: What the parser read, for the parts it saw and did not use.
            skipped: How many bullets carried no title.
            sequenced: Whether any edge was drawn from a numbered list.
            dangling: Annotation keys that are not in the batch.
            self_referential: Keys whose annotations pointed at themselves.
            unknown_markers: Markers matching no offered tag.
            cyclic: Whether the declared edges close a loop.

        Returns:
            The notes, in a fixed order.
        """
        notes: list[str] = []

        if sequenced:
            notes.append(SEQUENCE_NOTE)

        if dangling:
            names = ", ".join(sorted(dangling))
            notes.append(
                f"Ignored dependency annotations naming keys that are not in this "
                f"batch: {names}. Keys are assigned by position, so the third bullet "
                f"is the third key."
            )

        if self_referential:
            names = ", ".join(sorted(self_referential))
            notes.append(
                f"Ignored dependency annotations pointing a draft at itself: {names}."
            )

        if cyclic:
            notes.append(
                "These dependencies form a cycle. The batch is drafted as written, but "
                "a cycle cannot be pushed to a tracker — remove one of the edges."
            )

        if unknown_markers:
            names = ", ".join(f"[{marker}]" for marker in sorted(unknown_markers))
            notes.append(
                f"Ignored workflow markers that match no workflow this installation "
                f"has: {names}."
            )

        if outline.stray_annotations:
            notes.append(
                f"`blocks:` and `after:` are read from a bullet's own line. "
                f"{len(outline.stray_annotations)} indented line(s) carrying one were "
                f"kept as body text instead."
            )

        if skipped:
            notes.append(
                f"{skipped} bullet(s) had no text once markers and annotations were "
                f"removed, so they were not drafted."
            )

        if outline.preamble:
            notes.append(
                f"{len(outline.preamble)} line(s) before the first bullet are not part "
                f"of any ticket. Describe the outcome in the narrative and keep the "
                f"outline to a list."
            )

        return notes
