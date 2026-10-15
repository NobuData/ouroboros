/**
 * The chain executor's walk — AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)).
 *
 * ```
 * pre-flight: run cap spent? ─▶ error cost_cap_exceeded (no call)
 * for each planned hop:
 *   provider cap spent?      ─▶ hop failed_over cost_cap_exceeded (provider) ─▶ next hop
 *   open (one request scope) ─▶ invoke ─▶ delta… usage… done
 *     every delta and usage: run cap and provider cap re-checked; a breach stops the stream
 *   settle: usage row for this hop (even a failed one), usage event, hop event
 *   ok        ─▶ last_used_at, done
 *   advances  ─▶ next hop                    (5xx, timeout, 429 after back-off, auth, G8)
 *   aborts    ─▶ error                       (other 4xx, run cap, a hop that already streamed)
 * all hops failed ─▶ floor_exhausted when a floor applies, else chain_exhausted
 * ```
 *
 * Pure over {@link ExecutorPorts}: nothing here touches the database, the vault or a socket
 * directly, so the requirements doc's acceptance list is a set of unit tests.
 *
 * **The taxonomy is the contract's, in one table** ({@link codeOf}, {@link ADVANCES}). The
 * inspector tells a person what each hop catches, and this is the code that has to agree.
 *
 * **A hop that has already streamed text does not hand over.** Deltas are relayed as they
 * arrive (R6), and every engine consumer joins them into one answer; a second hop's text after
 * the first hop's would be one corrupted answer, not a failover. So the walk advances only
 * past hops that failed before their first delta, and a hop that fails after it aborts with
 * its own code — the stream already says which hop the text came from.
 *
 * **Usage rows hold what the provider reported**, per hop, attributed to the hop that served
 * it (R4). A cap is checked while streaming against an *estimate* — the provider's own count,
 * or the streamed characters over four when that is higher — because a stream that has not
 * reported its output yet must still be stoppable. The estimate is never stored.
 */

import {
  isTimeout,
  ProviderAdapterError,
  type ProviderErrorClass,
} from "../../providers/provider.errors";
import type {
  InvocationCapableAdapter,
  InvocationUsage,
  ProviderConnectionContext,
} from "../../providers/provider.adapter";
import {
  INVOKE_ERROR_CODES,
  type InvokeCap,
  type InvokeErrorCode,
  type InvokeEvent,
  type InvokeHopEvent,
} from "../invoke.contract";
import type { InvokePlan, PlannedHop } from "./invoke.plan";

/** Per-million-token rates, in cents. */
export interface TokenRates {
  readonly inputCentsPer1m: number;
  readonly outputCentsPer1m: number;
}

/** A provider connection's calendar-month cap and what it has spent this month, in cents. */
export interface ProviderMonth {
  readonly limitCents: number;
  readonly spentCents: number;
}

/** One hop's settled usage, as the executor hands it to be stored. */
export interface HopUsage {
  readonly hop: PlannedHop;
  readonly usage: InvocationUsage;
  /** Cents, or null when unpriced — never 0 for unpriced (R4). */
  readonly costCents: number | null;
  readonly latencyMs: number;
}

/** A hop's connection, opened. */
export interface OpenedHop {
  readonly adapter: InvocationCapableAdapter;
  readonly context: ProviderConnectionContext;
  /** The connection's calendar-month cap in cents (decision P7), or null for none. */
  readonly monthlyCapCents: number | null;
}

/**
 * Where the walk sends its events.
 *
 * A callback rather than an async generator: every generator between the provider's frame and
 * the worker's socket is a promise per token, and at 250 streams that layering was the CPU the
 * streaming criterion could not afford.
 */
export type Emit = (event: InvokeEvent) => void;

