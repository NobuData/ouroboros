import "server-only";

/**
 * Everything the `/issues` page reads — today, the page head's counts
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)).
 *
 * The composition `app/models/data.ts` makes, one read smaller: the route stays three lines, the
 * read is a function a stub can drive, and a refusal is a value the head draws rather than a throw
 * that blanks the page ({@link attempt}).
 *
 * ### One listing, asked for `state=all`, one row long
 *
 * The head needs three figures and one listing carries all three. `meta.openCount` and
 * `meta.sizedCount` are the head's sentence, and the contract scopes them by the workspace alone —
 * not by `state` — so asking for `state=all` changes neither. What it changes is `total`, which
 * describes the filter: with no filter but `state=all`, it is **every issue the workspace mirrors**.
 * That is exactly the set **Re-estimate all** claims from, because L.4's claim
 * ([#108](https://github.com/NobuData/ouroboros/issues/108)) is `where organization_id = … and
 * sizing_status != 'estimating'`, with no `state` in it. The confirmation's *"this re-estimates N
 * issues"* therefore states the scope the service will act on. The open count would not: one closed
 * issue in the mirror would already make the dialog promise less than the press does.
 *
 * One request rather than two is the other half of it. The head's figures and the dialog's are one
 * snapshot, so the dialog cannot count fewer issues than the head calls open.
 *
 * `limit=1` because this page draws no rows yet — N.3
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)) brings the table, and its own page.
 */

import type { Workspace } from "@/app/api/access";
import { type BacklogQuery, backlog } from "@/app/api/backlog";
import { attempt } from "@/app/api/reading";

import { type IssuesReadings, backlogCounts } from "./view";

/** The head's query — see the note above for why it is each of the two. */
const HEAD_QUERY: BacklogQuery = { state: "all", limit: 1 };

/**
 * Read the intake page.
 *
 * @param access The workspace the gate returned. **A precondition made visible in the type rather
 *   than a source of values**: nothing on it is read, because the backlog is scoped to the
 *   session's own active organization and this client sends no tenant header
 *   (`app/api/server.ts`). Taking it is what makes the page's authorization and its data one
 *   decision — the reason `app/models/data.ts` takes one too.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how a
 *   session that expired between the gate and this call still reaches the login screen.
 */
export async function readIssues(access: Workspace): Promise<IssuesReadings> {
  // Held, not read — see the parameter's note.
  void access;

  const counts = await attempt(async () => backlogCounts(await backlog.list(HEAD_QUERY)));

  return { counts };
}
