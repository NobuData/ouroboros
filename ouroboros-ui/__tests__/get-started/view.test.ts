import { describe, expect, it } from "vitest";

import {
  CONNECT_LABEL,
  CONTINUE_LABEL,
  ENABLE_ADMIN_REASON,
  FINISHED_LABEL,
  LAUNCH_LABEL,
  NO_PICK_REASON,
  PROMISE,
  SKIP_LABEL,
  SKIP_NOTE,
  VIEWER_REASON,
  defaultRepo,
  getStartedPath,
  openingStep,
  parseRepo,
  primaryAction,
  receiptLine,
  regressionLine,
  regressionsOf,
  repoName,
  stepCounter,
} from "@/app/get-started/view";
import { DASHBOARD_PATH, SOURCES_PATH } from "@/app/paths";

import { REPO, launchReceipt, readyToRun, regressed, step, wizard } from "../helpers/onboarding";

/**
 * The Get Started frame's pure rules (BC.1, #390): the head's approved promise, which repository
 * and step the frame opens on, regressions explained, and the action bar's primary action per
 * step — disabled with the reason whenever a guard would refuse it.
 */

const EVERYONE = { contribute: true, administer: true };
const MEMBER = { contribute: true, administer: false };
const VIEWER = { contribute: false, administer: false };