/** Everything the walk needs from outside itself. */
export interface ExecutorPorts {
  /**
   * Open the hop's connection for one hop — its retries included. Throws a classified
   * `ProviderAdapterError`. Answers the connection's monthly cap too, so the cap check needs
   * no second read of the row.
   */
  open(hop: PlannedHop): Promise<OpenedHop>;
  /** The hop's model's rates, or null when nothing prices it per token. */
  rates(hop: PlannedHop): Promise<TokenRates | null>;
  /** The run's priced spend before this call, in cents. */
  spent(): Promise<number>;
  /** What the hop's provider kind has spent this calendar month, in cents. */
  providerMonthSpent(hop: PlannedHop): Promise<number>;
  /** Store one hop's usage row. */
  record(usage: HopUsage): Promise<void>;
  /** Stamp the hop's connection's `last_used_at`. */
  touch(hop: PlannedHop): Promise<void>;
  /** Milliseconds on a monotonic clock. */
  now(): number;
  /** Wall time, for the hop event's `at`. */
  clock(): Date;
  /** Wait, or reject when the signal aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

/** The walk's bounds. */
export interface ExecutorOptions {
  /** Attempts on one hop when it answers 429, the first included. */
  readonly rateLimitAttempts: number;
  /** The back-off before the n-th retry, milliseconds; the last entry repeats. */
  readonly backoffMs: readonly number[];
  /** Silence after which a hop is treated as timed out, milliseconds. */
  readonly stallMs: number;
}

/**
 * The defaults: three attempts on a rate-limited hop with 1 s and 2 s between them — a bound
 * on attempts *and* on time, as `MODEL_PROVIDERS.md` § Retrying asks — and a minute of silence.
 */
export const EXECUTOR_DEFAULTS: ExecutorOptions = Object.freeze({
  rateLimitAttempts: 3,
  backoffMs: Object.freeze([1_000, 2_000]),
  stallMs: 60_000,
});

/** Characters per token for the in-flight cap estimate. Conservative for English and code. */
export const CHARS_PER_TOKEN = 4;

/** The codes that hand over to the next hop (R2, G3, G8). Everything else aborts. */
export const ADVANCES: ReadonlySet<InvokeErrorCode> = new Set<InvokeErrorCode>([
  INVOKE_ERROR_CODES.providerUnavailable,
  INVOKE_ERROR_CODES.providerRateLimited,
  INVOKE_ERROR_CODES.providerAuthFailed,
  INVOKE_ERROR_CODES.contextWindowExceeded,
  INVOKE_ERROR_CODES.modelNotFound,
]);

/** What each adapter class means as an invoke code (R2's table). */
const CLASS_CODES: Readonly<Record<ProviderErrorClass, InvokeErrorCode>> = Object.freeze({
  upstream: INVOKE_ERROR_CODES.providerUnavailable,
  network: INVOKE_ERROR_CODES.providerUnavailable,
  rate_limit: INVOKE_ERROR_CODES.providerRateLimited,
  auth: INVOKE_ERROR_CODES.providerAuthFailed,
  config: INVOKE_ERROR_CODES.requestInvalid,
});

/** The sentence an `error` event carries for each code. Ours, never the provider's (R2). */
export const ERROR_MESSAGES: Readonly<Record<InvokeErrorCode, string>> = Object.freeze({
  provider_unavailable: "The provider failed or did not answer in time.",
  provider_rate_limited: "The provider kept refusing with a rate limit after backing off.",
  provider_auth_failed: "The provider refused this connection's credential.",
  context_window_exceeded: "The prompt is longer than this model accepts.",
  model_not_found: "The provider does not have this model.",
  request_invalid: "The provider refused the request itself; another model would refuse it too.",
  floor_exhausted:
    "Every model down to the route's floor failed, and the floor stops the chain from going lower.",
  cost_cap_exceeded: "The run reached its spending cap.",
  chain_exhausted: "Every model in the route's chain failed.",
  vote_execution_unavailable: "This route needs a second opinion, which cannot run yet.",
  resolution_failed: "Routing refused this run, so no model was called.",
});

/** No usage at all. */
const NO_USAGE: InvocationUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/**
 * The invoke code for a caught failure.
 *
 * @param error - Whatever the adapter or the open threw.
 * @returns The code. An unclassified throw is `provider_unavailable`: the call failed for a
 *   reason that is not the request's, and the next hop may well serve it.
 */
export function codeOf(error: unknown): InvokeErrorCode {
  if (ProviderAdapterError.is(error)) {
    const refusal = error.refusal;

    if (refusal === "context_window_exceeded") {
      return INVOKE_ERROR_CODES.contextWindowExceeded;
    }

    if (refusal === "model_not_found") {
      return INVOKE_ERROR_CODES.modelNotFound;
    }

    return CLASS_CODES[error.errorClass];
  }

  return INVOKE_ERROR_CODES.providerUnavailable;
}

/**
 * What some usage cost.
 *
 * Cache reads and writes are charged at the input rate: the price catalog carries one input
 * rate, and for a cap a slight over-count is the safe direction.
 *
 * @param rates - The model's rates, or null.
 * @param usage - The tokens.
 * @returns Cents to four places, or null when unpriced (never 0 for unpriced).
 */
export function costOf(rates: TokenRates | null, usage: InvocationUsage): number | null {
  if (rates === null) {
    return null;
  }

  const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const cents =
    (input * rates.inputCentsPer1m + usage.outputTokens * rates.outputCentsPer1m) / 1_000_000;

  return Math.round(cents * 10_000) / 10_000;
}

/** How one hop ended. */
type HopResult =
  | { readonly ok: true; readonly finishReason: string }
  | {
      readonly ok: false;
      readonly code: InvokeErrorCode;
      readonly cap?: InvokeCap;
      readonly streamed: boolean;
    }
  | { readonly ok: false; readonly cancelled: true };

/** Mutable totals for one invocation. */
interface Tally {
  /** Priced spend this invocation has settled, in cents. */
  spentHere: number;
  /** Whether a cap applied while some usage was unpriced (G6). */
  unpricedNotCounted: boolean;
}

/**
 * Walk a plan, streaming the contract's events.
 *
 * @param plan - What to walk.
 * @param payload - The worker's payload; each hop's params are merged over it.
 * @param ports - The outside world.
 * @param signal - Aborts when the caller goes away; the walk then stops without an event.
 * @param emit - Receives each event as it happens — `delta`, `usage`, `hop`, and one terminal
 *   `done` or `error`, unless the caller left. Synchronous: an event is written as it arrives
 *   (R6), with no generator between the provider's frame and the caller's socket.
 * @param options - The bounds.
 * @returns When the walk has ended.
 */
export async function execute(
  plan: InvokePlan,
  payload: Readonly<Record<string, unknown>>,
  ports: ExecutorPorts,
  signal: AbortSignal,
  emit: Emit,
  options: ExecutorOptions = EXECUTOR_DEFAULTS,
): Promise<void> {
  const spentBefore = plan.cap === null ? 0 : await ports.spent();

  if (plan.cap !== null && spentBefore >= plan.cap.limitCents) {
    const cap: InvokeCap = { ...plan.cap, spentCents: spentBefore };

    emit({
      kind: "error",
      code: INVOKE_ERROR_CODES.costCapExceeded,
      message: capMessage(cap),
      cap,
    });
    return;
  }

  const tally: Tally = { spentHere: 0, unpricedNotCounted: false };

  for (const hop of plan.hops) {
    const started = ports.now();
    const result = await runHop(
      hop,
      plan,
      payload,
      ports,
      signal,
      emit,
      options,
      spentBefore,
      tally,
    );

    if ("cancelled" in result) {
      return;
    }

    const latencyMs = Math.max(0, Math.round(ports.now() - started));

    if (result.ok) {
      await ports.touch(hop);
      emit(hopEvent(hop, "ok", latencyMs, ports.clock()));
      emit({
        kind: "done",
        hop: hop.index,
        finishReason: result.finishReason,
        ...(tally.unpricedNotCounted ? { unpricedNotCounted: true } : {}),
      });
      return;
    }

    const handsOver =
      plan.chained &&
      !result.streamed &&
      (ADVANCES.has(result.code) || result.cap?.source === "provider");

    emit(hopEvent(hop, handsOver ? "failed_over" : "aborted", latencyMs, ports.clock(), result));

    if (!handsOver) {
      emit({
        kind: "error",
        hop: hop.index,
        code: result.code,
        message: result.cap === undefined ? ERROR_MESSAGES[result.code] : capMessage(result.cap),
        ...(result.cap === undefined ? {} : { cap: result.cap }),
      });
      return;
    }
  }

  const code =
    plan.floorPosition === null
      ? INVOKE_ERROR_CODES.chainExhausted
      : INVOKE_ERROR_CODES.floorExhausted;

  const reason = code === INVOKE_ERROR_CODES.floorExhausted ? plan.floorReason : null;

  emit({
    kind: "error",
    code,
    message: reason === null ? ERROR_MESSAGES[code] : `${ERROR_MESSAGES[code]} ${reason}`,
  });
}

/**
 * Attempt one hop — with bounded retries on a rate limit — streaming its deltas.
 *
 * @returns How the hop ended. Its usage has been stored and its `usage` event emitted.
 */
async function runHop(
  hop: PlannedHop,
  plan: InvokePlan,
  payload: Readonly<Record<string, unknown>>,
  ports: ExecutorPorts,
  signal: AbortSignal,
  emit: Emit,
  options: ExecutorOptions,
  spentBefore: number,
  tally: Tally,
): Promise<HopResult> {
  let opened: OpenedHop;

  try {
    opened = await ports.open(hop);
  } catch (error) {
    return { ok: false, code: codeOf(error), streamed: false };
  }

  const limit = opened.monthlyCapCents;
  const [rates, month] = await Promise.all([
    ports.rates(hop),
    limit === null
      ? Promise.resolve(null)
      : ports
          .providerMonthSpent(hop)
          .then((spentCents): ProviderMonth => ({ limitCents: limit, spentCents })),
  ]);

  if (month !== null && month.spentCents >= month.limitCents) {
    return {
      ok: false,
      code: INVOKE_ERROR_CODES.costCapExceeded,
      cap: { source: "provider", limitCents: month.limitCents, spentCents: month.spentCents },
      streamed: false,
    };
  }

  for (let attempt = 1; ; attempt += 1) {
    const result = await attemptHop(hop, plan, payload, ports, signal, emit, options, {
      opened,
      spentBefore,
      tally,
      rates,
      month,
    });

    const retry =
      !("cancelled" in result) &&
      !result.ok &&
      !result.streamed &&
      result.code === INVOKE_ERROR_CODES.providerRateLimited &&
      attempt < options.rateLimitAttempts;

    if (!retry) {
      return result;
    }

    const delays = options.backoffMs;

    try {
      await ports.sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0, signal);
    } catch {
      return { ok: false, cancelled: true };
    }
  }
}

