/**
 * The four words every ticket-source provider is allowed to fail in, and the sentence each one
 * becomes on a settings row.
 *
 * Q.2 ([#139](https://github.com/NobuData/ouroboros/issues/139)), roadmap decisions **P5** and
 * **P6**. The issue names the taxonomy and what it is for in one line — *"a provider-neutral
 * error taxonomy (auth / rate-limit / not-found / upstream) that maps onto
 * `ticket_sources.status` with honest, UI-facing reasons"* — and the acceptance criterion
 * spells out what *honest* means: `rate limited until 14:20`, **not** `error`.
 *
 * ---------------------------------------------------------------------------
 * **Why a vocabulary rather than each provider's own words.**
 *
 * Five kinds are in `ticket_sources_kind` and `custom` is in it from the start, so the set of
 * ways a sync can fail is open by construction: GitHub answers `401` with a JSON body, Jira
 * answers `403` for a permission and `401` for a credential, Linear puts errors inside a `200`
 * GraphQL envelope, and a self-hosted GitLab behind a misconfigured proxy answers HTML. Three
 * consumers have to say something about all of that — the status dot, the sentence under it,
 * and whether the loop should bother again — and without one vocabulary each of them ends up
 * pattern-matching on prose, which works until somebody rewords a message.
 *
 * So the vocabulary is here, it is four values wide, and **no tracker is named anywhere below
 * this header** — not in a phrase, not in a branch, not in a comment beside one.
 * `ticket-source.errors.spec.ts` asserts that literally, over the file's own source with this
 * comment stripped off. The header itself names all five, because naming the five ways the
 * same failure arrives is the argument for having one word for it, and a rule that forbade
 * that would have forbidden the explanation rather than the coupling.
 *
 * ---------------------------------------------------------------------------
 * **The mapping the issue asks for, as a table.**
 *
 * | Class        | `ticket_sources.status` | `status_reason`                   | Retryable |
 * |--------------|-------------------------|-----------------------------------|:---------:|
 * | `auth`       | `error`                 | `credentials rejected (401)`      | no        |
 * | `rate_limit` | `error`                 | `rate limited until 14:20 UTC`    | yes       |
 * | `not_found`  | `error`                 | `project or repository not found` | no        |
 * | `upstream`   | `error`                 | `tracker unavailable (503)`       | yes       |
 *
 * **Why the status column is constant, and why it is still written down.** V030 gives a source
 * three statuses — `active`, `paused`, `error` — and none of them means *working, but
 * throttled*. So every failure coarsens to `error`, and pretending otherwise would put a
 * throttled source on the same footing as a healthy one for the loop's own filter, which is
 * the one consumer that must not keep hammering a tracker that is refusing. The table stays
 * because the coarsening is a **decision** rather than an absence: if V030's CHECK ever grows
 * a fourth value, {@link TICKET_SOURCE_ERROR_STATUS} is the one place that changes and its
 * spec is what notices. `provider.errors.ts` makes exactly this argument for model providers,
 * and the shape is deliberately the same one.
 *
 * **`status_reason` is the finer instrument**, and V031 is the column it lives in. All four
 * classes answer *may the loop poll this* identically; only the reason answers *what should
 * somebody do about it*, and those four answers are four different people's jobs — rotate a
 * token, wait, fix a project key, wait for somebody else.
 *
 * ---------------------------------------------------------------------------
 * **Four classes, and the two that could have been more.**
 *
 * The issue lists exactly these four and this file has exactly these four. Two omissions are
 * worth stating, because both are classes `provider.errors.ts` has and this does not:
 *
 *   * **No `network`.** A tracker that cannot be reached is `upstream` here. The distinction
 *     matters for a *model provider* because Ollama may be a daemon on the operator's own box,
 *     where a closed socket is their problem; every tracker in this set is somebody else's
 *     service across the internet, and *"we could not reach it"* and *"it answered 503"* are
 *     the same sentence to the person reading the row.
 *   * **No `config`.** A base URL pointing at a web page produces a `404` or a `401` from
 *     whatever answers, and it is {@link TicketSourceErrorClass} `not_found` — which is the
 *     honest reading, because that is also what a real but mistyped project key produces and
 *     the row cannot tell them apart. What can is `validateConfig`, which runs while somebody
 *     is looking at the form rather than in a background loop, and returns a **value**.
 *
 * A fifth class added later is one entry in each of the three total records below, plus a
 * phrase and a spec. Nothing switches on this union outside this file.
 */