describe("the head", () => {
  it("is the mockup's promise, claim by claim, each naming its mechanism", () => {
    expect(PROMISE.map((claim) => claim.text).join(" · ")).toBe(
      "Ouroboros starts in dry-run · it opens draft PRs · never merges until you say so · Nothing here is irreversible.",
    );
    for (const claim of PROMISE) expect(claim.mechanism).toMatch(/#\d+/);
  });

  it("labels the corner link for what it does, and says nothing is imported", () => {
    expect(SKIP_LABEL).not.toMatch(/import/i);
    expect(SKIP_NOTE).toContain("Nothing is imported");
    expect(SKIP_NOTE).toContain("#398");
  });
});

describe("which repository", () => {
  it("reads owner/name from the query, and nothing else", () => {
    expect(parseRepo(REPO)).toBe(REPO);
    expect(parseRepo([REPO, "x/y"])).toBe(REPO);
    for (const bad of [undefined, null, "", "helios-firmware", "a/b/c", "/etc/passwd", "a b/c", "-x/y"]) {
      expect(parseRepo(bad)).toBeNull();
    }
  });

  it("addresses the wizard with the repository encoded, or bare", () => {
    expect(getStartedPath(REPO)).toBe("/get-started?repo=acme-robotics%2Fhelios-firmware");
    expect(getStartedPath(null)).toBe("/get-started");
  });

  it("opens on an enabled repository first, then by name — and on none when nothing is mirrored", () => {
    expect(
      defaultRepo([
        { login: "acme-robotics", name: "zeta", enabled: false },
        { login: "acme-robotics", name: "helios-firmware", enabled: true },
        { login: "acme-labs", name: "alpha", enabled: true },
      ]),
    ).toBe("acme-labs/alpha");
    expect(defaultRepo([{ login: "acme-robotics", name: "zeta", enabled: false }])).toBe("acme-robotics/zeta");
    expect(defaultRepo([])).toBeNull();
  });

  it("names a repository by its own name", () => {
    expect(repoName(REPO)).toBe("helios-firmware");
  });
});

describe("the counter and the opening step", () => {
  it("is the mockup's Step 3 of 4, opening on the service's current step — or the last when all are done", () => {
    expect(stepCounter(3)).toBe("Step 3 of 4");
    expect(openingStep(wizard())).toBe(3);
    expect(openingStep({ currentStep: null })).toBe(4);
  });
});

describe("regressions", () => {
  it("explains a step that went backwards in the service's words", () => {
    const [only] = regressionsOf(regressed());

    expect(only).toEqual({
      step: 1,
      title: "Connect GitHub",
      reason: 'The GitHub source "GitHub · acme-robotics" is paused, so acme-robotics/helios-firmware is not being read.',
    });
    expect(regressionLine(only!)).toBe(
      'Step 1 · Connect GitHub — The GitHub source "GitHub · acme-robotics" is paused, so acme-robotics/helios-firmware is not being read.',
    );
  });

  it("has none for a rail that only moved forward, and states one even without a reason", () => {
    expect(regressionsOf(wizard())).toEqual([]);
    expect(regressionsOf(wizard({ steps: [step({ step: 2, regressed: true })] }))[0]!.reason).toBe(
      "Step 2 is no longer done.",
    );
  });
});

describe("the primary action", () => {
  it("connects GitHub on step 1, by link to Settings → Sources", () => {
    expect(primaryAction(wizard({ steps: [step({ step: 1, status: "active" })] }), 1, VIEWER)).toEqual({
      kind: "link",
      label: CONNECT_LABEL,
      href: SOURCES_PATH,
      blocked: null,
    });
  });

  it("enables the repository on step 2 — an owner or admin's, stated for anyone else", () => {
    const at2 = wizard({
      steps: [step({ step: 1, status: "done", evidence: "acme-robotics · token" }), step({ step: 2, status: "active" })],
    });

    expect(primaryAction(at2, 2, EVERYONE)).toEqual({ kind: "enable", label: "Enable helios-firmware →", blocked: null });
    expect(primaryAction(at2, 2, MEMBER).blocked).toBe(ENABLE_ADMIN_REASON);
  });

  it("continues on step 3 only once a workflow exists — until then, with the service's reason", () => {
    expect(primaryAction(wizard(), 3, EVERYONE)).toEqual({
      kind: "continue",
      label: CONTINUE_LABEL,
      blocked: "No starting workflow has been chosen yet.",
    });
    expect(primaryAction(readyToRun(), 3, EVERYONE)).toEqual({ kind: "continue", label: CONTINUE_LABEL, blocked: null });
  });

  it("runs the first loop on step 4 once an issue is picked", () => {
    expect(primaryAction(readyToRun(), 4, MEMBER)).toEqual({ kind: "launch", label: LAUNCH_LABEL, blocked: null });
  });

  it("refuses step 4 with the service's reason while nothing is picked, and a fallback when it gave none", () => {
    const unpicked = wizard({
      steps: readyToRun().steps.map((one) => (one.step === 4 ? { ...one, reason: "No first issue has been picked yet." } : one)),
    });

    expect(primaryAction(unpicked, 4, EVERYONE).blocked).toBe("No first issue has been picked yet.");
    expect(
      primaryAction(wizard({ steps: readyToRun().steps.map((one) => (one.step === 4 ? { ...one, reason: null } : one)) }), 4, EVERYONE)
        .blocked,
    ).toBe(NO_PICK_REASON);
  });

  it("is blocked by an earlier step that is not done — with that step's own reason", () => {
    expect(primaryAction(regressed(), 4, EVERYONE).blocked).toBe(
      'Step 1 first: The GitHub source "GitHub · acme-robotics" is paused, so acme-robotics/helios-firmware is not being read.',
    );
    expect(primaryAction(regressed(), 3, EVERYONE).blocked).toMatch(/^Step 1 first: /);
  });

  it("continues past a done step through the guard, and leads to the dashboard from the last", () => {
    expect(primaryAction(wizard(), 1, EVERYONE)).toEqual({ kind: "continue", label: CONTINUE_LABEL, blocked: null });

    const finished = wizard({ steps: readyToRun().steps.map((one) => ({ ...one, status: "done" as const })) });

    expect(primaryAction(finished, 4, VIEWER)).toEqual({ kind: "link", label: FINISHED_LABEL, href: DASHBOARD_PATH, blocked: null });
  });

  it("lets a viewer follow the wizard but not move it on — said, not hidden", () => {
    expect(primaryAction(wizard(), 1, VIEWER).blocked).toBe(VIEWER_REASON);
    expect(primaryAction(readyToRun(), 4, VIEWER).blocked).toBe(VIEWER_REASON);
  });

  it("leads to the dashboard for a step the rail does not have", () => {
    expect(primaryAction(wizard({ steps: [] }), 5, EVERYONE).href).toBe(DASHBOARD_PATH);
  });
});

describe("the launch receipt", () => {
  it("says what was queued, under which workflow, with the service's dry-run note", () => {
    expect(receiptLine(launchReceipt())).toBe(
      "#488 queued under quick-fixes. Dry-run is on: the PR opens as a draft and nothing merges until you say so.",
    );
    expect(receiptLine(launchReceipt({ outcome: "already_started" }))).toContain("#488 has already started");
  });
});
