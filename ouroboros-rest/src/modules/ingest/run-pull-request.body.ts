/**
 * The description a live run's draft pull request opens with (DI.3,
 * [#1311](https://github.com/NobuData/ouroboros/issues/1311)) — composed, never generated.
 *
 * Every line is read off a row the control plane already holds: the run, its stage history, the
 * ticket's plan criteria, its latest farm job and its token ledger. No model writes any of it, so
 * a reviewer reading the PR on the host reads the same facts the run console shows.
 *
 * ```
 * Opened by an Ouroboros loop under dry-run policy. This is a draft: nothing merges on its own.
 *
 * Run: [Loop #12](https://ouro.example/runs/<id>) · workflow live-slice@v1 · model alias: slice-coder
 *
 * ## Summary                 the issue title, the stages passed, the correction rounds
 * ## Acceptance criteria     one unchecked line per imported claim — or none were imported
 * ## Build                   the run's latest farm job — or none ran — and the console link
 * ## Cost                    $x.yz · N tokens — or not priced · N tokens
 *
 * Refs #1
 * ```
 *
 * **No closing keyword.** The last line is `Refs #<n>`, never `Closes`/`Fixes`: a draft opened by
 * a loop must not close the issue when a person later merges something else into it, and the
 * merge executor writes its own closing message when it merges (#360).
 *
 * **Unpriced is not free** (`run.spend.ts`, decisions M7/N10): a run whose usage has no price
 * prints `not priced`, never `$0.00`, and a partial sum says it is a lower bound.
 *
 * Pure: the same facts give the same body, which is what the spec asserts line by line.
 */

import type { BuildJobStatus, RunStageReturnReason, RunStageStatus } from "../db/schema";

/** The opening line — what the PR is, before anything about what it does. */
export const PULL_REQUEST_BODY_OPENING =
  "Opened by an Ouroboros loop under dry-run policy. This is a draft: nothing merges on its own.";

/** The acceptance-criteria section's sentence when the ticket's plan stated none. */
export const NO_CRITERIA_SENTENCE = "No acceptance criteria were imported.";

/** The build section's sentence when no farm job ran for the run. */
export const NO_BUILD_SENTENCE = "Build: none ran for this run.";

/** What every imported claim says at open: nothing has cited evidence for it yet. */
export const UNVERIFIED_SUFFIX = "unverified, no evidence yet";

/** The run the PR was opened by. */
export interface PullRequestBodyRun {
  /** `runs.id`. */
  readonly id: string;
  /** `runs.loop_seq` — `Loop #12`. */
  readonly loopSeq: number;
  /** `runs.workflow_tag`. */
  readonly workflowTag: string;
  /** `runs.workflow_version_pin`, or null for a run with no pin. */
  readonly workflowVersion: number | null;
  /** `runs.model` — the model alias the run resolved. */
  readonly model: string;
}

/** One attempt of one stage, as `run_stages` holds it. */
export interface PullRequestBodyStage {
  /** `run_stages.stage_key`. */
  readonly stageKey: string;
  /** `run_stages.stage_label` — what the summary prints. */
  readonly label: string;
  /** `run_stages.position` — the stage's place in the pinned workflow. */
  readonly position: number;
  /** `run_stages.attempt`, from 1. */
  readonly attempt: number;
  /** `run_stages.status`. */
  readonly status: RunStageStatus;
  /** The later stage that sent the run back into this attempt — a correction round — or null. */
  readonly returnedFromStageKey: string | null;
  /** Why it was sent back, or null. */
  readonly returnReason: RunStageReturnReason | null;
}

/** The run's latest farm job. */
export interface PullRequestBodyBuild {
  /** `build_jobs.number` — `farm job #41`. */
  readonly number: number;
  /** The pool's name (`runner_pools.name`). */
  readonly pool: string;
  /** `build_jobs.status`. */
  readonly status: BuildJobStatus;
  /** `build_jobs.exit_code`, or null while it has none. */
  readonly exitCode: number | null;
}

