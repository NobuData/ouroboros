/**
 * `POST /internal/llm/invoke` — the contract, written before the thing that honours it.
 *
 * AD.3 ([#224](https://github.com/NobuData/ouroboros/issues/224)) specifies this surface and
 * AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)) implements it. That order
 * is the point of the ticket rather than an accident of scheduling: AF.1
 * ([#234](https://github.com/NobuData/ouroboros/issues/234)) has to choose between a custom
 * executor and LiteLLM-as-executor *against a contract*, and a decision recorded after the
 * fact is a description of whatever got built. So the shapes are here, the route answers
 * `501 invocation_not_implemented` naming AF.2, and the engine's client stub compiles
 * against both.
 *
 * ---------------------------------------------------------------------------
 * **The one idea.** A worker sends the *call it wants made* and the *run it is making it
 * for*. It never sends a credential, because it never has one — decision **P3**, and the
 * whole of mockup 07's *"keys never leave the control plane"* made literal. This service
 * resolves the target, unwraps the credential inside one request scope, walks the resolved
 * chain, and streams back what the provider said.
 *
 * ```
 * worker ──▶ {connection | alias, payload, runCtx} ──▶ REST ──▶ provider
 *        ◀── delta · delta · usage · hop · done   ◀──      (key never crosses back)
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Four decisions this file makes, so that AF.2 does not have to make them alone.**
 *
 * **1. The target is `connection` or `alias`, exactly one.** A connection is a concrete
 * provider connection (Y.1, [#189](https://github.com/NobuData/ouroboros/issues/189)) and
 * means *this provider and no other*; an alias is a routing alias and means *whatever Z.1
 * ([#194](https://github.com/NobuData/ouroboros/issues/194)) resolves it to right now*,
 * which is an ordered chain with a floor and a cap. AF.2's own diagram writes the second
 * case as `{resolution r1, …}`, and that is the same thing seen one step later: the
 * resolution is what REST produces *from* the alias, on this side of the boundary, so that
 * routing decisions stay in the resolution layer and the worker never re-decides one. A
 * worker that could send a resolution could send a different chain than the one routing
 * chose — which is the exact divergence AB.1 ([#207](https://github.com/NobuData/ouroboros/issues/207))
 * says an executor must not be able to cause.
 *
 * **2. `payload` is opaque and passes through.** This service brokers the call; it does not
 * read the prompt. Adapters own the per-provider shape (AC.1,
 * [#216](https://github.com/NobuData/ouroboros/issues/216)), so a field this contract does
 * not know about is one an adapter may still understand — which is why the schema does not
 * enumerate it and why nothing here inspects it. It is also the field most likely to carry
 * a customer's data, and a control plane that parsed it would be a control plane that could
 * log it.
 *
 * **3. The answer is always a stream, never sometimes a stream.** One response shape —
 * newline-delimited JSON, one {@link InvokeEvent} per line — whether the underlying provider
 * streamed or not, because two shapes would be two code paths in AF.2 and the non-streaming
 * one would be the one that quietly stopped emitting usage. A caller that wants the whole
 * answer accumulates the deltas. NDJSON rather than SSE deliberately: the reader is a worker
 * process, not a browser, so SSE's reconnection and event-id machinery buys nothing and
 * costs a framing layer on both sides.
 *
 * **4. Every AB.1 semantic has a field, and none of them has a default here.** Floor abort,
 * per-run cost caps, per-hop errors and usage capture are the four things #207 says an
 * executor must do, and each one is either an input on {@link RunContext} or an event kind
 * below. They are *hooks*: this file names them and states what they mean, AF.1 decides how
 * they are implemented, AF.2 implements them. What this file refuses to do is leave one of
 * them unnamed, because an executor that was never handed a floor cannot be found to have
 * ignored one.
 */

/** The media type the answer is streamed as — one JSON object per line. */
export const INVOKE_MEDIA_TYPE = "application/x-ndjson";

