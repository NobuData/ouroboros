"""The harness credential routes — what a harness executor holds instead of a provider key.

DH.2 (`#1303 <https://github.com/NobuData/ouroboros/issues/1303>`_) built them in
``ouroboros-rest``; DH.3 (`#1308 <https://github.com/NobuData/ouroboros/issues/1308>`_) is
their first caller. A stage attempt that runs inside a vendor harness never sees a provider
key: it is handed one **run-scoped credential**, minted for the run, the stage, the routing
alias and the attempt, which authenticates the facade at ``/internal/harness/anthropic`` and
nothing else.

==================================================== =====================================
route                                                when
==================================================== =====================================
``POST /internal/harness/credentials``               attempt start — the token, once
``POST /internal/harness/credentials/{id}/reconcile`` session end — the SDK's own totals
``DELETE /internal/harness/credentials/{id}``         attempt end, whatever the outcome
==================================================== =====================================

The token is a :class:`~pydantic.SecretStr`, so neither a log line nor a ``repr`` carries it.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field, SecretStr

from ouroboros_engine.control_plane.contract import _Request, _Response

#: ``POST``: mint a run-scoped credential.
HARNESS_CREDENTIALS_PATH = "/internal/harness/credentials"

#: ``DELETE``: revoke one.
HARNESS_CREDENTIAL_PATH = "/internal/harness/credentials/{id}"

#: ``POST``: reconcile the harness's totals with the facade's usage rows.
HARNESS_RECONCILE_PATH = "/internal/harness/credentials/{id}/reconcile"

#: The facade a harness's ``ANTHROPIC_BASE_URL`` names; the SDK appends ``/v1/messages``.
HARNESS_ANTHROPIC_PATH = "/internal/harness/anthropic"


class HarnessCredentialRequest(_Request):
    """The body of ``POST /internal/harness/credentials``.

    Attributes:
        run: ``runs.id`` — a live run.
        stage: The stage key the alias is walked under.
        alias: The only routing alias the credential may call.
        attempt: The stage attempt, from 1.
    """

    run: str = Field(min_length=1)
    stage: str = Field(min_length=1, max_length=64)
    alias: str = Field(min_length=1, max_length=128)
    attempt: int = Field(ge=1)


class HarnessCredential(_Response):
    """A minted credential.

    Attributes:
        id: ``harness_credentials.id`` — what revoke and reconcile address.
        token: The harness's ``ANTHROPIC_API_KEY``. Shown once, never stored by REST.
        run: The run it is bound to.
        stage: The stage.
        alias: The alias.
        attempt: The attempt.
        expires_at: Two hours after minting, ISO 8601.
    """

    id: str
    token: SecretStr
    run: str
    stage: str
    alias: str
    attempt: int
    expires_at: str


class HarnessReconcileRequest(_Request):
    """The body of ``POST /internal/harness/credentials/{id}/reconcile``.

    Attributes:
        models: The SDK's ``modelUsage``, keyed as it keys them, each carrying at least
            ``inputTokens`` and ``outputTokens`` (camelCase — the SDK's own names).
    """

    models: dict[str, dict[str, int]]


class HarnessReconciliation(_Response):
    """The facade's comparison.

    Attributes:
        id: The credential's id.
        matches: True only when every model agrees.
        reconciled_at: When it was stored.
        models: Per model: recorded, reported and difference.
    """

    id: str
    matches: bool
    reconciled_at: str
    models: list[dict[str, Any]] = Field(default_factory=list)