/** The run's token ledger, as `readSpendTotals` reads it. */
export interface PullRequestBodySpend {
  /** Summed cents, as the ledger answers them — null when nothing was priced. */
  readonly costCents: string | number | null;
  /** How many usage events had no price — a non-null cost beside them is a lower bound. */
  readonly unpricedEvents: number;
  /** Tokens in and out, summed. */
  readonly tokens: number;
}

/** Everything the body is composed from. */
export interface PullRequestBodyFacts {
  /** `OURO_UI_URL` — where the run console lives. */
  readonly uiUrl: string;
  /** The run. */
  readonly run: PullRequestBodyRun;
  /** The issue the run works on. */
  readonly issue: { readonly number: number; readonly title: string };
  /** Every stage attempt the run recorded, in any order. */
  readonly stages: readonly PullRequestBodyStage[];
  /** The claims imported from the ticket's plan, in the plan's order. */
  readonly claims: readonly string[];
  /** The run's latest farm job, or null when none ran. */
  readonly build: PullRequestBodyBuild | null;
  /** The run's spend. */
  readonly spend: PullRequestBodySpend;
}

/**
 * Compose the draft PR's description.
 *
 * @param facts - The run, its stages, the plan's claims, its build and its spend.
 * @returns Markdown, `\n`-separated, with no trailing newline.
 */
export function composePullRequestBody(facts: PullRequestBodyFacts): string {
  const consoleUrl = runConsoleUrl(facts.uiUrl, facts.run.id);

  return [
    PULL_REQUEST_BODY_OPENING,
    "",
    runLine(facts.run, consoleUrl),
    "",
    "## Summary",
    "",
    facts.issue.title,
    "",
    stagesLine(facts.stages),
    correctionsLine(facts.stages),
    "",
    "## Acceptance criteria",
    "",
    ...criteriaLines(facts.claims),
    "",
    "## Build",
    "",
    buildLine(facts.build),
    "",
    `[Run console](${consoleUrl})`,
    "",
    "## Cost",
    "",
    costLine(facts.spend),
    "",
    `Refs #${String(facts.issue.number)}`,
  ].join("\n");
}

/**
 * The run console's address.
 *
 * @param uiUrl - `OURO_UI_URL`, with or without a trailing slash.
 * @param runId - The run.
 * @returns `<uiUrl>/runs/<id>`.
 */
export function runConsoleUrl(uiUrl: string, runId: string): string {
  return `${uiUrl.replace(/\/+$/, "")}/runs/${runId}`;
}

/**
 * `Run: [Loop #12](…) · workflow live-slice@v1 · model alias: slice-coder`.
 *
 * @param run - The run.
 * @param consoleUrl - Its console.
 * @returns The line.
 */
function runLine(run: PullRequestBodyRun, consoleUrl: string): string {
  const workflow =
    run.workflowVersion === null
      ? run.workflowTag
      : `${run.workflowTag}@v${String(run.workflowVersion)}`;

  return `Run: [Loop #${String(run.loopSeq)}](${consoleUrl}) · workflow ${workflow} · model alias: ${run.model}`;
}

/**
 * Attempts in the order the run made them: by the stage's place, then the attempt.
 *
 * @param stages - The attempts.
 * @returns A sorted copy.
 */
function ordered(stages: readonly PullRequestBodyStage[]): PullRequestBodyStage[] {
  return [...stages].sort((a, b) => a.position - b.position || a.attempt - b.attempt);
}

/**
 * `Stages passed: Plan → Implement (3 attempts) → Review.` — each stage with a succeeded attempt,
 * in workflow order, with how many attempts it took when that was more than one.
 *
 * @param stages - The attempts.
 * @returns The line.
 */
