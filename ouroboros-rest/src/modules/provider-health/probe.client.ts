/**
 * The one place this module talks to a provider — and the reason it can be audited in a
 * single file.
 *
 * **Every request it makes is a `GET`, and none of them carries a body.** That is not a
 * convention, it is the ticket's explicit, testable non-goal: decision **M8** refuses
 * synthetic completions, and the way to refuse them credibly is to build a client that has no
 * way to send one. {@link ProviderProbe.run} takes a {@link ProviderCheck} — a path from
 * `checks.ts`'s frozen table — and there is no parameter for a method, a body or a model.
 * `probe.client.spec.ts` drives every entry in that table through a `fetch` stand-in and
 * asserts the method and the absent body on each, rather than on a representative one.
 *
 * ---------------------------------------------------------------------------
 * **A plain `fetch`, for the reason `health/engine.health.ts` gives.** Node 24's global
 * `fetch` *is* undici, which is the client the ticket's technical stack names; adding the
 * package as a direct dependency would put a second HTTP client in the process to make the
 * same call the runtime already makes. What a probe needs from a client is a deadline and a
 * status code, and it has both.
 *
 * ---------------------------------------------------------------------------
 * **Failures are values.** Nothing here throws for a provider that is down, refusing, slow or
 * answering nonsense — those are the states the strip exists to render, and an exception
 * would make the sweep's control flow the place where a chip's colour is decided. The only
 * thing that escapes is a bug in this file.
 *
 * ---------------------------------------------------------------------------
 * **What this file may never learn to do.** It receives an opened credential as a parameter,
 * for one kind, for the length of one call, and it does not read it, store it, log it or put
 * it anywhere but a request header built by the check's own `authorize`. It logs nothing at
 * all — the sweep does the logging, from a value that cannot contain a key.
 */

import { Injectable } from "@nestjs/common";

import { failureCode } from "../errors/failure";
import { PROBE_TIMEOUT_MS } from "./cadence";
import type { ProviderCheck } from "./checks";

/** A check that answered. */
export interface ProbeSuccess {
  readonly ok: true;
  /**
   * How long the provider took, in whole milliseconds.
   *
   * Measured across the request and, where the body is read, the read — because a daemon that
   * answers its headers instantly and dribbles its body is slow in the way a person watching
   * the strip cares about. Never negative, which V015's CHECK also requires.
   */
  readonly latencyMs: number;
  /**
   * How many models the provider listed, or null when this check does not enumerate them or
   * the answer could not be read as a list.
   *
   * Null rather than zero for an unreadable body — see `snapshot.ts`. The provider answered,
   * so the check succeeded; what it served just was not something this module understands.
   */
  readonly models: number | null;
}

/** A check that did not answer, or answered a refusal. */
export interface ProbeFailure {
  readonly ok: false;
  /**
   * Why, in a phrase — `unreachable (ECONNREFUSED)`, `timed out after 5000 ms`,
   * `key rejected (401)`, `responded 503`.
   *
   * Short and classified rather than the runtime's own message, which carries the host, the
   * port and sometimes the request headers. The strip is a page in a browser; a driver's
   * error text is written for a server log and belongs in one.
   *
   * **No latency accompanies a failure.** A timeout's "latency" is the deadline, and a
   * refusal's is how fast the refusal came — neither is what the word means on a chip.
   */
  readonly detail: string;
}

/** What one check found. */
export type ProbeOutcome = ProbeSuccess | ProbeFailure;

/** Shape of a symbolic error code worth putting in front of a person. */
const CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;

/**
 * Was this a deadline rather than a refusal?
 *
 * An `AbortSignal.timeout()` abort arrives as a `DOMException`, which Node does **not** make
 * an `instanceof Error` — a check written against `Error` would report every timed-out probe
 * as a plain failure. `health/probe.ts` learned the same thing; the test that keeps it true
 * lives beside each.
 *
 * @param error - Whatever was caught.
 * @returns `true` when the probe ran out of time.
 */
function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error
    ? error.name === "TimeoutError"
    : false;
}

/**
 * A thrown thing, as a phrase fit for a chip.
 *
 * `health/probe.ts`'s `describeFailure` is deliberately not reused: its timeout phrase is
 * bound to *its* deadline, its audience is an unauthenticated readiness poller, and its
 * vocabulary says *failed* where this one has to say *unreachable* — a strip's reader is
 * deciding whether a provider is worth routing to, not whether a container should be
 * restarted.
 *
 * @param error - Whatever was caught.
 * @returns The phrase. Never the runtime's own message; at most a short symbolic code.
 */
