/**
 * What mockup 12 renders against the verification seed, and how the PR leg draws the states the
 * seed does not hold ([#370](https://github.com/NobuData/ouroboros/issues/370), AY.8).
 *
 * Two jobs, for leg 20 (`specs/pr-verification.spec.ts`):
 *
 *   1. **The seed's figures**, copied on purpose the way `support/dashboard.ts` copies its
 *      seed's. `R__dev_seed_verification.sql` (AW.5,
 *      [#356](https://github.com/NobuData/ouroboros/issues/356)) is mockup 12 as rows — one PR,
 *      `#514`, mid-verification — and {@link SEEDED_PR} is what those rows render as.
 *   2. **The browser's own poll, rewritten on its way back** ({@link rewritePoll}), for the
 *      states no seeded PR is in.
 *
 * ## What is intercepted, and why that is honest
 *
 * The seed holds one PR and it is `verifying`. A merged, a closed, a blocked and a disarmed PR
 * are each a state of that same page, and writing four more PRs into the seed to photograph them
 * would put four more rows on every surface that lists PRs — the dashboard's, the run console's
 * links, the inbox to come — and move their baselines for this leg's convenience.
 *
 * So those states are drawn the way leg 19 draws its parse warning: the page's first paint is
 * the service's own answer, and the **browser's poll** of `/api/prs/:id` is answered by the
 * service and then changed — a state, a plan's record, a sync stamp — before the page reads it.
 * It proves the page draws each state from the payload's own fields, in both palettes. That the
 * service *writes* those fields is `ouroboros-rest`'s suites (`merge.integration-spec.ts`,
 * `pr-sync.integration-spec.ts`), and the one state this leg reaches for real is the one that
 * matters most: the TOCTOU test arms the seeded PR, turns a gate red, and reads the disarm the
 * executor wrote.
 */

import type { Page, Route } from "@playwright/test";

/** The seeded PR mockup 12 draws — `#514`, opened by loop `#1847` for issue `#482`. */
export const SEEDED_PR = {
  /** `pull_requests.id` — literal in the migration. */
  id: "5eed003a-0000-4000-8000-000000000514",
  /** The host's number. */
  number: 514,
  /** The page's eyebrow. */
  eyebrow: "PR Verification · PR #514 · Revision 2",
  /** The host PR's title — the page's `h1`. */
  title: "can: fix flaky telemetry frame order under ISR load",
  /** The head's pill while the seed is untouched. */
  pill: "verifying — 5 of 7 gates green",
  /** The branches, head into base. */
  branches: "loop/482-canbus-flake → main",
  /** The counts, as revision 2's snapshot sums them. */
  counts: "+68 −15 · 3 files",
  /** The latest revision's short sha. */
  headSha: "b7e41d0",
  /** The run that opened it — `#482`, *Loop #1847*. */
  runId: "5eed0009-0000-4000-8000-000000000482",
  /** The ticket it closes, as the tracker keys it. */
  ticket: "#482",
} as const;

/** A well-formed PR id no seed writes. */
export const NO_SUCH_PR_ID = "5eed003a-0000-4000-8000-0000000fffff";

/** Where the browser polls a PR's page — `app/prs/poll.ts`'s address, on the UI's own origin. */
export const POLL_ROUTE = "**/api/prs/*";

/**
 * The PR page's address.
 *
 * @param prId - The PR.
 * @param query - The query, without its `?`.
 * @returns The path.
 */
export function prPath(prId: string = SEEDED_PR.id, query = ""): string {
  return `/prs/${prId}${query === "" ? "" : `?${query}`}`;
}

/** One gate's row, as the page payload states it — the fields a rewrite touches. */
export interface GateRow {
  key: string;
  label: string;
  required: boolean;
  verdict: string;
  evidence: string | null;
  [field: string]: unknown;
}

/** A revision's gate snapshot. */
export interface GateSnapshot {
  aggregate: Record<string, unknown> | null;
  rows: GateRow[];
  [field: string]: unknown;
}

/**
 * The PR page payload, as far as a rewrite needs to name it. Everything else passes through as
 * the service answered it.
 */
export interface PagePayload {
  pullRequest: Record<string, unknown> & { state: string; number: number };
  revisions: (Record<string, unknown> & { id: string; seq: number; gates: GateSnapshot })[];
  gates: GateSnapshot | null;
  plan: Record<string, unknown>;
  review: Record<string, unknown> | null;
  [region: string]: unknown;
}

/**
 * Answer the browser's poll with the service's own page, changed.
 *
 * `if-none-match` is dropped so the service always answers with a body — a `304` has nothing to
 * rewrite. Anything but a `200` is passed through untouched, so a broken read model still
 * reaches the page as the failure it is.
 *
 * @param page - The page about to open the PR.
 * @param change - What to change. It is handed a fresh copy of what the service answered.
 * @returns When the route is installed — before the navigation, so the first poll is caught.
 */
export async function rewritePoll(
  page: Page,
  change: (payload: PagePayload) => PagePayload,
): Promise<void> {
  await page.route(POLL_ROUTE, async (route: Route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];

    const response = await route.fetch({ headers });
    if (response.status() !== 200) return route.fulfill({ response });

    const body = (await response.json()) as PagePayload;
    await route.fulfill({ response, json: change(structuredClone(body)) });
  });
}