/** What the worker is asking this service to do. */
export interface InvokeRequest {
  /**
   * A concrete provider connection — `provider_connections.id` (Y.1).
   *
   * Mutually exclusive with {@link alias}. Naming one means *this provider*: no chain, no
   * fallback, no floor, and a failure is a failure rather than a hop.
   */
  readonly connection?: string;
  /**
   * A routing alias — `model_aliases.alias` (Y.1).
   *
   * Mutually exclusive with {@link connection}. Naming one means *whatever routing resolves
   * this to*, which is an ordered chain with a floor and a cap; Z.1 resolves it on this side
   * of the boundary and the worker never sees the chain.
   */
  readonly alias?: string;
  /**
   * The model call itself, in the adapter's own vocabulary.
   *
   * Opaque here. See decision 2 in this file's header for why nothing reads it.
   */
  readonly payload: Record<string, unknown>;
  /** Which run this call belongs to, and the policy that applies to it. */
  readonly runCtx: RunContext;
}

/**
 * The run a call is made for — *per-run scoping*, as a shape.
 *
 * Everything about a call that is not the call: whose work it is, where it sits in a chain,
 * and the two limits that may stop it. The worker supplies what it knows; this service is
 * the authority on the rest — a cap the worker sent that is looser than the workspace's is
 * not the cap that applies, and AF.4 ([#237](https://github.com/NobuData/ouroboros/issues/237))
 * is where enforcement beyond blocking lands.
 */
export interface RunContext {
  /** The run — `runs.id`. Required: an invocation that belongs to no run cannot be attributed. */
  readonly run: string;
  /**
   * Which hop of the resolved chain this is, zero-based.
   *
   * Sent by the worker only when it is retrying something it already knows the shape of;
   * normally absent, because walking the chain is this service's job and not the worker's.
   */
  readonly hop?: number;
  /**
   * The workflow stage this call is part of — `runs.stage_label`.
   *
   * Telemetry rather than policy: AB.2 ([#208](https://github.com/NobuData/ouroboros/issues/208))
   * aggregates per-hop health, and *which stage was running* is what makes a spike legible.
   */
  readonly stage?: string;
  /**
   * The hop index below which the chain may not degrade — AB.1's floor.
   *
   * *"Never silently below the floor you set"* is mockup 06's promise, and the failure it
   * forbids is a chain that quietly finishes on a cheaper model. Exhausting the chain down
   * to this index fails the run with {@link INVOKE_ERROR_CODES.floorExhausted} rather than
   * using a hop below it. Absent means the resolution carries one and this service reads it
   * from there.
   */
  readonly floorHopIndex?: number;
  /**
   * The per-run spend ceiling, in cents.
   *
   * Checked pre-flight *and* while running (AF.2's third and fourth criteria), because a
   * single streaming response can cross a cap it was under when it started.
   */
  readonly costCapCents?: number;
  /**
   * Which resolution this call was planned against — Z.1's `resolution_version`.
   *
   * Carried so that a call planned under one resolution and executed after a rebind is
   * recognisable as such, rather than being silently executed against a chain the plan never
   * saw. AB.1's third acceptance criterion is that this identity is sufficient for either
   * candidate executor; that is why it crosses the boundary rather than being reconstructed.
   */
  readonly resolutionVersion?: string;
  /**
   * Is this a vote rather than the primary call?
   *
   * `add_vote` escalation asks a second model for its opinion, and #207 is explicit that a
   * vote is a real invocation with its own usage. Marked rather than inferred, so a usage
   * row can be attributed to *the vote* instead of inflating what the primary call cost.
   */
  readonly vote?: boolean;
}

/** What one line of the answer can be. */
export const INVOKE_EVENT_KINDS = ["delta", "usage", "hop", "error", "done"] as const;

/** One of {@link INVOKE_EVENT_KINDS}. */
export type InvokeEventKind = (typeof INVOKE_EVENT_KINDS)[number];

/**
 * The error taxonomy, as codes — AB.1's *per-hop* rules, named.
 *
 * The rule beside each one is the contract, and #235's first acceptance criterion is that
 * the executor's behaviour matches *what routing's explanations promised the user*. The
 * inspector tells somebody that hop 2 catches 5xx and timeouts; if an executor treats a 500
 * as fatal, the UI has been lying since the day it shipped. So the mapping lives here, in
 * the contract both sides read, rather than in whichever module walks the chain.
 */
