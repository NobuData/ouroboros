/**
 * The derivation matrix ([#385](https://github.com/NobuData/ouroboros/issues/385)): every
 * subsystem state × every step, and the regression rule — the first test the issue asks for is
 * the disconnect regression, and it is the first `describe` here.
 */

import {
  blockingStep,
  deriveRail,
  splitRepo,
  type DerivedRail,
  type RailFacts,
} from "./onboarding.derivation";

const REPO = "acme-robotics/helios-firmware";

/** Every step done — the finished wizard the mockup's user has after step 4. */
const ALL_DONE: RailFacts = {
  repo: REPO,
  source: {
    displayName: "GitHub · acme-robotics",
    login: "acme-robotics",
    status: "active",
    statusReason: null,
    appInstalled: false,
  },
  repository: { enabled: true, accountEnabled: true },
  scanned: true,
  selectedTemplate: "quick-fixes",
  workflow: { slug: "quick-fixes", templateSlug: "quick-fixes", templateVersion: 1 },
  pickedTicket: { externalKey: "#488", inRepository: true, queued: true, run: false },
  completed: true,
};

/** Nothing done — a fresh workspace's first read. */
const NOTHING: RailFacts = {
  repo: REPO,
  source: null,
  repository: null,
  scanned: false,
  selectedTemplate: null,
  workflow: null,
  pickedTicket: null,
  completed: false,
};

/** The statuses, in rail order. */
function statuses(rail: DerivedRail): string[] {
  return rail.steps.map((step) => step.status);
}

describe("the disconnect regression", () => {
  it("flips step 1 to todo with a reason when the source is paused after completion", () => {
    const rail = deriveRail({
      ...ALL_DONE,
      source: { ...ALL_DONE.source!, status: "paused" },
    });

    expect(rail.steps[0]).toMatchObject({
      step: 1,
      status: "todo",
      regressed: true,
      evidence: null,
      reason:
        'The GitHub source "GitHub · acme-robotics" is paused, so acme-robotics/helios-firmware is not being read.',
    });
    expect(statuses(rail)).toEqual(["todo", "done", "done", "done"]);
    expect(rail.currentStep).toBe(1);
  });

  it("flips step 1 to todo when the source is gone entirely, and says why", () => {
    const rail = deriveRail({ ...ALL_DONE, source: null });

    expect(rail.steps[0]).toMatchObject({
      status: "todo",
      regressed: true,
      reason:
        "No GitHub source covers acme-robotics/helios-firmware yet — connect GitHub to continue.",
    });
  });

  it("carries the sync loop's reason when the source is failing", () => {
    const rail = deriveRail({
      ...ALL_DONE,
      source: { ...ALL_DONE.source!, status: "error", statusReason: "token revoked" },
    });

    expect(rail.steps[0].reason).toBe(
      'The GitHub source "GitHub · acme-robotics" is failing: token revoked.',
    );
    expect(rail.steps[0].regressed).toBe(true);
  });

  it("treats a completed wizard as evidence even when no later step is done", () => {
    const rail = deriveRail({ ...NOTHING, completed: true });

    expect(rail.steps.every((step) => step.status === "todo" && step.regressed)).toBe(true);
  });
});

describe("the rail", () => {
  it("is all done, with evidence lines, when every subsystem says so", () => {
    const rail = deriveRail(ALL_DONE);

    expect(statuses(rail)).toEqual(["done", "done", "done", "done"]);
    expect(rail.currentStep).toBeNull();
    expect(rail.steps.map((step) => step.evidence)).toEqual([
      "acme-robotics · token",
      "helios-firmware · auto-detected below",
      "quick-fixes · from quick-fixes@v1",
      "#488 · queued",
    ]);
    expect(rail.steps.map((step) => step.derivedFrom)).toEqual([
      "sources",
      "tenancy",
      "workflows",
      "intake",
    ]);
  });

  it("is active on step 1 and todo after it for a fresh workspace, with no regression", () => {
    const rail = deriveRail(NOTHING);

    expect(statuses(rail)).toEqual(["active", "todo", "todo", "todo"]);
    expect(rail.steps.some((step) => step.regressed)).toBe(false);
    expect(rail.currentStep).toBe(1);
  });

  it("reads as the mockup draws it: done, done, active, todo", () => {
    const rail = deriveRail({
      ...ALL_DONE,
      workflow: null,
      pickedTicket: null,
      completed: false,
    });

    expect(statuses(rail)).toEqual(["done", "done", "active", "todo"]);
    expect(rail.currentStep).toBe(3);
  });
});

