"""The contract of ``POST /v0/skills/run`` (CM.5, #624).

A **skill** is a procedure kept in the Knowledge registry (BE.1, #405): versioned text a
workspace can read and change. ``ouroboros-rest`` sends the body of the version it resolved
and the input the procedure works on; the engine asks a model to follow it and answers with
a **validated** result — never with the model's prose.

Two outputs exist, one per pipeline skill:

``roadmap``
    ``create-roadmap`` — milestones with target dates, and items with an MVP flag and an
    effort. Keys are the caller's handles: a re-run is told the keys of the version before
    it and keeps them for items that survive, which is how an item keeps its draft and its
    issue across versions.

``issue_bodies``
    ``create-issues`` — one description per roadmap item, keyed by the item.

The shapes are deliberately the document's own (``roadmap_doc_versions.structure``, V113)
minus the references only ``ouroboros-rest`` can know — drafts, tickets and checked state.
"""

from __future__ import annotations

import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: The model produced nothing — the gateway refused, or every hop of the chain failed.
SKILL_MODEL_FAILED = "skill_model_failed"

#: The model answered, twice, with something that is not the output asked for.
SKILL_OUTPUT_INVALID = "skill_output_invalid"

#: A key, as V113 stores it: lower-case, at most 32 characters.
KEY_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,31}$"

#: A skill slug, as V069 stores it.
SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"

#: The largest input a run accepts, as JSON text. The brief export is the bulk of it.
MAX_INPUT_BYTES = 1_048_576

SkillOutput = Literal["roadmap", "issue_bodies"]

Effort = Literal["xs", "s", "m", "l", "xl"]


class _Strict(BaseModel):
    """A wire model that refuses a field it does not declare."""

    model_config = ConfigDict(extra="forbid")


class SkillRef(_Strict):
    """The skill version to follow.

    Attributes:
        slug: Its registry slug — ``create-roadmap``.
        version: The published version resolved by the caller.
        body: The procedure text of that version.
    """

    slug: str = Field(pattern=SLUG_PATTERN, max_length=64)
    version: int = Field(ge=1)
    body: str = Field(min_length=1, max_length=200_000)


class SkillRunRequest(_Strict):
    """One run of one skill.

    Attributes:
        run: What the model calls are attributed to — the roadmap document's id.
        skill: The skill version to follow.
        output: Which validated shape to answer with.
        input: What the procedure works on, as an object.
        alias: The routing alias the calls go through.
        resolution_version: The resolution the alias came from, when known.
        cost_cap_cents: The most the run may spend, or ``None`` for no cap.
    """

    run: str = Field(min_length=1, max_length=200)
    skill: SkillRef
    output: SkillOutput
    input: dict[str, Any]
    alias: str = Field(min_length=1, max_length=200)
    resolution_version: str | None = Field(default=None, max_length=200)
    cost_cap_cents: int | None = Field(default=None, ge=0)


class RoadmapItem(_Strict):
    """One item of a milestone.

    Attributes:
        key: Its handle — kept across re-runs for an item that survives.
        title: What will be built.
        mvp: Whether it is in the MVP set.
        effort: The procedure's effort guess, or ``None``.
    """

    key: str = Field(pattern=KEY_PATTERN)
    title: str = Field(min_length=1, max_length=512)
    mvp: bool
    effort: Effort | None = None

    @model_validator(mode="after")
    def _title_is_not_blank(self) -> RoadmapItem:
        if not self.title.strip():
            raise ValueError("an item needs a title")
        return self


class RoadmapMilestone(_Strict):
    """One milestone.

    Attributes:
        key: Its handle.
        name: Its name — ``Docking parity``.
        target_date: The date it is due, or ``None``.
        items: Its items, in order.
    """

    key: str = Field(pattern=KEY_PATTERN)
    name: str = Field(min_length=1, max_length=200)
    target_date: datetime.date | None = None
    items: list[RoadmapItem] = Field(max_length=500)

    @model_validator(mode="after")
    def _name_is_not_blank(self) -> RoadmapMilestone:
        if not self.name.strip():
            raise ValueError("a milestone needs a name")
        return self


class Roadmap(_Strict):
    """A roadmap, as ``create-roadmap`` answers it.

    Attributes:
        title: The document's title.
        milestones: One to fifty milestones; keys unique among milestones and among items.
    """

    title: str = Field(min_length=1, max_length=200)
    milestones: list[RoadmapMilestone] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _keys_are_unique(self) -> Roadmap:
        if not self.title.strip():
            raise ValueError("a roadmap needs a title")
        milestones = [milestone.key for milestone in self.milestones]
        if len(set(milestones)) != len(milestones):
            raise ValueError("milestone keys must be unique")
        items = [item.key for milestone in self.milestones for item in milestone.items]
        if len(set(items)) != len(items):
            raise ValueError("item keys must be unique across the roadmap")
        if len(items) > 500:
            raise ValueError("a roadmap holds at most 500 items")
        return self


class IssueBody(_Strict):
    """The description of one item's issue.

    Attributes:
        key: The roadmap item it describes.
        body: The issue description, in Markdown.
    """

    key: str = Field(pattern=KEY_PATTERN)
    body: str = Field(min_length=1, max_length=60_000)


class SkillUsage(_Strict):
    """What one hop of one model call consumed.

    Attributes:
        hop: The hop of the resolved chain.
        connection: The provider connection.
        model: The model.
        input_tokens: Tokens sent.
        output_tokens: Tokens received.
        cost_cents: What it cost, or ``None`` when unpriced.
    """

    hop: int
    connection: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_cents: float | None = None


class SkillRunResult(_Strict):
    """What a run produced.

    Attributes:
        skill: The skill's slug.
        version: The version that was followed.
        output: Which shape was asked for.
        roadmap: The roadmap, for ``output: roadmap``; else ``None``.
        issues: One body per item, for ``output: issue_bodies``; else ``None``.
        attempts: How many model answers it took — ``2`` when the first did not validate.
        usage: What every call consumed.
    """

    skill: str
    version: int
    output: SkillOutput
    roadmap: Roadmap | None = None
    issues: list[IssueBody] | None = None
    attempts: int = Field(ge=1)
    usage: list[SkillUsage] = Field(default_factory=list)
