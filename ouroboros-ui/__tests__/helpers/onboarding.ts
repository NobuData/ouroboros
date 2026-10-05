import type { Onboarding, OnboardingLaunchReceipt, OnboardingStep } from "@/app/api/onboarding";

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
