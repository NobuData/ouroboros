import "server-only";

/**
 * What the build farm page reads for its first paint
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * One read — `GET /api/v1/farm` is the page in one observation (`app/api/farm.ts`) — composed
 * here for the reason every screen's `data.ts` exists: the route stays thin, and the screen is
 * handed one object. From the first paint on, the browser keeps it fresh through
 * `app/farm/farm-store.tsx`; this is what it draws until the poll's first answer.
 *
 * The read is an {@link attempt}, so a refusal is a page that says what it could not read under
 * one banner rather than an error boundary: the head, the actions and four named tiles still
 * draw, and the poll that starts on mount is the retry that mends it.
 */

import type { Workspace } from "@/app/api/access";
import { type FarmPage, farm } from "@/app/api/farm";
import { type Reading, attempt } from "@/app/api/reading";

/** Everything the farm page's first paint is drawn from. */
export interface FarmReadings {
  /** The page, or why it could not be read. */
  readonly page: Reading<FarmPage>;
  /**
   * When the read was made, in epoch milliseconds — what a later *"showing data from 14:02"* is
   * drawn from. Taken once, on the server, so the hydration pass holds the same instant.
   */
  readonly readAt: number;
}

/**
 * Read the farm page.
 *
 * @param access The workspace the gate returned — a precondition made visible in the type rather
 *   than a source of values: the call is scoped to the session's own active organization.
 * @param now The clock. Defaults to the real one; a suite passes one to hold `readAt` still.
 * @returns The page, read or explained, and when.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readFarm(
  access: Workspace,
  now: () => number = Date.now,
): Promise<FarmReadings> {
  // Held, not read — see the parameter's note.
  void access;

  return { page: await attempt(() => farm.page()), readAt: now() };
}
