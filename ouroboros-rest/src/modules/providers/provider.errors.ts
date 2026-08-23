/**
 * The five words every adapter is allowed to fail in, and what each of them renders as.
 *
 * AC.1 ([#216](https://github.com/NobuData/ouroboros/issues/216)), roadmap decision **P1**.
 * This is the subtle half of the ticket and the reason the SPI is worth having at all: five
 * adapters ship in MVP and the add-card promises more, every one of them fails differently —
 * Anthropic's `401` shape, an Ollama daemon refusing a socket, Copilot's upstream `503` — and
 * three separate consumers have to say something about it. The card's status pill, the card
 * foot's test note, and Z.3's ([#196](https://github.com/NobuData/ouroboros/issues/196))
 * health snapshots all need *one* vocabulary. Without it the UI ends up pattern-matching on
 * prose, which works until an adapter author rewords a message.
 *
 * So the vocabulary is here, it is five values wide, and it is provider-neutral: nothing in
 * this file names a vendor.
 *
 * ---------------------------------------------------------------------------
 * **The mapping onto mockup 07's pills, which the ticket asks for as a table.**
 *
 * | Class | Pill | Tone | Retryable | `provider_connections.status` |
 * |---|---|---|:---:|---|
 * | *(none — the check passed)* | `connected` | ok | — | `active` |
 * | `auth` | `key rejected` | err | no | `error` |
 * | `network` | `unreachable` | err | yes | `error` |
 * | `upstream` | `degraded upstream` | warn | yes | `error` |
 * | `rate_limit` | `rate limited` | warn | yes | `error` |
 * | `config` | `needs configuration` | err | no | `error` |
 *
 * It is 1:1 in both directions — five classes, five distinct pills — and
 * `provider.errors.spec.ts` asserts the injectivity rather than trusting the table above to
 * stay true. The tones are the three mockup 07 defines (`.pill.ok`, `.pill.warn`,
 * `.pill.err` in `docs/mockups/assets/ouroboros.css`); `degraded upstream` and its `warn`
 * tone are lifted from the Copilot card verbatim.
 *
 * ---------------------------------------------------------------------------
 * **Why the last column is constant, and why it is still written down.**
 *
 * V015 gives a connection four statuses — `active`, `paused`, `error`, `unknown` — and none
 * of them means *working, but throttled*. So every failure coarsens to `error`, and pretending
 * otherwise would put a `rate_limit` on the same footing as a healthy provider for Z.1's
 * ([#194](https://github.com/NobuData/ouroboros/issues/194)) routing, which is the one
 * consumer that must not route to a provider currently refusing.
 *
 * The table stays because the coarsening is a *decision* rather than an absence. The pill is
 * the finer instrument and answers *why*; the column is the coarse routing signal and answers
 * *may I use this*. If V015 ever grows a fifth status, {@link PROVIDER_ERROR_STATUS} is the
 * one place that has to change and its spec is what notices.
 *
 * ---------------------------------------------------------------------------
 * **Why `config` is an error class and not a validation failure.**
 *
 * A connection whose base URL points at a web page rather than an API root fails in a way no
 * retry fixes and no credential explains: the provider answered, it just answered a `404` to
 * a listing route. Calling that `upstream` would put a permanent misconfiguration behind a
 * retrying pill, and calling it `network` would tell an operator to check a firewall. It is
 * the one class a person can always act on, which is why its pill reads `needs configuration`
 * and its retryable flag is `false`.
 */

import type { ProviderConnectionStatus } from "../db/schema";
import { failureCode } from "../errors/failure";

/**
 * Why a provider call failed, in provider-neutral terms.
 *
 * The whole vocabulary. An adapter that wants to say something this list cannot say should
 * be adding a class here — with a pill, a tone and a spec — rather than reaching for the
 * nearest one, because every consumer downstream is switching on exactly these five.
 */
export type ProviderErrorClass = "auth" | "network" | "upstream" | "rate_limit" | "config";

/**
 * The five classes as values, in the order this file's table declares them.
 *
 * Iterated by the conformance kit, which requires a recorded fixture for **each** of them
 * from every adapter — see `conformance.fixture.ts` for why there is no escape hatch.
 */
