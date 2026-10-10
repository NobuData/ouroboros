"""``/v0/skills/run`` — follow a registry skill over an input (CM.5, #624).

``POST /v0/skills/run`` answers when the run is done: one model call, or two when the first
answer did not validate. The result is the validated output — a roadmap or one issue body
per item — never the model's text.

Refusals answer in the error envelope: ``422 skill_input_invalid`` for an input the output
cannot be produced from, ``422 skill_output_invalid`` when the model answered outside the
contract twice, and ``502 skill_model_failed`` when a call produced no answer — whose
``details.reason`` is the gateway's code (``gateway_unavailable`` until AF.2, #235).

The log line carries the skill, its version and the output — never the input.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ouroboros_engine.api.v0 import V0_PREFIX, V0_TAG
from ouroboros_engine.core.errors import envelope
from ouroboros_engine.investigation.model import ModelFailureError
from ouroboros_engine.skills.contract import (
    SKILL_MODEL_FAILED,
    SKILL_OUTPUT_INVALID,
    SkillRunRequest,
    SkillRunResult,
)
from ouroboros_engine.skills.runner import (
    SkillInputError,
    SkillOutputError,
    SkillRunner,
)

#: Where the operation lives under the versioned prefix.
SKILLS_RUN_ROUTE = "/skills/run"

#: The input cannot produce the output asked for.
SKILL_INPUT_INVALID = "skill_input_invalid"

_logger = logging.getLogger(__name__)

router = APIRouter(prefix=V0_PREFIX, tags=[V0_TAG])


def _runner(request: Request) -> SkillRunner:
    """The runner installed on the application.

    Args:
        request: The incoming request.

    Returns:
        ``app.state.skills`` — a test installs its own.
    """
    return request.app.state.skills


@router.post(
    SKILLS_RUN_ROUTE,
    summary="Run a registry skill over an input",
    response_model=SkillRunResult,
)
def run_skill(
    request: Request, payload: SkillRunRequest
) -> SkillRunResult | JSONResponse:
    """Run one skill.

    Args:
        request: The incoming request, read for the installed runner.
        payload: The validated run — a body that does not validate is the ``422`` envelope
            before any model is called.

    Returns:
        The validated result; or the refusal's envelope.
    """
    labels = {
        "skill": payload.skill.slug,
        "version": payload.skill.version,
        "output": payload.output,
    }
    try:
        result = _runner(request).run(payload)
    except SkillInputError as invalid:
        return JSONResponse(
            status_code=422, content=envelope(SKILL_INPUT_INVALID, str(invalid))
        )
    except SkillOutputError as invalid:
        _logger.warning("skill answered outside its contract", extra=labels)
        return JSONResponse(
            status_code=422,
            content=envelope(
                SKILL_OUTPUT_INVALID,
                "The model did not answer in the shape the skill's output requires.",
                {"problem": invalid.problem},
            ),
        )
    except ModelFailureError as failed:
        _logger.warning(
            "skill model call failed", extra={**labels, "reason": failed.code}
        )
        return JSONResponse(
            status_code=502,
            content=envelope(
                SKILL_MODEL_FAILED, failed.message, {"reason": failed.code}
            ),
        )

    _logger.info("skill run", extra={**labels, "attempts": result.attempts})
    return result
