import { QUEUE_ERRORS } from "../backlog/queue.errors";
import { TABLE_COLUMNS } from "../db/schema";
import { PLAYBOOK_ERRORS } from "./playbooks.errors";
import {
  HELIOS,
  ISSUE_485,
  ISSUE_491,
  ISSUE_OTHER_REPO,
  LIVE_RUN,
  PlaybookWorld,
  SOURCE_RUN,
  STANDARD_FIX,
  STANDARD_FIX_ID,
  WORKSPACE,
} from "./playbooks.store.fixture";
import type { PlaybooksService } from "./playbooks.service";

/**
 * Playbooks (#415, K6) over the real queue write (#112) and the real assembly (#414), with only
 * the statements doubled. The acceptance criteria this file holds:
 *
 *   * create-from-run against a seeded run captures its workflow pin, manifest-derived overrides
 *     and steer notes;
 *   * run-on-issue queues the ticket with the workflow pinned and the preset attached, in the
 *     dashboard queue's own shape;
 *   * the queued item carries `playbook_id`, and the count increments from the real launch;
 *   * `run 9×` derives from launches — no counter column is ever written;
 *   * the issue filter narrows the picker.
 */

/** A recipe's body, pinned to standard-fix@v14. */
const FLAKY = {
  name: "Flaky test hunt",
  description: "Hunt the flakiest suite first",
  workflow: STANDARD_FIX,
  workflowVersion: 14,
};

