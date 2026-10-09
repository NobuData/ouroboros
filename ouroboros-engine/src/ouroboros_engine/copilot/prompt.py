"""The system context, and the payload one turn sends through the gateway.

The payload is what AD.3's contract calls *the model call in the adapter's own vocabulary*,
and the vocabulary chosen here is the neutral one every chat provider maps onto: a ``system``
string and a ``messages`` list of ``{role, content}``. AF.2's adapters translate it per
provider; nothing in the gateway reads it.

**Tool calls travel as fenced blocks in the reply text.** The gateway streams text deltas and
nothing else (``delta`` events), so structure has to be recoverable *from* text: the model writes
a call as

.. code-block:: text

    ```tool
    {"tool": "add_stage", "arguments": {"node": {...}}}
    ```

and :mod:`.parser` recovers it as it streams. One block per call, prose around it as the model
pleases. This is the whole of what *structured output* means on this side of the gateway.

**The rules the prompt states are the rules ``ouroboros-rest`` enforces.** Saying *only typed
operations change the draft* does not make it so; the manifest having no other write does. The
prompt says it anyway, because a model told the rule bounces less.
"""

from __future__ import annotations

import json
from typing import Any

from ouroboros_engine.copilot.contract import (
    CopilotContext,
    CopilotTurn,
    CopilotTurnRequest,
    ToolResultTurn,
    UserTurn,
)
from ouroboros_engine.copilot.tools import ASK_USER, manifest_text

#: The fence that opens a tool call in the reply text.
TOOL_FENCE_OPEN = "```tool"

#: The fence that closes one.
TOOL_FENCE_CLOSE = "```"

#: What one turn may write, at most. Generous for a reply with several operations; far below
#: anything a runaway loop would want.
MAX_OUTPUT_TOKENS = 4_096

_RULES = f"""You are the Workflow Copilot for Ouroboros. You help a person author a workflow \
by editing a shared draft that the visual canvas and the code editor also edit.

Rules:
1. The ONLY way to change the draft is a tool call from the manifest below. Never write the \
document out in prose or as code; propose operations. Each operation is validated before it is \
applied, and an invalid one comes back to you as a tool result with the validator's message — \
read it and correct the operation.
2. Reference what exists. The stage catalog, the skills and the task routes below are what this \
workspace has. You MAY propose a stage kind, skill or task that does not exist yet when the \
person's intent needs it, but then you MUST say plainly that it does not exist yet and that the \
draft will carry an unresolved-reference warning until it does. Never imply it will run.
3. When a choice is the person's to make, call {ASK_USER} with two to six short options \
instead of guessing. After asking, stop and wait for the answer.
4. A guard proposed with set_guard is a proposal: the workflow language has no guard construct \
yet. Say so when you propose one.
5. Keep replies short and concrete: what you drafted, what you invented, what you need to know.
6. To call a tool, write a fenced block exactly like this, one per call, with nothing else \
inside the fences:

{TOOL_FENCE_OPEN}
{{"tool": "<name>", "arguments": {{...}}}}
{TOOL_FENCE_CLOSE}
"""


def system_prompt(context: CopilotContext) -> str:
    """Assemble the system context for one turn.

    Args:
        context: The draft and the names that exist.

    Returns:
        The rules, the manifest and the grounding, as one string.
    """
    catalog = "\n".join(
        f"- {entry.type}: {entry.label}"
        + (f" — {entry.summary}" if entry.summary else "")
        for entry in context.catalog
    )
    guards = "\n".join(
        f"- {guard.name}" + (f": {guard.description}" if guard.description else "")
        for guard in context.guards
    )
    draft = (
        "(no draft yet — the first add_stage creates it)"
        if context.draft is None
        else json.dumps(context.draft, separators=(",", ":"), sort_keys=True)
    )
    return "\n".join(
        [
            _RULES,
            "Tools:",
            manifest_text(),
            "",
            "Stage catalog (the stage types the canvas offers):",
            catalog or "- (none)",
            "",
            "Skills defined in this workspace (anything else does not exist yet):",
            ", ".join(context.skills) or "(none)",
            "",
            "Task routes this workspace routes (anything else does not exist yet):",
            ", ".join(context.tasks) or "(none)",
            "",
            "Guards the enforcement planes honour:",
            guards or "- (none)",
            "",
            f"Current draft ({context.draft_label}):",
            draft,
        ]
    )


def messages(
    transcript: list[UserTurn | CopilotTurn | ToolResultTurn],
) -> list[dict[str, str]]:
    """Render the transcript as chat messages.

    A tool result is rendered as a user-role message naming the call it answers, because a
    result is something the environment tells the model and every chat vocabulary has exactly
    two speakers. The call id is what lets the model match a bounce to the operation it sent.

    Args:
        transcript: The conversation so far.

    Returns:
        ``{role, content}`` pairs, ``user`` or ``assistant``, in order.
    """
    rendered: list[dict[str, str]] = []
    for entry in transcript:
        if isinstance(entry, UserTurn):
            rendered.append({"role": "user", "content": entry.text})
        elif isinstance(entry, CopilotTurn):
            parts = [entry.text] if entry.text else []
            for call in entry.tool_calls:
                body = json.dumps({"tool": call.tool, "arguments": call.arguments})
                parts.append(f"{TOOL_FENCE_OPEN}\n{body}\n{TOOL_FENCE_CLOSE}")
            rendered.append({"role": "assistant", "content": "\n".join(parts)})
        else:
            outcome = "ok" if entry.ok else "error"
            rendered.append(
                {
                    "role": "user",
                    "content": f"[tool result {entry.call_id}] {outcome}: {entry.content}",
                }
            )
    return rendered


def payload(request: CopilotTurnRequest) -> dict[str, Any]:
    """The model call for one turn.

    Args:
        request: The turn.

    Returns:
        The payload the gateway passes through to the adapter.
    """
    return {
        "system": system_prompt(request.context),
        "messages": messages(request.transcript),
        "max_output_tokens": MAX_OUTPUT_TOKENS,
    }
