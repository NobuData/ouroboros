"use server";

/**
 * The server hops for the playbooks card
 * (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)) — the calls its Client
 * Components cannot make themselves: the picker's candidates, the launch, the recent terminal
 * runs, a run's draft, and the create.
 *
 * `app/knowledge/facts-actions.ts` is the same seam for the learned-facts card and states the
 * rule: the browser cannot reach REST, so a Client Component that needs the API calls a Server
 * Action that calls it.
 *
 * ### A Server Action is a POST endpoint anybody can reach
 *
 * - **There is no workspace in the call and no person.** The playbook belongs to the workspace
 *   the caller's own session is acting in, resolved by `ouroboros-rest` from the cookie.
 * - **The gates are the service's.** A viewer's **Run on issue… ▾** is drawn inert and a member's
 *   **+ New playbook** likewise, but that is presentation; whoever reaches {@link launchPlaybook}
 *   or {@link createPlaybookFromRun} without the role gets `403 forbidden` back as a value and
 *   writes nothing. A launch is refused exactly as queueing the issue would be.
 *
 * A refusal comes back as a value, not a throw, so the dialog can show it. The one throw that
 * must travel is Next.js's redirect signal. A `"use server"` module may export only async
 * functions, so the sentences live in `app/knowledge/playbooks.ts`.
 */

import type { RunPage } from "@/app/api/runs";
import { runs } from "@/app/api/runs";
import type { ErrorEnvelope } from "@/app/api/errors";
import { isApiError } from "@/app/api/errors";
import {
  type CreatePlaybookFromRunBody,
  type Playbook,
  type PlaybookDraft,
  type PlaybookIssueList,
  type PlaybookLaunchReceipt,
  playbooks,
} from "@/app/api/playbooks";

import { RUNS_LIMIT } from "./playbooks";

/** What one call produced: the service's answer, or its refusal as a value. */
export type PlaybookActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ErrorEnvelope };

/**
 * Run one call, keeping the service's refusal as a value.
 *
 * @param call The call.
 * @returns Its answer, or the envelope.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
async function outcome<T>(call: () => Promise<T>): Promise<PlaybookActionOutcome<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    if (!isApiError(error)) throw error;

    return {
      ok: false,
      refusal: { code: error.code, message: error.message, details: error.details },
    };
  }
}

/**
 * The issues a playbook may run on — what **Run on issue… ▾** lists.
 *
 * @param id The playbook.
 * @param q A title word or an issue number, or nothing for the head of the list.
 * @returns The candidates as the service narrowed them, or its refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function listPlaybookIssues(id: string, q?: string): Promise<PlaybookActionOutcome<PlaybookIssueList>> {
  const query = q === undefined || q.trim() === "" ? undefined : q.trim();

  return outcome(() => playbooks.issues(id, query));
}

/**
 * Queue an issue under the playbook's pin.
 *
 * @param id The playbook.
 * @param issueId The issue, as the picker listed it.
 * @returns The receipt, or the service's refusal — `forbidden` for a viewer, and the queue
 *   write's own refusals.
 * @throws Whatever is not an `ApiError`.
 */
export async function launchPlaybook(id: string, issueId: string): Promise<PlaybookActionOutcome<PlaybookLaunchReceipt>> {
  return outcome(() => playbooks.launch(id, issueId));
}

/**
 * The runs that finished, newest first — what **+ New playbook from a past run…** offers.
 *
 * @returns The page, or the service's refusal.
 * @throws Whatever is not an `ApiError`.
 */
export async function listRecentRuns(): Promise<PlaybookActionOutcome<RunPage>> {
  return outcome(() => runs.list("terminal", RUNS_LIMIT));
}

/**
 * What a playbook learned from a run would hold. Writes nothing.
 *
 * @param runId The run.
 * @returns The draft, or the service's refusal — `playbook_run_not_terminal`,
 *   `playbook_run_unpinned`.
 * @throws Whatever is not an `ApiError`.
 */
export async function draftPlaybook(runId: string): Promise<PlaybookActionOutcome<PlaybookDraft>> {
  return outcome(() => playbooks.draftFromRun(runId));
}

/**
 * Create a playbook from a run.
 *
 * @param body The run, the name, and optionally a description and an issue filter, as the dialog
 *   composed them — forwarded as they are.
 * @returns The playbook, or the service's refusal — `forbidden` for a member,
 *   `playbook_name_taken`.
 * @throws Whatever is not an `ApiError`.
 */
export async function createPlaybookFromRun(body: CreatePlaybookFromRunBody): Promise<PlaybookActionOutcome<Playbook>> {
  return outcome(() => playbooks.createFromRun(body));
}
