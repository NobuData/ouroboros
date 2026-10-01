/**
 * The first-run launcher ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5), over
 * the real wizard service and an in-memory wizard, queue and policy — so *queued, pinned,
 * completed, dry-run confirmed* is asserted as one composition rather than four mocks agreeing.
 */

import type { QueueSelectionBody } from "../backlog/queue.dto";
import { queueItemSummary } from "../dashboard/resources";
import type { QueueItem } from "../db/schema";
import { ConflictError, InvalidRequestError } from "../errors/error.envelope";
import type { DryRunPolicyResource } from "../policies/org-policy.service";
import type { LaunchRepository, MirroredPickRow, PickRunRow } from "./launch.repository";
import { FirstRunLauncherService } from "./launch.service";
import {
  emptyRow,
  FakeOnboarding,
  ISSUE_ID,
  ORG,
  REPO,
  TICKET,
  TICKET_ID,
} from "./onboarding.fixture";
import { OnboardingService, type OnboardingSnapshot } from "./onboarding.service";

/** `#488` as the repository's backlog mirrors it — the seed's 3–6 minute cycle. */
const PICK: MirroredPickRow = {
  id: ISSUE_ID,
  number: 488,
  title: "Typo sweep in operator manual + pairing guide",
  cycleMin: 3,
  cycleMax: 6,
};

/** The dry-run policy in memory: `undefined` is a workspace that never answered. */
class FakePolicies {
  stored: boolean | undefined;

  adoptDefault = jest.fn((): Promise<boolean> => {
    const adopted = this.stored === undefined;

    this.stored ??= true;

    return Promise.resolve(adopted);
  });

  read = jest.fn((): Promise<DryRunPolicyResource> => {
    const dryRun = this.stored ?? false;

    return Promise.resolve({
      dryRun,
      explicit: this.stored !== undefined,
      reason: dryRun ? "dry-run policy active" : null,
      updatedAt: null,
      updatedBy: null,
    });
  });
}

/** The queue and the runs of one workspace, in memory. */
class FakeLoop {
  picks = new Map<number, MirroredPickRow>([[488, PICK]]);
  items = new Map<number, QueueItem>();
  runs = new Map<number, PickRunRow>();

  constructor(private readonly wizard: FakeOnboarding) {}

  /**
   * Put an issue in the queue, as M.3's write would.
   *
   * @param issueNumber - The issue.
   * @param workflow - The workflow it is pinned to.
   * @returns The row.
   */
  enqueue(issueNumber: number, workflow: string): QueueItem {
    const row: QueueItem = {
      id: `queue-${String(issueNumber)}`,
      organization_id: ORG,
      github_repo_id: "repo-1",
      issue_number: issueNumber,
      issue_title: PICK.title,
      effort: "xs",
      workflow_tag: workflow,
      workflow_version: 1,
      workflow_pin_reason: "explicit",
      playbook_id: null,
      position: this.items.size + 1,
      est_minutes: 15,
      enqueued_at: new Date("2026-09-30T10:00:00.000Z"),
      created_at: new Date("2026-09-30T10:00:00.000Z"),
      updated_at: new Date("2026-09-30T10:00:00.000Z"),
    };

    this.items.set(issueNumber, row);
    this.wizard.queued.add(issueNumber);

    return row;
  }

  /**
   * Record a run of an issue, as the engine claiming its queue item would.
   *
   * @param issueNumber - The issue.
   * @param run - The run.
   */
  start(issueNumber: number, run: PickRunRow): void {
    this.items.delete(issueNumber);
    this.wizard.queued.delete(issueNumber);
    this.runs.set(issueNumber, run);
    this.wizard.runs.add(issueNumber);
  }

  asRepository(): LaunchRepository {
    return {
      mirroredPick: (_org: string, _repo: string, issue: number) =>
        Promise.resolve(this.picks.get(issue)),
      queueItem: (_org: string, _repo: string, issue: number) =>
        Promise.resolve(this.items.get(issue)),
      latestRun: (_org: string, _repo: string, issue: number) =>
        Promise.resolve(this.runs.get(issue)),
    } as unknown as LaunchRepository;
  }
}

