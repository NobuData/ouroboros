"""``ouroboros-rest``'s internal contract, mirrored — the shapes, the routes, and the header.

The control plane publishes a surface only this service calls
(`openapi.internal.yaml <https://github.com/NobuData/ouroboros/blob/main/ouroboros-rest/openapi.internal.yaml>`_),
and this module is that document written as Python. Mirroring it *here* rather than inside
the client is what makes the mirror reviewable: this file and that one can be read side by
side, and nothing else in this service needs to know what the control plane's JSON looks
like. It is the same arrangement, in the other direction, that
``ouroboros-rest``'s ``src/modules/engine/engine.contract.ts`` keeps for ``/v0``.

AD.3 (`#224 <https://github.com/NobuData/ouroboros/issues/224>`_), decision **P3**. Two
surfaces, and the asymmetry between them is the whole of the design::

    POST /internal/llm/invoke          the control plane makes the call — keys never cross
    POST /internal/credentials/lease   local providers only — an address, TTL'd and audited

**A worker never holds a provider credential.** There is no field below in which one could
arrive: :class:`Lease` carries an address, and :class:`InvokeRequest` carries the call to be
made rather than the credential to make it with.

Three decisions about how it is mirrored:

* **The naming convention changes here, once.** ``ouroboros-rest`` writes ``camelCase`` in
  its contracts because it is TypeScript; this service writes ``snake_case`` because it is
  Python. Every model below declares a camel-case alias, so the translation happens in this
  file and no code beneath it carries ``runCtx`` or ``ttlSeconds``.
* **Requests are closed and responses are not.** A request this service *sends* forbids a
  field it does not declare, so a typo is caught here rather than by a ``422`` from the
  other side. A response it *reads* ignores an unknown field, because the internal contract
  is allowed to add one and a client that refused would turn a forward-compatible release
  into an outage.
* **The invocation half is specified, not implemented.** AF.2
  (`#235 <https://github.com/NobuData/ouroboros/issues/235>`_) is what makes
  ``/internal/llm/invoke`` answer; today it is a ``501`` naming that issue. The shapes are
  here anyway, because the executor #235 builds is written against them — which is what
  makes AF.1's (`#234 <https://github.com/NobuData/ouroboros/issues/234>`_) ADR a real
  decision rather than a description of whatever got built.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

#: The header the shared secret travels on, and the value is ``OURO_ENGINE_SHARED_SECRET``
#: — the same header and the same variable ``ouroboros-rest`` sends when it calls *this*
#: service (:mod:`ouroboros_engine.core.security`). One boundary, one credential, two
#: directions.
INTERNAL_KEY_HEADER = "X-Ouro-Internal-Key"

#: ``POST`` — a scoped lease for a local provider. Implemented.
LEASE_PATH = "/internal/credentials/lease"

#: ``POST`` — the proxied invocation. Specified by #224, implemented by AF.2 (#235).
INVOKE_PATH = "/internal/llm/invoke"

#: How the invocation answer is framed: one JSON object per line. NDJSON rather than SSE
#: because the reader is this process rather than a browser — reconnection and event ids
#: buy nothing here and cost a framing layer on both sides.
INVOKE_MEDIA_TYPE = "application/x-ndjson"

#: Provider kinds a worker may be told the address of. Both are reached **without a
#: credential**, which is the property that makes an address worth handing over at all.
LEASABLE_PROVIDERS: tuple[str, ...] = ("ollama", "openai_compatible")

#: Provider kinds whose connection details are, in substance, a key. A lease naming one is
#: a ``403`` from the control plane, by policy rather than by configuration.
PROXIED_PROVIDERS: tuple[str, ...] = ("anthropic", "copilot", "cursor")

#: Every provider kind this contract knows — AC.1's registry keys, spelled as
#: ``ouroboros-db`` spells them in ``model_prices.match_provider_kind``.
PROVIDERS: tuple[str, ...] = LEASABLE_PROVIDERS + PROXIED_PROVIDERS

#: What the control plane can refuse a lease with. ``provider_not_leasable`` is a
#: **decision** and will never succeed; ``local_provider_not_configured`` is an **absence**
#: an operator fixes. A worker that retried the first forever would be a worker nobody had
#: told the difference to.
LEASE_ERRORS: tuple[str, ...] = (
    "unauthenticated",
    "provider_not_leasable",
    "local_provider_not_configured",
    "run_not_found",
    "validation_failed",
)

#: What ``/internal/llm/invoke`` answers until AF.2 lands. Deliberately not ``404``: a
#: caller with the path wrong gets that, and an executor being written against this
#: contract has to be able to tell the two apart.
INVOCATION_NOT_IMPLEMENTED = "invocation_not_implemented"


class _Request(BaseModel):
    """Base of every body this service **sends** to the control plane.

    Closed, and camel-case on the wire. A field this service does not declare is refused
    here rather than by a ``422`` from the other side, which is the same rule
    :class:`ouroboros_engine.api.tasks.EchoRequest` applies to what it receives.
    """

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid"
    )


class _Response(BaseModel):
    """Base of every body this service **reads** from the control plane.

    Open, and camel-case on the wire. An unknown field is ignored rather than refused,
    because the internal contract may add one — and a client that rejected it would turn a
    forward-compatible release of the control plane into an outage here.
    """

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="ignore"
    )


class LeaseRequest(_Request):
    """The body of ``POST /internal/credentials/lease``.

    Attributes:
        provider: Which provider kind is wanted. A *kind* rather than a connection id,
            because there are no connections yet — Y.1
            (`#189 <https://github.com/NobuData/ouroboros/issues/189>`_) brings them. A
            cloud kind is a valid request and an invalid grant: it reaches the policy and
            is refused with ``403``, which is what the criterion asks for.
        run: The run this work belongs to. What *scoped* means — the control plane resolves
            the workspace from it, so a worker cannot choose which one to be audited
            against.
    """

    provider: str = Field(examples=["ollama"])
    run: str = Field(examples=["4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94"])


class Lease(_Response):
    """A granted lease — an address, a scope, and two times.

    **Every field is an identifier, an address or a timestamp.** There is nowhere for a
    credential to arrive, which is decision P3 expressed as a shape rather than as a
    promise: a "short-lived token" cannot be read out of this model because it has no field
    to be read from.

    A lease is **not a bearer token**. Holding one grants nothing that knowing the address
    would not, so nothing is stored and there is nothing to revoke; what
    :attr:`ttl_seconds` bounds is how long this worker should keep believing the answer
    before asking again.

    Attributes:
        id: This grant's id — the value the control plane's ``credential.lease_granted``
            audit event carries, so a worker's log line and the trail can be matched up.
        provider: The provider kind that was granted.
        run: The run it is scoped to, echoed back.
        organization_id: The workspace that run belongs to, resolved by the control plane.
            Carried because whatever this worker does next has to be attributed to the same
            workspace the grant was audited against.
        base_url: Where the provider is. The whole of what is handed over.
        granted_at: When the grant happened, ISO 8601.
        expires_at: When to ask again, ISO 8601.
        ttl_seconds: How long that is, so nothing has to subtract two timestamps.
    """

    id: str
    provider: str
    run: str
    organization_id: str
    base_url: str
    granted_at: str
    expires_at: str
    ttl_seconds: int


class RunContext(_Request):
    """The run a call is made for — *per-run scoping*, as a shape.

    Everything about a call that is not the call: whose work it is, where it sits in a
    chain, and the two limits that may stop it. This worker supplies what it knows; the
    control plane is the authority on the rest, so a cap sent here that is looser than the
    workspace's is not the cap that applies.

    Every field below is one of AB.1's
    (`#207 <https://github.com/NobuData/ouroboros/issues/207>`_) requirements given a name.
    They are hooks: this contract says what they mean, and AF.2 is what honours them.

    Attributes:
        run: The run — ``runs.id``. Required: a call belonging to no run cannot be
            attributed.
        hop: Which hop of the resolved chain this is, zero-based. Normally ``None``:
            walking the chain is the control plane's job, not a worker's.
        stage: The workflow stage this call is part of. Telemetry rather than policy — it
            is what makes a spike in AB.2's aggregates legible.
        floor_hop_index: The hop index below which the chain may not degrade. Mockup 06's
            *"never silently below the floor you set"*: exhausting the chain down to it
            fails the run with ``floor_exhausted`` rather than using a hop beneath it.
        cost_cap_cents: The per-run spend ceiling. Checked pre-flight *and* while running,
            because one streamed response can cross a cap it was under when it started.
        resolution_version: Which resolution this call was planned against, so a call
            planned under one and executed after a rebind is recognisable as such.
        vote: Whether this is a vote rather than the primary call. A vote is a real
            invocation with its own usage, and marking it is what keeps its tokens from
            inflating what the primary call cost.
    """

    run: str
    hop: int | None = None
    stage: str | None = None
    floor_hop_index: int | None = None
    cost_cap_cents: int | None = None
    resolution_version: str | None = None
    vote: bool | None = None


class InvokeRequest(_Request):
    """The body of ``POST /internal/llm/invoke``.

    Exactly one of :attr:`connection` and :attr:`alias` names the target — the client
    refuses a request that names both or neither, rather than letting the control plane
    decide which one it meant.

    Attributes:
        connection: A concrete provider connection. *This provider*: no chain, no fallback,
            no floor.
        alias: A routing alias. *Whatever routing resolves this to*, which is an ordered
            chain with a floor and a cap — resolved on the control plane's side, so a
            worker never re-decides a routing decision.
        payload: The model call itself, in the adapter's own vocabulary. Opaque to both
            sides of this boundary: the control plane brokers the call and does not read
            the prompt, which is also why it cannot log it.
        run_ctx: Which run this call belongs to, and the policy that applies to it.
    """

    connection: str | None = None
    alias: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    run_ctx: RunContext


class DeltaEvent(_Response):
    """A streamed fragment of the model's answer.

    Attributes:
        kind: Always ``"delta"``.
        hop: Which hop produced it — a chain that failed over says so in the stream.
        text: The fragment, exactly as the provider sent it.
    """

    kind: Literal["delta"]
    hop: int
    text: str


class UsageEvent(_Response):
    """What one hop cost — the row ``token_usage`` gets.

    Emitted **per hop**, including a hop that failed partway, attributed to the model and
    provider that actually served it: a fallback hop's tokens attributed to the primary is
    every spend figure in the product subtly wrong in a way nobody notices for months.

    Attributes:
        kind: Always ``"usage"``.
        hop: Which hop this usage belongs to.
        connection: The provider connection that served it.
        model: The model as the provider names it.
        input_tokens: Tokens sent.
        output_tokens: Tokens received.
        cost_cents: What it cost, or ``None`` when nothing prices it. ``None`` rather than
            ``0``: a local model's tokens are *unpriced*, which is a different statement
            from *free*, and a zero is spend nobody incurred appearing in an aggregate.
    """

    kind: Literal["usage"]
    hop: int
    connection: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_cents: float | None = None


class HopEvent(_Response):
    """A hop finished, one way or another — the telemetry AB.2 aggregates.

    Emitted for every hop *attempted*, so a chain that failed over twice produces three of
    them and a reader can see the failover the routing explanation promised.

    Attributes:
        kind: Always ``"hop"``.
        hop: Which hop.
        connection: The provider connection attempted.
        outcome: ``ok``, ``failed_over`` or ``aborted``.
        code: Why, when it was not ``ok``.
        latency_ms: How long the attempt took.
    """

    kind: Literal["hop"]
    hop: int
    connection: str
    outcome: Literal["ok", "failed_over", "aborted"]
    code: str | None = None
    latency_ms: int


class ErrorEvent(_Response):
    """The invocation failed. Terminal — no further events follow.

    Attributes:
        kind: Always ``"error"``.
        hop: Which hop was in flight, when one was.
        code: Which rule fired — see :data:`INVOKE_ERROR_CODES`.
        message: A sentence for a person. Never a provider's own error text.
    """

    kind: Literal["error"]
    hop: int | None = None
    code: str
    message: str


class DoneEvent(_Response):
    """The invocation completed. Terminal — no further events follow.

    Attributes:
        kind: Always ``"done"``.
        hop: Which hop served the answer — the one the run should be attributed to.
        finish_reason: Why generation stopped, in the provider's own vocabulary.
    """

    kind: Literal["done"]
    hop: int
    finish_reason: str


#: One line of the streamed answer.
InvokeEvent = DeltaEvent | UsageEvent | HopEvent | ErrorEvent | DoneEvent

#: Which model parses which line, by its ``kind``. A mapping rather than a discriminated
#: union so that an unknown kind is a *named* failure — a control plane that started
#: emitting one is a version mismatch an operator can read, not a validation trace.
EVENT_MODELS: dict[str, type[InvokeEvent]] = {
    "delta": DeltaEvent,
    "usage": UsageEvent,
    "hop": HopEvent,
    "error": ErrorEvent,
    "done": DoneEvent,
}

#: The per-hop error taxonomy — AB.1's rules, named, with the behaviour each implies:
#:
#: ``provider_unavailable``
#:     5xx or a timeout. The executor advances to the next hop.
#: ``provider_rate_limited``
#:     429 or a provider throttle. Backs off, then advances.
#: ``provider_auth_failed``
#:     The credential was refused. Does **not** retry; marks the provider in error.
#: ``request_invalid``
#:     A 4xx that is not auth. Aborts — the next hop would refuse it too.
#: ``floor_exhausted``
#:     The chain reached its floor. Aborts with the floor reason.
#: ``cost_cap_exceeded``
#:     The run's cap is spent. Aborts, naming the cap.
#: ``chain_exhausted``
#:     Every hop failed and there was no floor to stop at. Aborts.
INVOKE_ERROR_CODES: tuple[str, ...] = (
    "provider_unavailable",
    "provider_rate_limited",
    "provider_auth_failed",
    "request_invalid",
    "floor_exhausted",
    "cost_cap_exceeded",
    "chain_exhausted",
)


class ErrorEnvelope(_Response):
    """How every failure on this boundary arrives — ``docs/ARCHITECTURE.md`` § 5.3.

    The same shape this service answers with (:mod:`ouroboros_engine.core.errors`), so one
    envelope is parsed whether a request was refused at the control plane's boundary or
    inside one of its handlers.

    Attributes:
        code: Stable, machine-readable, and the thing to branch on.
        message: Written for a person.
        details: Whatever is specific to this failure — the provider that was refused, the
            run that was not found, the fields of a ``422``. Always present, empty rather
            than absent.
    """

    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
