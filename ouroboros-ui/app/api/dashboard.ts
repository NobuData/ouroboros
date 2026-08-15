/**
 * The dashboard aggregate — every number, list and switch mockup 02 draws, in one payload.
 *
 * `GET /api/v1/dashboard` ([#70](https://github.com/NobuData/ouroboros/issues/70)) is
 * decision F5 of `docs/ROADMAP_MOCKUP_02_DASHBOARD.md`: the page paints in **one** round
 * trip, because it is a single glance-view and eight cards issuing eight requests would
 * paint eight times. The per-card endpoints exist beside it for the drill-in screens that
 * will reuse them, and this module does not wrap them — a screen that needs the whole
 * dashboard asks for the whole dashboard.
 *
 * ### What this module adds, and what it deliberately does not
 *
 * It adds what `app/api/engine.ts` adds: a name, the path written down once, and the body
 * rather than the body-or-nothing a raw call returns.
 *
 * It does **not** poll, and it does not carry the `ETag`. The contract asks a client to send
 * the tag back in `If-None-Match` so an unchanged dashboard costs a `304` with no body, and
 * that loop is [#87](https://github.com/NobuData/ouroboros/issues/87)'s — a hook with a
 * timer, a stored tag and a browser to run in. This is the *first* read, made by a Server
 * Component so the page arrives rendered rather than as a shell that then loads, and a first
 * read has no tag to send.
 *
 * ### The workspace is the session's
 *
 * There is no workspace in this path and this client sends no `X-Ouro-Tenant`
 * (`app/api/server.ts` says why), so the aggregate is scoped to the session's active
 * organization. That makes it the first operation in the contract that can answer
 * {@link ORGANIZATION_REQUIRED_CODE} — every other workspace-scoped operation names one in
 * its path. A screen behind `requireWorkspace()` has already been redirected to the login
 * screen if the session was acting nowhere, so that code is a race rather than a state the
 * dashboard renders: it arrives as an `ApiError` like any other refusal, and
 * `app/dashboard/data.ts` degrades the cards that needed it.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/**
 * The whole dashboard for one workspace, measured between one set of boundaries.
 *
 * Every field is always present: an organization with nothing in it answers zeros and empty
 * arrays, never `null` and never an absent key, so a card renders from this without a
 * fallback branch. The nullable values are all *inside* a row, where a null is a fact about
 * that row.
 */
export type Dashboard = components["schemas"]["Dashboard"];

/**
 * The four numbers of the stat row, each with the breakdown its card draws beneath it.
 *
 * Named separately from {@link Dashboard} because the row is composed card by card
 * (`app/dashboard/view.ts`), and a function that decides one card should take that card's
 * figures rather than the whole payload — which is what lets each of them be a unit test on
 * a small object instead of on an aggregate.
 */
export type DashboardStats = components["schemas"]["DashboardStats"];

/**
 * The pulse card's three windowed meters, and the one switch this page can change.
 *
 * Named separately from {@link Dashboard} for {@link DashboardStats}'s reason — the card is
 * decided figure by figure in `app/dashboard/view.ts`, and a function that decides one meter
 * should take the meters rather than the whole payload.
 *
 * **The three are not all measured over the same window**, and the contract is where that is
 * written down: the merge rate covers **fourteen** days and the other two **seven**, because
 * the mockup's own figures cannot all be true of one window (46 merged of 50 closed is `0.92`
 * exactly; no integer count of closed runs makes 27 merged 92% over seven days). That is why
 * the card labels the merge rate for its own window rather than letting the head's `7 days`
 * tag speak for all three.
 *
 * **`autoMerge` is the switch's position, not a way to change it.** The aggregate reports it
 * so the card paints in the page's one round trip; the write is `app/api/settings.ts`.
 */
export type LoopPulse = components["schemas"]["LoopPulse"];

/**
 * One run of the loop against one issue, as every card that draws a run draws it.
 *
 * **One shape for both lists.** *Active loops* and *Recently closed* are two queries over one
 * table, so the columns a stopped run has and a running one does not — `finishedAt`,
 * `prNumber`, the check counts — are `null` here rather than absent, and both cards render
 * from one type. The paged runs endpoint
 * ([#71](https://github.com/NobuData/ouroboros/issues/71)) answers with the same shape, so a
 * card and its drill-in cannot drift apart.
 *
 * **No duration is carried.** *Elapsed* is `now − startedAt` and *Cycle* is
 * `finishedAt − startedAt`; both are the client's to compute, which is why
 * `app/dashboard/view.ts` takes a clock reading rather than reading one.
 */
export type RunSummary = components["schemas"]["RunSummary"];

/**
 * Where a run is in its life: the three that put it in *Active loops*, and the three that
 * put it in *Recently closed*.
 *
 * Named here because two cards branch on it and the union is the contract's, so a status
 * added to the service is a type error in the screens rather than a silent neutral pill.
 */
export type RunStatus = components["schemas"]["RunStatus"];

/**
 * One issue waiting for a loop, as the *Up next in queue* card draws it.
 *
 * Named here for {@link RunSummary}'s reason: it is one shape used in two places. The
 * aggregate's `queueHead` is the top of the queue and
 * [#73](https://github.com/NobuData/ouroboros/issues/73)'s paged listing is the whole of it,
 * and the contract says the rows are byte-identical — so the card and its drill-in cannot
 * drift into two ideas of what a queued issue is.
 *
 * **`estMinutes` is nullable, and a null is not a zero.** It means nobody has sized the
 * issue yet, which is why `stats.queued.estMinutes` sums the estimates rather than counting
 * the rows.
 */
export type QueueItemSummary = components["schemas"]["QueueItemSummary"];

/**
 * The size somebody put on a queued issue — the contract's five, lower-cased.
 *
 * Named here because the card maps every one of them to a chip
 * (`app/dashboard/view.ts`), so a sixth size added to the service is a build error in the
 * screen rather than a row that silently draws no chip at all.
 *
 * It is a **judgement**, deliberately not a function of `estMinutes`: the chip is a size a
 * person chose and the estimate is minutes something measured, and deriving one from the
 * other would make the queue's total a restatement of the chips rather than a second fact.
 */
export type QueueEffort = components["schemas"]["QueueEffort"];

/**
 * The three figures the page head's subline is made of.
 *
 * The greeting beside it is the client's — it needs the reader's own clock (decision F7) —
 * and these are the half of the sentence that is data. The first two deliberately restate
 * `stats.loopsLive.total` and `stats.queued.count` under the names the sentence uses, so one
 * payload cannot disagree with itself.
 */
export type DashboardActivity = components["schemas"]["DashboardActivity"];

/**
 * The `code` the contract answers when the session is acting in no workspace.
 *
 * Named here rather than matched on the status, because `code` is what the contract asks a
 * caller to branch on — the status is for the log line (`app/api/errors.ts`).
 */
export const ORGANIZATION_REQUIRED_CODE = "organization_required";

/**
 * The dashboard, as `ouroboros-rest` aggregates it.
 *
 * One method, because the contract has one.
 */
export const dashboard = {
  /**
   * The whole dashboard for the workspace this session is acting in.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass
   *   one over a stub `fetch`.
   * @returns The aggregate, complete — zeros and empty arrays for a workspace with nothing
   *   in it, never nulls.
   * @throws {ApiError} What the service answered. `400 organization_required` is a session
   *   acting in no workspace; a `401` redirects to login before this rejects.
   */
  async read(client: ApiClient = api()): Promise<Dashboard> {
    return unwrap(await client.GET("/api/v1/dashboard", {}));
  },
};