/** What one attempt reads but does not own. */
interface AttemptState {
  readonly opened: OpenedHop;
  readonly spentBefore: number;
  readonly tally: Tally;
  readonly rates: TokenRates | null;
  readonly month: ProviderMonth | null;
}

/**
 * One call to one hop.
 *
 * @returns How the attempt ended.
 */
async function attemptHop(
  hop: PlannedHop,
  plan: InvokePlan,
  payload: Readonly<Record<string, unknown>>,
  ports: ExecutorPorts,
  signal: AbortSignal,
  emit: Emit,
  options: ExecutorOptions,
  state: AttemptState,
): Promise<HopResult> {
  const controller = new AbortController();
  const onCallerGone = (): void => {
    controller.abort();
  };
  let stalled = false;
  // One timer, refreshed per chunk: a `clearTimeout` + `setTimeout` per token is real CPU at
  // tens of thousands of tokens a second.
  const stall = setTimeout(() => {
    stalled = true;
    controller.abort();
  }, options.stallMs);

  signal.addEventListener("abort", onCallerGone, { once: true });

  const started = ports.now();
  let usage = NO_USAGE;
  let reported = false;
  let characters = 0;
  let streamed = false;
  let finishReason: string | null = null;
  let cap: InvokeCap | undefined;
  let failure: unknown = null;

  try {
    const calls = state.opened.adapter.invoke(state.opened.context, {
      modelId: hop.modelId,
      payload: { ...payload, ...hop.params },
      signal: controller.signal,
    });

    for await (const chunk of calls) {
      stall.refresh();

      if (chunk.kind === "done") {
        finishReason = chunk.finishReason;
        break;
      }

      if (chunk.kind === "delta") {
        streamed = true;
        characters += chunk.text.length;
        emit({ kind: "delta", hop: hop.index, text: chunk.text });
      } else {
        usage = chunk.usage;
        reported = true;
      }

      cap = breach(plan, state, estimate(usage, characters));

      if (cap !== undefined) {
        controller.abort();
        break;
      }
    }
  } catch (error) {
    failure = stalled ? new ProviderAdapterError("network", "stalled") : error;
  } finally {
    clearTimeout(stall);
    signal.removeEventListener("abort", onCallerGone);
  }

  if (reported || streamed) {
    const costCents = costOf(state.rates, usage);

    await ports.record({
      hop,
      usage,
      costCents,
      latencyMs: Math.max(0, Math.round(ports.now() - started)),
    });
    state.tally.spentHere += costCents ?? 0;
    state.tally.unpricedNotCounted ||= costCents === null && plan.cap !== null;
    emit({
      kind: "usage",
      hop: hop.index,
      connection: hop.connectionId,
      model: hop.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costCents,
    });
  }

  if (signal.aborted) {
    return { ok: false, cancelled: true };
  }

  if (cap !== undefined) {
    return { ok: false, code: INVOKE_ERROR_CODES.costCapExceeded, cap, streamed };
  }

  if (failure !== null || finishReason === null) {
    const code =
      failure !== null && !isTimeout(failure)
        ? codeOf(failure)
        : INVOKE_ERROR_CODES.providerUnavailable;

    return { ok: false, code, streamed };
  }

  return { ok: true, finishReason };

  /**
   * The cap this attempt has crossed, if any.
   *
   * @returns The run cap first — it aborts — then the provider cap.
   */
  function breach(
    walked: InvokePlan,
    known: AttemptState,
    inFlight: InvocationUsage,
  ): InvokeCap | undefined {
    const cost = costOf(known.rates, inFlight);

    if (cost === null) {
      return undefined;
    }

    const runSpent = known.spentBefore + known.tally.spentHere + cost;

    if (walked.cap !== null && runSpent >= walked.cap.limitCents) {
      return { ...walked.cap, spentCents: round(runSpent) };
    }

    const monthSpent = (known.month?.spentCents ?? 0) + cost;

    if (known.month !== null && monthSpent >= known.month.limitCents) {
      return {
        source: "provider",
        limitCents: known.month.limitCents,
        spentCents: round(monthSpent),
      };
    }

    return undefined;
  }
}