export const PROVIDER_ERROR_CLASSES = [
  "auth",
  "network",
  "upstream",
  "rate_limit",
  "config",
] as const satisfies readonly ProviderErrorClass[];

/**
 * The three pill tones mockup 07 defines.
 *
 * Named after the CSS classes rather than after colours — `.pill.ok`, `.pill.warn`,
 * `.pill.err` — so AE.2 ([#228](https://github.com/NobuData/ouroboros/issues/228)) renders a
 * pill by concatenating a class name and never by mapping a colour. A palette change in
 * `docs/mockups/assets/ouroboros.css` then costs nothing on this side.
 */
export type ProviderPillTone = "ok" | "warn" | "err";

/**
 * One status pill, as the card renders it.
 *
 * Two fields and no third: what the pill says and which class it carries. Anything else a
 * card shows — the meta row, the spend meter, the test note — comes from somewhere that is
 * not an error taxonomy.
 */
export interface ProviderStatusPill {
  /** Which of the three `.pill` modifiers to apply. */
  readonly tone: ProviderPillTone;
  /** What the pill says, lower-case, exactly as mockup 07 writes it. */
  readonly label: string;
}

/**
 * The pill a working connection carries — mockup 07's `<span class="pill ok">connected</span>`.
 *
 * Separate from {@link PROVIDER_ERROR_PILLS} because success is not an error class, and a
 * sixth entry in that record called `none` would be a value every consumer had to remember
 * to exclude when iterating the taxonomy.
 */
export const CONNECTED_PILL: ProviderStatusPill = Object.freeze({
  tone: "ok",
  label: "connected",
});

/**
 * Every error class, and the pill it renders as.
 *
 * A total `Record`, so a sixth class added to {@link ProviderErrorClass} does not compile
 * until somebody has decided what a card should say about it. That decision is the one thing
 * this file exists to force.
 */
export const PROVIDER_ERROR_PILLS: Readonly<Record<ProviderErrorClass, ProviderStatusPill>> =
  Object.freeze({
    // The credential was understood and refused. An administrator can fix this in a minute,
    // which is why the pill names the key rather than the provider.
    auth: Object.freeze({ tone: "err", label: "key rejected" }),
    // Nothing answered. Says nothing about the credential, and deliberately does not: a
    // pill that blamed a key for a closed socket would send somebody to rotate a good one.
    network: Object.freeze({ tone: "err", label: "unreachable" }),
    // The provider answered, and what it answered was its own failure. Mockup 07's Copilot
    // card, verbatim — the one pill in this table that was drawn before it was named.
    upstream: Object.freeze({ tone: "warn", label: "degraded upstream" }),
    // Working, and refusing anyway. `warn` rather than `err` because nothing is broken and
    // the next window will very likely succeed.
    rate_limit: Object.freeze({ tone: "warn", label: "rate limited" }),
    // The connection's own settings are wrong. See this file's header for why it is a class
    // of its own rather than the nearest of the other four.
    config: Object.freeze({ tone: "err", label: "needs configuration" }),
  });

/**
 * Whether trying the same call again could plausibly succeed without anybody changing
 * anything.
 *
 * Read by AF.2's ([#235](https://github.com/NobuData/ouroboros/issues/235)) chain executor to
 * decide whether a hop is worth retrying before falling through, and by AE.4
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)) to decide whether the card foot
 * says `retrying`. The two `false` entries are the two failures a retry can only waste time
 * on: a refused credential stays refused, and a wrong address stays wrong.
 */
export const PROVIDER_ERROR_RETRYABLE: Readonly<Record<ProviderErrorClass, boolean>> =
  Object.freeze({
    auth: false,
    network: true,
    upstream: true,
    rate_limit: true,
    config: false,
  });

/**
 * What each class means for `provider_connections.status`.
 *
 * Deliberately constant, and deliberately still a table — this file's header argues both
 * halves. Z.3 writes the column and Z.1 routes on it; neither should be inventing this
 * mapping at its own call site, and neither should have to re-derive it when V015's CHECK
 * gains a value.
 */
