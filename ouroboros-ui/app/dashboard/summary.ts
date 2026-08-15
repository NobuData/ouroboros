/**
 * The polling contract's vocabulary, written down once for both sides of it
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)).
 *
 * `docs/ARCHITECTURE.md` § 5.4 is the contract itself — a conditional `GET`, a strong
 * `ETag` echoed in `If-None-Match`, a `304` with no body when nothing moved, and an
 * `X-Ouro-Poll-After` hint that puts the cadence in the server's hands. Three modules have
 * to agree about it and none of them may import the others:
 *
 * | Module | Side | Why it cannot import the others |
 * |---|---|---|
 * | `app/api/dashboard-summary.ts` | server | `server-only`; it holds the address of `ouroboros-rest` |
 * | `app/api/dashboard/route.ts` | server | a route handler, and the only thing on this origin that answers |
 * | `app/dashboard/summary-poll.ts` | browser | ships in the bundle, so nothing server-only may reach it |
 *
 * So the header names, the endpoint, the bounds on the hint and the shape of one answer
 * live here, framework-free and value-only in the way `app/paths.ts` and
 * `app/api/tenant.ts` are: no `next/*`, no React, no `server-only`. A header name spelled
 * twice is a header name that stops being read the day one copy is corrected.
 *
 * **The answer type is the interesting part.** {@link SummaryAnswer} is produced twice —
 * once by the server reading `ouroboros-rest`, once by the browser reading this origin —
 * and the route handler in between is what turns the first into HTTP and the second back
 * out of it. Both ends therefore branch on the same four cases, and a case added to the
 * contract is a compile error at both.
 */

import type { components } from "@/app/api/schema";

/**
 * The whole dashboard for one workspace, exactly as the contract declares it
 * ([#70](https://github.com/NobuData/ouroboros/issues/70)).
 *
 * Every field is always present — an organization with nothing in it answers zeros and
 * empty arrays, never `null` and never an absent key — so a consumer renders from this
 * without a fallback branch. That promise is the endpoint's, restated here only because it
 * is what lets the pills treat `0` as *nothing is live* rather than as *nobody has said*.
 */
export type DashboardSummary = components["schemas"]["Dashboard"];

/**
 * Where the browser asks — **this origin**, not `ouroboros-rest`.
 *
 * The service's address is `OURO_REST_URL`, which carries no `NEXT_PUBLIC_` prefix and is
 * therefore not in the browser bundle (`app/env.ts`), and the session cookie is `HttpOnly`.
 * The browser could not make this call directly even if it knew where to make it, so
 * `app/api/dashboard/route.ts` answers it here and forwards the conditional exchange
 * unchanged.
 */
export const SUMMARY_ENDPOINT = "/api/dashboard";

/** The header the tag comes back in. */
export const ETAG_HEADER = "ETag";

/** The header the tag goes back out in, on the next ask. */
export const IF_NONE_MATCH_HEADER = "If-None-Match";

/**
 * The header carrying how long the server currently wants a client to wait
 * ([#75](https://github.com/NobuData/ouroboros/issues/75)).
 *
 * On every answer, `200` and `304` alike — a backed-off server answers mostly `304`s, so
 * the cheap answer has to carry the cadence or a slowed client would never hear it change.
 */
export const POLL_AFTER_HEADER = "X-Ouro-Poll-After";

/**
 * What the contract documents as the interval, in seconds.
 *
 * Used only until the first answer is heard: every answer carries the server's own value,
 * and {@link readPollAfter} is what replaces this with it. `OURO_DASHBOARD_POLL_SECONDS`
 * is the same number on the other side, and this copy exists because a client with no
 * answer yet still has to pick something.
 */
export const DEFAULT_POLL_SECONDS = 15;

/** The shortest interval the contract allows the server to ask for. */
export const MIN_POLL_SECONDS = 1;

/**
 * The longest — an hour, which is already "never refreshes"; above it the knob would be an
 * off switch wearing a number. The same bounds `ouroboros-rest` validates its own variable
 * against, so a hint this client refuses is a hint the server could not have sent.
 */
export const MAX_POLL_SECONDS = 3600;

/**
 * One answer to one conditional read.
 *
 * @see file://./summary-poll.ts for what the browser does with each case.
 */
export type SummaryAnswer =
  /** `200` — the dashboard changed, or this is the first ask. */
  | {
      readonly state: "fresh";
      readonly summary: DashboardSummary;
      readonly etag: string | null;
      readonly pollAfterSeconds: number | null;
    }
  /** `304` — nothing has moved, and the client already holds the payload. */
  | {
      readonly state: "unchanged";
      readonly etag: string | null;
      readonly pollAfterSeconds: number | null;
    }
  /**
   * `401` — the session ended. Distinct from a failure because it does not mend itself:
   * asking again on the interval would be a request per interval that cannot succeed.
   */
  | { readonly state: "gone" }
  /**
   * Anything else — the service refused, or nothing answered at all. Carries a sentence
   * written for a person, because that is what the stale banner
   * ([#86](https://github.com/NobuData/ouroboros/issues/86)) renders.
   */
  | {
      readonly state: "failed";
      readonly reason: string;
      readonly pollAfterSeconds: number | null;
    };

/**
 * What is said when something answered and this client could not read it as a dashboard.
 *
 * A body that is not the payload means the same thing to every consumer — *nothing can be
 * said about the loop right now* — and naming which of the several possible causes it was
 * is a distinction only an operator can act on.
 */
export const UNREADABLE_SUMMARY = "The dashboard could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_SUMMARY = "The dashboard could not be reached.";

/**
 * Read the server's cadence hint off an answer.
 *
 * **Whole seconds only, and inside the bounds the contract states.** A hint this client
 * cannot use is treated as no hint rather than as an error: the header is advice, the
 * default interval is still a working one, and a client that stopped polling over a
 * malformed header would be a dashboard that froze because a proxy rewrote a number.
 *
 * @param headers The answer's headers.
 * @returns The interval the server asked for, in seconds, or `null` when it asked for
 *   nothing usable.
 */
export function readPollAfter(headers: Headers): number | null {
  const raw = headers.get(POLL_AFTER_HEADER);
  if (raw === null) return null;

  const seconds = Number(raw.trim());

  if (!Number.isInteger(seconds)) return null;
  if (seconds < MIN_POLL_SECONDS || seconds > MAX_POLL_SECONDS) return null;

  return seconds;
}

/**
 * Whether a parsed body is the dashboard payload.
 *
 * Structural rather than exhaustive, the same way `isHealthReport` in `app/api/health.ts`
 * is: what every consumer reaches for first is `stats` and `pulse`, and a body carrying
 * both objects is the payload for every purpose this application has. Checking it at all is
 * the boundary between *the contract's type* and *whatever answered on that URL* — a proxy,
 * a captive portal or a misconfigured base URL can each reply `200` with something else.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link DashboardSummary}.
 */
export function isDashboardSummary(value: unknown): value is DashboardSummary {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<DashboardSummary>;

  return (
    typeof candidate.stats === "object" &&
    candidate.stats !== null &&
    typeof candidate.pulse === "object" &&
    candidate.pulse !== null
  );
}