import type { TicketSourceStatus } from "../db/schema";

/**
 * Why a ticket-source call failed, in provider-neutral terms.
 *
 * The whole vocabulary. A provider that wants to say something this list cannot say should be
 * adding a class here — with a status, a phrase, a retryable flag and a spec — rather than
 * reaching for the nearest one.
 */
export type TicketSourceErrorClass = "auth" | "rate_limit" | "not_found" | "upstream";

/**
 * The four as values, in the order the issue lists them.
 *
 * Iterated by the suites, and by Q.5's conformance kit
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)), which will require a recorded
 * fixture for each of them from every provider.
 */
export const TICKET_SOURCE_ERROR_CLASSES = [
  "auth",
  "rate_limit",
  "not_found",
  "upstream",
] as const satisfies readonly TicketSourceErrorClass[];

/**
 * What each class means for `ticket_sources.status`.
 *
 * Deliberately constant, and deliberately still a table — this file's header argues both
 * halves. A total `Record`, so a fifth class does not compile until somebody has decided what
 * the loop's own filter should do about it.
 */
export const TICKET_SOURCE_ERROR_STATUS: Readonly<
  Record<TicketSourceErrorClass, TicketSourceStatus>
> = Object.freeze({
  auth: "error",
  rate_limit: "error",
  not_found: "error",
  upstream: "error",
});

/**
 * Whether polling again could plausibly succeed without anybody changing anything.
 *
 * The two `false` entries are the two failures a retry can only waste time on: a refused
 * credential stays refused until it is rotated, and a project that is not there stays absent
 * until somebody fixes the configuration. Read by the loop's log line rather than by its
 * schedule — the cadence is the same either way, because a source nobody is watching costs one
 * request per interval and a source somebody *is* watching should recover on its own the
 * moment they fix it.
 */
export const TICKET_SOURCE_ERROR_RETRYABLE: Readonly<Record<TicketSourceErrorClass, boolean>> =
  Object.freeze({
    auth: false,
    rate_limit: true,
    not_found: false,
    upstream: true,
  });

/**
 * The sentence each class becomes, before anything specific is appended.
 *
 * Written in the second person's problem rather than in the system's: `credentials rejected`
 * rather than `401 Unauthorized`, because the row is read by somebody deciding whether this is
 * theirs to fix. The vocabulary is `provider-health/probe.client.ts`'s and
 * `provider.errors.ts`'s on purpose — a person looking at the providers page and the sources
 * page should not have to learn that two phrasings mean the same thing.
 */
export const TICKET_SOURCE_ERROR_REASONS: Readonly<Record<TicketSourceErrorClass, string>> =
  Object.freeze({
    // The credential was understood and refused. Names the credential rather than the tracker,
    // because that is the thing somebody can go and change.
    auth: "credentials rejected",
    // Working, and refusing anyway. The window is what makes this sentence worth reading, and
    // {@link statusReasonFor} appends it when a provider supplied one.
    rate_limit: "rate limited",
    // The project, the repository or the site is not there — or the credential cannot see it,
    // which is indistinguishable from the outside and is why the phrase does not guess.
    not_found: "project or repository not found",
    // The tracker answered, and what it answered was its own failure; or it did not answer at
    // all. See this file's header on why those are one class here.
    upstream: "tracker unavailable",
  });