export const PROVIDER_ERROR_STATUS: Readonly<Record<ProviderErrorClass, ProviderConnectionStatus>> =
  Object.freeze({
    auth: "error",
    network: "error",
    upstream: "error",
    rate_limit: "error",
    config: "error",
  });

/**
 * The pill for one class.
 *
 * @param errorClass - The class, or `null` for a check that passed.
 * @returns The pill — {@link CONNECTED_PILL} for `null`, the class's own otherwise. A
 *   function rather than two lookups at each call site, because *success is a pill too* is
 *   the thing a caller most easily forgets.
 */
export function pillFor(errorClass: ProviderErrorClass | null): ProviderStatusPill {
  return errorClass === null ? CONNECTED_PILL : PROVIDER_ERROR_PILLS[errorClass];
}

/**
 * The class an HTTP status belongs to.
 *
 * Every adapter in AC.2–AC.5 talks HTTP and every one of them would otherwise write this
 * `switch` again, slightly differently — which is exactly the divergence the taxonomy exists
 * to prevent. An adapter whose provider needs a different reading of a status (a vendor that
 * answers `403` for a quota rather than for a credential) overrides *that status* and calls
 * this for the rest, rather than forking the whole table.
 *
 * @param status - The status the provider answered with. Must be a refusal — see `@throws`.
 * @returns The class.
 * @throws {RangeError} For anything below `300`. A success is not an error class, and a
 *   caller that reached here with a `200` has a bug this must not paper over by returning a
 *   plausible-looking `upstream`.
 */
export function classifyHttpStatus(status: number): ProviderErrorClass {
  if (status < 300) {
    throw new RangeError(`classifyHttpStatus expects a refusal, received ${status.toString()}`);
  }

  // A redirect that reached a caller is an address pointing one level above the API — a
  // console URL pasted into the Base URL field is the way this actually happens — so it is
  // the connection's settings rather than the provider's health.
  if (status < 400) {
    return "config";
  }

  if (status === 401 || status === 403 || status === 407) {
    return "auth";
  }

  // A server saying *you took too long* is the same fact a transport timeout reports, seen
  // from the other end. Grouping it with `config` because it is a 4xx would tell an operator
  // to check a field that is perfectly correct.
  if (status === 408) {
    return "network";
  }

  if (status === 429) {
    return "rate_limit";
  }

  if (status >= 500) {
    return "upstream";
  }

  // Every other 4xx: the provider understood the request and rejected it on its merits. For
  // a listing route built by an adapter, that means the address is not what it was taken to
  // be — a `404` from a base URL missing its `/v1`, a `400` from a gateway expecting a
  // tenant header. All of them are somebody's settings.
  return "config";
}

/**
 * How a refusal reads on the card foot.
 *
 * The vocabulary is `provider-health/probe.client.ts`'s, on purpose: `key rejected (401)`
 * already appears on mockup 06's health strip, and a person looking at the two pages should
 * not have to learn that they mean the same thing. `503 upstream` is the other direction —
 * mockup 07's test note is `△ 503 upstream · retrying`, and the `· retrying` half is the
 * card's to add from {@link PROVIDER_ERROR_RETRYABLE} rather than this function's to bake in.
 *
 * @param status - The status the provider answered with.
 * @returns A short phrase. Never a provider's own error body, which carries request headers
 *   often enough that reading one is not worth the times it does not.
 * @throws {RangeError} For anything below `300`, through {@link classifyHttpStatus}.
 */
export function describeHttpRefusal(status: number): string {
  const printed = status.toString();

  switch (classifyHttpStatus(status)) {
    case "auth":
      return `key rejected (${printed})`;
    case "rate_limit":
      return `rate limited (${printed})`;
    case "upstream":
      return `${printed} upstream`;
    case "network":
      return `timed out (${printed})`;
    case "config":
      return `responded ${printed}`;
  }
}

/** Shape of a symbolic error code worth putting in front of a person. */
const CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;