/**
 * Give some gates of the latest revision a verdict — in the page's own snapshot and in the
 * revision's, which is the one the gates card draws.
 *
 * @param payload - The page.
 * @param verdicts - The verdict and evidence line, by gate key.
 * @returns The page, changed. The aggregate is recounted from the rows, as the service's is.
 */
export function withVerdicts(
  payload: PagePayload,
  verdicts: Readonly<Record<string, readonly [verdict: string, evidence: string]>>,
): PagePayload {
  const latest = payload.revisions.at(-1);
  if (latest === undefined || payload.gates === null) return payload;

  const rows = payload.gates.rows.map((row) => {
    const changed = verdicts[row.key];

    return changed === undefined ? row : { ...row, verdict: changed[0], evidence: changed[1] };
  });
  const required = rows.filter((row) => row.required);
  const satisfied = required.filter((row) =>
    ["green", "waived", "not_required"].includes(row.verdict),
  );
  const aggregate = {
    requiredCount: required.length,
    greenCount: required.filter((row) => row.verdict === "green").length,
    redCount: required.filter((row) => row.verdict === "red").length,
    satisfiedCount: satisfied.length,
    mergeReady: required.length > 0 && satisfied.length === required.length,
  };
  const gates = { ...payload.gates, aggregate, rows };

  return {
    ...payload,
    gates,
    revisions: payload.revisions.map((revision) =>
      revision.id === latest.id
        ? { ...revision, gates: { ...revision.gates, ...gates } }
        : revision,
    ),
  };
}

/** The merge the rewritten plan records — mockup 12's arm, landed. */
export const MERGED_RESULT = {
  sha: "9c4ab7f02d31e8a6",
  identityUsed: "ken-s",
  actionsExecuted: ["close_ticket", "comment_evidence", "delete_branch"],
  mergedAt: "2026-09-27T14:45:02.000Z",
} as const;

/** The sentence the service records when the host reports a conflict (`merge.recheck.ts`). */
export const HOST_CONFLICT_MESSAGE = "The host reports a merge conflict with the base branch.";

/**
 * The page once the plan merged it: every required gate satisfied, the plan holding its record,
 * and the host's mirror caught up.
 *
 * @param payload - The page.
 * @returns The merged page.
 */
export function asMerged(payload: PagePayload): PagePayload {
  const green = withVerdicts(payload, {
    model_review: ["green", "cursor/composer-2 · approved"],
  });

  return {
    ...green,
    pullRequest: {
      ...green.pullRequest,
      state: "merged",
      mergedAt: MERGED_RESULT.mergedAt,
      mergedBy: MERGED_RESULT.identityUsed,
    },
    plan: {
      ...green.plan,
      armed: false,
      armedBy: null,
      armedByPerson: null,
      armedAt: null,
      armedAgainstRevisionId: null,
      disarmReason: null,
      mergedResult: MERGED_RESULT,
    },
  };
}

/**
 * The page of a PR its host closed without merging.
 *
 * @param payload - The page.
 * @returns The closed page.
 */
export function asClosed(payload: PagePayload): PagePayload {
  return { ...payload, pullRequest: { ...payload.pullRequest, state: "closed" } };
}

/**
 * The page while the latest revision is blocked the way the mockup's revision 1 was: the test
 * suite and the physical HIL gates red.
 *
 * @param payload - The page.
 * @returns The blocked page.
 */
export function asBlocked(payload: PagePayload): PagePayload {
  const red = withVerdicts(payload, {
    test_suite: ["red", "61/63 · 2 failing after attempt 3"],
    physical_hil: ["red", "overshoot 2.4% > 2.0% · rig helios-rig-02"],
  });

  return { ...red, pullRequest: { ...red.pullRequest, state: "blocked" } };
}

/**
 * The page after a re-check disarmed the plan.
 *
 * @param payload - The page.
 * @param code - Which re-check refused — `merge.recheck.ts`'s code.
 * @param message - The service's sentence.
 * @returns The disarmed page.
 */
export function asDisarmed(payload: PagePayload, code: string, message: string): PagePayload {
  return {
    ...payload,
    plan: {
      ...payload.plan,
      armed: false,
      armedBy: null,
      armedByPerson: null,
      armedAt: null,
      armedAgainstRevisionId: null,
      disarmReason: { code, message },
      mergedResult: null,
    },
  };
}

/**
 * The page with its sync stamp moved.
 *
 * @param payload - The page.
 * @param syncedAt - When the host was last asked, or `null` for never.
 * @returns The page, changed.
 */
export function syncedAt(payload: PagePayload, syncedAt: string | null): PagePayload {
  return { ...payload, pullRequest: { ...payload.pullRequest, syncedAt } };
}

/**
 * The page while a human review is waiting on the latest revision.
 *
 * @param payload - The page.
 * @returns The page, with the approval slot open and human approval pending.
 */
export function withReviewWaiting(payload: PagePayload): PagePayload {
  const latest = payload.revisions.at(-1);
  const waiting = withVerdicts(payload, {
    human_approval: ["pending", "review requested — waiting for an answer"],
  });

  return {
    ...waiting,
    review: {
      id: "5eed003c-0000-4000-8000-0000000e2e01",
      state: "requested",
      requestedRevisionId: latest?.id ?? null,
      requestedBy: { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken Suenobu" },
      requestedAt: "2026-09-27T14:41:00.000Z",
      host: null,
      decidedRevisionId: null,
      decidedBy: null,
      decidedAt: null,
      note: null,
    },
  };
}
