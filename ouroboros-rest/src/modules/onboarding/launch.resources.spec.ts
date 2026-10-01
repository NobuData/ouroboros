/** The launch receipt ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5). */

import type { QueueItemSummary } from "../dashboard/resources";
import {
  DASHBOARD_PATH,
  DASHBOARD_QUEUE_PATH,
  DRY_RUN_NOTES,
  launchDryRun,
  launchReceipt,
  runConsolePath,
  type LaunchReceiptParts,
} from "./launch.resources";
import type { OnboardingResource } from "./resources";

const QUEUED: QueueItemSummary = {
  id: "queue-488",
  issueNumber: 488,
  issueTitle: "Typo sweep in operator manual + pairing guide",
  effort: "xs",
  workflowTag: "quick-fixes",
  workflowVersion: 1,
  workflowPinReason: "explicit",
  position: 1,
  estMinutes: 15,
  enqueuedAt: "2026-09-30T10:00:00.000Z",
  playbookId: null,
};

const ONBOARDING = {
  repo: "acme-robotics/helios-firmware",
  choices: { completedAt: "2026-09-30T10:00:01.000Z" },
} as OnboardingResource;

/**
 * The parts of a receipt, with whatever a test changes.
 *
 * @param overrides - The fields to change.
 * @returns A fresh launch of `#488` under dry-run.
 */
function parts(overrides: Partial<LaunchReceiptParts> = {}): LaunchReceiptParts {
  return {
    outcome: "queued",
    issue: { id: "issue-488", number: 488, title: QUEUED.issueTitle },
    queue: QUEUED,
    workflow: { slug: "quick-fixes", version: 1, pinReason: "explicit" },
    policy: { dryRun: true, reason: "dry-run policy active" },
    runId: null,
    cycle: { min: 3, max: 6 },
    onboarding: ONBOARDING,
    ...overrides,
  };
}

describe("the launch receipt", () => {
  it("states what happened: queued, at this position, under this workflow version", () => {
    const receipt = launchReceipt(parts());

    expect(receipt).toMatchObject({
      repo: "acme-robotics/helios-firmware",
      outcome: "queued",
      issue: { number: 488 },
      queue: { position: 1 },
      workflow: {
        slug: "quick-fixes",
        version: 1,
        pinReason: "explicit",
        path: "/workflows/quick-fixes",
      },
      completedAt: "2026-09-30T10:00:01.000Z",
    });
    expect(receipt.queue).toBe(QUEUED);
    expect(receipt.onboarding).toBe(ONBOARDING);
  });

  it("links the dashboard and its queue card", () => {
    expect(DASHBOARD_PATH).toBe("/dashboard");
    expect(DASHBOARD_QUEUE_PATH).toBe("/dashboard#dash-up-next-title");
    expect(launchReceipt(parts()).links).toEqual({
      dashboard: "/dashboard",
      queue: "/dashboard#dash-up-next-title",
      console: null,
    });
  });

  it("keeps the run slot empty until a run exists, then fills it with the console's path", () => {
    expect(launchReceipt(parts()).run).toBeNull();

    const started = launchReceipt(parts({ outcome: "already_started", queue: null, runId: "r 1" }));

    expect(started.run).toEqual({ id: "r 1", path: "/runs/r%201" });
    expect(started.links.console).toBe("/runs/r%201");
    expect(runConsolePath("7f00")).toBe("/runs/7f00");
  });

  it("projects the timeline for the launched issue under the confirmed dry-run state", () => {
    const { timeline } = launchReceipt(parts());

    expect(timeline).toMatchObject({ kind: "projected", basis: "issue_estimate", dryRun: true });
    expect(timeline.rows[0].text).toBe("loop starts on #488");
  });

  describe("dry-run", () => {
    it("confirms an active policy with its designed reason", () => {
      expect(launchDryRun({ dryRun: true, reason: "dry-run policy active" })).toEqual({
        active: true,
        reason: "dry-run policy active",
        note: DRY_RUN_NOTES.active,
        path: "/settings/policies",
      });
    });

    it("says it is off, in words, rather than implying draft-only", () => {
      const off = launchDryRun({ dryRun: false, reason: null });

      expect(off).toMatchObject({ active: false, reason: null, note: DRY_RUN_NOTES.off });
      expect(off.note).toMatch(/Dry-run is off/);
      expect(off.note).toMatch(/not draft-only/);
      expect(
        launchReceipt(parts({ policy: { dryRun: false, reason: null } })).timeline.dryRun,
      ).toBe(false);
    });
  });
});