/**
 * What `ticket_sources_status_reason_present` (V031) permits.
 *
 * The bound is the database's, restated here so the composer can be **held** to it rather
 * than discover it as a `23514` inside a background loop that nobody is watching.
 *
 * There is deliberately no truncation in {@link statusReasonFor}. Every part of every
 * sentence it can compose is fixed by this file — four phrases, a clock time of known width,
 * and a three-digit status — so a value that exceeded this could only come from editing one
 * of the phrases, and a run-time guard would turn that mistake into a silent ellipsis instead
 * of a red test. `ticket-source.errors.spec.ts` is the check, over every class and every
 * branch, which is the form a bound with finitely many inputs should take.
 */
export const MAX_STATUS_REASON = 200;

/**
 * A tracker's clock time, as a status line renders it.
 *
 * **UTC, and it says so.** The acceptance criterion's example is `rate limited until 14:20`,
 * and a bare `14:20` is the one part of it that cannot be written honestly here: this string is
 * composed in a background loop on a self-hosted server and read in a browser that is very
 * often somewhere else, so a time with no zone is a time the reader will get wrong by however
 * many hours they are from the host. Naming the zone costs four characters and is the
 * difference between a sentence somebody can act on and one they have to distrust.
 *
 * @param instant - When the window lifts.
 * @returns `14:20 UTC`. Whole minutes: a rate-limit window is not accurate to the second, and a
 *   second-precision time claims it is.
 */
export function formatClock(instant: Date): string {
  const hours = instant.getUTCHours().toString().padStart(2, "0");
  const minutes = instant.getUTCMinutes().toString().padStart(2, "0");

  return `${hours}:${minutes} UTC`;
}

/**
 * The sentence `ticket_sources.status_reason` holds for one failure.
 *
 * The acceptance criterion, as a function: *"provider errors map to source status with honest
 * UI-facing reasons (`rate limited until 14:20`, not `error`)"*. Composed here rather than by
 * each provider so that the four classes read the same whichever tracker produced them — which
 * is the whole of what makes the sentence *provider-neutral* rather than merely short.
 *
 * Three things can appear, in this order and never more than two of them:
 *
 *   * the class's own phrase, always;
 *   * ` until 14:20 UTC`, when the provider said when the window lifts;
 *   * ` (503)`, when the tracker answered with a status and no window was given.
 *
 * A retry time wins over a status code because it is the half a person can act on: *when* beats
 * *what* for the one class where waiting is the answer.
 *
 * **The provider's own `detail` is not one of them**, and that omission is the whole of how
 * this function keeps a credential off a settings page. A `detail` is written by a provider
 * from whatever a tracker answered, and tracker error bodies quote request headers; a sentence
 * assembled only from this file's own phrases cannot carry one however carelessly a provider
 * was written. The `detail` still reaches a log, where the audience is an operator rather than
 * a page — see `ticket-sources.service.ts`.
 *
 * @param error - What the provider reported.
 * @returns The sentence, never blank and never longer than {@link MAX_STATUS_REASON} — both
 *   are `ticket_sources_status_reason_present`'s rules, and both hold by construction rather
 *   than by a guard. See {@link MAX_STATUS_REASON}.
 */
export function statusReasonFor(error: TicketSourceError): string {
  const base = TICKET_SOURCE_ERROR_REASONS[error.errorClass];

  if (error.retryAt !== null) {
    return `${base} until ${formatClock(error.retryAt)}`;
  }

  return error.httpStatus !== null ? `${base} (${error.httpStatus.toString()})` : base;
}

/**
 * The class an HTTP status belongs to.
 *
 * Every provider that talks HTTP would otherwise write this `switch` again, slightly
 * differently — which is exactly the divergence the taxonomy exists to prevent. A provider
 * whose tracker needs a different reading of one status (a site that answers `403` for a
 * project it cannot see rather than for a bad credential) overrides *that status* and calls
 * this for the rest, rather than forking the whole table.
 *
 * @param status - The status the tracker answered with. Must be a refusal — see `@throws`.
 * @returns The class.
 * @throws {RangeError} For anything below `300`. A success is not an error class, and a caller
 *   that reached here with a `200` has a bug this must not paper over by returning a
 *   plausible-looking `upstream`. Note that a GraphQL tracker's errors *do* arrive inside a
 *   `200`; the provider reads those out of the body and constructs the class itself, which is
 *   why this function refuses rather than accommodates.
 */