export function describeProbeFailure(error: unknown): string {
  if (isTimeout(error)) {
    return `timed out after ${PROBE_TIMEOUT_MS.toString()} ms`;
  }

  const code = failureCode(error);

  return code !== undefined && CODE_PATTERN.test(code) ? `unreachable (${code})` : "unreachable";
}

/**
 * How a non-`2xx` reads, given what the check was asking.
 *
 * The distinction is the point of the key-validation check: a `401` or a `403` from a
 * credentialled request is not "the provider is down", it is "this key is no longer good",
 * which is a thing an administrator can act on within a minute and the single most common way
 * a working cloud provider stops working.
 *
 * @param check - The check that was performed.
 * @param status - The status the provider answered with.
 * @returns The phrase.
 */
export function describeRefusal(check: ProviderCheck, status: number): string {
  const rejected = status === 401 || status === 403;

  return check.check === "key_validation" && rejected
    ? `key rejected (${status.toString()})`
    : `responded ${status.toString()}`;
}

/**
 * How many models a body lists, if it lists any.
 *
 * @param body - The parsed response, which is `unknown` because a provider is not a source of
 *   types — a server answering `null`, a number or an object with the wrong field is a case
 *   this has to survive rather than a case that cannot happen.
 * @param inventory - The field whose array length is the count.
 * @returns The count, or null when the body is not an object, the field is absent, or it is
 *   not an array.
 */
export function countModels(body: unknown, inventory: string): number | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const listing: unknown = (body as Record<string, unknown>)[inventory];

  return Array.isArray(listing) ? listing.length : null;
}

@Injectable()
export class ProviderProbe {
  /**
   * Ask one provider its one cheap question.
   *
   * @param url - Where to ask, from `checkUrl`. Absolute, and already the *listing* route —
   *   this method appends nothing and rewrites nothing, so the set of paths this service can
   *   reach is the set `checks.ts` declares.
   * @param check - What is being asked, from `checks.ts`'s frozen table.
   * @param apiKey - The opened credential, for a key-validation check only. Passed rather
   *   than fetched so this class holds no vault, and used only by the check's own
   *   `authorize`. Omitted for every reachability check, which must never carry one.
   * @returns What was found. Never rejects for anything a provider did — see this file's
   *   header.
   */
  async run(url: string, check: ProviderCheck, apiKey?: string): Promise<ProbeOutcome> {
    const started = performance.now();

    try {
      const response = await fetch(url, {
        // Stated rather than defaulted. The default *is* GET, and writing it here is what
        // makes the file's central claim visible at the one line that could ever break it.
        method: "GET",
        // No `body`, and no branch that could add one. This is the non-goal, as code.
        headers: {
          accept: "application/json",
          ...(check.authorize !== null && apiKey !== undefined ? check.authorize(apiKey) : {}),
        },
        // The deadline that makes a sweep bounded. An abort actually ends the request, unlike
        // a race: a sweep every minute that left its predecessors in flight would hold a
        // socket per cycle against a provider that is already struggling.
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });

      if (!response.ok) {
        // The body of a refusal is never read: it is the vendor's error object, it sometimes
        // echoes request headers, and nothing here would do anything with it.
        await response.body?.cancel();

        return { ok: false, detail: describeRefusal(check, response.status) };
      }

      const models = await this.inventory(response, check);

      return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - started)), models };
    } catch (error) {
      return { ok: false, detail: describeProbeFailure(error) };
    }
  }

  /**
   * Read a successful response's model count, or give its socket back unread.
   *
   * An unread body keeps its connection checked out of undici's pool until the garbage
   * collector gets to it, which for a sweep that runs every minute is a slow leak of sockets
   * against every cloud provider a workspace has. Cancelling is how a check that only wanted
   * a status code returns one immediately.
   *
   * @param response - The successful response.
   * @param check - The check, whose `inventory` says whether there is a count to read.
   * @returns The count, or null — including when the body is not JSON at all, which is a
   *   reachable provider serving something unexpected rather than a failed check.
   */
  private async inventory(response: Response, check: ProviderCheck): Promise<number | null> {
    if (check.inventory === null) {
      await response.body?.cancel();

      return null;
    }

    try {
      const body: unknown = await response.json();

      return countModels(body, check.inventory);
    } catch {
      return null;
    }
  }
}
