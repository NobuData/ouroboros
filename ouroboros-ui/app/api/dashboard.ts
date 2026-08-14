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
