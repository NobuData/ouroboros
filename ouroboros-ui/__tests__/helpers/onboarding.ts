import type { RepoDetection, RepoDetectionProgress, RepoDetectionRow } from "@/app/api/detection";
import type {
  Onboarding,
  OnboardingInstantiatedWorkflow,
  OnboardingLaunchReceipt,
  OnboardingStep,
  OnboardingTemplateSelection,
  OnboardingTemplateTile,
  OnboardingTemplateTiles,
} from "@/app/api/onboarding";

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

