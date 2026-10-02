/**
 * The insights page's poll — `app/poll.ts`'s loop over the whole page, for one range
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * The page ages: a merge lands, an intervention is recorded, and the head's *this week* moves.
 * So the browser asks `app/api/insights/route.ts` on the DASH-I.8 pattern
 * ([#87](https://github.com/NobuData/ouroboros/issues/87)), and what the head and the KPI row draw
 * is the last answer. The loop — the interval, the hidden tab, the sequence check — is the
 * generic one; what is here is the address for a range, the guard that decides whether what
 * answered is the page at all, and the two sentences a failed ask carries.
 *
 * **One loop per range.** Switching the range is a new address and therefore a new loop
 * (`app/insights/insights-store.tsx` keys it), so a loop still asking for `30d` never draws over
 * a page that now shows `7d`.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`.
 */

import type { InsightsPage, InsightsRange } from "@/app/api/insights";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

import { RANGE_PARAM } from "./range";

/** Where the browser asks — **this origin**, not `ouroboros-rest`. */
export const INSIGHTS_ENDPOINT = "/api/insights";

/** What is said when something answered and this client could not read it as the page. */
export const UNREADABLE_INSIGHTS = "Insights could not be read.";

/** What is said when nothing answered at all — a dropped connection, a timeout. */
export const UNREACHABLE_INSIGHTS = "Insights could not be reached.";

/** One read of the page, as the loop needs it. Replaced wholesale in tests. */
export type InsightsReader = PollReader<InsightsPage>;

/** How to build the page's poll. Everything is optional; production supplies none of it. */
export interface InsightsPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestInsights} over the range's address. */
  read?: InsightsReader;
}

/**
 * The address the poll asks for a range — always naming it, so the answer is never the
 * service's default standing in for the range on screen.
 *
 * @param range The range.
 * @returns `/api/insights?range=30d`.
 */
export function insightsUrl(range: InsightsRange): string {
  return `${INSIGHTS_ENDPOINT}?${RANGE_PARAM}=${range}`;
}

/**
 * Whether a parsed body is the insights page.
 *
 * Structural rather than exhaustive: what reads it reaches into `head`'s two numbers and walks
 * `kpis`, so those are what must be there. Checking at all is the boundary between *the
 * contract's type* and *whatever answered on that URL*.
 *
 * @param value A parsed response body.
 * @returns `true` when it can be read as an {@link InsightsPage}.
 */
export function isInsightsPage(value: unknown): value is InsightsPage {
  if (typeof value !== "object" || value === null) return false;

  const { head, kpis } = value as Partial<Record<keyof InsightsPage, unknown>>;

  if (typeof head !== "object" || head === null || !Array.isArray(kpis)) return false;

  const { mergedPrs, interventions } = head as Record<string, unknown>;

  return typeof mergedPrs === "number" && typeof interventions === "number";
}

/**
 * A reader for one range's address.
 *
 * @param url The address — {@link insightsUrl}'s answer.
 * @returns The reader. **It does not throw**, for the reason `requestPayload` gives.
 */
export function requestInsights(url: string): InsightsReader {
  return (etag) =>
    requestPayload(url, etag, isInsightsPage, {
      unreachable: UNREACHABLE_INSIGHTS,
      unreadable: UNREADABLE_INSIGHTS,
    });
}

/**
 * Build the loop for one address.
 *
 * @param url The address — {@link insightsUrl}'s answer.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createInsightsPoll(url: string, options: InsightsPollOptions = {}): Poll<InsightsPage> {
  return createPoll(options.read ?? requestInsights(url), options);
}