function stagesLine(stages: readonly PullRequestBodyStage[]): string {
  // By stage, in the order the stages first ran: its label, its attempts, whether one succeeded.
  const byStage = new Map<string, { label: string; attempts: number; passed: boolean }>();

  for (const stage of ordered(stages)) {
    const seen = byStage.get(stage.stageKey);

    byStage.set(stage.stageKey, {
      label: seen?.label ?? stage.label,
      attempts: Math.max(seen?.attempts ?? 0, stage.attempt),
      passed: (seen?.passed ?? false) || stage.status === "succeeded",
    });
  }

  const names = [...byStage.values()]
    .filter((stage) => stage.passed)
    .map(({ label, attempts }) =>
      attempts > 1 ? `${label} (${String(attempts)} attempts)` : label,
    );

  return names.length === 0
    ? "Stages passed: none recorded."
    : `Stages passed: ${names.join(" → ")}.`;
}

/**
 * `Correction rounds: 1 — Review returned to Implement (failed review).` — every attempt a later
 * stage sent the run back into, in the order they happened.
 *
 * @param stages - The attempts.
 * @returns The line.
 */
function correctionsLine(stages: readonly PullRequestBodyStage[]): string {
  const labels = new Map(stages.map((stage) => [stage.stageKey, stage.label]));
  const rounds = ordered(stages).filter((stage) => stage.returnedFromStageKey !== null);

  if (rounds.length === 0) {
    return "Correction rounds: none.";
  }

  const described = rounds.map((round) => {
    const from = round.returnedFromStageKey as string;
    const reason =
      round.returnReason === null ? "" : ` (${round.returnReason.replaceAll("_", " ")})`;

    return `${labels.get(from) ?? from} returned to ${round.label}${reason}`;
  });

  return `Correction rounds: ${String(rounds.length)} — ${described.join("; ")}.`;
}

/**
 * One unchecked line per claim, each unverified — or the no-criteria sentence.
 *
 * @param claims - The imported claims.
 * @returns The section's lines.
 */
function criteriaLines(claims: readonly string[]): string[] {
  return claims.length === 0
    ? [NO_CRITERIA_SENTENCE]
    : claims.map((claim) => `- [ ] ${oneLine(claim)} — ${UNVERIFIED_SUFFIX}`);
}

/**
 * `farm job #41 · linux-x64 · succeeded · exit 0` — or the none-ran sentence.
 *
 * @param build - The latest job, or null.
 * @returns The line.
 */
function buildLine(build: PullRequestBodyBuild | null): string {
  if (build === null) {
    return NO_BUILD_SENTENCE;
  }

  const parts = [`farm job #${String(build.number)}`, build.pool, build.status];

  if (build.exitCode !== null) {
    parts.push(`exit ${String(build.exitCode)}`);
  }

  return parts.join(" · ");
}

/**
 * `$0.94 · 12,400 tokens`, `at least $0.40 (3 usage events not priced) · 9,000 tokens`, or
 * `not priced · 1,200 tokens` — never `$0.00` for usage that has no price.
 *
 * @param spend - The ledger's totals.
 * @returns The line.
 */
function costLine(spend: PullRequestBodySpend): string {
  const tokens = `${spend.tokens.toLocaleString("en-US")} ${spend.tokens === 1 ? "token" : "tokens"}`;
  const cents = spend.costCents === null ? Number.NaN : Number(spend.costCents);

  if (!Number.isFinite(cents) || cents < 0) {
    return `not priced · ${tokens}`;
  }

  const dollars = `$${(cents / 100).toFixed(2)}`;

  if (spend.unpricedEvents > 0) {
    const events = `${String(spend.unpricedEvents)} usage ${spend.unpricedEvents === 1 ? "event" : "events"}`;

    return `at least ${dollars} (${events} not priced) · ${tokens}`;
  }

  return `${dollars} · ${tokens}`;
}

/**
 * A claim on one line — a checkbox item cannot span lines.
 *
 * @param text - The claim.
 * @returns It with every run of whitespace collapsed to one space.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