describe("the first-run launcher", () => {
  let wizard: FakeOnboarding;
  let loop: FakeLoop;
  let policies: FakePolicies;
  let queueSelection: jest.Mock;
  let launcher: FirstRunLauncherService;

  beforeEach(() => {
    wizard = new FakeOnboarding().readyToLaunch();
    loop = new FakeLoop(wizard);
    policies = new FakePolicies();
    queueSelection = jest.fn((_org: string, body: QueueSelectionBody) => {
      const row = loop.enqueue(488, body.workflow ?? "docs-loop");

      return Promise.resolve({ items: [queueItemSummary(row)], estMinutes: 15 });
    });
    launcher = new FirstRunLauncherService(
      new OnboardingService(wizard.asRepository(), policies),
      loop.asRepository(),
      { queueSelection },
      policies,
    );
  });

  describe("a launch", () => {
    it("queues the picked issue, naming the instantiated workflow so its version is pinned", async () => {
      const receipt = await launcher.launch(ORG, REPO);

      // M.3's write, one issue, the instantiated workflow explicit — R.1 pins it from there.
      expect(queueSelection.mock.calls).toEqual([
        [ORG, { issueIds: [ISSUE_ID], workflow: "quick-fixes" }],
      ]);
      expect(receipt).toMatchObject({
        repo: REPO,
        outcome: "queued",
        issue: { id: ISSUE_ID, number: 488, title: PICK.title },
        queue: { issueNumber: 488, position: 1, workflowTag: "quick-fixes" },
        workflow: {
          slug: "quick-fixes",
          version: 1,
          pinReason: "explicit",
          path: "/workflows/quick-fixes",
        },
      });
    });

    it("answers the queue's own item, so the dashboard queue shows the same entry", async () => {
      const receipt = await launcher.launch(ORG, REPO);
      const held = loop.items.get(488);

      expect(held).toBeDefined();
      expect(receipt.queue).toEqual(queueItemSummary(held as QueueItem));
    });

    it("links the dashboard and its queue card, and no console while there is no run", async () => {
      const receipt = await launcher.launch(ORG, REPO);

      expect(receipt.links).toEqual({
        dashboard: "/dashboard",
        queue: "/dashboard#dash-up-next-title",
        console: null,
      });
      expect(receipt.run).toBeNull();
    });

    it("marks the wizard complete, every step done in reality", async () => {
      const receipt = await launcher.launch(ORG, REPO);

      expect(receipt.onboarding.steps.map((step) => step.status)).toEqual([
        "done",
        "done",
        "done",
        "done",
      ]);
      expect(receipt.onboarding.currentStep).toBeNull();
      expect(receipt.completedAt).not.toBeNull();
      expect(receipt.completedAt).toBe(receipt.onboarding.choices.completedAt);
      expect(wizard.writes.map((write) => write.method)).toEqual(["markCompleted"]);
    });

    it("compares the repository case-insensitively", async () => {
      const receipt = await launcher.launch(ORG, "Acme-Robotics/Helios-Firmware");

      expect(receipt.repo).toBe(REPO);
      expect(receipt.outcome).toBe("queued");
    });
  });

  describe("dry-run", () => {
    it("is defaulted ON by completion when the workspace never answered, and confirmed", async () => {
      expect(policies.stored).toBeUndefined();

      const receipt = await launcher.launch(ORG, REPO);

      expect(policies.stored).toBe(true);
      expect(receipt.dryRun).toEqual({
        active: true,
        reason: "dry-run policy active",
        note: "Dry-run is on: this loop opens a draft pull request and never merges.",
        path: "/settings/policies",
      });
      expect(receipt.timeline.dryRun).toBe(true);
    });

    it("is read after completion, not before — the receipt reports what completion left", async () => {
      await launcher.launch(ORG, REPO);

      const adopted = policies.adoptDefault.mock.invocationCallOrder[0];
      const read = policies.read.mock.invocationCallOrder[0];

      expect(adopted).toBeLessThan(read);
    });

    it("says so when the workspace turned it off, rather than claiming draft-only", async () => {
      policies.stored = false;

      const receipt = await launcher.launch(ORG, REPO);

      // An explicit false is left alone (BA.3) …
      expect(policies.stored).toBe(false);
      // … and the receipt states it.
      expect(receipt.dryRun.active).toBe(false);
      expect(receipt.dryRun.reason).toBeNull();
      expect(receipt.dryRun.note).toContain("Dry-run is off");
      expect(receipt.dryRun.note).not.toContain("never merges");
      expect(receipt.timeline.dryRun).toBe(false);
      expect(JSON.stringify(receipt.timeline)).not.toContain("draft PR");
    });

    it("confirms an already-active policy without rewriting it", async () => {
      policies.stored = true;

      const receipt = await launcher.launch(ORG, REPO);

      expect(receipt.dryRun.active).toBe(true);
      expect(policies.stored).toBe(true);
    });
  });

  describe("the guards", () => {
    /** Nothing was queued, completed or adopted. */
    function expectNothingHappened(): void {
      expect(queueSelection).not.toHaveBeenCalled();
      expect(wizard.writes).toEqual([]);
      expect(policies.adoptDefault).not.toHaveBeenCalled();
      expect(policies.stored).toBeUndefined();
    }

    it("refuses with step 1's reason when no source covers the repository", async () => {
      wizard.sources = [];

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        status: 409,
        response: {
          code: "onboarding_step_incomplete",
          message: `No GitHub source covers ${REPO} yet — connect GitHub to continue.`,
          details: { step: 4, blockingStep: 1 },
        },
      });
      expectNothingHappened();
    });

    it("refuses with step 2's reason when the repository is not enabled", async () => {
      wizard.repositoryRow = { id: "repo-1", enabled: false, account_enabled: true };

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        response: {
          code: "onboarding_step_incomplete",
          message: `${REPO} is not enabled — enable it to continue.`,
          details: { step: 4, blockingStep: 2 },
        },
      });
      expectNothingHappened();
    });

    it("refuses with step 3's reason when no workflow was instantiated", async () => {
      wizard.workflows = [];

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        response: {
          code: "onboarding_step_incomplete",
          message: "No workflow has been created from the quick-fixes template yet.",
          details: {
            step: 4,
            blockingStep: 3,
            reason: "No workflow has been created from the quick-fixes template yet.",
          },
        },
      });
      expectNothingHappened();
    });

    it("names the first blocking step when several are incomplete", async () => {
      wizard.sources = [];
      wizard.workflows = [];

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        response: { details: { blockingStep: 1 } },
      });
    });

    it("refuses with a stated reason when nothing is picked", async () => {
      wizard.rows.set(REPO, { ...emptyRow(), selected_template: "quick-fixes" });

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        status: 409,
        response: {
          code: "onboarding_pick_required",
          message: "No first issue has been picked yet.",
          details: { step: 4, reason: "No first issue has been picked yet." },
        },
      });
      expectNothingHappened();
    });

    it("refuses a pick that is another repository's issue", async () => {
      wizard.tickets = [{ ...TICKET, meta: { github: { owner: "acme-robotics", repo: "other" } } }];

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        response: {
          code: "onboarding_pick_required",
          message: `#488 is not an issue of ${REPO}, so it cannot be its first run.`,
        },
      });
      expectNothingHappened();
    });

    it("refuses a pick the repository's backlog does not mirror", async () => {
      loop.picks.clear();

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        response: {
          code: "onboarding_pick_required",
          message: `#488 is not in ${REPO}'s synced backlog yet, so it cannot be queued.`,
        },
      });
      expectNothingHappened();
    });

    it("refuses a pick whose ticket has since been deleted", async () => {
      wizard.tickets = [];
      wizard.rows.set(REPO, {
        ...emptyRow(),
        selected_template: "quick-fixes",
        picked_ticket_id: TICKET_ID,
      });

      await expect(launcher.launch(ORG, REPO)).rejects.toMatchObject({
        response: { code: "onboarding_pick_required" },
      });
      expectNothingHappened();
    });

    it("never launches on a rail that passed without the rows it is derived from", async () => {
      const real = new OnboardingService(wizard.asRepository(), policies);
      const hollow = {
        snapshot: async (): Promise<OnboardingSnapshot> => ({
          ...(await real.snapshot(ORG, REPO)),
          workflow: undefined,
        }),
        completeStep: jest.fn(),
      } as unknown as OnboardingService;
      const guarded = new FirstRunLauncherService(
        hollow,
        loop.asRepository(),
        { queueSelection },
        policies,
      );

      await expect(guarded.launch(ORG, REPO)).rejects.toThrow(
        "The onboarding rail reports steps 2 and 3 done without their rows.",
      );
      expect(queueSelection).not.toHaveBeenCalled();
    });
  });

  describe("a repeat", () => {
    it("is not a second launch: the queue is written once and the receipt says already queued", async () => {
      const first = await launcher.launch(ORG, REPO);
      const second = await launcher.launch(ORG, REPO);

      expect(queueSelection).toHaveBeenCalledTimes(1);
      expect(second.outcome).toBe("already_queued");
      expect(second.queue).toEqual(first.queue);
      expect(second.workflow).toEqual(first.workflow);
      // The first completion stands.
      expect(second.completedAt).toBe(first.completedAt);
    });

    it("reports the workflow the queue actually holds, when the issue was queued elsewhere", async () => {
      loop.enqueue(488, "docs-loop");

      const receipt = await launcher.launch(ORG, REPO);

      expect(queueSelection).not.toHaveBeenCalled();
      expect(receipt.outcome).toBe("already_queued");
      expect(receipt.workflow).toMatchObject({ slug: "docs-loop", path: "/workflows/docs-loop" });
      expect(receipt.onboarding.choices.completedAt).not.toBeNull();
    });

    it("fills the run slot, and writes no queue item, once a run of the issue exists", async () => {
      loop.start(488, { id: "run-7f00", workflowTag: "quick-fixes" });

      const receipt = await launcher.launch(ORG, REPO);

      expect(queueSelection).not.toHaveBeenCalled();
      expect(receipt).toMatchObject({
        outcome: "already_started",
        queue: null,
        run: { id: "run-7f00", path: "/runs/run-7f00" },
        links: { console: "/runs/run-7f00" },
        workflow: { slug: "quick-fixes", version: null, pinReason: null },
      });
    });

    it("answers the other press's item when two launches race for the queue", async () => {
      queueSelection.mockImplementationOnce(() => {
        // The other request's insert landed between this one's check and its write.
        loop.enqueue(488, "quick-fixes");

        return Promise.reject(new ConflictError("queue_issues_conflict", "already queued"));
      });

      const receipt = await launcher.launch(ORG, REPO);

      expect(receipt.outcome).toBe("already_queued");
      expect(receipt.queue).toMatchObject({ issueNumber: 488, workflowTag: "quick-fixes" });
      expect(receipt.onboarding.choices.completedAt).not.toBeNull();
    });
  });

  describe("the queue's refusals", () => {
    it("passes through a conflict it cannot explain — another repository holding the number", async () => {
      const conflict = new ConflictError("queue_issues_conflict", "already queued");
      queueSelection.mockRejectedValueOnce(conflict);

      await expect(launcher.launch(ORG, REPO)).rejects.toBe(conflict);
      expect(wizard.writes).toEqual([]);
      expect(policies.adoptDefault).not.toHaveBeenCalled();
    });

    it("passes through an unsized pick, and completes nothing", async () => {
      const unsized = new InvalidRequestError("queue_issues_not_queueable", "not sized");
      queueSelection.mockRejectedValueOnce(unsized);

      await expect(launcher.launch(ORG, REPO)).rejects.toBe(unsized);
      expect(wizard.writes).toEqual([]);
      expect(policies.stored).toBeUndefined();
    });
  });

  describe("the receipt's timeline", () => {
    it("is labelled as a projection on the card and on every row", async () => {
      const { timeline } = await launcher.launch(ORG, REPO);

      expect(timeline.kind).toBe("projected");
      expect(timeline.rows).toHaveLength(5);
      expect(timeline.rows.every((row) => row.kind === "projected")).toBe(true);
    });

    it("carries the issue's own estimate and nothing measured", async () => {
      const { timeline } = await launcher.launch(ORG, REPO);

      expect(timeline.basis).toBe("issue_estimate");
      expect(timeline.rows.map((row) => [row.key, row.atMinutes])).toEqual([
        ["loop_starts", 0],
        ["plan_posted", null],
        // The first-issue card's `est. 4 min`: the 3–6 minute cycle's midpoint.
        ["draft_pr_opens", 4],
        ["you_review", null],
        ["merge", null],
      ]);
      expect(timeline.rows[0].text).toBe("loop starts on #488");
    });

    it("carries no time at all for a pick that was never estimated", async () => {
      loop.picks.set(488, { ...PICK, cycleMin: null, cycleMax: null });

      const { timeline } = await launcher.launch(ORG, REPO);

      expect(timeline.basis).toBe("none");
      expect(timeline.rows.map((row) => row.atMinutes)).toEqual([0, null, null, null, null]);
    });

    it("puts no aggregate statistic anywhere in the receipt (O8)", async () => {
      const text = JSON.stringify(await launcher.launch(ORG, REPO));

      expect(text).not.toMatch(/\d\s*%/);
      expect(text).not.toMatch(/4m 10s/);
      expect(text).not.toMatch(/average|across teams|of teams/i);
    });
  });
});
