/**
 * The build farm's poll — `app/poll.ts`'s loop over the whole page
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * Mockup 08 is a page about the present: `4/5` runners online, a build that is running, a cache
 * rate over today. So the browser asks `app/api/farm/route.ts` for the page on the DASH-I.8
 * pattern ([#87](https://github.com/NobuData/ouroboros/issues/87)), and what the head and the
 * stat row draw is the last answer. The loop — the interval, the hidden tab, the sequence check
 * that keeps an overtaken answer out of the store — is the generic one; what is here is the
 * farm's reader, the guard that decides whether what answered is the page at all, and the two
 * sentences a failed ask carries.
 *
 * ### The cadence is the fleet's, not the contract's default
 *
 * `GET /api/v1/farm` answers `X-Ouro-Poll-After: 10` — the agents' own heartbeat interval — and
 * `app/api/farm-page.ts` carries it through this origin, so the loop settles on ten seconds
 * after its first answer. Nothing here names the number: the server owns it, and slowing every
 * open farm page is one variable on that side.
 *
 * ### One payload, one loop
 *
 * The page is one observation because its figures are claims about each other, and the runners
 * table (AI.2), the pools card (AI.4) and the live card (AI.6) read the same answer the stat row
 * does. `app/farm/farm-store.tsx` builds exactly one of these per screen for that reason.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`;
 * `app/farm/farm-store.tsx` is where it meets React.
 */

import type { FarmPage } from "@/app/api/farm";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

/**
 * Where the browser asks — **this origin**, not `ouroboros-rest`, for the reason
 * `app/dashboard/summary.ts` gives for its own endpoint.
 */
export const FARM_ENDPOINT = "/api/farm";

/** What is said when something answered and this client could not read it as the page. */
export const UNREADABLE_FARM = "The build farm could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_FARM = "The build farm could not be reached.";

/** One read of the page, as the loop needs it. Replaced wholesale in tests. */
export type FarmReader = PollReader<FarmPage>;

/** How to build the farm's poll. Everything is optional; production supplies none of it. */
export interface FarmPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestFarm}. */
  read?: FarmReader;
}

/** The four stat cards' keys — what {@link isFarmPage} requires `stats` to carry. */
const STAT_KEYS = ["runnersOnline", "buildsToday", "avgBuildTime", "cacheHitRate"] as const;

/**
 * Whether a parsed body is the farm page.
 *
 * Structural rather than exhaustive, the way `isDashboardSummary` is — but one level deeper,
 * because of what reads it: the headline reaches straight into `stats.runnersOnline.total` and
 * `stats.cacheHitRate.pct`, so a body whose `stats` was an empty object would pass a shallower
 * check and then throw in a render. Each of the four cards must be an object, and the two
 * collections the page counts must be arrays. Checking it at all is the boundary between *the
 * contract's type* and *whatever answered on that URL* — a proxy, a captive portal or a
 * misconfigured base URL can each reply `200` with something else.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as a {@link FarmPage}.
 */
export function isFarmPage(value: unknown): value is FarmPage {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.runners) || !Array.isArray(value.pools)) return false;

  const { stats } = value;

  return isRecord(stats) && STAT_KEYS.every((key) => isRecord(stats[key]));
}

/**
 * Whether a value is an object with keys to look at.
 *
 * @param value Anything.
 * @returns `true` for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the page once, from the browser.
 *
 * @param etag The tag the loop holds — always `null` here, since the page answers none, and
 *   passed through anyway so the reader has the loop's one signature.
 * @returns The answer. **It does not throw**, for the reason `requestPayload` gives.
 */
export const requestFarm: FarmReader = (etag) =>
  requestPayload(FARM_ENDPOINT, etag, isFarmPage, {
    unreachable: UNREACHABLE_FARM,
    unreadable: UNREADABLE_FARM,
  });

/**
 * Build the farm's loop.
 *
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createFarmPoll(options: FarmPollOptions = {}): Poll<FarmPage> {
  return createPoll(options.read ?? requestFarm, options);
}