describe("the derivation matrix — each subsystem state × its step", () => {
  // One row per state a subsystem can be in. Every other subsystem is held at "done", so the
  // step under test is the only one that can differ — and a later step being done makes every
  // not-done state here a regression, which is asserted alongside.
  const cases: [string, Partial<RailFacts>, number, boolean, string | null][] = [
    // step 1 — sources
    ["source active, token", {}, 1, true, "acme-robotics · token"],
    [
      "source active, App installed",
      { source: { ...ALL_DONE.source!, appInstalled: true } },
      1,
      true,
      "acme-robotics · GitHub App installed",
    ],
    ["source paused", { source: { ...ALL_DONE.source!, status: "paused" } }, 1, false, null],
    ["source failing", { source: { ...ALL_DONE.source!, status: "error" } }, 1, false, null],
    ["no source", { source: null }, 1, false, null],
    // step 2 — tenancy
    ["repository enabled, scanned", {}, 2, true, "helios-firmware · auto-detected below"],
    ["repository enabled, not scanned", { scanned: false }, 2, true, "helios-firmware · enabled"],
    [
      "repository disabled",
      { repository: { enabled: false, accountEnabled: true } },
      2,
      false,
      null,
    ],
    ["account disabled", { repository: { enabled: true, accountEnabled: false } }, 2, false, null],
    ["repository not mirrored", { repository: null }, 2, false, null],
    // step 3 — workflows
    ["workflow instantiated", {}, 3, true, "quick-fixes · from quick-fixes@v1"],
    ["template picked, no workflow", { workflow: null }, 3, false, null],
    ["no template picked", { selectedTemplate: null, workflow: null }, 3, false, null],
    // step 4 — intake
    ["picked issue queued", {}, 4, true, "#488 · queued"],
    [
      "picked issue run",
      { pickedTicket: { externalKey: "#488", inRepository: true, queued: false, run: true } },
      4,
      true,
      "#488 · run started",
    ],
    [
      "picked issue not queued",
      { pickedTicket: { externalKey: "#488", inRepository: true, queued: false, run: false } },
      4,
      false,
      null,
    ],
    [
      "picked issue of another repository",
      { pickedTicket: { externalKey: "HEL-142", inRepository: false, queued: false, run: false } },
      4,
      false,
      null,
    ],
    ["no issue picked", { pickedTicket: null }, 4, false, null],
  ];

  it.each(cases)("%s", (_label, override, step, done, evidence) => {
    const rail = deriveRail({ ...ALL_DONE, ...override });
    const derived = rail.steps[step - 1];

    expect(derived.status === "done").toBe(done);
    expect(derived.evidence).toBe(evidence);
    expect(derived.reason === null).toBe(done);
    // Everything else stayed done — the state moved only its own step.
    expect(
      rail.steps.filter((other) => other.step !== step).every((o) => o.status === "done"),
    ).toBe(true);
    // Not done, with the wizard completed: a regression, never "active".
    if (!done) {
      expect(derived).toMatchObject({ status: "todo", regressed: true });
    }
  });

  it("states a distinct reason for every not-done state", () => {
    const reasons = cases
      .filter(([, , , done]) => !done)
      .map(([, override, step]) => deriveRail({ ...ALL_DONE, ...override }).steps[step - 1].reason);

    expect(new Set(reasons).size).toBe(reasons.length);
    expect(reasons.every((reason) => typeof reason === "string" && reason.length > 0)).toBe(true);
  });

  it("does not call an unmirrored repository a regression when nothing later is done", () => {
    const rail = deriveRail({
      ...NOTHING,
      source: ALL_DONE.source,
      repository: null,
    });

    expect(rail.steps[1]).toMatchObject({ status: "active", regressed: false });
  });

  it("does not call a not-yet-enabled repository a regression — enabled defaults to false", () => {
    const rail = deriveRail({
      ...NOTHING,
      source: ALL_DONE.source,
      repository: { enabled: false, accountEnabled: false },
    });

    expect(rail.steps[1]).toMatchObject({ status: "active", regressed: false });
    expect(rail.steps[1].reason).toBe(
      "The GitHub account acme-robotics is not enabled for this workspace.",
    );
  });
});

describe("the completion guard", () => {
  it("passes when every step up to the one asked for is done", () => {
    const rail = deriveRail({ ...ALL_DONE, pickedTicket: null, completed: false });

    expect(blockingStep(rail, 3)).toBeUndefined();
  });

  it("names the first step that is not done — step 3 without an instantiated workflow", () => {
    const rail = deriveRail({ ...ALL_DONE, workflow: null, completed: false });

    expect(blockingStep(rail, 3)).toMatchObject({
      step: 3,
      reason: "No workflow has been created from the quick-fixes template yet.",
    });
  });

  it("refuses a later step when an earlier one regressed", () => {
    const rail = deriveRail({ ...ALL_DONE, source: null });

    expect(blockingStep(rail, 4)?.step).toBe(1);
  });

  it("ignores steps after the one asked for", () => {
    const rail = deriveRail({ ...ALL_DONE, pickedTicket: null, completed: false });

    expect(blockingStep(rail, 2)).toBeUndefined();
    expect(blockingStep(rail, 4)?.step).toBe(4);
  });
});

describe("splitRepo", () => {
  it("splits owner/name, keeping a nested namespace in the owner", () => {
    expect(splitRepo("acme-robotics/helios-firmware")).toEqual([
      "acme-robotics",
      "helios-firmware",
    ]);
    expect(splitRepo("group/sub/project")).toEqual(["group/sub", "project"]);
  });
});