export function classifyHttpStatus(status: number): TicketSourceErrorClass {
  if (status < 300) {
    throw new RangeError(`classifyHttpStatus expects a refusal, received ${status.toString()}`);
  }

  // A redirect that reached a caller is an address pointing somewhere other than the API — a
  // browser URL pasted into a Base URL field is how this actually happens — and the row cannot
  // distinguish that from a project key that is wrong. Both are `not_found`, which is the
  // phrase that sends somebody to the right form either way.
  if (status < 400) {
    return "not_found";
  }

  if (status === 401 || status === 403 || status === 407) {
    return "auth";
  }

  // A server saying *you took too long* is the same fact a transport timeout reports, seen from
  // the other end — and this taxonomy has one class for both.
  if (status === 408) {
    return "upstream";
  }

  if (status === 429) {
    return "rate_limit";
  }

  if (status >= 500) {
    return "upstream";
  }

  // Every other 4xx: the tracker understood the request and rejected it on its merits. For a
  // listing call that means the address is not what it was taken to be — a `404` from a project
  // key that does not exist, a `400` from a gateway expecting a tenant header.
  return "not_found";
}

/**
 * A provider call that failed, as something a `catch` can bind.
 *
 * **Most failures are this.** `validateConfig` returns its failure as a *value*, because *is
 * this configuration any good* is the question a form is asking and an exception would put a
 * form's own control flow in charge of the answer. The sync members have no room for a failure
 * in their return type — each answers a page of tickets — so the only honest way to report one
 * is to throw, and this is what they throw.
 *
 * It carries **no cause and no response body**. Whatever this was constructed from stays inside
 * the provider: a tracker's error body quotes request headers often enough that reading one is
 * not worth the times it does not, and this value's destination is a database column that a
 * settings page renders. The same rule means it never carries a credential — see
 * `ticket-source.errors.spec.ts`, which asserts a round trip of every branch above against a
 * credential-shaped string.
 */
export class TicketSourceError extends Error {
  /**
   * @param errorClass - Which of the four this is.
   * @param detail - What happened, in words already fit to appear in a log beside the source's
   *   display name. Becomes the error's `message`. **Not** the status reason — that is
   *   {@link statusReasonFor}'s, composed from the class so every provider's rows read the
   *   same — which is why a provider may be as specific here as it likes without making a
   *   settings page inconsistent.
   * @param retryAt - When a rate-limit window lifts, or null. The one piece of provider
   *   knowledge that reaches a person's screen unchanged, because there is no neutral way to
   *   say *when* and no reason to hide it.
   * @param httpStatus - The status the tracker answered with, when there was one. Null for a
   *   transport failure and for an error read out of a `200` GraphQL envelope.
   */
  constructor(
    readonly errorClass: TicketSourceErrorClass,
    readonly detail: string,
    readonly retryAt: Date | null = null,
    readonly httpStatus: number | null = null,
  ) {
    super(detail);
    // Without this, `instanceof` works but `error.name` reads `Error` — and the name is what
    // reaches a log through `describeForLog`, whose first line would otherwise say nothing
    // about which layer failed.
    this.name = "TicketSourceError";
  }

  /**
   * Whether a caught value is one of these.
   *
   * Duck-typed rather than an `instanceof`, for the reason `provider.errors.ts` gives: a
   * provider compiled into a different copy of this module — which is what a community
   * provider loaded at run time would be — must still be recognised. The two fields checked are
   * the two the loop reads.
   *
   * @param error - Whatever was caught.
   * @returns `true` when it carries a known class and a string detail.
   */
  static is(error: unknown): error is TicketSourceError {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    const candidate = error as { errorClass?: unknown; detail?: unknown };

    return (
      typeof candidate.detail === "string" &&
      (TICKET_SOURCE_ERROR_CLASSES as readonly unknown[]).includes(candidate.errorClass)
    );
  }
}
