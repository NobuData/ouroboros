import "server-only";

/**
 * Everything the `/issues` page reads — the page head's counts
 * ([#115](https://github.com/NobuData/ouroboros/issues/115)), the chip set and the repository
 * select's options ([#116](https://github.com/NobuData/ouroboros/issues/116)) and, since the
 * table landed ([#117](https://github.com/NobuData/ouroboros/issues/117)), the page of rows
 * itself.
 *
 * The composition `app/models/data.ts` makes: the route stays three lines, the reads are a function
 * a stub can drive, and a refusal is a value the screen draws rather than a throw that blanks the
 * page ({@link attempt}). Four reads, issued together, each degrading on its own.
 *
 * ### Two listings, because the head asks two questions
 *
 * The **view** is M.1 asked with the filter bar's query and the address's page — one page of
 * rows, which is what the table draws. Its `meta` is the head's sentence — the contract scopes
 * `openCount` and `sizedCount` by `repo` and by nothing else, so the head counts the selected
 * repository's backlog and does not move as chips are pressed — and its `labelFacets` is the
 * chip set, scoped the same way and deliberately not narrowed by the chips already on. Its
 * `total` is the filtered count, which is the footer's page arithmetic. One request, three
 * surfaces: a head that disagreed with its own table would have to be the client's doing.
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
 *
 * ### The sync's status is read beside the page
 *
 * M.4's status ([#113](https://github.com/NobuData/ouroboros/issues/113)) is the fourth read
 * ([#120](https://github.com/NobuData/ouroboros/issues/120)): a page with no rows has to say
 * *which* nothing it is — no token, no enabled repository, a first sync still running, a
 * backlog that is simply clear — and a paused loop has to say why over the rows it did
 * mirror. Every member may read it, `viewer` included, so it is asked for on every render.
 *
 * ### The page is read here once, and polled afterwards
 *
 * The rows the route renders are the first paint, and the status with them. From then on the
 * table asks `app/api/backlog/route.ts` for the same page on the DASH-I.8 cadence, and what it
 * draws is the last answer — which is how an `estimating…` row becomes `sized` when the
 * pipeline finishes rather than when somebody reloads, and how a paused banner clears when
 * the pause does.
 */

import type { Workspace } from "@/app/api/access";
import { type BacklogListing, type BacklogQuery, backlog } from "@/app/api/backlog";
import { enabledRepos, readEnablement } from "@/app/api/enablement";
import { type Reading, attempt } from "@/app/api/reading";

import type { BacklogFilter } from "./filter";
import { FIRST_PAGE, pageQuery } from "./paging";
import { type BacklogCounts, type IssuesReadings, backlogCounts } from "./view";

/** The scope listing's query — see the note above for why it is each of the two. */
const SCOPE_QUERY: BacklogQuery = { state: "all", limit: 1 };

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
 * @param page The page the address carries, as `app/issues/paging.ts` read it. Defaults to the
 *   first.
 * @param now The clock behind `readAt`. Defaults to `Date.now`; tests pass a fixed one.
 * @returns Everything the screen draws, each part either read or explained.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all, which is how a
 *   session that expired between the gate and these calls still reaches the login screen.
 */
export async function readIssues(
  access: Workspace,
  filter: BacklogFilter,
  page: number = FIRST_PAGE,
  now: () => number = Date.now,
): Promise<IssuesReadings> {
  const readAt = now();
  const [view, scope, repos, sync] = await Promise.all([
    attempt(() => backlog.list(pageQuery(filter, page))),
    attempt(() => backlog.list(SCOPE_QUERY)),
    attempt(async () => enabledRepos(await readEnablement(access.membership.id))),
    attempt(() => backlog.status()),
  ]);

  return {
    counts: counted(view, scope),
    facets: view.ok ? { ok: true, value: view.value.labelFacets } : view,
    repos,
    listing: view,
    sync,
    readAt,
  };
}
