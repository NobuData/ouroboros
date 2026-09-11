/**
 * The polling contract's vocabulary for the dashboard, written down once for both sides of it
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
 * The header names, the bounds on the hint and the shape of one answer are the contract's
 * for **every** poll, not this one's, and since [#117](https://github.com/NobuData/ouroboros/issues/117)
 * they live in `app/poll.ts` — framework-free and value-only, the way `app/paths.ts` is —
 * and are re-exported here under the names the dashboard's three modules already import.
 * What stays here is what is the dashboard's alone: the payload, the endpoint, the guard
 * and the two sentences.
 */

import type { components } from "@/app/api/schema";
import type { PollAnswer } from "@/app/poll";

export {
  DEFAULT_POLL_SECONDS,
  ETAG_HEADER,
  IF_NONE_MATCH_HEADER,
  MAX_POLL_SECONDS,
  MIN_POLL_SECONDS,
  POLL_AFTER_HEADER,
  readPollAfter,
} from "@/app/poll";

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

/**
 * One answer to one conditional read of the dashboard — `app/poll.ts`'s four cases over
 * this payload.
 *
 * @see file://./summary-poll.ts for what the browser does with each case.
 */
export type SummaryAnswer = PollAnswer<DashboardSummary>;

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