export const INVOKE_ERROR_CODES = {
  /** 5xx or a timeout. **Advances to the next hop.** */
  providerUnavailable: "provider_unavailable",
  /** 429 or a provider's own throttle. **Backs off, then advances.** */
  providerRateLimited: "provider_rate_limited",
  /** The credential was refused. **Does not retry** — the provider is marked in error. */
  providerAuthFailed: "provider_auth_failed",
  /** The provider refused the payload — a 4xx that is not auth. **Aborts**; the next hop would refuse it too. */
  requestInvalid: "request_invalid",
  /** The chain reached its floor. **Aborts with the floor reason**, never degrades past it. */
  floorExhausted: "floor_exhausted",
  /** The run's cap is spent — pre-flight, or crossed mid-stream. **Aborts**, naming the cap. */
  costCapExceeded: "cost_cap_exceeded",
  /** Every hop failed and there was no floor to stop at. **Aborts.** */
  chainExhausted: "chain_exhausted",
} as const;

/** One of {@link INVOKE_ERROR_CODES}' values. */
export type InvokeErrorCode = (typeof INVOKE_ERROR_CODES)[keyof typeof INVOKE_ERROR_CODES];

/** A streamed fragment of the model's answer. */
export interface InvokeDeltaEvent {
  readonly kind: "delta";
  /** Which hop produced it — a chain that failed over says so in the stream. */
  readonly hop: number;
  /** The fragment, exactly as the provider sent it. */
  readonly text: string;
}

/**
 * What one hop cost — the row `token_usage` (#66) gets.
 *
 * Emitted **per hop**, including a hop that failed partway, and attributed to the model and
 * provider that actually served it. #235's fifth criterion is that these reconcile with
 * provider-reported counts; the spend meters (AE.2), routing's `$/run` (Z.5) and the caps all
 * read that table, so a hop's tokens attributed to the primary is every one of those numbers
 * wrong in a way nobody notices for months.
 */
export interface InvokeUsageEvent {
  readonly kind: "usage";
  /** Which hop this usage belongs to. */
  readonly hop: number;
  /** The provider connection that served it. */
  readonly connection: string;
  /** The model as the provider names it. */
  readonly model: string;
  /** Tokens sent. */
  readonly inputTokens: number;
  /** Tokens received. */
  readonly outputTokens: number;
  /**
   * What it cost, in cents, or `null` when nothing prices it.
   *
   * `null` rather than `0` — the honesty rule the pricing service already enforces
   * (CH.3, [#586](https://github.com/NobuData/ouroboros/issues/586)): a local model's tokens
   * are *unpriced*, which is a different statement from *free*, and a zero here would be
   * spend nobody incurred appearing in an aggregate.
   */
  readonly costCents: number | null;
}

/**
 * A hop finished, one way or another — the telemetry AB.2 aggregates.
 *
 * Emitted for every hop that was *attempted*, so a chain that failed over twice produces
 * three of these and a reader can see the failover the routing explanation promised.
 */
export interface InvokeHopEvent {
  readonly kind: "hop";
  /** Which hop. */
  readonly hop: number;
  /** The provider connection attempted. */
  readonly connection: string;
  /** How it ended. */
  readonly outcome: "ok" | "failed_over" | "aborted";
  /** Why, when it was not `ok`. */
  readonly code?: InvokeErrorCode;
  /** How long the attempt took, milliseconds — AB.2's latency input. */
  readonly latencyMs: number;
}

/** The invocation failed. Terminal: no further events follow. */
export interface InvokeErrorEvent {
  readonly kind: "error";
  /** Which hop was in flight, when one was. */
  readonly hop?: number;
  /** Which rule fired — see {@link INVOKE_ERROR_CODES}. */
  readonly code: InvokeErrorCode;
  /** A sentence for a person. Never a provider's own error text; see `error.envelope.ts`. */
  readonly message: string;
}

/** The invocation completed. Terminal: no further events follow. */
export interface InvokeDoneEvent {
  readonly kind: "done";
  /** Which hop served the answer — the one the run should be attributed to. */
  readonly hop: number;
  /** Why generation stopped, in the provider's own vocabulary. */
  readonly finishReason: string;
}

/** One line of the answer. */
export type InvokeEvent =
  InvokeDeltaEvent | InvokeUsageEvent | InvokeHopEvent | InvokeErrorEvent | InvokeDoneEvent;
