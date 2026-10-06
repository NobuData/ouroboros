import type { RepoDetection, RepoDetectionProgress, RepoDetectionRow } from "@/app/api/detection";
import type {
  FirstIssueCard,
  Onboarding,
  OnboardingDefaultRow,
  OnboardingDefaults,
  OnboardingFirstIssue,
  OnboardingFirstIssueAlternatives,
  OnboardingFirstIssueCandidate,
  OnboardingInstantiatedWorkflow,
  OnboardingLaunchReceipt,
  OnboardingReassureClaim,
  OnboardingStep,
  OnboardingTemplateSelection,
  OnboardingTemplateTile,
  OnboardingTemplateTiles,
  OnboardingTimeline,
  OnboardingTimelineRow,
  PlanningReestimationStatus,
} from "@/app/api/onboarding";
import type { DryRunPolicy } from "@/app/api/policies";

/**
 * The Get Started wizard as BB.2 (#385) serves it — the onboarding seed's `acme-robotics/helios-firmware`,
 * with steps 1–2 done (a GitHub source by token, the repository enabled and scanned) and step 3
 * active, as mockup 13 draws it.
 */

/** The seeded repository. */
export const REPO = "acme-robotics/helios-firmware";

/** One step, with overrides. */
export function step(overrides: Partial<OnboardingStep> & Pick<OnboardingStep, "step">): OnboardingStep {
  const titles: Record<number, [OnboardingStep["key"], string, OnboardingStep["derivedFrom"]]> = {
    1: ["connect_github", "Connect GitHub", "sources"],
    2: ["pick_repo", "Pick a repo", "tenancy"],
    3: ["choose_workflow", "Choose a starting workflow", "workflows"],
    4: ["first_loop", "Run your first loop", "intake"],
  };
  const [key, title, derivedFrom] = titles[overrides.step]!;

  return {
    key,
    title,
    status: "todo",
    evidence: null,
    reason: null,
    regressed: false,
    derivedFrom,
    ...overrides,
  };
}

/** The seeded rail: 1 and 2 done, 3 active, 4 todo. */
export function seededSteps(): OnboardingStep[] {
  return [
    step({ step: 1, status: "done", evidence: "acme-robotics · token" }),
    step({ step: 2, status: "done", evidence: "helios-firmware · auto-detected below" }),
    step({ step: 3, status: "active", reason: "No starting workflow has been chosen yet." }),
    step({ step: 4, status: "todo", reason: "No first issue has been picked yet." }),
  ];
}

/** The wizard, with overrides. */
export function wizard(overrides: Partial<Onboarding> = {}): Onboarding {
  const steps = overrides.steps ?? seededSteps();
  const first = steps.find((one) => one.status !== "done");

  return {
    repo: REPO,
    steps,
    currentStep: first?.step ?? null,
    choices: {
      selectedTemplate: null,
      pickedTicketId: null,
      dismissed: false,
      completedAt: null,
      bypassedAt: null,
    },
    refs: { detectionScan: null, templates: [], pickedTicket: null },
    surfacing: { offer: true, reason: "fresh_organization" },
    ...overrides,
  };
}

/** The wizard with steps 1–3 done and an issue picked: step 4 is ready to run. */
export function readyToRun(): Onboarding {
  return wizard({
    steps: [
      step({ step: 1, status: "done", evidence: "acme-robotics · token" }),
      step({ step: 2, status: "done", evidence: "helios-firmware · auto-detected below" }),
      step({ step: 3, status: "done", evidence: "quick-fixes · from quick-fixes@v1" }),
      step({ step: 4, status: "active", reason: "#488 has not been queued yet." }),
    ],
    choices: {
      selectedTemplate: "quick-fixes",
      pickedTicketId: "5eed0080-0000-4000-8000-000000000488",
      dismissed: false,
      completedAt: null,
      bypassedAt: null,
    },
    refs: { detectionScan: null, templates: [], pickedTicket: pickedTicket() },
  });
}