/**
 * Whether a caught value is a deadline rather than a refusal.
 *
 * An `AbortSignal.timeout()` abort arrives as a `DOMException`, which Node does **not** make
 * an `instanceof Error` — the same trap `provider-health/probe.client.ts` and `health/probe.ts`
 * each document. Checked by name for that reason.
 *
 * @param error - Whatever was caught.
 * @returns `true` when the call ran out of time.
 */
export function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error
    ? error.name === "TimeoutError"
    : false;
}

/**
 * A thrown transport failure, as a phrase fit for a card foot.
 *
 * Everything that reaches here is {@link ProviderErrorClass} `network` by construction: it is
 * the branch where no response existed at all. What varies is *why*, and the two answers
 * worth distinguishing are "it refused" and "it never finished" — an operator does different
 * things about each.
 *
 * @param error - Whatever was caught.
 * @param timeoutMs - The deadline the call was given, so the timeout phrase can name it. A
 *   parameter rather than a constant because each adapter sets its own.
 * @returns The phrase. At most a short symbolic code from the runtime — never its message,
 *   which carries the host, the port and sometimes the request headers.
 */
export function describeTransportFailure(error: unknown, timeoutMs: number): string {
  if (isTimeout(error)) {
    return `timed out after ${timeoutMs.toString()} ms`;
  }

  // `failureCode` is `errors/failure.ts`'s, and it is shared rather than re-derived because
  // it is the same two-line question `provider-health/probe.client.ts` already asks through it:
  // *what code did the runtime hang on this, looking through the wrapper `fetch` reports one
  // in*. What is deliberately **not** shared is that module's `describeForLog`, which is
  // written for an operator's log and carries a host, a port and sometimes request headers —
  // everything in this file is written to be rendered on a page.
  const code = failureCode(error);

  return code !== undefined && CODE_PATTERN.test(code) ? `unreachable (${code})` : "unreachable";
}

/**
 * A provider call that failed, as something a `catch` can bind.
 *
 * **Most failures are not this.** {@link import("./provider.adapter").ModelProviderAdapter.validate}
 * returns its failure as a value, for `provider-health/probe.client.ts`'s reason: a provider
 * being down is the state the card exists to render, and an exception would put a pill's
 * colour at the mercy of somebody's control flow. This class is for the members that have no
 * room for a failure in their return type — `discoverModels`, which answers a list, and
 * `pullModel`, which answers a stream — where the only honest way to report one is to throw.
 *
 * It carries the taxonomy so a caller that catches it has the same five words available that
 * a validation failure would have handed it. It carries **no cause and no provider body**:
 * whatever this is constructed from stays in the adapter, and what crosses the boundary is a
 * class and a phrase already fit to render.
 */
export class ProviderAdapterError extends Error {
  /**
   * @param errorClass - Which of the five this is.
   * @param detail - The phrase, from {@link describeHttpRefusal},
   *   {@link describeTransportFailure}, or the adapter's own words for a `config` failure.
   *   Becomes the error's `message` too, so a log line that only prints one is still useful.
   * @param httpStatus - The status the provider answered with, when there was one. Null for
   *   a transport failure and for a `config` failure found before any request was made.
   */
  constructor(
    readonly errorClass: ProviderErrorClass,
    readonly detail: string,
    readonly httpStatus: number | null = null,
  ) {
    super(detail);
    // Without this, `instanceof` works but `error.name` reads `Error` — and the name is what
    // reaches a log through `describeForLog`, which prints a stack whose first line would
    // otherwise say nothing about which layer failed.
    this.name = "ProviderAdapterError";
  }

  /**
   * Whether a caught value is one of these.
   *
   * Duck-typed rather than an `instanceof`, for the reason `registry.errors.ts` gives about
   * driver errors: an adapter compiled into a different copy of this module — which is what
   * a future plugin adapter would be — must still be recognised. The two fields checked are
   * the two a consumer reads.
   *
   * @param error - Whatever was caught.
   * @returns `true` when it carries a known class and a string detail.
   */
  static is(error: unknown): error is ProviderAdapterError {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const candidate = error as { errorClass?: unknown; detail?: unknown };

    return (
      typeof candidate.detail === "string" &&
      (PROVIDER_ERROR_CLASSES as readonly unknown[]).includes(candidate.errorClass)
    );
  }
}
