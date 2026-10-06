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
  coveredBy,
  defaultRepo,
  getStartedPath,
  githubSources,
  isComplete,
  notCoveredReason,
  openingStep,
  parseRepo,
  pickerRowNote,
  pickerRows,
  positionLine,
  primaryAction,
  receiptLine,
  receiptView,
  regressionFixLabel,
  regressionLine,
  regressionsOf,
  repoName,
  sourceRepos,
  stepCounter,
  switchLabel,
} from "@/app/get-started/view";
import { DASHBOARD_PATH, SOURCES_PATH } from "@/app/paths";

import { enablement, org, repo } from "../helpers/login";
import { ISSUE_488, REPO, completed, launchReceipt, mirrored, readyToRun, regressed, step, wizard } from "../helpers/onboarding";
import { jiraSource, source } from "../helpers/sources";

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
    expect(primaryAction(readyToRun(), 4, MEMBER)).toEqual({ kind: "launch", label: LAUNCH_LABEL, blocked: null, pickIssueId: null });
  });

  it("runs step 4 on the picker's suggestion while nothing is stored — the press stores it first (#393)", () => {
    const unpicked = wizard({ steps: readyToRun().steps });

    expect(primaryAction(unpicked, 4, MEMBER, { suggestedIssueId: ISSUE_488 })).toEqual({
      kind: "launch",
      label: LAUNCH_LABEL,
      blocked: null,
      pickIssueId: ISSUE_488,
    });
    // A stored pick is the pick: the suggestion is not stored over it.
    expect(primaryAction(readyToRun(), 4, MEMBER, { suggestedIssueId: ISSUE_488 }).pickIssueId).toBeNull();
    // A viewer is refused before the suggestion matters.
    expect(primaryAction(unpicked, 4, VIEWER, { suggestedIssueId: ISSUE_488 }).blocked).toBe(VIEWER_REASON);
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

/* ------------------------------------------------------- the states the mockup cannot show (#395) */

describe("the sources a repository is read through (#395)", () => {
  it("reads a GitHub source's account and repositories out of its public config, lower-cased", () => {
    expect(sourceRepos(source({ config: { login: "Acme-Robotics", repos: ["Helios-Firmware", 7, ""] } }))).toMatchObject({
      login: "acme-robotics",
      repos: ["helios-firmware"],
    });
    expect(sourceRepos(source({ config: { login: "", repos: [] } }))).toBeNull();
    expect(sourceRepos(source({ config: { base_url: "https://x" } }))).toBeNull();
  });

  it("keeps only the GitHub sources, and knows which repository one names", () => {
    expect(githubSources([jiraSource(), source()])).toEqual([source()]);
    expect(coveredBy([source()], "Acme-Robotics/Helios-Firmware")).toBe(true);
    expect(coveredBy([source()], "acme-robotics/nowhere")).toBe(false);
    expect(coveredBy([jiraSource()], REPO)).toBe(false);
  });

  it("refuses, in a sentence that says what to do first, a repository no source names", () => {
    expect(notCoveredReason("acme-robotics/nowhere")).toBe("No GitHub source names acme-robotics/nowhere — connect one that does first.");
  });
});

describe("the repository picker's rows (#395)", () => {
  it("joins what the sources name with what the mirror holds — this wizard's row first, then by name, once each", () => {
    const rows = pickerRows([source(), source({ id: "twin", config: { login: "acme-robotics", repos: ["helios-firmware"] } })], mirrored(), REPO);

    expect(rows.map((row) => [row.repo, row.recorded, row.enabled, row.current])).toEqual([
      ["acme-robotics/helios-firmware", true, true, true],
      ["acme-robotics/atlas-scheduler", false, false, false],
      ["acme-robotics/helios-console", true, false, false],
      ["acme-robotics/helios-telemetry", false, false, false],
    ]);
  });

  it("counts a repository under a disabled account as off, and every row unrecorded with no mirror", () => {
    const off = enablement([[org({ enabled: false }), [repo()]]]);

    expect(pickerRows([source()], off, null)[0]).toMatchObject({ repo: "acme-robotics/atlas-scheduler", recorded: false });
    expect(pickerRows([source()], off, null).find((row) => row.name === "helios-firmware")).toMatchObject({ recorded: true, enabled: false });
    expect(pickerRows([source()], null, null).every((row) => !row.recorded && !row.enabled)).toBe(true);
  });

  it("says what each row's switches mean, and names what pressing the switch does", () => {
    const [current, unrecorded, off] = pickerRows([source()], mirrored(), REPO);

    expect(pickerRowNote(current!)).toBe("enabled");
    expect(pickerRowNote(unrecorded!)).toBe("not recorded yet — switching on records it");
    expect(pickerRowNote(off!)).toBe("off");
    expect(switchLabel(current!)).toBe("Disable Ouroboros in acme-robotics/helios-firmware");
    expect(switchLabel(off!)).toBe("Enable Ouroboros in acme-robotics/helios-console");
  });
});

describe("the regression's fix (#395)", () => {
  it("leads to the step whose surface owns the problem", () => {
    expect(regressionFixLabel({ step: 1 })).toBe("Fix step 1 →");
  });
});

describe("the completion card (#395)", () => {
  it("knows a complete wizard by its stamp or its last step", () => {
    expect(isComplete(completed())).toBe(true);
    expect(isComplete(wizard({ steps: completed().steps }))).toBe(true);
    expect(isComplete(readyToRun())).toBe(false);
  });

  it("says a position in words", () => {
    expect(positionLine(1)).toBe("next in the queue");
    expect(positionLine(13)).toBe("queue position 13");
  });

  it("is the receipt while the press is fresh — position, note and the service's links — with the console only when there is a run", () => {
    const receipt = launchReceipt({ run: { id: "run-1", path: "/runs/run-1" }, outcome: "already_started" });
    const view = receiptView(receipt, completed(), mirrored());

    expect(view.headline).toBe("#488 has already started under quick-fixes@v1");
    expect(view.position).toBeNull();
    expect(view.dryRunNote).toBe("Dry-run is on: the PR opens as a draft and nothing merges until you say so.");
    expect(view.consoleHref).toBe("/runs/run-1");
    expect(view.dashboardHref).toBe(DASHBOARD_PATH);
    expect(receiptView(launchReceipt(), completed(), mirrored()).consoleHref).toBeNull();
    expect(receiptView(launchReceipt({ workflow: { ...launchReceipt().workflow, version: null } }), completed(), mirrored()).headline).toBe(
      "#488 queued under quick-fixes",
    );
  });

  it("is the rail's own evidence after a reload, with no position or note it did not read", () => {
    const view = receiptView(null, completed(), mirrored());

    expect(view).toMatchObject({
      headline: "#488 · queued",
      position: null,
      dryRunNote: null,
      dashboardHref: "/dashboard",
      queueHref: "/dashboard#dash-up-next-title",
      consoleHref: null,
      runsHref: "/runs",
    });
  });

  it("re-enters for every other mirrored repository, by name, and none without a mirror", () => {
    expect(receiptView(null, completed(), mirrored()).others).toEqual([
      { repo: "acme-robotics/helios-console", href: "/get-started?repo=acme-robotics%2Fhelios-console" },
    ]);
    expect(receiptView(null, completed(), null).others).toEqual([]);
  });
});
