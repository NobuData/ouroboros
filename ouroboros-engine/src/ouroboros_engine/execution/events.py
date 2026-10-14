"""The stage-execution event vocabulary — five kinds, and nothing else.

DH.1 (`#1302 <https://github.com/NobuData/ouroboros/issues/1302>`_). Every executor, native
or harness, reports a stage attempt as a stream of these, and
:mod:`~ouroboros_engine.execution.ingest` maps each onto AP.1's run-ingestion contract
(`#303 <https://github.com/NobuData/ouroboros/issues/303>`_):

============== ============================================================================
kind           AP.1
============== ============================================================================
model_turn     a transcript entry, actor ``model``, with ``model_id`` — provenance required
tool_request   a transcript entry, actor ``tool``, ``tool_tag`` the tool
tool_result    a transcript entry, actor ``tool``, carrying the policy's verdict
file_change    a file of the whole change-set (``PUT /files``), which AP.3 judges
usage          an attributed spend (``POST /resources``)
============== ============================================================================

**An executor that cannot observe a real event emits nothing** (#315's provenance rule). A
model turn is text a model returned, never a summary, a narration or reasoning the executor
composed; a harness that does not expose a model's text emits usage and tool events only.
There is no ``reasoning``, ``status`` or ``note`` kind to put such text in, and the
conformance kit fails an executor that emits anything outside :data:`EVENT_TYPES`.
"""

from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from ouroboros_engine.control_plane.ingest import FileStatus
from ouroboros_engine.execution.policy import ToolName, ToolRequest, ToolVerdict

#: Stage keys are DSL node ids — AP.1's grammar.
StageKey = Annotated[
    str, Field(min_length=1, max_length=64, pattern=r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
]


class _Event(BaseModel):
    """What every event carries.

    Attributes:
        seq: The executor's own monotonic number for this stage attempt, from 1. It becomes
            AP.1's ordering ``hint``; the store allocates the real sequence.
        stage_key: The stage.
        attempt: The attempt, from 1.
        ts: When it happened, ISO 8601.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    seq: int = Field(ge=1, le=2_147_483_647)
    stage_key: StageKey
    attempt: int = Field(ge=1, le=11)
    ts: str = Field(min_length=1)


class ModelTurn(_Event):
    """Text a model returned.

    Attributes:
        model_id: The model that said it — never an alias, never absent.
        text: What it said, verbatim.
    """

    kind: Literal["model_turn"] = "model_turn"
    model_id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)


class ToolRequestEvent(_Event):
    """A tool call the model asked for, before the policy has answered.

    Attributes:
        request: The call, in the executor-neutral vocabulary the policy reads.
    """

    kind: Literal["tool_request"] = "tool_request"
    request: ToolRequest


class ToolResultEvent(_Event):
    """What became of a tool call: the verdict and, when it ran, the outcome.

    Attributes:
        call_id: The request's ``call_id``.
        tool: The request's tool.
        verdict: The policy's answer. A ``deny`` means the tool did not run.
        ok: Whether the tool ran and succeeded. Always ``False`` after a ``deny``.
        output: What the tool returned, when it ran — truncated by the mapping, not here.
    """

    kind: Literal["tool_result"] = "tool_result"
    call_id: str = Field(min_length=1, max_length=200)
    tool: ToolName
    verdict: ToolVerdict
    ok: bool
    output: str | None = None


class FileChange(_Event):
    """A file the stage changed in its working tree.

    Attributes:
        path: Working-tree-relative, forward slashes.
        status: git's word for what happened to it.
        additions: Lines added, when known.
        deletions: Lines removed, when known.
    """

    kind: Literal["file_change"] = "file_change"
    path: str = Field(min_length=1, max_length=1024)
    status: FileStatus
    additions: int | None = Field(default=None, ge=0)
    deletions: int | None = Field(default=None, ge=0)


class Usage(_Event):
    """Tokens one model call spent.

    Attributes:
        provider: The provider kind that answered.
        model: The model id that answered.
        tokens_in: Tokens sent.
        tokens_out: Tokens received.
        latency_ms: How long the call took, when known.
    """

    kind: Literal["usage"] = "usage"
    provider: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=200)
    tokens_in: int = Field(ge=0)
    tokens_out: int = Field(ge=0)
    latency_ms: int | None = Field(default=None, ge=0)


#: One event of the vocabulary, discriminated by ``kind``.
StageEvent = Annotated[
    ModelTurn | ToolRequestEvent | ToolResultEvent | FileChange | Usage,
    Field(discriminator="kind"),
]

#: The vocabulary's classes. Anything else an executor yields is outside it.
EVENT_TYPES: Final[tuple[type[_Event], ...]] = (
    ModelTurn,
    ToolRequestEvent,
    ToolResultEvent,
    FileChange,
    Usage,
)

#: The vocabulary's kinds, in the order the module table lists them.
EVENT_KINDS: Final[tuple[str, ...]] = (
    "model_turn",
    "tool_request",
    "tool_result",
    "file_change",
    "usage",
)
