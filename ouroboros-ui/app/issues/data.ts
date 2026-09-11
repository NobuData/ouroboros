import "server-only";

/**
 * Everything the `/issues` page reads — the page head's counts
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)) and, since the filter bar
 * ([#116](https://github.com/NobuData/ouroboros/issues/116)), the chip set and the repository
 * select's options.
 *
 * The composition `app/models/data.ts` makes: the route stays three lines, the reads are a function
 * a stub can drive, and a refusal is a value the screen draws rather than a throw that blanks the
 * page ({@link attempt}). Three reads, issued together, each degrading on its own.
 *
 * ### Two listings, because the head asks two questions
 *
 * The **view** is M.1 asked with the filter bar's query. Its `meta` is the head's sentence — the
 * contract scopes `openCount` and `sizedCount` by `repo` and by nothing else, so the head counts the
 * selected repository's backlog and does not move as chips are pressed — and its `labelFacets` is
 * the chip set, scoped the same way and deliberately not narrowed by the chips already on. One row
 * long, because this page draws no rows yet; N.3
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)) turns the limit into its page.
 *
 * The **scope** is M.1 asked with `state=all` and nothing else, one row long. Its `total` is every
 * issue the workspace mirrors, which is exactly the set **Re-estimate all** claims from: L.4's claim
 * ([#108](https://github.com/NobuData/ouroboros/issues/108)) is `where organization_id = … and
 * sizing_status != 'estimating'`, with neither `state` nor `repo` in it. The view's `total` cannot
 * stand in — it describes the filter — and so the confirmation's *"this re-estimates N issues"* would
 * understate the press the moment a repository was selected or a state chosen. Two requests rather
 * than one is the price of a dialog that states the scope the service will act on.
 *
 * ### The repositories come from the enablement list
 *
 * There is no operation for *the enabled repositories* — `app/api/enablement.ts` composes it as
 * `1 + n` requests, bounded, and `enabledRepos` applies the both-flags rule. The header's chip
 * defers that read until its menu opens; the select cannot, because a `<select>` needs its options
 * before it is opened, and the page arrives rendered.
 */

import type { Workspace } from "@/app/api/access";
import { type BacklogListing, type BacklogQuery, backlog } from "@/app/api/backlog";
import { enabledRepos, readEnablement } from "@/app/api/enablement";
import { type Reading, attempt } from "@/app/api/reading";

import { type BacklogFilter, filterQuery } from "./filter";
import { type BacklogCounts, type IssuesReadings, backlogCounts } from "./view";

/** The scope listing's query — see the note above for why it is each of the two. */
const SCOPE_QUERY: BacklogQuery = { state: "all", limit: 1 };

/**
 * The view listing's query: the filter bar's, one row long.
 *
 * @param filter The filter the address carries.
 * @returns The query.
 */
function viewQuery(filter: BacklogFilter): BacklogQuery {
  return { ...filterQuery(filter), limit: 1 };
}

/**
 * The head's counts, out of the two listings — or why there are none, which is the view's reason
 * first: it is the listing the rest of the page is drawn from, so its refusal is the one to show.
 *
 * @param view The view listing's reading.
 * @param scope The scope listing's reading.
 * @returns The counts, or why there are none.
 */
function counted(
  view: Reading<BacklogListing>,
  scope: Reading<BacklogListing>,
): Reading<BacklogCounts> {
  if (!view.ok) return view;
  if (!scope.ok) return scope;

  return { ok: true, value: backlogCounts(view.value, scope.value) };
}

/**
 * Read the intake page.
 *
 * @param access The workspace the gate returned. Its membership is the workspace whose enabled
 *   repositories fill the select; the two listings read nothing from it, because the backlog is
 *   scoped to the session's own active organization and this client sends no tenant header
 *   (`app/api/server.ts`). Taking it is also what makes the page's authorization and its data one
 *   decision — the reason `app/models/data.ts` takes one.
 * @param filter The filter the address carries, as `app/issues/filter.ts` read it.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how a
 *   session that expired between the gate and these calls still reaches the login screen.
 */
export async function readIssues(access: Workspace, filter: BacklogFilter): Promise<IssuesReadings> {
  const [view, scope, repos] = await Promise.all([
    attempt(() => backlog.list(viewQuery(filter))),
    attempt(() => backlog.list(SCOPE_QUERY)),
    attempt(async () => enabledRepos(await readEnablement(access.membership.id))),
  ]);

  return {
    counts: counted(view, scope),
    facets: view.ok ? { ok: true, value: view.value.labelFacets } : view,
    repos,
  };
}