/** The seeded wizard after its GitHub source was paused: step 1 regressed, its reason stated. */
export function regressed(): Onboarding {
  return wizard({
    steps: [
      step({
        step: 1,
        status: "todo",
        regressed: true,
        reason: 'The GitHub source "GitHub · acme-robotics" is paused, so acme-robotics/helios-firmware is not being read.',
      }),
      step({ step: 2, status: "done", evidence: "helios-firmware · auto-detected below" }),
      step({ step: 3, status: "todo", reason: "No starting workflow has been chosen yet." }),
      step({ step: 4, status: "todo", reason: "No first issue has been picked yet." }),
    ],
  });
}

/** What a launch answers. */
export function launchReceipt(overrides: Partial<OnboardingLaunchReceipt> = {}): OnboardingLaunchReceipt {
  return {
    repo: REPO,
    outcome: "queued",
    issue: { id: "issue-488", number: 488, title: "Bootloader: verify image CRC before jump" },
    queue: null,
    workflow: { slug: "quick-fixes", version: 1, pinReason: "explicit", path: "/workflows/quick-fixes" },
    dryRun: {
      active: true,
      reason: "dry-run policy active",
      note: "Dry-run is on: the PR opens as a draft and nothing merges until you say so.",
      path: "/settings#policies",
    },
    completedAt: "2026-10-05T09:00:00.000Z",
    links: { dashboard: "/dashboard", queue: "/dashboard#dash-up-next-title", console: null },
    run: null,
    timeline: { rows: [] } as unknown as OnboardingLaunchReceipt["timeline"],
    onboarding: wizard(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ the detection card (#391) */

/** When the seeded scan ran. */
export const SCANNED_AT = "2026-10-03T09:00:00.000Z";

/**
 * One detection row, with overrides.
 *
 * @param overrides What to change.
 * @returns The row.
 */
export function cardRow(overrides: Partial<RepoDetectionRow> & Pick<RepoDetectionRow, "rowKey">): RepoDetectionRow {
  return {
    verdict: "ok",
    value: "",
    label: "detected",
    confidence: "high",
    determined: true,
    evidence: { pack: overrides.rowKey, packVersion: "1.0.0", probes: ["tree"] },
    ...overrides,
  };
}

/**
 * The seeded card — `R__dev_seed_onboarding.sql`'s six rows of scan 1, 38 s, and the two
 * suggested protected paths: mockup 13's card with its honesty labels.
 *
 * @param overrides What to change.
 * @returns The detection.
 */
export function seededCard(overrides: Partial<RepoDetection> = {}): RepoDetection {
  return {
    repo: REPO,
    scan: {
      scanSeq: 1,
      scannedAt: SCANNED_AT,
      durationMs: 38_000,
      packVersions: { language: "1.0.0", conventions: "1.1.0" },
      probeBudgetUsed: 9,
    },
    rows: [
      cardRow({
        rowKey: "language",
        value: "C 92% · Zephyr RTOS 4.1",
        evidence: { pack: "language", packVersion: "1.0.0", probes: ["languages", "tree", "file:west.yml"] },
      }),
      cardRow({
        rowKey: "build",
        value: "west + twister (found west.yml)",
        evidence: { hit: "west.yml", pack: "build", packVersion: "1.0.0", probes: ["tree"] },
      }),
      cardRow({
        rowKey: "devcontainer",
        value: "found .devcontainer.json → image ghcr.io/zephyrproject-rtos/ci:v0.27.4",
        evidence: {
          hit: ".devcontainer.json",
          pack: "devcontainer",
          packVersion: "1.0.0",
          probes: ["tree", "file:.devcontainer.json"],
        },
      }),
      cardRow({ rowKey: "tests", value: "5 suites, 63 tests (detected)", confidence: "medium" }),
      cardRow({ rowKey: "protected_paths", value: "boot/, keys/ suggested", confidence: "medium" }),
      cardRow({
        rowKey: "conventions",
        verdict: "warn",
        value: "No CONTRIBUTING.md — a coming knowledge release will learn your conventions from merged PRs.",
        evidence: { pack: "conventions", packVersion: "1.1.0", probes: ["tree"], contributing: null },
      }),
    ],
    protectedPaths: [
      { glob: "boot/**", source: "suggested" },
      { glob: "keys/**", source: "suggested" },
    ],
    progress: null,
    ...overrides,
  };
}

/**
 * A scan's progress, with overrides.
 *
 * @param overrides What to change.
 * @returns The progress — running, four of nine probes settled.
 */
export function scanProgress(overrides: Partial<RepoDetectionProgress> = {}): RepoDetectionProgress {
  return {
    state: "running",
    startedAt: "2026-10-05T12:00:00.000Z",
    finishedAt: null,
    probesPlanned: 9,
    probesSettled: 4,
    scanSeq: null,
    error: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ the template tiles (#392) */

/**
 * One tile, with overrides — a starter tile, unselected, no workflow yet.
 *
 * @param overrides What to change.
 * @returns The tile.
 */
export function tile(overrides: Partial<OnboardingTemplateTile> & Pick<OnboardingTemplateTile, "slug">): OnboardingTemplateTile {
  return {
    version: 1,
    scope: "global",
    name: overrides.slug,
    description: "",
    stageDots: ["analyze", "code", "PR"],
    effortRange: ["s"],
    caption: null,
    tier: "starter",
    selected: false,
    unlock: null,
    workflow: null,
    ...overrides,
  };
}

/**
 * A workflow instantiated from a template, with overrides.
 *
 * @param overrides What to change.
 * @returns The workflow — `quick-fixes` v1 by default.
 */
export function instantiated(overrides: Partial<OnboardingInstantiatedWorkflow> = {}): OnboardingInstantiatedWorkflow {
  return {
    id: "wf-quick-fixes",
    slug: "quick-fixes",
    name: "Quick fixes",
    currentVersion: 1,
    templateSlug: "quick-fixes",
    templateVersion: 1,
    studioPath: "/workflows/quick-fixes",
    ...overrides,
  };
}

/**
 * The seeded grid — V068's four shipped templates as the onboarding seed's workspace sees them:
 * Quick fixes chosen (and not yet created), three merged loops, so Deep refactor is locked at
 * `3 of 10 merged loops`. Mockup 13's grid, minus the caption's invented statistic (O8).
 *
 * @param overrides What to change.
 * @returns The tiles.
 */
export function seededTiles(overrides: Partial<OnboardingTemplateTiles> = {}): OnboardingTemplateTiles {
  return {
    repo: REPO,
    selectedTemplate: "quick-fixes",
    mergedLoops: 3,
    studioPath: "/workflows",
    tiles: [
      tile({
        slug: "quick-fixes",
        name: "Quick fixes",
        description: "Small bugs and cleanups, fully hands-off.",
        stageDots: ["analyze", "plan", "code", "build", "test", "PR"],
        effortRange: ["xs", "s", "m"],
        caption: "recommended first workflow",
        selected: true,
      }),
      tile({
        slug: "feature-builder",
        name: "Feature builder",
        description: "Plans bigger changes, asks before merging.",
        stageDots: ["analyze", "plan", "ask you", "code", "build", "test", "PR"],
        effortRange: ["m", "l"],
        caption: "best for new capabilities that touch several files",
      }),
      tile({
        slug: "docs-chores",
        name: "Docs & chores",
        description: "Docs, typos, dep bumps on your cheapest model.",
        stageDots: ["analyze", "code", "check", "PR"],
        effortRange: ["xs", "s"],
        caption: "best for keeping the backlog tidy at near-zero cost",
      }),
      tile({
        slug: "deep-refactor",
        name: "Deep refactor",
        description: "Multi-PR restructures with staged rollout and extra review.",
        stageDots: ["map", "plan", "split", "code ×n", "verify", "PR ×n"],
        effortRange: ["l", "xl"],
        caption: "best once the loop has learned your codebase",
        tier: "advanced",
        unlock: {
          locked: true,
          mergedLoops: 3,
          threshold: 10,
          rule: "unlock after 10 merged loops",
          progress: "3 of 10 merged loops",
        },
      }),
    ],
    ...overrides,
  };
}

/**
 * What selecting a template answers.
 *
 * @param overrides What to change.
 * @returns The selection — Quick fixes created, nothing kept, the wizard with step 3 done.
 */
export function templateSelection(overrides: Partial<OnboardingTemplateSelection> = {}): OnboardingTemplateSelection {
  return {
    created: true,
    workflow: instantiated(),
    kept: [],
    onboarding: wizard({
      steps: [
        step({ step: 1, status: "done", evidence: "acme-robotics · token" }),
        step({ step: 2, status: "done", evidence: "helios-firmware · auto-detected below" }),
        step({ step: 3, status: "done", evidence: "quick-fixes · v1" }),
        step({ step: 4, status: "active", reason: "No first issue has been picked yet." }),
      ],
      currentStep: 4,
    }),
    ...overrides,
  };
}


/* ------------------------------------------------------------------ the first-issue card (#393) */

/** The seeded `#488`'s `github_issues.id`, and `#491`'s and `#485`'s. */
export const ISSUE_488 = "5eed004e-0000-4000-8000-000000000488";
export const ISSUE_491 = "5eed004e-0000-4000-8000-000000000491";
export const ISSUE_485 = "5eed004e-0000-4000-8000-000000000485";

/** The instant the card's fixtures are read at — the estimator's last run ten hours before. */
export const FIRST_ISSUE_READ_AT = Date.parse("2026-10-05T12:14:00.000Z");

/**
 * The seeded `#488` as the picker scores it (BB.4, #387): XS, docs-loop, no code paths, active a
 * day ago — 99.4 under `safety-v1` — on an unpriced model, so **no cost**. Mockup 13's pick row,
 * minus the `est. $0.03` the seed cannot back.
 *
 * @param overrides What to change.
 * @returns The candidate.
 */
export function candidate(overrides: Partial<OnboardingFirstIssueCandidate> = {}): OnboardingFirstIssueCandidate {
  return {
    issueId: ISSUE_488,
    number: 488,
    title: "Typo sweep in operator manual + pairing guide",
    url: "https://github.com/acme-robotics/helios-firmware/issues/488",
    effort: "xs",
    suggestedWorkflow: "docs-loop",
    score: 99.4,
    clearsBar: true,
    estimate: { version: 1, routedModel: "ollama/qwen3-coder", cycleMin: 3, cycleMax: 6, loopMinutes: 4, estTokens: 25000 },
    reasoning: {
      line: "no code paths touched · est. 4 min",
      fragments: [
        { source: "paths", text: "no code paths touched" },
        { source: "estimate", text: "est. 4 min" },
      ],
      components: [
        { key: "effort", signal: "xs", points: 35, maxPoints: 35, label: "XS effort" },
        { key: "workflow", signal: "docs-loop", points: 30, maxPoints: 30, label: "docs-loop workflow" },
        { key: "paths", signal: "no_code", points: 25, maxPoints: 25, label: "no code paths touched" },
        { key: "freshness", signal: "1", points: 9.4, maxPoints: 10, label: "active 1d ago" },
      ],
    },
    ...overrides,
  };
}

/**
 * The seeded `#491` — S, standard-fix, two code paths, active today: 49.9, just over the bar.
 *
 * @returns The candidate.
 */
export function candidate491(): OnboardingFirstIssueCandidate {
  return candidate({
    issueId: ISSUE_491,
    number: 491,
    title: "Add CRC32 to config persistence layer",
    url: "https://github.com/acme-robotics/helios-firmware/issues/491",
    effort: "s",
    suggestedWorkflow: "standard-fix",
    score: 49.9,
    estimate: { version: 1, routedModel: "copilot/gpt-5-codex", cycleMin: 8, cycleMax: 14, loopMinutes: 11, estTokens: 90000 },
    reasoning: {
      line: "2 code paths touched · est. 11 min",
      fragments: [
        { source: "paths", text: "2 code paths touched" },
        { source: "estimate", text: "est. 11 min" },
      ],
      components: [
        { key: "effort", signal: "s", points: 20, maxPoints: 35, label: "S effort" },
        { key: "workflow", signal: "standard-fix", points: 15, maxPoints: 30, label: "standard-fix workflow" },
        { key: "paths", signal: "code", points: 5, maxPoints: 25, label: "2 code paths touched" },
        { key: "freshness", signal: "0", points: 9.9, maxPoints: 10, label: "active today" },
      ],
    },
  });
}

/**
 * The seeded `#485` — M, standard-fix, three code paths: 34.9, below the bar.
 *
 * @returns The candidate.
 */
export function candidate485(): OnboardingFirstIssueCandidate {
  return candidate({
    issueId: ISSUE_485,
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    url: "https://github.com/acme-robotics/helios-firmware/issues/485",
    effort: "m",
    suggestedWorkflow: "standard-fix",
    score: 34.9,
    clearsBar: false,
    estimate: { version: 1, routedModel: "claude-fable-5", cycleMin: 12, cycleMax: 18, loopMinutes: 15, estTokens: 180000 },
    reasoning: {
      line: "3 code paths touched · est. 15 min",
      fragments: [
        { source: "paths", text: "3 code paths touched" },
        { source: "estimate", text: "est. 15 min" },
      ],
      components: [
        { key: "effort", signal: "m", points: 5, maxPoints: 35, label: "M effort" },
        { key: "workflow", signal: "standard-fix", points: 15, maxPoints: 30, label: "standard-fix workflow" },
        { key: "paths", signal: "code", points: 5, maxPoints: 25, label: "3 code paths touched" },
        { key: "freshness", signal: "0", points: 9.9, maxPoints: 10, label: "active today" },
      ],
    },
  });
}

/**
 * A candidate on a priced model — the mockup's `est. $0.03`, as the service answers it.
 *
 * @param base The candidate to price.
 * @returns The same candidate with a cost and its fragment.
 */
export function priced(base: OnboardingFirstIssueCandidate = candidate()): OnboardingFirstIssueCandidate {
  return {
    ...base,
    cost: { cents: 3, display: "$0.03" },
    reasoning: {
      ...base.reasoning,
      line: `${base.reasoning.line} · est. $0.03`,
      fragments: [...base.reasoning.fragments, { source: "cost", text: "est. $0.03" }],
    },
  };
}

/**
 * The nightly estimator's status (AL.5, #281): a run that succeeded at 02:14 UTC today.
 *
 * @param overrides What to change.
 * @returns The status.
 */
export function estimatorStatus(overrides: Partial<PlanningReestimationStatus> = {}): PlanningReestimationStatus {
  return {
    schedule: { hourUtc: 2, jitterMinutes: 30, batchLimit: 200 },
    lastRun: {
      startedAt: "2026-10-05T02:14:00.000Z",
      finishedAt: "2026-10-05T02:20:00.000Z",
      status: "succeeded",
      found: 4,
      queued: 4,
      inFlight: 0,
    },
    ...overrides,
  };
}

/**
 * The seeded ranking — `#488`, `#491` and `#485`, safest first; the two L issues set aside.
 *
 * @param overrides What to change.
 * @returns The alternatives.
 */
export function seededAlternatives(overrides: Partial<OnboardingFirstIssueAlternatives> = {}): OnboardingFirstIssueAlternatives {
  return {
    repo: REPO,
    weightsVersion: "safety-v1",
    safetyBar: 45,
    candidates: [candidate(), candidate491(), candidate485()],
    excluded: { protectedPath: 0, tooLarge: 2, belowBar: 1 },
    ...overrides,
  };
}

/**
 * The picker's seeded answer: `#488` picked over the seeded backlog, one issue still being sized
 * so the estimator's status travels with it.
 *
 * @param overrides What to change.
 * @returns The answer.
 */
export function seededFirstIssue(overrides: Partial<OnboardingFirstIssue> = {}): OnboardingFirstIssue {
  return {
    repo: REPO,
    weightsVersion: "safety-v1",
    safetyBar: 45,
    state: "picked",
    backlog: { open: 9, sized: 7, sizing: 1, needsHuman: 1 },
    pick: candidate(),
    estimator: estimatorStatus(),
    planning: null,
    excluded: { protectedPath: 0, tooLarge: 2, belowBar: 1 },
    ...overrides,
  };
}

/**
 * A backlog with open issues and none sized yet — most brand-new workspaces.
 *
 * @returns The answer.
 */
export function sizingFirstIssue(): OnboardingFirstIssue {
  return seededFirstIssue({
    state: "sizing",
    backlog: { open: 3, sized: 0, sizing: 3, needsHuman: 0 },
    pick: null,
    excluded: { protectedPath: 0, tooLarge: 0, belowBar: 0 },
  });
}

/**
 * A repository with no open issues.
 *
 * @returns The answer, with the planning pointer.
 */
export function emptyFirstIssue(): OnboardingFirstIssue {
  return seededFirstIssue({
    state: "empty",
    backlog: { open: 0, sized: 0, sizing: 0, needsHuman: 0 },
    pick: null,
    estimator: null,
    planning: { path: "/planning" },
    excluded: { protectedPath: 0, tooLarge: 0, belowBar: 0 },
  });
}

/**
 * Sized issues, none clearing the bar — one disqualified each way, `#485` below the bar.
 *
 * @returns The answer.
 */
export function noneSafeFirstIssue(): OnboardingFirstIssue {
  return seededFirstIssue({
    state: "none_safe",
    backlog: { open: 4, sized: 3, sizing: 1, needsHuman: 0 },
    pick: null,
    excluded: { protectedPath: 1, tooLarge: 1, belowBar: 1 },
  });
}

/**
 * The dry-run policy, on — the onboarding seed's default, which no person chose.
 *
 * @returns The policy.
 */
export function dryRunOn(): DryRunPolicy {
  return { dryRun: true, explicit: true, reason: "dry-run policy active", updatedAt: "2026-10-01T09:00:00.000Z", updatedBy: null };
}

/**
 * The dry-run policy, flipped off by a person.
 *
 * @returns The policy.
 */
export function dryRunOff(): DryRunPolicy {
  return { dryRun: false, explicit: true, reason: null, updatedAt: "2026-10-05T11:00:00.000Z", updatedBy: "5eed0003-0000-4000-8000-000000000001" };
}

/**
 * The dry-run policy of a workspace that never answered.
 *
 * @returns The policy.
 */
export function dryRunUnset(): DryRunPolicy {
  return { dryRun: false, explicit: false, reason: null, updatedAt: null, updatedBy: null };
}

/**
 * The card's one read over the seed: `#488` picked, the ranking, dry-run on.
 *
 * @param overrides What to change.
 * @returns The card.
 */
export function firstIssueCard(overrides: Partial<FirstIssueCard> = {}): FirstIssueCard {
  return {
    firstIssue: seededFirstIssue(),
    alternatives: seededAlternatives(),
    dryRun: { ok: true, value: dryRunOn() },
    ...overrides,
  };
}

/**
 * The wizard's stored pick as its rail read references it — the seed's `#488`.
 *
 * @param overrides What to change.
 * @returns The reference.
 */
export function pickedTicket(overrides: Partial<NonNullable<Onboarding["refs"]["pickedTicket"]>> = {}): NonNullable<Onboarding["refs"]["pickedTicket"]> {
  return {
    id: "5eed0080-0000-4000-8000-000000000488",
    externalKey: "#488",
    title: "Typo sweep in operator manual + pairing guide",
    source: "github",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ the right column (BB.5 → BC.5, #394) */

/**
 * One row of the *Smart Defaults* card, as BB.5 selects it — the self-hosted models row unless
 * overridden.
 *
 * @param overrides What to change.
 * @returns The row.
 */
export function defaultRow(overrides: Partial<OnboardingDefaultRow> & Pick<OnboardingDefaultRow, "key">): OnboardingDefaultRow {
  const rows: Record<OnboardingDefaultRow["key"], OnboardingDefaultRow> = {
    models: {
      key: "models",
      variant: "bring_your_own_keys",
      status: "ready",
      text: "Models: bring your own keys",
      link: { label: "Providers", path: "/models/providers" },
    },
    build: {
      key: "build",
      variant: "enroll_runner",
      status: "ready",
      text: "Build: enroll a runner",
      link: { label: "Build Farm", path: "/build-farm" },
    },
    estimator: {
      key: "estimator",
      variant: "nightly_estimator",
      status: "ready",
      text: "Estimator pre-sizes your backlog overnight",
      link: null,
      estimator: estimatorStatus(),
    },
    slack: {
      key: "slack",
      variant: "slack_future",
      status: "optional",
      text: "Slack: connect after your first PR (optional)",
      link: null,
      arrivesWith: "ChatOps",
    },
  };

  return { ...rows[overrides.key], ...overrides };
}

/** The SaaS-flagged models row — a managed pool with a declared `$5` trial credit (#397's shape). */
export function managedKeysRow(): OnboardingDefaultRow {
  return defaultRow({
    key: "models",
    variant: "managed_keys",
    text: "Models: managed keys with $5 trial credit",
    link: { label: "bring your own keys anytime", path: "/models/providers" },
    trialCredit: { cents: 500, display: "$5" },
  });
}

/** The SaaS-flagged build row — a hosted runner pool. */
export function hostedRunnerRow(): OnboardingDefaultRow {
  return defaultRow({
    key: "build",
    variant: "hosted_runner",
    text: "Build: hosted runner for your first loops",
    link: { label: "enroll your own farm later", path: "/build-farm" },
  });
}

/**
 * One reassure claim, as BB.5 writes it for the seeded workspace (a token source).
 *
 * @param key Which claim.
 * @param overrides What to change.
 * @returns The claim.
 */
export function reassureClaim(
  key: OnboardingReassureClaim["key"],
  overrides: Partial<OnboardingReassureClaim> = {},
): OnboardingReassureClaim {
  const claims: Record<OnboardingReassureClaim["key"], OnboardingReassureClaim> = {
    draft_only: {
      key: "draft_only",
      text: "Nothing is written to main.",
      mechanism: {
        key: "dry_run_policy",
        description:
          "The dry-run policy is on: loops open draft pull requests, and merging is refused until an owner or admin turns it off.",
        issue: 382,
        path: "/settings/policies",
      },
    },
    uninstall: {
      key: "uninstall",
      text: "The GitHub connection can be paused in one click.",
      mechanism: {
        key: "source_pause",
        description: "Pausing the acme-robotics source in Settings → Sources stops every read of it until it is resumed.",
        issue: 141,
        path: "/settings/sources",
      },
    },
    vault: {
      key: "vault",
      text: "Your keys are sealed in the tenant vault and never leave the control plane.",
      mechanism: {
        key: "vault_envelope_encryption",
        description:
          "Every stored credential is envelope-encrypted under this workspace's own data key; only ciphertext is stored.",
        issue: 222,
        path: "/models/providers",
      },
    },
  };

  return { ...claims[key], ...overrides };
}

/** The uninstall claim where the account records a GitHub App installation. */
export function appUninstallClaim(): OnboardingReassureClaim {
  return reassureClaim("uninstall", {
    text: "The app can be uninstalled in one click.",
    mechanism: {
      key: "github_app_uninstall",
      description: "Uninstalling the GitHub App from acme-robotics on GitHub revokes its access; the source then reads as disconnected.",
      issue: 122,
      path: "/settings/sources",
    },
  });
}

/**
 * One row of the projected timeline.
 *
 * @param overrides What to change.
 * @returns The row.
 */
export function timelineRow(
  overrides: Partial<OnboardingTimelineRow> & Pick<OnboardingTimelineRow, "key">,
): OnboardingTimelineRow {
  const rows: Record<OnboardingTimelineRow["key"], OnboardingTimelineRow> = {
    loop_starts: { key: "loop_starts", actor: "loop", text: "loop starts on #488", kind: "projected", atMinutes: 0 },
    plan_posted: { key: "plan_posted", actor: "loop", text: "draft plan posted to the issue", kind: "projected", atMinutes: null },
    draft_pr_opens: { key: "draft_pr_opens", actor: "loop", text: "draft PR opens", kind: "projected", atMinutes: 4 },
    you_review: { key: "you_review", actor: "you", text: "you review", kind: "projected", atMinutes: null },
    merge: { key: "merge", actor: "you", text: "merge — only when you say so; dry-run never merges", kind: "projected", atMinutes: null },
  };

  return { ...rows[overrides.key], ...overrides };
}

/**
 * The projection for the seeded pick under dry-run: `#488`, its `est. 4 min` on the draft-PR row,
 * every row `projected`.
 *
 * @param overrides What to change.
 * @returns The timeline.
 */
export function projectedTimeline(overrides: Partial<OnboardingTimeline> = {}): OnboardingTimeline {
  return {
    kind: "projected",
    basis: "issue_estimate",
    dryRun: true,
    rows: [
      timelineRow({ key: "loop_starts" }),
      timelineRow({ key: "plan_posted" }),
      timelineRow({ key: "draft_pr_opens" }),
      timelineRow({ key: "you_review" }),
      timelineRow({ key: "merge" }),
    ],
    ...overrides,
  };
}

/** The projection for a workspace that turned dry-run off — the PR is not a draft, and the workflow decides the merge. */
export function mergingTimeline(): OnboardingTimeline {
  return projectedTimeline({
    dryRun: false,
    rows: [
      timelineRow({ key: "loop_starts" }),
      timelineRow({ key: "plan_posted" }),
      timelineRow({ key: "draft_pr_opens", text: "pull request opens" }),
      timelineRow({ key: "you_review" }),
      timelineRow({ key: "merge", actor: "loop", text: "merge — as the workflow's final step decides" }),
    ],
  });
}

/** The projection before anything is picked — generic, and with no time beyond the origin. */
export function genericTimeline(): OnboardingTimeline {
  return projectedTimeline({
    basis: "none",
    rows: [
      timelineRow({ key: "loop_starts", text: "loop starts on your first issue" }),
      timelineRow({ key: "plan_posted" }),
      timelineRow({ key: "draft_pr_opens", atMinutes: null }),
      timelineRow({ key: "you_review" }),
      timelineRow({ key: "merge" }),
    ],
  });
}

/**
 * The right column as BB.5 serves it for a self-hosted deployment — the MVP default: bring your
 * own keys, enroll a runner, the real estimator, Slack dim; the three claims a token-connected,
 * dry-run workspace has; the projection for `#488`.
 *
 * @param overrides What to change.
 * @returns The column.
 */
export function selfHostedDefaults(overrides: Partial<OnboardingDefaults> = {}): OnboardingDefaults {
  const claims = [reassureClaim("draft_only"), reassureClaim("uninstall"), reassureClaim("vault")];

  return {
    repo: REPO,
    deployment: "self_hosted",
    capabilities: { managedKeyPool: false, hostedRunnerPool: false },
    rows: [defaultRow({ key: "models" }), defaultRow({ key: "build" }), defaultRow({ key: "estimator" }), defaultRow({ key: "slack" })],
    reassure: { claims, line: claims.map((claim) => claim.text).join(" ") },
    timeline: projectedTimeline(),
    ...overrides,
  };
}

/**
 * The column for a SaaS-flagged deployment — both pools declared (forward-compatible with #397).
 *
 * @returns The column.
 */
export function saasDefaults(): OnboardingDefaults {
  return selfHostedDefaults({
    deployment: "saas",
    capabilities: { managedKeyPool: true, hostedRunnerPool: true },
    rows: [managedKeysRow(), hostedRunnerRow(), defaultRow({ key: "estimator" }), defaultRow({ key: "slack" })],
  });
}

/**
 * The column for a workspace that turned dry-run off and has no covering source — only the vault
 * claim holds, and the timeline merges as the workflow decides.
 *
 * @returns The column.
 */
export function mergingDefaults(): OnboardingDefaults {
  const claims = [reassureClaim("vault")];

  return selfHostedDefaults({
    reassure: { claims, line: claims.map((claim) => claim.text).join(" ") },
    timeline: mergingTimeline(),
  });
}
