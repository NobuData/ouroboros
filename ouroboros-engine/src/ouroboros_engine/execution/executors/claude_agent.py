"""The Claude Agent stage executor — a ``harness`` executor over the Claude Agent SDK.

DH.3 (`#1308 <https://github.com/NobuData/ouroboros/issues/1308>`_), decided in
``docs/DECISION_EXECUTION_ENGINE.md`` § *Axis 2* and held to ``docs/STAGE_EXECUTORS.md`` §
*Writing an executor*. One instance runs one stage attempt inside the CLI bundled with the
pinned ``claude-agent-sdk`` wheel, reaching models only through DH.2's facade:

1. **A credential first.** The attempt mints a run-scoped credential
   (``POST /internal/harness/credentials``). Without one the attempt fails and no process
   is started — there is no other way to give the CLI a key.
2. **L5, configured.** ``permission_mode="dontAsk"`` (a raising hook fails *open* under the
   SDK's default mode), ``setting_sources=[]`` (no repository settings or hooks), the five
   file tools and nothing else, no MCP, the run's tree as ``cwd``, a per-run
   ``CLAUDE_CONFIG_DIR`` and an environment scrubbed of everything inherited
   (:mod:`~ouroboros_engine.execution.executors.claude_agent_env`). Prompts are delivered
   verbatim, so an ``@/path`` in the issue's text cannot make the CLI read a file.
3. **One hook, every tool.** :class:`~ouroboros_engine.execution.executors.claude_agent_session.AttemptRecorder`
   asks the engine's policy before each call; a ``deny`` halts the session with
   ``continue: false``.
4. **The outcome from ``terminal_reason``**, never ``subtype``: a hook halt reports
   ``subtype: "success"``.
5. **Settled at the end.** The SDK's per-model totals are reconciled with the facade's
   usage rows, and the credential is revoked — whatever the outcome.

``max_turns`` is :data:`DEFAULT_MAX_TURNS`: the workflow DSL has no turns field yet.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections import deque
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Final, Protocol

from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient, HookMatcher

from ouroboros_engine.control_plane.harness import (
    HARNESS_ANTHROPIC_PATH,
    HarnessCredential,
    HarnessCredentialRequest,
    HarnessReconcileRequest,
    HarnessReconciliation,
)
from ouroboros_engine.execution.events import StageEvent
from ouroboros_engine.execution.executors.claude_agent_env import (
    config_dir,
    harness_env,
    session_exists,
)
from ouroboros_engine.execution.executors.claude_agent_session import (
    AttemptRecorder,
    Evaluate,
)
from ouroboros_engine.execution.executors.claude_agent_tools import (
    DISALLOWED_TOOLS,
    OFFERED_TOOLS,
)
from ouroboros_engine.execution.policy import evaluate
from ouroboros_engine.execution.spi import (
    Checkpoint,
    ExecutorCapabilities,
    ExecutorCapabilityError,
    StageContext,
    StageExecutor,
    StageOutcome,
)

_log = logging.getLogger(__name__)

#: The turns one session may take. The workflow DSL has no turns field yet, so every stage
#: gets this; a stage that needs more fails ``max_turns`` and is retried within its bound.
DEFAULT_MAX_TURNS: Final = 40

#: Seconds the SDK waits for the hook before skipping the tool. The policy itself is given
#: two thirds of it (:data:`POLICY_DEADLINE_SHARE`), so the engine answers ``deny`` — and
#: records why — before the SDK's own timeout, which records nothing.
HOOK_TIMEOUT_SECONDS: Final = 30.0

#: The share of the hook timeout the policy may use.
POLICY_DEADLINE_SHARE: Final = 2 / 3

#: The user turn that continues a resumed session. The task itself is already in the
#: session's history; this only says to carry on.
RESUME_PROMPT: Final = (
    "The stage was paused and has resumed. Continue where you stopped."
)

#: Stops the SDK probing the CLI's version with an unscrubbed environment before each
#: session. The binary is the pinned wheel's own, so there is nothing to probe.
_SKIP_VERSION_CHECK: Final = "CLAUDE_AGENT_SDK_SKIP_VERSION_CHECK"

#: How many of the CLI's last stderr lines a failure quotes from.
_STDERR_LINES: Final = 20


class CredentialIssuer(Protocol):
    """The control plane's credential routes, as the executor calls them."""

    def mint_credential(self, body: HarnessCredentialRequest) -> HarnessCredential:
        """Mint a run-scoped credential.

        Args:
            body: The run, stage, alias and attempt.

        Returns:
            The credential.
        """
        ...

    def reconcile_credential(
        self, credential: str, body: HarnessReconcileRequest
    ) -> HarnessReconciliation:
        """Report the session's own totals.

        Args:
            credential: The credential's id.
            body: The SDK's per-model totals.

        Returns:
            The comparison.
        """
        ...

    def revoke_credential(self, credential: str) -> None:
        """Revoke a credential.

        Args:
            credential: The credential's id.
        """
        ...


