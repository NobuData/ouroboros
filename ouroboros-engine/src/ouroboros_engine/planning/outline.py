"""The outline parser — markdown structure in, ticket-shaped items out.

AL.1 (`#277 <https://github.com/NobuData/ouroboros/issues/277>`_). This module is the half
of planner v0 that reads, and it deliberately knows nothing about the contract it will be
turned into: it takes text and answers with what was *written down*, and
:mod:`ouroboros_engine.planning.outline_planner` decides what that means. The split is
:mod:`ouroboros_engine.estimation.signals`' — the rules a reviewer can argue with a line at
a time, kept apart from the arithmetic that combines them.

**Why an outline is worth parsing at all.** Decision **N2**'s claim is that a markdown
outline is a real way to plan work — reviewable, diffable, and the same batch every time —
rather than a placeholder for a model. That claim only holds if the rules are few enough to
keep in your head, so there are five:

======================================  ==================================================
what you write                          what it becomes
======================================  ==================================================
a top-level bullet                      a ticket
anything indented under it              that ticket's body, nesting preserved
``blocks: KEY`` / ``after: KEY``        a dependency edge
a numbered list                         a sequence — each item after the one before it
``[marker]``                            a workflow-tag hint
======================================  ==================================================

**Top-level is measured, not assumed.** The shallowest bullet in the document is the ticket
level, so an outline pasted with two spaces of leading indent — out of a textarea, a YAML
block, an email — parses the same as one written flush left. Anything deeper is body detail
for the bullet above it.

**Nothing is read that was not written.** An unordered list is a *set*: its bullets get no
dependencies unless an annotation says so, because the order somebody typed tasks in is not
a claim that one blocks another. A **numbered** list is the one place sequencing is inferred,
and only because writing ``1. 2. 3.`` is itself the statement that there is an order. That
asymmetry is the whole honesty argument of this parser, and the planner discloses the edges
it drew from it in a note rather than letting them appear from nowhere.

**Nothing is silently dropped, either.** Lines before the first bullet come back as
:attr:`Outline.preamble` and annotations found on a nested line come back as
:attr:`Outline.stray_annotations` — not because this module does anything with them, but so
the planner can *say* it saw them. A parser that quietly ignores half of what it was handed
is one nobody can debug.

Deterministic by construction: no clock, no randomness, no environment, no I/O, and no
iteration over anything unordered. ``tests/test_planning_planner.py`` asserts that by
reading this module's imports, which is cheaper to notice than a batch that re-drafted
differently for no reason.
"""

import re
from dataclasses import dataclass

#: How wide a tab is when one shows up in an outline. Expanded before anything is measured,
#: so indentation means the same thing whichever key the author pressed.
TAB_WIDTH = 4

#: A list item: optional indent, a bullet or a number, whitespace, then text. The text must
#: be non-empty — ``-`` alone on a line is a blank list item, not a ticket with no name.
_BULLET = re.compile(
    r"^(?P<indent>[ ]*)(?P<marker>[-*+]|\d{1,3}[.)])[ ]+(?P<text>\S.*)$"
)

#: A bullet whose marker is a number, which is what makes a list a *sequence*.
_ORDERED_MARKER = re.compile(r"^\d")

#: ``blocks: OTA-3`` or ``after: OTA-1, OTA-2``. Case-insensitive because it is prose
#: somebody typed, and comma-separated because one bullet can block two others.
_ANNOTATION = re.compile(
    r"(?P<keyword>blocks|after)[ ]*:[ ]*"
    r"(?P<keys>[A-Za-z][A-Za-z0-9]*-\d+(?:[ ]*,[ ]*[A-Za-z][A-Za-z0-9]*-\d+)*)",
    re.IGNORECASE,
)

#: One local key inside an annotation's key list.
_KEY = re.compile(r"[A-Za-z][A-Za-z0-9]*-\d+")

#: A bracketed workflow hint — ``[docs]``, ``[hil-verify]``. The charset is deliberately
#: narrow and a following ``(`` is excluded, so a markdown link's ``[text](url)`` is left
#: alone rather than read as a marker nobody meant.
_MARKER = re.compile(r"\[(?P<marker>[A-Za-z0-9][A-Za-z0-9-]*)\](?!\()")


@dataclass(frozen=True, slots=True)
class OutlineItem:
    """One top-level bullet — everything the parser read off it, and nothing more."""

    #: The bullet's text with its annotations and markers removed, whitespace collapsed.
    #: May be empty, for a bullet that was *only* an annotation or a marker; deciding what
    #: to do about that is the planner's, not this module's.
    title: str
    #: Every line indented under the bullet, in document order, with the outline's common
    #: indent removed so relative nesting survives into the body.
    detail: tuple[str, ...]
    #: Local keys this item blocks, upper-cased, first mention first.
    blocks: tuple[str, ...]
    #: Local keys this item comes after, upper-cased, first mention first.
    after: tuple[str, ...]
    #: Bracketed markers on the bullet's own line, lower-cased, in the order written.
    markers: tuple[str, ...]
    #: Whether the bullet was numbered — the one signal that implies sequencing.
    ordered: bool
    #: Its 1-based position among the top-level bullets.
    ordinal: int


