import "server-only";

/**
 * What the insights page reads for its first paint
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * One read — `GET /api/v1/insights` is the page in one payload (`app/api/insights.ts`) — for the
 * range the address names. From the first paint on, the browser keeps it fresh through
 * `app/insights/insights-store.tsx`; this is what it draws until the poll's first answer.
 *
 * Beside it, the workspace's playbooks — only so the flaky card can link the flaky-test recipe
 * (BK.5, [#446](https://github.com/NobuData/ouroboros/issues/446)). The two reads are
 * independent and made together.
 *
 * Each read is an {@link attempt}, so a refusal is a page that says what it could not read under
 * one banner rather than an error boundary: the head, the range and the actions still draw, and
 * the poll that starts on mount is the retry that mends it.
 */

import type { Workspace } from "@/app/api/access";
import { type InsightsPage, type InsightsRange, insights } from "@/app/api/insights";
import { mayContribute } from "@/app/api/membership";
import { playbooks } from "@/app/api/playbooks";
import { type Reading, attempt } from "@/app/api/reading";

import { type FlakyPlaybook, flakyPlaybookOf } from "./flaky-view";

/** Everything the insights page's first paint is drawn from. */
export interface InsightsReadings {
  /** The range the page was read for. */
  readonly range: InsightsRange;
  /** The page, or why it could not be read. */
  readonly page: Reading<InsightsPage>;
  /**
   * When the read was made, in epoch milliseconds. Taken once, on the server, so the hydration
   * pass holds the same instant.
   */
  readonly readAt: number;
  /**
   * Whether this person may re-categorize an intervention — `owner`, `admin` or `member` (BK.4,
   * [#445](https://github.com/NobuData/ouroboros/issues/445)). It decides only whether the card
   * draws the control; the service refuses a viewer's direct call whatever this says.
   */
  readonly mayRecategorize: boolean;
  /**
   * The workspace's flaky-test playbook (#415) — what the flaky card's *Open playbook →* links —
   * `null` when the workspace has none, or why the playbooks could not be read (BK.5,
   * [#446](https://github.com/NobuData/ouroboros/issues/446)). Read once for the first paint: a
   * recipe is not a figure, and the poll does not re-read it.
   */
  readonly flakyPlaybook: Reading<FlakyPlaybook | null>;
}

/**
 * Read the insights page for one range.
 *
 * @param access The workspace the gate returned. The call is scoped to the session's own active
 *   organization; the membership's roles decide whether the re-categorize control is drawn.
 * @param range The range the address names.
 * @param now The clock. Defaults to the real one; a suite passes one to hold `readAt` still.
 * @returns The page, read or explained, for that range, and when.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readInsights(
  access: Workspace,
  range: InsightsRange,
  now: () => number = Date.now,
): Promise<InsightsReadings> {
  const [page, list] = await Promise.all([attempt(() => insights.page(range)), attempt(() => playbooks.list())]);

  return {
    range,
    page,
    readAt: now(),
    mayRecategorize: mayContribute(access.membership.roles),
    flakyPlaybook: list.ok ? { ok: true, value: flakyPlaybookOf(list.value.items) } : list,
  };
}
