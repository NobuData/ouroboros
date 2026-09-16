import { budgetHeaders, httpError } from "../github/github.fixture";
import { NotFoundError } from "../errors/error.envelope";
import {
  InMemoryTicketSourceProvider,
  InMemoryTracker,
} from "../ticket-sources/providers/in-memory.provider.fixture";
import { CREATE_ISSUE_ROUTE, MILESTONES_ROUTE } from "../ticket-sources/providers/github.write";
import { BLOCKER_NOT_PUSHED, PUSH_ERRORS } from "./push.errors";
import { pushKey } from "./push.service";
import {
  OTA_BLOCKS,
  OTA_KEYS,
  OTHER_ORG,
  PLANNING_BATCH,
  PLANNING_EPIC,
  PLANNING_ORG,
  PLANNING_SOURCE,
  draftId,
  planningWorld,
  refusal,
  titleOf,
  type World,
} from "./push.world.fixture";

/**
 * AL.3's acceptance criteria, over the real GitHub provider and a recorded GitHub
 * ([#279](https://github.com/NobuData/ouroboros/issues/279)).
 *
 * The store keeps V034–V036's rules in memory (`push.store.fixture.ts`); `push.integration-spec.ts`
 * runs the same push against PostgreSQL.
 */

/** The issue number a draft's ticket landed as. */
function issueNumberOf(world: World, localKey: string): number {
  const ticketId = world.draft(localKey).pushedTicketId;
  const ticket = world.store.ticketRows.find((row) => row.ticketId === ticketId);

  if (ticket === undefined) {
    throw new Error(`${localKey} has no ticket`);
  }

  return Number(ticket.ref.externalId);
}

/** A spent GitHub budget: a 403 with nothing remaining and a wait. */
function spent(): Error {
  return httpError(403, { ...budgetHeaders({ remaining: 0 }), "retry-after": "900" });
}

