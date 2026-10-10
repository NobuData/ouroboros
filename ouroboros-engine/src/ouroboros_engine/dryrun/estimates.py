"""Replayed infrastructure: a build or test estimate from the farm's own history (CD.2, #560).

A dry run dispatches nothing to the farm, and a model asked how long a build takes answers
with a confident number that has no basis. So an infrastructure stage — and the ``build`` and
``run_tests`` tools — ask ``ouroboros-rest``'s estimator (CD.3, #561) instead:
``POST /internal/dry-runs/{id}/replay-estimates``. Its answer carries the sample it rests on
(``est. 4m 02s (214 similar builds, ±20s)``) or says there is not enough history and gives
**no number at all**. Either way the harness passes it on untouched: the ``stage`` object of
the answer is the row that is recorded.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib import error, request
from urllib.parse import quote, urljoin

from ouroboros_engine.control_plane.contract import (
    DRY_RUN_REPLAY_ESTIMATES_PATH,
    INTERNAL_KEY_HEADER,
)

#: Seconds to wait for the estimator.
ESTIMATE_TIMEOUT_SECONDS = 30.0

InfraKind = Literal["build", "test"]


class EstimateUnavailableError(RuntimeError):
    """The estimator did not answer with an estimate.

    Attributes:
        code: The control plane's code, or ``estimator_unreachable``.
    """

    def __init__(self, code: str, message: str) -> None:
        """Name the failure.

        Args:
            code: The code.
            message: A sentence.
        """
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class ReplayedStage:
    """An estimator's answer, as the stage row that records it.

    Attributes:
        note: The card's line, composed by the estimator.
        metrics: The estimate and its basis — ``estimate_ms``, ``spread_ms``,
            ``sample_count``, ``similarity_class``, ``window_days`` — or
            ``insufficient_history`` with the count found.
    """

    note: str
    metrics: dict[str, Any]


class ReplayEstimates(Protocol):
    """Anything that can estimate an infrastructure stage. Tests substitute a recording."""

    def estimate(
        self,
        dry_run: str,
        kind: InfraKind,
        *,
        runner_pool: str | None,
        command: str | None,
    ) -> ReplayedStage:
        """Estimate one build or test stage.

        Args:
            dry_run: ``dry_runs.id`` — the estimator resolves the workspace and repository.
            kind: ``build`` or ``test``.
            runner_pool: The stage's pool, or ``None`` for the default.
            command: The stage's command, or ``None`` for the pool's default.

        Returns:
            The row.

        Raises:
            EstimateUnavailableError: When there is no answer to pass on.
        """
        ...


class HttpReplayEstimates:
    """:class:`ReplayEstimates` over ``urllib``, with this service's internal key."""

    def __init__(
        self,
        base_url: str,
        shared_secret: str,
        *,
        timeout: float = ESTIMATE_TIMEOUT_SECONDS,
    ) -> None:
        """Point at the control plane.

        Args:
            base_url: ``OURO_REST_URL``.
            shared_secret: The internal key.
            timeout: Seconds to wait.
        """
        self._base = base_url.rstrip("/") + "/"
        self._secret = shared_secret
        self._timeout = timeout
        self._opener = request.build_opener(request.ProxyHandler({}))

    def estimate(
        self,
        dry_run: str,
        kind: InfraKind,
        *,
        runner_pool: str | None,
        command: str | None,
    ) -> ReplayedStage:
        """See :meth:`ReplayEstimates.estimate`."""
        body: dict[str, Any] = {"kind": kind}
        if runner_pool is not None:
            body["runnerPool"] = runner_pool
        if command is not None and kind == "build":
            body["command"] = command
        path = DRY_RUN_REPLAY_ESTIMATES_PATH.format(id=quote(dry_run, safe=""))
        prepared = request.Request(  # noqa: S310 - the URL is the configured control plane's
            urljoin(self._base, path.lstrip("/")),
            data=json.dumps(body).encode("utf-8"),
            headers={
                INTERNAL_KEY_HEADER: self._secret,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with self._opener.open(prepared, timeout=self._timeout) as answer:
                parsed = json.loads(answer.read().decode("utf-8"))
        except error.HTTPError as refused:
            raise EstimateUnavailableError(
                _code_of(refused), f"the estimator answered {refused.code}"
            ) from refused
        except (error.URLError, TimeoutError, ConnectionError, OSError) as failure:
            raise EstimateUnavailableError(
                "estimator_unreachable", "the estimator could not be reached"
            ) from failure
        except ValueError as malformed:
            raise EstimateUnavailableError(
                "estimator_unreachable", "the estimator did not answer JSON"
            ) from malformed
        return read_stage(parsed)


def read_stage(answer: object) -> ReplayedStage:
    """Take the stage row out of an estimator's answer.

    Args:
        answer: The parsed body of a ``200``.

    Returns:
        The row.

    Raises:
        EstimateUnavailableError: When the answer has no replayed ``stage`` with a note —
            the harness will not compose a figure the estimator did not give.
    """
    stage = answer.get("stage") if isinstance(answer, dict) else None
    if (
        not isinstance(stage, dict)
        or stage.get("how") != "replayed"
        or not isinstance(stage.get("note"), str)
        or not stage["note"].strip()
        or not isinstance(stage.get("metrics"), dict)
    ):
        raise EstimateUnavailableError(
            "estimator_contract", "the estimator answered outside its contract"
        )
    return ReplayedStage(note=stage["note"], metrics=dict(stage["metrics"]))


def _code_of(refused: error.HTTPError) -> str:
    """Read the error envelope's code from a refusal.

    Args:
        refused: What ``urllib`` raised.

    Returns:
        The code, or ``http_<status>``.
    """
    try:
        envelope = json.loads(refused.read().decode("utf-8"))
        if isinstance(envelope, dict) and envelope.get("code"):
            return str(envelope["code"])
    except (ValueError, OSError):
        pass
    return f"http_{refused.code}"