@dataclass(frozen=True, slots=True)
class Outline:
    """What one outline document turned out to contain."""

    #: The top-level bullets, in document order. Empty for a document with no list in it,
    #: which is the narrative-only case the contract degrades for.
    items: tuple[OutlineItem, ...]
    #: Non-blank lines that appeared before the first bullet. Returned rather than dropped
    #: so the planner can say they were not turned into tickets.
    preamble: tuple[str, ...]
    #: Detail lines carrying what looks like a ``blocks:``/``after:`` annotation. They are
    #: body text — annotations are read from a bullet's own line — and they are reported so
    #: an author who put one in the wrong place is told rather than left wondering where
    #: their edge went.
    stray_annotations: tuple[str, ...]


def _unique(values: list[str]) -> tuple[str, ...]:
    """Drop repeats while keeping the order they were written in.

    Args:
        values: The values, in document order.

    Returns:
        The same values, first mention first, each appearing once. Order-preserving rather
        than a ``set`` because every tuple this module returns has to be reproducible, and
        a set's iteration order is not something to build a contract on.
    """
    return tuple(dict.fromkeys(values))


def _annotations(text: str) -> tuple[tuple[str, ...], tuple[str, ...], str]:
    """Read the dependency annotations off a bullet's line and take them out of it.

    Args:
        text: The bullet's text.

    Returns:
        The keys it blocks, the keys it comes after, and the text with every annotation
        removed — so an annotation never ends up in the title it was written beside.
    """
    blocks: list[str] = []
    after: list[str] = []

    for match in _ANNOTATION.finditer(text):
        keys = [key.upper() for key in _KEY.findall(match.group("keys"))]
        if match.group("keyword").lower() == "blocks":
            blocks.extend(keys)
        else:
            after.extend(keys)

    return _unique(blocks), _unique(after), _ANNOTATION.sub(" ", text)


def _markers(text: str) -> tuple[tuple[str, ...], str]:
    """Read the bracketed workflow hints off a bullet's line and take them out of it.

    Args:
        text: The bullet's text, annotations already removed.

    Returns:
        The markers, lower-cased and in the order written, and the text without them.
    """
    found = [match.group("marker").lower() for match in _MARKER.finditer(text)]
    return _unique(found), _MARKER.sub(" ", text)


def _normalise_detail(lines: list[str]) -> tuple[str, ...]:
    """Pull one bullet's detail lines back to the left, keeping their relative nesting.

    The block is dedented by *its own* shallowest line rather than by the outline's top
    level. Both would preserve nesting, and this one also puts the first level of detail
    flush against the margin — which matters because the result becomes a ticket body, and
    a body that opens with two stray spaces is one somebody has to tidy after the push.

    Args:
        lines: The detail lines, right-stripped, in document order.

    Returns:
        The lines with their common indent removed. A line nested one level deeper than its
        siblings keeps exactly that one level.
    """
    if not lines:
        return ()

    common = min(len(line) - len(line.lstrip(" ")) for line in lines)
    return tuple(line[common:] for line in lines)


def parse_outline(text: str) -> Outline:
    """Read one markdown outline.

    Args:
        text: The outline as the caller sent it. Empty or whitespace-only is a valid
            argument and answers with an empty :class:`Outline` — the caller that sent no
            outline and the caller that sent a blank one are the same case, and the planner
            treats them the same way.

    Returns:
        The :class:`Outline`: its top-level bullets with the detail, annotations and markers
        attached to each, plus whatever was seen but not turned into an item.
    """
    lines = text.expandtabs(TAB_WIDTH).splitlines()
    bullets = [match for line in lines if (match := _BULLET.match(line)) is not None]

    if not bullets:
        # No list at all. Every non-blank line is preamble, which is what lets the planner
        # say "there was prose here and none of it became a ticket" rather than answering
        # as though the request had been empty.
        preamble = tuple(line.strip() for line in lines if line.strip())
        return Outline(items=(), preamble=preamble, stray_annotations=())

    # The shallowest bullet is the ticket level — measured rather than assumed, so a
    # uniformly indented outline parses like a flush-left one.
    common = min(len(match.group("indent")) for match in bullets)

    items: list[OutlineItem] = []
    preamble: list[str] = []
    stray: list[str] = []

    # The item being built: its parts, held until the next top-level bullet or the end of
    # the document closes it. A small builder rather than mutating a frozen dataclass.
    title = ""
    detail: list[str] = []
    blocks: tuple[str, ...] = ()
    after: tuple[str, ...] = ()
    markers: tuple[str, ...] = ()
    ordered = False
    open_item = False

    def close() -> None:
        """Turn the parts held above into an item, if one is open."""
        if open_item:
            items.append(
                OutlineItem(
                    title=title,
                    detail=_normalise_detail(detail),
                    blocks=blocks,
                    after=after,
                    markers=markers,
                    ordered=ordered,
                    ordinal=len(items) + 1,
                )
            )

    for line in lines:
        if not line.strip():
            continue

        match = _BULLET.match(line)

        if match is not None and len(match.group("indent")) == common:
            close()
            raw = match.group("text").strip()
            blocks, after, remainder = _annotations(raw)
            markers, remainder = _markers(remainder)
            title = " ".join(remainder.split())
            detail = []
            ordered = _ORDERED_MARKER.match(match.group("marker")) is not None
            open_item = True
            continue

        if not open_item:
            preamble.append(line.strip())
            continue

        piece = line.rstrip()
        if _ANNOTATION.search(piece) is not None:
            # Body text, by the rule above — and reported, so the author finds out rather
            # than wondering why the edge they wrote never appeared.
            stray.append(piece.strip())
        detail.append(piece)

    close()

    return Outline(
        items=tuple(items),
        preamble=tuple(preamble),
        stray_annotations=tuple(stray),
    )