describe("playbooks", () => {
  let world: PlaybookWorld;
  let service: PlaybooksService;

  beforeEach(() => {
    world = new PlaybookWorld();
    service = world.service();
  });

  describe("CRUD", () => {
    it("creates a recipe pinned to a published version, and reads it back", async () => {
      const created = await service.create(WORKSPACE, {
        ...FLAKY,
        skillOverrides: { disable: [world.commit.id] },
        contextPreset: { steerNotes: ["focus the flakiest suite first"] },
        issueFilter: { labels: ["flaky"] },
      });

      expect(created).toMatchObject({
        name: "Flaky test hunt",
        workflow: { id: STANDARD_FIX_ID, slug: STANDARD_FIX, version: 14 },
        skillOverrides: { enable: [], disable: [world.commit.id] },
        contextPreset: { steerNotes: ["focus the flakiest suite first"], factIds: [] },
        issueFilter: { labels: ["flaky"], repos: null },
        sourceRunId: null,
        runCount: 0,
      });
      await expect(service.read(WORKSPACE, created.id)).resolves.toEqual(created);
      await expect(service.list(WORKSPACE)).resolves.toEqual({ items: [created] });
    });

    it.each([
      [{ workflow: "no-such-flow" }, PLAYBOOK_ERRORS.workflowNotFound],
      [{ workflowVersion: 15 }, PLAYBOOK_ERRORS.versionNotPublished],
    ])("refuses a pin that is not a published version: %o", async (change, code) => {
      await expect(service.create(WORKSPACE, { ...FLAKY, ...change })).rejects.toMatchObject({
        code,
      });
      expect(world.playbooks).toHaveLength(0);
    });

    it("refuses overlapping overrides before writing", async () => {
      await expect(
        service.create(WORKSPACE, {
          ...FLAKY,
          skillOverrides: { enable: [world.commit.id], disable: [world.commit.id] },
        }),
      ).rejects.toMatchObject({ code: PLAYBOOK_ERRORS.overridesOverlap });
      expect(world.writes).toHaveLength(0);
    });

    it("answers V072's reference trigger as a 422 — a required skill cannot be disabled", async () => {
      await expect(
        service.create(WORKSPACE, { ...FLAKY, skillOverrides: { disable: [world.hil.id] } }),
      ).rejects.toMatchObject({ code: PLAYBOOK_ERRORS.referenceUnresolved });
    });

    it("answers a taken name as a 409", async () => {
      await service.create(WORKSPACE, FLAKY);

      await expect(service.create(WORKSPACE, FLAKY)).rejects.toMatchObject({
        code: PLAYBOOK_ERRORS.nameTaken,
      });
    });

    it("updates what was sent, keeps the rest, re-pins deliberately and clears a filter", async () => {
      const created = await service.create(WORKSPACE, {
        ...FLAKY,
        issueFilter: { labels: ["flaky"] },
        contextPreset: { steerNotes: ["keep me"] },
      });

      const updated = await service.update(WORKSPACE, created.id, {
        workflowVersion: 13,
        issueFilter: null,
      });

      expect(updated).toMatchObject({
        name: FLAKY.name,
        workflow: { slug: STANDARD_FIX, version: 13 },
        issueFilter: null,
        contextPreset: { steerNotes: ["keep me"] },
        sourceRunId: null,
      });
    });

    it("deletes, and a second delete is a 404", async () => {
      const created = await service.create(WORKSPACE, FLAKY);

      await service.delete(WORKSPACE, created.id);

      await expect(service.delete(WORKSPACE, created.id)).rejects.toMatchObject({
        code: PLAYBOOK_ERRORS.notFound,
      });
    });

    it("answers another workspace's playbook as absent", async () => {
      const created = await service.create(WORKSPACE, FLAKY);

      await expect(service.read("org_other", created.id)).rejects.toMatchObject({
        code: PLAYBOOK_ERRORS.notFound,
      });
    });
  });

  describe("create-from-run", () => {
    it("captures the seeded run's workflow pin, manifest-derived overrides and steer notes", async () => {
      // The run went without commit-style and carried legacy-timer, which today is switched off.
      world.injected.set(SOURCE_RUN, [world.hil.id, world.zephyr.id, world.legacy.id]);

      const draft = await service.draftFromRun(WORKSPACE, SOURCE_RUN);

      expect(draft).toEqual({
        sourceRunId: SOURCE_RUN,
        sourceLoopSeq: 1791,
        workflow: { id: STANDARD_FIX_ID, slug: STANDARD_FIX, version: 14 },
        skillOverrides: { enable: [world.legacy.id], disable: [world.commit.id] },
        contextPreset: {
          steerNotes: ["focus the flakiest suite first", "rerun each failure 5×"],
          factIds: [],
        },
        derivedFrom: { repo: HELIOS, injections: 2, steers: 2 },
        suggestedDescription: "Learned from Loop #1791 (#402 CAN bus flake in hil suite)",
      });
    });

    it("stores the named draft with its provenance", async () => {
      world.injected.set(SOURCE_RUN, [world.hil.id, world.zephyr.id]);

      const created = await service.createFromRun(WORKSPACE, {
        runId: SOURCE_RUN,
        name: "Flaky test hunt",
        issueFilter: { labels: ["flaky"] },
      });

      expect(created).toMatchObject({
        sourceRunId: SOURCE_RUN,
        workflow: { version: 14 },
        skillOverrides: { enable: [], disable: [world.commit.id] },
        contextPreset: { steerNotes: ["focus the flakiest suite first", "rerun each failure 5×"] },
        description: "Learned from Loop #1791 (#402 CAN bus flake in hil suite)",
        issueFilter: { labels: ["flaky"], repos: null },
      });
    });

    it("derives no overrides from a run with no injection record", async () => {
      const draft = await service.draftFromRun(WORKSPACE, SOURCE_RUN);

      expect(draft.skillOverrides).toEqual({ enable: [], disable: [] });
      expect(draft.derivedFrom.injections).toBe(0);
    });

    it("refuses a run still going, a missing run and an unpinned run", async () => {
      await expect(service.draftFromRun(WORKSPACE, LIVE_RUN)).rejects.toMatchObject({
        code: PLAYBOOK_ERRORS.runNotTerminal,
      });
      await expect(
        service.draftFromRun(WORKSPACE, "5eed0009-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: PLAYBOOK_ERRORS.runNotFound });

      const source = world.runSources.get(SOURCE_RUN);
      if (source !== undefined) {
        world.runSources.set(SOURCE_RUN, { ...source, workflowVersionPin: null });
      }

      await expect(service.draftFromRun(WORKSPACE, SOURCE_RUN)).rejects.toMatchObject({
        code: PLAYBOOK_ERRORS.runUnpinned,
      });
    });
  });

  describe("run-on-issue", () => {
    it("queues the ticket with the pinned workflow and the playbook, attaching the preset", async () => {
      const playbook = await service.create(WORKSPACE, {
        ...FLAKY,
        workflowVersion: 13,
        skillOverrides: { disable: [world.commit.id] },
        contextPreset: { steerNotes: ["focus the flakiest suite first"] },
      });

      const receipt = await service.launch(WORKSPACE, playbook.id, ISSUE_485);

      // The pin is the playbook's v13, never the head — and no trigger was consulted.
      expect(world.appended).toEqual([
        [
          expect.objectContaining({
            issueNumber: 485,
            workflowTag: STANDARD_FIX,
            workflowVersion: 13,
            workflowPinReason: "explicit",
            playbookId: playbook.id,
          }),
        ],
      ]);
      expect(world.triggered).toHaveLength(0);
      // The dashboard queue's own shape — what GET /api/v1/queue draws.
      expect(receipt.item).toMatchObject({
        issueNumber: 485,
        workflowTag: STANDARD_FIX,
        workflowVersion: 13,
        workflowPinReason: "explicit",
      });
      expect(receipt.position).toBe(receipt.item.position);
      expect(receipt.links).toEqual({
        queue: "/api/v1/queue",
        playbook: `/api/v1/knowledge/playbooks/${playbook.id}`,
        issue: `/api/v1/backlog/${ISSUE_485}`,
      });
      // The preset attached: steer notes, and the manifest with the overrides applied.
      expect(receipt.context.steerNotes).toEqual(["focus the flakiest suite first"]);
      expect(receipt.context.manifest).toMatchObject({
        consumer: "playbook",
        scope: { repo: HELIOS, workflow: STANDARD_FIX },
      });
      expect(receipt.context.manifest.skillVersions.map((s) => s.slug)).not.toContain(
        "commit-style",
      );
    });

    it("counts the run the launch becomes — and only that", async () => {
      const playbook = await service.create(WORKSPACE, FLAKY);

      await service.launch(WORKSPACE, playbook.id, ISSUE_485);
      // Queued is not launched: nothing counts until a run opens for it.
      expect((await service.read(WORKSPACE, playbook.id)).runCount).toBe(0);

      world.openRun(playbook.id);
      world.openRun(null);

      expect((await service.read(WORKSPACE, playbook.id)).runCount).toBe(1);
      await expect(service.counts(WORKSPACE)).resolves.toEqual({
        counts: [{ playbookId: playbook.id, runs: 1 }],
      });
    });

    it("writes no counter column — run 9× is derived from launches", async () => {
      const playbook = await service.create(WORKSPACE, FLAKY);
      await service.launch(WORKSPACE, playbook.id, ISSUE_485);
      world.openRun(playbook.id);
      await service.update(WORKSPACE, playbook.id, { description: "Still hunting" });

      const counter = /count|uses|last_run|runs/i;

      expect(TABLE_COLUMNS.playbooks.filter((column) => counter.test(column))).toEqual([]);
      for (const write of world.writes) {
        expect(Object.keys(write).filter((key) => counter.test(key))).toEqual([]);
      }
    });

    it("honours the issue filter — refusing an issue the picker would not offer", async () => {
      const playbook = await service.create(WORKSPACE, {
        ...FLAKY,
        issueFilter: { labels: ["flaky"], repos: [HELIOS] },
      });

      await expect(service.launch(WORKSPACE, playbook.id, ISSUE_491)).rejects.toMatchObject({
        code: PLAYBOOK_ERRORS.issueFiltered,
      });
      await expect(service.launch(WORKSPACE, playbook.id, ISSUE_OTHER_REPO)).rejects.toMatchObject({
        code: PLAYBOOK_ERRORS.issueFiltered,
      });
      expect(world.appended).toHaveLength(0);
    });

    it("is refused as the queue write would be — an issue already queued is a 409", async () => {
      const playbook = await service.create(WORKSPACE, FLAKY);

      await service.launch(WORKSPACE, playbook.id, ISSUE_485);

      await expect(service.launch(WORKSPACE, playbook.id, ISSUE_485)).rejects.toMatchObject({
        code: QUEUE_ERRORS.conflict,
      });
    });

    it("answers an unknown issue as a 404", async () => {
      const playbook = await service.create(WORKSPACE, FLAKY);

      await expect(
        service.launch(WORKSPACE, playbook.id, "5eed0018-0000-4000-8000-000000000999"),
      ).rejects.toMatchObject({ code: PLAYBOOK_ERRORS.issueNotFound });
    });
  });

  describe("the picker", () => {
    it("offers every open issue when the playbook has no filter", async () => {
      const playbook = await service.create(WORKSPACE, FLAKY);

      const { items } = await service.issues(WORKSPACE, playbook.id);

      expect(items.map((issue) => issue.number)).toEqual([485, 491, 302]);
    });

    it("narrows to the issues the filter admits, and says which are queued", async () => {
      const playbook = await service.create(WORKSPACE, {
        ...FLAKY,
        issueFilter: { labels: ["flaky"], repos: [HELIOS] },
      });
      world.queued.add(485);

      const { items } = await service.issues(WORKSPACE, playbook.id);

      expect(items).toEqual([
        expect.objectContaining({ id: ISSUE_485, repo: HELIOS, queued: true }),
      ]);
    });
  });

  describe("the attached context", () => {
    it("is assembly for the playbook consumer with the overrides, plus the preset", async () => {
      const playbook = await service.create(WORKSPACE, {
        ...FLAKY,
        skillOverrides: { enable: [world.legacy.id] },
        contextPreset: { steerNotes: ["go slow"] },
      });

      const context = await service.context(WORKSPACE, playbook.id, HELIOS);

      expect(context.steerNotes).toEqual(["go slow"]);
      expect(context.manifest.skillVersions.map((s) => s.slug)).toContain("legacy-timer");
    });
  });
});