describe("PushService", () => {
  describe("a six-draft batch", () => {
    it("lands as six issues, five native links, one parent epic issue and a milestone", async () => {
      const world = planningWorld();

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report).toMatchObject({
        outcome: "pushed",
        batchStatus: "pushed",
        pushedThisRun: 6,
        links: { native: 5, fallback: 0 },
        retryAt: null,
        milestone: { externalRef: "1", name: "Helios 2.1" },
        epic: { mapping: "parent_issue", externalRef: "1" },
      });
      expect(world.ticketIssues()).toBe(6);
      expect(world.github.ledger().containers).toStrictEqual(["1"]);
      expect(world.github.issues).toHaveLength(7);
      expect(world.github.relations).toHaveLength(5);
      expect(world.github.milestones).toStrictEqual([{ number: 1, title: "Helios 2.1" }]);
      expect(world.github.subIssues).toHaveLength(6);
      expect(world.github.issues.slice(1).every((issue) => issue.milestone === 1)).toBe(true);

      // Every relation is the batch's note, between the issues its drafts became.
      expect([...world.github.relations].sort(([a], [b]) => a - b)).toStrictEqual(
        OTA_BLOCKS.map(([blocker, blocked]) => [
          issueNumberOf(world, blocker),
          issueNumberOf(world, blocked),
        ]).sort(([a], [b]) => a - b),
      );
    });

    it("creates every blocker before the issue it blocks", async () => {
      const world = planningWorld();

      await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      for (const [blocker, blocked] of OTA_BLOCKS) {
        expect(issueNumberOf(world, blocker)).toBeLessThan(issueNumberOf(world, blocked));
      }

      expect(world.provider.created).toStrictEqual(
        ["OTA-3", "OTA-1", "OTA-2", "OTA-4", "OTA-5", "OTA-6"].map(titleOf),
      );
    });

    it("creates canonical tickets and rewrites every dependency end from draft to ticket", async () => {
      const world = planningWorld();

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(world.store.ticketRows).toHaveLength(6);
      expect(
        world.store.edges.every(
          (edge) =>
            edge.blockerDraftId === null &&
            edge.blockedDraftId === null &&
            edge.blockerTicketId !== null &&
            edge.blockedTicketId !== null,
        ),
      ).toBe(true);
      expect(world.store.memberships.size).toBe(6);
      expect(world.store.mirrors.get(`${PLANNING_EPIC}|${PLANNING_SOURCE}|parent_issue`)).toBe("1");
      expect(report.drafts.map((draft) => [draft.localKey, draft.pushState])).toStrictEqual(
        OTA_KEYS.map((key) => [key, "pushed"]),
      );
      expect(report.drafts.find((draft) => draft.localKey === "OTA-3")?.ticket).toStrictEqual({
        externalId: "2",
        externalKey: "#2",
        url: "https://github.com/acme-robotics/helios-firmware/issues/2",
      });
    });

    it("keys every issue by batch and draft", async () => {
      const world = planningWorld();

      await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      for (const key of OTA_KEYS) {
        const marker = `<!-- ouroboros:push-key ${pushKey(PLANNING_BATCH, draftId(key))} -->`;

        expect(world.github.issues.filter((issue) => issue.body?.includes(marker))).toHaveLength(1);
      }
    });

    it("preserves each draft's evidence verbatim in the pushed body", async () => {
      const world = planningWorld();

      await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(world.github.issues[1]?.body).toMatch(
        /^Evidence for OTA-3: 0 of 1,284 builds set this option\.\n\n---\n/,
      );
    });
  });

  describe("the fallback", () => {
    it("records body markers on a GitHub without the dependency API, and says so", async () => {
      const world = planningWorld({ nativeDependencies: false });

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.links).toStrictEqual({ native: 0, fallback: 5 });
      expect(world.github.relations).toHaveLength(0);
      expect(world.github.ledger().dependencies).toHaveLength(5);
      expect(report.outcome).toBe("pushed");
    });
  });

  describe("idempotency and resume", () => {
    it("completes without duplicates when the push is killed mid-batch and resumed", async () => {
      const world = planningWorld();

      // Four drafts commit; the fifth's issue is created and the process dies before its commit.
      world.store.crashOnRecordPushed = 4;

      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toThrow(
        "the process was killed",
      );
      expect(world.store.drafts.filter((draft) => draft.pushState === "pushed")).toHaveLength(4);
      expect(world.store.drafts.filter((draft) => draft.pushState === "pending")).toHaveLength(2);
      expect(world.ticketIssues()).toBe(5);
      expect(world.store.batches.get(PLANNING_BATCH)?.status).toBe("pushing");
      expect(world.service.isPushing(PLANNING_BATCH)).toBe(false);

      world.store.crashOnRecordPushed = null;

      const resumed = await world.service.resume(PLANNING_ORG, PLANNING_BATCH);

      expect(resumed).toMatchObject({ outcome: "pushed", batchStatus: "pushed", pushedThisRun: 2 });
      expect(world.ticketIssues()).toBe(6);
      expect(world.store.ticketRows).toHaveLength(6);
      expect(world.github.relations).toHaveLength(5);
      expect(world.github.subIssues).toHaveLength(6);
      expect(world.github.ledger().containers).toHaveLength(1);
      expect(world.github.milestones).toHaveLength(1);
    });

    it("resumes only pending and failed drafts, never re-creating a pushed one", async () => {
      const world = planningWorld();

      world.store.crashOnRecordPushed = 4;
      await world.service.push(PLANNING_ORG, PLANNING_BATCH).catch(() => undefined);
      world.store.crashOnRecordPushed = null;
      world.provider.created.length = 0;

      await world.service.resume(PLANNING_ORG, PLANNING_BATCH);

      expect(world.provider.created).toStrictEqual(["OTA-5", "OTA-6"].map(titleOf));
    });

    it("pauses a throttled push with its drafts pending, and a resume creates exactly the rest", async () => {
      const world = planningWorld();

      // GitHub accepts four creates, then the budget is spent.
      world.github.refuseRoute(CREATE_ISSUE_ROUTE, spent(), 5);

      const throttled = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(throttled).toMatchObject({ outcome: "throttled", batchStatus: "pushing" });
      expect(throttled.retryAt).toBeInstanceOf(Date);
      expect(throttled.drafts.map((draft) => draft.pushState)).toStrictEqual([
        "pushed",
        "pushed",
        "pushed",
        "pushed",
        "pending",
        "pending",
      ]);
      expect(throttled.drafts.every((draft) => draft.error === null)).toBe(true);
      expect(world.ticketIssues()).toBe(4);

      world.github.recover();
      // The budget window passing: the guard is keyed by the pushing workspace.
      world.limiter.forget(PLANNING_ORG);

      const resumed = await world.service.resume(PLANNING_ORG, PLANNING_BATCH);

      expect(resumed).toMatchObject({ outcome: "pushed", pushedThisRun: 2 });
      expect(world.ticketIssues()).toBe(6);
      expect(world.github.relations).toHaveLength(5);
    });

    it("pushes a second time as a no-op refusal once every draft is pushed", async () => {
      const world = planningWorld();

      await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.notPushable,
      });
      expect(world.ticketIssues()).toBe(6);
    });
  });

  describe("failed drafts", () => {
    it("records a structured reason, holds back what depends on it, and pushes the rest", async () => {
      const world = planningWorld();

      world.provider.createFailures.set(titleOf("OTA-1"), refusal("validation", 422));

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.outcome).toBe("partial");
      expect(world.draft("OTA-1").pushError).toStrictEqual({
        code: "validation",
        message: "creating the ticket failed — tracker rejected the write (422)",
        detail: { step: "create", retryable: false, httpStatus: 422 },
      });
      // OTA-4 waits on OTA-1; OTA-6 waits on OTA-4.
      expect(world.draft("OTA-4").pushError).toStrictEqual({
        code: BLOCKER_NOT_PUSHED,
        message: "waiting on OTA-1, which has not been pushed",
        detail: { blockers: ["OTA-1"] },
      });
      expect(world.draft("OTA-6").pushError?.code).toBe(BLOCKER_NOT_PUSHED);
      expect(["OTA-2", "OTA-3", "OTA-5"].map((key) => world.draft(key).pushState)).toStrictEqual([
        "pushed",
        "pushed",
        "pushed",
      ]);

      const resumed = await world.service.resume(PLANNING_ORG, PLANNING_BATCH);

      expect(resumed.outcome).toBe("pushed");
      expect(resumed.drafts.every((draft) => draft.error === null)).toBe(true);
      expect(world.ticketIssues()).toBe(6);
      expect(world.github.relations).toHaveLength(5);
    });

    it("fails every draft with the reason when the milestone is refused, creating nothing", async () => {
      const world = planningWorld();

      world.github.refuseRoute(
        MILESTONES_ROUTE,
        httpError(403, budgetHeaders({ remaining: 4999 })),
      );

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.outcome).toBe("partial");
      expect(report.drafts.every((draft) => draft.error?.code === "permission")).toBe(true);
      expect(report.drafts[0]?.error?.message).toBe(
        "ensuring the milestone failed — permission denied (403)",
      );
      expect(world.github.issues).toHaveLength(0);
    });

    it("pauses rather than fails when the milestone is throttled", async () => {
      const world = planningWorld();

      world.github.refuseRoute(MILESTONES_ROUTE, spent());

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.outcome).toBe("throttled");
      expect(report.drafts.every((draft) => draft.pushState === "pending")).toBe(true);
    });

    it("fails every draft as auth when the source's credential will not open", async () => {
      const world = planningWorld({ openFails: refusal("auth") });

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.drafts[0]?.error).toMatchObject({
        code: "auth",
        message: "opening the source's credential failed — credentials rejected",
      });
      expect(world.github.calls).toHaveLength(0);
    });

    it("records a provider that throws something unclassified as upstream, and continues", async () => {
      const world = planningWorld();

      world.provider.createFailures.set(titleOf("OTA-5"), new Error("socket hang up"));

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(world.draft("OTA-5").pushError).toMatchObject({
        code: "upstream",
        detail: { step: "create", retryable: true },
      });
      expect(report.drafts.filter((draft) => draft.pushState === "pushed")).toHaveLength(5);
    });
  });

  describe("epics", () => {
    it("attaches to the stored mirror rather than asking the tracker for the container again", async () => {
      const world = planningWorld();

      world.github.issues.push({
        id: 9_100_000,
        number: 1,
        title: "OTA power-loss safety",
        body: "an epic someone filed by hand",
        labels: [],
        milestone: null,
      });
      world.store.mirrors.set(`${PLANNING_EPIC}|${PLANNING_SOURCE}|parent_issue`, "1");

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.epic).toStrictEqual({ mapping: "parent_issue", externalRef: "1" });
      expect(world.github.ledger().containers).toHaveLength(0);
      expect(world.github.subIssues.every(([parent]) => parent === 1)).toBe(true);
    });

    it("pushes with no epic and no milestone when the batch names neither", async () => {
      const world = planningWorld({ epic: false, milestone: null });

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report).toMatchObject({ outcome: "pushed", epic: null, milestone: null });
      expect(world.github.subIssues).toHaveLength(0);
      expect(world.github.milestones).toHaveLength(0);
      expect(world.store.memberships.size).toBe(0);
    });
  });

  describe("dependencies outside the batch", () => {
    it("links to an existing ticket in the same source, and not to one in another tracker", async () => {
      const world = planningWorld({ epic: false, milestone: null });

      // An issue that already exists in the target repository, and one in another source.
      world.github.issues.push({
        id: 9_200_000,
        number: 1,
        title: "Existing bootloader issue",
        body: null,
        labels: [],
        milestone: null,
      });
      world.store.ticketRows.push(
        {
          ticketId: "existing-same",
          organizationId: PLANNING_ORG,
          sourceId: PLANNING_SOURCE,
          ref: {
            externalId: "1",
            externalKey: "#1",
            url: "https://github.com/acme-robotics/helios-firmware/issues/1",
          },
          title: "Existing bootloader issue",
        },
        {
          ticketId: "existing-other",
          organizationId: PLANNING_ORG,
          sourceId: "another-source",
          ref: { externalId: "PROJ-1", externalKey: "PROJ-1", url: "https://jira.example/PROJ-1" },
          title: "Somewhere else",
        },
      );
      world.store.edges.push(
        {
          organizationId: PLANNING_ORG,
          blockerDraftId: null,
          blockerTicketId: "existing-same",
          blockedDraftId: draftId("OTA-3"),
          blockedTicketId: null,
        },
        {
          organizationId: PLANNING_ORG,
          blockerDraftId: draftId("OTA-6"),
          blockerTicketId: null,
          blockedDraftId: null,
          blockedTicketId: "existing-same",
        },
        {
          organizationId: PLANNING_ORG,
          blockerDraftId: null,
          blockerTicketId: "existing-other",
          blockedDraftId: draftId("OTA-2"),
          blockedTicketId: null,
        },
      );

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.links.native).toBe(7);
      expect(world.github.relations).toContainEqual([1, issueNumberOf(world, "OTA-3")]);
      expect(world.github.relations).toContainEqual([issueNumberOf(world, "OTA-6"), 1]);
    });

    it("pushes a draft whose blocker is not selected, without linking it", async () => {
      const world = planningWorld({ epic: false, milestone: null });

      world.draft("OTA-3").selected = false;

      const report = await world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(report.outcome).toBe("pushed");
      expect(report.drafts).toHaveLength(5);
      expect(report.links.native).toBe(3);
      expect(world.draft("OTA-3").pushState).toBe("pending");
    });
  });

  describe("refusals before anything is sent", () => {
    it("cannot push another organization's batch — isolation", async () => {
      const world = planningWorld();

      await expect(world.service.push(OTHER_ORG, PLANNING_BATCH)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(world.service.resume(OTHER_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.batchNotFound,
      });
      expect(world.github.calls).toHaveLength(0);
    });

    it("cannot push a batch whose target source belongs to another organization", async () => {
      const world = planningWorld();
      const source = world.store.sources.get(PLANNING_SOURCE);

      if (source !== undefined) {
        world.store.sources.set(PLANNING_SOURCE, { ...source, organizationId: OTHER_ORG });
      }

      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.batchNotFound,
      });
      expect(world.github.calls).toHaveLength(0);
    });

    it("refuses a read-only target with the catalog's reason", async () => {
      const world = planningWorld({
        providers: () => [
          new InMemoryTicketSourceProvider(new InMemoryTracker(), { kind: "github" }),
        ],
      });

      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.readOnly,
      });
    });

    it("refuses a target kind with no provider at all", async () => {
      const world = planningWorld({ providers: () => [] });

      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.readOnly,
      });
    });

    it("refuses a cycle with a 422 naming it, creating nothing", async () => {
      const world = planningWorld();

      world.store.edges.push({
        organizationId: PLANNING_ORG,
        blockerDraftId: draftId("OTA-6"),
        blockerTicketId: null,
        blockedDraftId: draftId("OTA-3"),
        blockedTicketId: null,
      });

      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.cycle,
        details: { cycle: ["OTA-1", "OTA-4", "OTA-6", "OTA-3", "OTA-1"] },
      });
      expect(world.github.calls).toHaveLength(0);
      expect(world.store.batches.get(PLANNING_BATCH)?.status).toBe("sized");
    });

    it("refuses a second push of a batch already in flight", async () => {
      const world = planningWorld();
      const first = world.service.push(PLANNING_ORG, PLANNING_BATCH);

      expect(world.service.isPushing(PLANNING_BATCH)).toBe(true);
      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.inProgress,
      });
      await expect(first).resolves.toMatchObject({ outcome: "pushed" });
      expect(world.ticketIssues()).toBe(6);
    });

    it("refuses a resume nobody started, an abandoned batch, and a batch with nothing selected", async () => {
      const world = planningWorld();

      await expect(world.service.resume(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.nothingToResume,
      });

      const batch = world.store.batches.get(PLANNING_BATCH);

      if (batch === undefined) {
        throw new Error("the world has a batch");
      }

      batch.status = "abandoned";
      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.notPushable,
        message: "This batch was abandoned and cannot be pushed.",
      });

      batch.status = "sized";
      world.store.drafts.forEach((draft) => {
        draft.selected = false;
      });
      await expect(world.service.push(PLANNING_ORG, PLANNING_BATCH)).rejects.toMatchObject({
        code: PUSH_ERRORS.nothingSelected,
      });
      expect(world.github.calls).toHaveLength(0);
    });
  });
});