def facade_url(rest_url: str) -> str:
    """The ``ANTHROPIC_BASE_URL`` the harness is pointed at.

    Args:
        rest_url: ``OURO_REST_URL``.

    Returns:
        ``<rest_url>/internal/harness/anthropic``; the SDK appends ``/v1/messages``.
    """
    return rest_url.rstrip("/") + HARNESS_ANTHROPIC_PATH


class ClaudeAgentExecutor(StageExecutor):
    """One stage attempt inside the Claude Agent harness. See the module.

    Attributes:
        kind: ``harness``.
    """

    kind = "harness"

    def __init__(
        self,
        credentials: CredentialIssuer,
        *,
        rest_url: str,
        cli_path: Path,
        max_turns: int = DEFAULT_MAX_TURNS,
        hook_timeout: float = HOOK_TIMEOUT_SECONDS,
        policy: Evaluate = evaluate,
    ) -> None:
        """Hold the collaborators.

        Args:
            credentials: Mints, reconciles and revokes run-scoped credentials.
            rest_url: ``OURO_REST_URL`` — the facade is under it.
            cli_path: The bundled CLI.
            max_turns: The session's turn limit.
            hook_timeout: The SDK's hook timeout, in seconds.
            policy: The tool policy; tests substitute a failing one.
        """
        self._credentials = credentials
        self._base_url = facade_url(rest_url)
        self._cli_path = cli_path
        self._max_turns = max_turns
        self._hook_timeout = hook_timeout
        self._policy = policy
        self._recorder: AttemptRecorder | None = None
        self._ctx: StageContext | None = None
        self._outcome: StageOutcome | None = None
        self._pause = False
        self._abort = False
        self._steers: list[str] = []
        self._stderr: deque[str] = deque(maxlen=_STDERR_LINES)

    # --- the SPI ------------------------------------------------------------------------

    def capabilities(self) -> ExecutorCapabilities:
        """What this executor can do.

        Returns:
            A tool loop that resumes and takes guidance, on Anthropic models only.
        """
        return ExecutorCapabilities(
            tools=True, resume=True, steer=True, provider_neutral=False
        )

    def run(self, ctx: StageContext) -> AsyncIterator[StageEvent]:
        """Run the attempt from its first turn.

        Args:
            ctx: The attempt's context.

        Returns:
            The events, from ``seq`` 1.
        """
        return self._attempt(ctx, ctx.prompt, None, 1)

    def resume(self, checkpoint: Checkpoint) -> AsyncIterator[StageEvent]:
        """Continue a paused or interrupted attempt in its own harness session.

        Refused before any process starts when the session cannot be found — a checkpoint
        from another kind, one without a session id, or a configuration directory without
        that session (a restart on a container without the runs volume). The interpreter
        then starts one fresh attempt.

        Args:
            checkpoint: A paused outcome's, or a live one the interpreter stored.

        Returns:
            The rest of the attempt's events, from ``checkpoint.next_seq``.

        Raises:
            ExecutorCapabilityError: When the session cannot be resumed.
        """
        if checkpoint.executor_kind != self.kind:
            raise ExecutorCapabilityError(
                f"a {checkpoint.executor_kind} checkpoint cannot resume a harness attempt"
            )
        session = checkpoint.state.get("session_id")
        if not isinstance(session, str) or not session:
            raise ExecutorCapabilityError("the checkpoint names no harness session")
        ctx = checkpoint.context
        if not session_exists(config_dir(ctx.policy.working_tree), session):
            raise ExecutorCapabilityError(
                f"no conversation found with session id {session} in this run's "
                "configuration directory"
            )
        return self._attempt(ctx, RESUME_PROMPT, session, checkpoint.next_seq)

    def pause(self) -> None:
        """Pause at the next pre-tool hook: that call is refused and the session stops."""
        self._pause = True
        if self._recorder is not None:
            self._recorder.pause_requested = True

    def abort(self) -> None:
        """Abort at the next pre-tool hook: that call is refused and the session stops."""
        self._abort = True
        if self._recorder is not None:
            self._recorder.abort_requested = True

    def steer(self, text: str) -> None:
        """Queue guidance for the model, delivered as the session's next user turn.

        Delivered at the next pre-tool boundary, where the harness folds it into the
        model's next request; guidance still queued when the session would end starts one
        more turn instead. #315 wires REST's control queue to this.

        Args:
            text: The guidance.

        Raises:
            ValueError: If the text is blank.
        """
        if not text.strip():
            raise ValueError("steer text must not be blank")
        if self._recorder is not None:
            self._recorder.steers.append(text)
        else:
            self._steers.append(text)

    @property
    def outcome(self) -> StageOutcome | None:
        """How the attempt ended — ``None`` until its stream has."""
        return self._outcome

    def live_checkpoint(self) -> Checkpoint | None:
        """The running session, as a checkpoint :meth:`resume` accepts.

        Returns:
            The session id and the next ``seq`` once the session has reported its id;
            ``None`` before.
        """
        recorder = self._recorder
        if recorder is None or recorder.session_id is None or self._ctx is None:
            return None
        return self._checkpoint(self._ctx, recorder)

    # --- one attempt --------------------------------------------------------------------

    def _checkpoint(self, ctx: StageContext, recorder: AttemptRecorder) -> Checkpoint:
        """The checkpoint for the session the recorder saw.

        Args:
            ctx: The attempt's context.
            recorder: The attempt's recorder, with a session id.

        Returns:
            The checkpoint.
        """
        return Checkpoint(
            executor_kind="harness",
            context=ctx,
            next_seq=recorder.next_seq,
            state={"session_id": recorder.session_id},
        )

    async def _attempt(
        self, ctx: StageContext, prompt: str, resume_id: str | None, first_seq: int
    ) -> AsyncIterator[StageEvent]:
        """Mint, run the session in a task, stream what it records, then decide.

        Args:
            ctx: The attempt's context.
            prompt: The first user turn.
            resume_id: The session to resume, or ``None`` for a new one.
            first_seq: The first ``seq``.

        Yields:
            The attempt's events.
        """
        recorder = AttemptRecorder(
            ctx,
            first_seq=first_seq,
            evaluate=self._policy,
            policy_deadline=self._hook_timeout * POLICY_DEADLINE_SHARE,
        )
        recorder.pause_requested, recorder.abort_requested = self._pause, self._abort
        recorder.steers, self._steers = self._steers, []
        recorder.session_id = resume_id
        self._recorder, self._ctx = recorder, ctx
        if self._abort:
            self._outcome = StageOutcome(status="aborted")
            return
        try:
            credential = await asyncio.to_thread(
                self._credentials.mint_credential,
                HarnessCredentialRequest(
                    run=ctx.run_id,
                    stage=ctx.stage_key,
                    alias=ctx.model,
                    attempt=ctx.attempt,
                ),
            )
        except Exception as error:
            self._outcome = StageOutcome(
                status="failed",
                error=f"No facade credential could be minted ({type(error).__name__}: "
                f"{error}); the harness was not started.",
            )
            return
        session = asyncio.create_task(
            self._session(ctx, recorder, credential, prompt, resume_id)
        )
        try:
            while (event := await recorder.queue.get()) is not None:
                yield event
            await session
        finally:
            if not session.done():
                session.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await session
        self._outcome = self._decide(ctx, recorder)

    def _options(
        self,
        ctx: StageContext,
        recorder: AttemptRecorder,
        credential: HarnessCredential,
        resume_id: str | None,
    ) -> ClaudeAgentOptions:
        """The harness's options: L5, isolated, pointed at the facade.

        Args:
            ctx: The attempt's context.
            recorder: The hook's owner.
            credential: The minted credential.
            resume_id: The session to resume, or ``None``.

        Returns:
            The options.
        """
        config = config_dir(ctx.policy.working_tree)
        config.mkdir(parents=True, exist_ok=True)
        return ClaudeAgentOptions(
            cli_path=self._cli_path,
            cwd=ctx.policy.working_tree,
            permission_mode="dontAsk",
            setting_sources=[],
            tools=list(OFFERED_TOOLS),
            disallowed_tools=list(DISALLOWED_TOOLS),
            mcp_servers={},
            strict_mcp_config=True,
            max_turns=self._max_turns,
            model=ctx.model,
            resume=resume_id,
            verbatim_prompts=True,
            stderr=self._stderr.append,
            env=harness_env(
                base_url=self._base_url,
                credential=credential.token.get_secret_value(),
                alias=ctx.model,
                config=config,
            ),
            hooks={
                "PreToolUse": [
                    HookMatcher(
                        matcher=None,
                        hooks=[recorder.pre_tool_use],
                        timeout=self._hook_timeout,
                    )
                ]
            },
        )

    async def _session(
        self,
        ctx: StageContext,
        recorder: AttemptRecorder,
        credential: HarnessCredential,
        prompt: str,
        resume_id: str | None,
    ) -> None:
        """Run the harness session to its end, then settle the credential. Never raises.

        Args:
            ctx: The attempt's context.
            recorder: Where the session is recorded.
            credential: The minted credential.
            prompt: The first user turn.
            resume_id: The session to resume, or ``None``.
        """
        try:
            options = self._options(ctx, recorder, credential, resume_id)
            os.environ[_SKIP_VERSION_CHECK] = "1"
            async with ClaudeSDKClient(options=options) as client:
                recorder.deliver = client.query
                await client.query(prompt)
                while await self._turn(client, recorder):
                    await client.query(recorder.steers.pop(0))
        except Exception as error:
            last = self._stderr[-1][:300] if self._stderr else ""
            recorder.error = f"The harness failed ({type(error).__name__}: {error})" + (
                f"; its last output: {last}" if last else ""
            )
        finally:
            recorder.deliver = None
            await self._settle(credential, recorder)
            recorder.queue.put_nowait(None)

    async def _turn(self, client: ClaudeSDKClient, recorder: AttemptRecorder) -> bool:
        """Read one turn to its result, or until the engine must stop the session.

        Args:
            client: The connected client.
            recorder: Where it is recorded.

        Returns:
            ``True`` when the turn ended normally with guidance still queued — one more
            turn delivers it.
        """
        recorder.result = None
        async for message in client.receive_response():
            if recorder.on_message(message):
                return False
        return (
            recorder.stop is None
            and recorder.result is not None
            and recorder.result.terminal_reason == "completed"
            and bool(recorder.steers)
        )

    async def _settle(
        self, credential: HarnessCredential, recorder: AttemptRecorder
    ) -> None:
        """Reconcile the SDK's totals with the facade's, then revoke. Never raises.

        Args:
            credential: The attempt's credential.
            recorder: What the session reported.
        """
        result = recorder.result
        usage = result.model_usage if result is not None else None
        if usage:
            models = {
                model: {
                    key: int(totals.get(key, 0) or 0)
                    for key in (
                        "inputTokens",
                        "outputTokens",
                        "cacheReadInputTokens",
                        "cacheCreationInputTokens",
                    )
                }
                for model, totals in usage.items()
            }
            try:
                reconciled = await asyncio.to_thread(
                    self._credentials.reconcile_credential,
                    credential.id,
                    HarnessReconcileRequest(models=models),
                )
                if not reconciled.matches:
                    _log.warning(
                        "harness usage for credential %s does not reconcile: %s",
                        credential.id,
                        reconciled.models,
                    )
            except Exception:
                _log.exception("harness credential %s: reconcile failed", credential.id)
        try:
            await asyncio.to_thread(self._credentials.revoke_credential, credential.id)
        except Exception:
            _log.exception("harness credential %s: revoke failed", credential.id)

    def _decide(self, ctx: StageContext, recorder: AttemptRecorder) -> StageOutcome:
        """How the attempt ended: the engine's own stop first, then ``terminal_reason``.

        Args:
            ctx: The attempt's context.
            recorder: What the session reported.

        Returns:
            The outcome.
        """
        if recorder.stop == "halted":
            return StageOutcome(status="halted", verdict=recorder.verdict)
        if recorder.stop == "aborted":
            return StageOutcome(status="aborted")
        if recorder.stop == "paused":
            if recorder.session_id is None:
                return StageOutcome(
                    status="failed",
                    error="The stage paused before the harness reported its session.",
                )
            return StageOutcome(
                status="paused", checkpoint=self._checkpoint(ctx, recorder)
            )
        if recorder.error is not None:
            return StageOutcome(status="failed", error=recorder.error)
        result = recorder.result
        if result is None:
            return StageOutcome(
                status="failed", error="The harness ended without a result."
            )
        reason = result.terminal_reason
        if reason == "completed" and not result.is_error:
            return StageOutcome(status="completed")
        if reason == "max_turns":
            return StageOutcome(
                status="failed",
                error=f"max_turns: the session used all {self._max_turns} turns.",
            )
        detail = "; ".join(result.errors or []) or result.result or ""
        if result.api_error_status is not None:
            detail = f"HTTP {result.api_error_status} from the facade. {detail}"
        return StageOutcome(
            status="failed",
            error=f"{reason or 'no terminal reason'}: {detail.strip() or 'the harness gave no detail'}",
        )
