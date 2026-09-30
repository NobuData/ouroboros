/**
 * Playbooks — mockup 14's playbooks card, through `ouroboros-rest`
 * (BF.6, [#415](https://github.com/NobuData/ouroboros/issues/415); drawn by BG.4,
 * [#420](https://github.com/NobuData/ouroboros/issues/420)).
 *
 * ### A recipe is a launch you can repeat
 *
 * Decision **K6**: a playbook is a workflow pinned at a published version, a delta of skill
 * overrides against context assembly, a preset of steer notes, and an optional issue filter. The
 * card's `run 9×` is **counted** from the runs that carry the playbook's id — never a stored
 * number — so it moves only when a real run opens for a launch.
 *
 * ### Five calls, and what each one is for
 *
 * - {@link playbooks.list} — the card's rows.
 * - {@link playbooks.issues} — **Run on issue… ▾**'s candidates: the open issues the playbook's
 *   filter admits, each saying whether it is sized and whether the queue already holds it. The
 *   card ranks them (`app/knowledge/playbooks.ts`); the service narrows them.
 * - {@link playbooks.launch} — the queue write under the playbook's pin. The answer is a
 *   **receipt**: the queued item, its position and where to look next.
 * - {@link playbooks.draftFromRun} — what **+ New playbook from a past run…** would capture from a
 *   terminal run, before a person names it. Writes nothing.
 * - {@link playbooks.createFromRun} — the same, named and stored.
 *
 * ### The workspace is the session's
 *
 * No workspace in these paths and no `X-Ouro-Tenant` sent (`app/api/server.ts` says why). Every
 * member reads; a launch is `owner`, `admin` or `member` — the queue write's own gate; creating a
 * recipe is `owner` or `admin`.
 *
 * Server-side only, by way of `app/api/server.ts` — see that file for why.
 */

import { type ApiClient, unwrap } from "@/app/api/client";
import type { components } from "@/app/api/schema";
import { api } from "@/app/api/server";

/** One recipe, as the card draws it. */
export type Playbook = components["schemas"]["Playbook"];

/** Every recipe of the workspace. */
export type PlaybookList = components["schemas"]["PlaybookList"];

/** One issue **Run on issue… ▾** offers. */
export type PlaybookIssueCandidate = components["schemas"]["PlaybookIssueCandidate"];

/** The picker's list. */
export type PlaybookIssueList = components["schemas"]["PlaybookIssueList"];

/** The proof a launch happened, and where to look next. */
export type PlaybookLaunchReceipt = components["schemas"]["PlaybookLaunchReceipt"];

/** What create-from-run captured from a run, before a person names it. */
export type PlaybookDraft = components["schemas"]["PlaybookDraft"];

/** What a create-from-run sends: the run, the name, and optionally the rest. */
export type CreatePlaybookFromRunBody = components["schemas"]["CreatePlaybookFromRunBody"];

/** Playbooks, as `ouroboros-rest` serves them. */
export const playbooks = {
  /**
   * Every recipe of the workspace, by name, each with its counted `runCount`.
   *
   * @param client The client to call through. Defaults to the server-side one; tests pass one
   *   over a stub `fetch`.
   * @returns The list. A workspace with no recipes answers an empty one.
   * @throws {ApiError} What the service answered.
   */
  async list(client: ApiClient = api()): Promise<PlaybookList> {
    return unwrap(await client.GET("/api/v1/knowledge/playbooks", {}));
  },

  /**
   * The issues a playbook may run on — open, admitted by its filter, newest first.
   *
   * @param id The playbook.
   * @param q A substring of the title or an issue number, or nothing for the head of the list.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The candidates.
   * @throws {ApiError} `404 playbook_not_found`.
   */
  async issues(id: string, q?: string, client: ApiClient = api()): Promise<PlaybookIssueList> {
    return unwrap(
      await client.GET("/api/v1/knowledge/playbooks/{id}/issues", {
        params: { path: { id }, query: q === undefined ? {} : { q } },
      }),
    );
  },

  /**
   * **Run on issue… ▾** — queue the issue under the playbook's pin, carrying its id.
   *
   * @param id The playbook.
   * @param issueId The issue, as the picker listed it.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The receipt.
   * @throws {ApiError} `403 forbidden` for a viewer, `404 playbook_not_found` /
   *   `playbook_issue_not_found`, `422 playbook_issue_filtered`, and the queue write's own —
   *   `409 queue_issues_conflict` (already queued), `422 queue_issues_not_queueable` (not sized),
   *   `422 queue_workflow_unknown`.
   */
  async launch(id: string, issueId: string, client: ApiClient = api()): Promise<PlaybookLaunchReceipt> {
    return unwrap(
      await client.POST("/api/v1/knowledge/playbooks/{id}/launch", {
        params: { path: { id } },
        body: { issueId },
      }),
    );
  },

  /**
   * What a recipe learned from a run would hold. Writes nothing.
   *
   * @param runId The terminal run.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The draft: the pin, the overrides, the steers, and where each came from.
   * @throws {ApiError} `404 playbook_run_not_found`, `409 playbook_run_not_terminal`,
   *   `422 playbook_run_unpinned`.
   */
  async draftFromRun(runId: string, client: ApiClient = api()): Promise<PlaybookDraft> {
    return unwrap(
      await client.GET("/api/v1/knowledge/playbooks/from-run/{runId}", { params: { path: { runId } } }),
    );
  },

  /**
   * **+ New playbook from a past run…** — the draft, named and stored.
   *
   * @param body The run, the name, and optionally a description and an issue filter.
   * @param client The client to call through. Defaults to the server-side one.
   * @returns The playbook, `sourceRunId` recorded.
   * @throws {ApiError} `403 forbidden` for a member, `409 playbook_name_taken`, and
   *   {@link playbooks.draftFromRun}'s.
   */
  async createFromRun(body: CreatePlaybookFromRunBody, client: ApiClient = api()): Promise<Playbook> {
    return unwrap(await client.POST("/api/v1/knowledge/playbooks/from-run", { body }));
  },
};