/**
 * The in-flight estimate a cap is checked against.
 *
 * @param usage - What the provider has reported.
 * @param characters - What has streamed.
 * @returns The usage, with output raised to the streamed characters' worth when that is more.
 */
export function estimate(usage: InvocationUsage, characters: number): InvocationUsage {
  return {
    ...usage,
    outputTokens: Math.max(usage.outputTokens, Math.ceil(characters / CHARS_PER_TOKEN)),
  };
}

/**
 * Cents to four places.
 *
 * @param cents - Any amount.
 * @returns It, rounded.
 */
function round(cents: number): number {
  return Math.round(cents * 10_000) / 10_000;
}

/**
 * The sentence naming a cap (*"a designed error naming the cap"*).
 *
 * @param cap - The cap.
 * @returns The message.
 */
export function capMessage(cap: InvokeCap): string {
  const limit = `$${(cap.limitCents / 100).toFixed(2)}`;

  switch (cap.source) {
    case "route":
      return `The route's per-run cap of ${limit} was reached.`;
    case "spend_guard":
      return `The org policy's spend guard of ${limit} per run was reached.`;
    case "worker":
      return `The caller's cap of ${limit} for this run was reached.`;
    case "provider":
      return `This provider connection's monthly cap of ${limit} was reached.`;
  }
}

/**
 * One hop's telemetry (R8, with G7's alias and timestamp).
 *
 * @returns The event.
 */
function hopEvent(
  hop: PlannedHop,
  outcome: InvokeHopEvent["outcome"],
  latencyMs: number,
  at: Date,
  failed?: { readonly code: InvokeErrorCode; readonly cap?: InvokeCap },
): InvokeHopEvent {
  return {
    kind: "hop",
    hop: hop.index,
    connection: hop.connectionId,
    alias: hop.alias,
    outcome,
    ...(failed === undefined ? {} : { code: failed.code }),
    ...(failed?.cap === undefined ? {} : { cap: failed.cap }),
    latencyMs,
    at: at.toISOString(),
  };
}
