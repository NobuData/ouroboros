import type { BatchesService } from "../../planning/batches.service";
import type { EpicsService } from "../../planning/epics.service";
import type { LedgerSourceResource } from "../briefs/brief.resources";
import type { BriefsService } from "../briefs/briefs.service";
import type { GapProposals, ProposedTicket } from "../briefs/gap-proposals";
import { GAPS_PLANNER, GapHandoffService, gapDraftBody, gapDrafts } from "./gap-handoff.service";
import { PIPELINE_ERRORS } from "./pipeline.errors";
import { FakePlanning, MemoryPipelineStore, ORG, SOURCE, USER } from "./pipeline.fixture";

const RS127 = "5eed0091-0000-4000-8000-000000000127";
const S7 = "5eed0092-0000-4000-8000-000000000007";
const S12 = "5eed0092-0000-4000-8000-000000000012";

function source(
  sourceId: string,
  label: string,
  title: string,
  locatorLabel: string,
): LedgerSourceResource {
  return { sourceId, label, title, locatorLabel } as unknown as LedgerSourceResource;
}

const LEDGER = [
  source(S7, "[07]", "Skylink firmware 6.2 release notes", "skylink.example.com/releases/6.2"),
  source(S12, "[git]", "dock_ctrl.c blame", "src/dock/dock_ctrl.c#L214"),
];

function stub(key: string, title: string, change: Partial<ProposedTicket> = {}): ProposedTicket {
  return {
    key,
    title,
    label: `${key} ${title}`,
    effort: "m",
    capability: "Wind-compensated docking",
    severity: "high",
    sources: [S7],
    ...change,
  };
}

/** RS-127's proposal: the Docking parity epic and its five stubs. */
function proposals(): GapProposals {
  const tickets = [
    stub("DOCK-1", "Wind-feedforward MPC", { sources: [S7, S12] }),
    stub("DOCK-2", "Re-planned retry", { capability: "Retry after abort" }),
    stub("DOCK-3", "Gust estimator", { severity: "med", sources: [] }),
    stub("DOCK-4", "Approach telemetry", { effort: "l" }),
    stub("DOCK-5", "Operator abort UX", { effort: null, severity: "med" }),
  ];

  return {
    epic: { title: "Docking parity", label: "EPIC · Docking parity" },
    tickets,
    top: tickets.slice(0, 2),
    more: 3,
    effort: "l",
  };
}

function bench(proposed: GapProposals | null = proposals()) {
  const store = new MemoryPipelineStore();
  const planning = new FakePlanning(store);
  const epics: { id: string; name: string; status: string }[] = [];
  const epicService = {
    create: jest.fn((_org: string, body: { name: string; status: string }) => {
      const epic = { id: `epic-${String(epics.length + 1)}`, name: body.name, status: body.status };

      epics.push(epic);

      return Promise.resolve(epic);
    }),
    read: jest.fn((_org: string, id: string) =>
      Promise.resolve(epics.find((epic) => epic.id === id)),
    ),
    remove: jest.fn((_org: string, id: string) => {
      epics.splice(
        epics.findIndex((epic) => epic.id === id),
        1,
      );

      return Promise.resolve();
    }),
  };
  const document = jest.fn().mockResolvedValue({
    brief: { investigation: { displayId: "RS-127" }, proposed },
    ledger: LEDGER,
  });
  const service = new GapHandoffService(
    store as never,
    { document } as unknown as BriefsService,
    epicService as unknown as EpicsService,
    planning as unknown as BatchesService,
  );

  return { service, store, planning, epics, epicService, document };
}

describe("Draft epic from gaps", () => {
  it("creates the seeded batch shape: a proposed epic and five drafts with gap and citation provenance", async () => {
    const { service, planning, epics } = bench();
    const answer = await service.draftEpic(ORG, USER, RS127);

    expect(epics).toEqual([{ id: "epic-1", name: "Docking parity", status: "proposed" }]);
    expect(answer).toEqual({
      created: true,
      epic: { id: "epic-1", name: "Docking parity" },
      batch: {
        id: "batch-1",
        status: "drafting",
        drafts: [
          {
            id: "batch-1-draft-1",
            localKey: "DOCK-1",
            title: "Wind-feedforward MPC",
            capability: "Wind-compensated docking",
            severity: "high",
            effort: "m",
            sources: 2,
          },
          {
            id: "batch-1-draft-2",
            localKey: "DOCK-2",
            title: "Re-planned retry",
            capability: "Retry after abort",
            severity: "high",
            effort: "m",
            sources: 1,
          },
          {
            id: "batch-1-draft-3",
            localKey: "DOCK-3",
            title: "Gust estimator",
            capability: "Wind-compensated docking",
            severity: "med",
            effort: "m",
            sources: 0,
          },
          {
            id: "batch-1-draft-4",
            localKey: "DOCK-4",
            title: "Approach telemetry",
            capability: "Wind-compensated docking",
            severity: "high",
            effort: "l",
            sources: 1,
          },
          {
            id: "batch-1-draft-5",
            localKey: "DOCK-5",
            title: "Operator abort UX",
            capability: "Wind-compensated docking",
            severity: "med",
            effort: null,
            sources: 1,
          },
        ],
      },
      href: "/planning?batch=batch-1",
    });

    const composed = planning.batches.get("batch-1")?.input;

    expect(composed).toMatchObject({
      prompt: "RS-127 gaps → EPIC · Docking parity",
      planner: GAPS_PLANNER,
      targetSourceId: SOURCE,
      epicId: "epic-1",
    });
    expect(composed?.drafts[0]?.research).toEqual({
      investigation_id: RS127,
      origin: "gap",
      capability: "Wind-compensated docking",
      severity: "high",
      item_key: null,
      effort: "m",
      sources: [S7, S12],
    });
  });

  it("files nothing: no push, no ticket, and the batch waits in Planning", async () => {
    const { service, planning, store } = bench();

    await service.draftEpic(ORG, USER, RS127);

    expect(planning.pushes).toEqual([]);
    expect(store.tickets.size).toBe(0);
    expect(planning.batches.get("batch-1")?.status).toBe("drafting");
  });

  it("answers the batch it already drafted instead of drafting again", async () => {
    const { service, planning, store, epicService } = bench();
    const first = await service.draftEpic(ORG, USER, RS127);

    store.gapBatches.set(RS127, { batchId: first.batch.id, epicId: first.epic.id });

    const second = await service.draftEpic(ORG, USER, RS127);

    expect(second).toEqual({ ...first, created: false });
    expect(planning.batches.size).toBe(1);
    expect(epicService.create).toHaveBeenCalledTimes(1);
  });

  it("names the proposal's epic when the stored one has been deleted", async () => {
    const { service, store } = bench();
    const first = await service.draftEpic(ORG, USER, RS127);

    store.gapBatches.set(RS127, { batchId: first.batch.id, epicId: null });

    expect((await service.draftEpic(ORG, USER, RS127)).epic).toEqual({
      id: null,
      name: "Docking parity",
    });
  });

  it.each([
    ["no proposal", null],
    ["a proposal with no surviving stub", { ...proposals(), tickets: [], top: [], more: 0 }],
  ])("refuses a brief with %s, creating nothing", async (_name, proposed) => {
    const { service, planning, epics } = bench(proposed);

    await expect(service.draftEpic(ORG, USER, RS127)).rejects.toMatchObject({
      code: PIPELINE_ERRORS.nothingProposed,
      details: { investigation: "RS-127" },
    });
    expect(epics).toEqual([]);
    expect(planning.batches.size).toBe(0);
  });

  it("needs the tracker named when the workspace has none, or several — before creating an epic", async () => {
    const none = bench();

    none.store.sourceRows.length = 0;
    await expect(none.service.draftEpic(ORG, USER, RS127)).rejects.toMatchObject({
      code: PIPELINE_ERRORS.targetRequired,
    });
    expect(none.epics).toEqual([]);

    const two = bench();

    two.store.sourceRows.push({
      id: "source-2",
      organizationId: ORG,
      kind: "jira",
      displayName: "Jira",
    });
    await expect(two.service.draftEpic(ORG, USER, RS127)).rejects.toMatchObject({
      code: PIPELINE_ERRORS.targetRequired,
    });
    expect((await two.service.draftEpic(ORG, USER, RS127, "source-2")).created).toBe(true);
    expect(two.planning.batches.get("batch-1")?.input.targetSourceId).toBe("source-2");
  });

  it("refuses a tracker the workspace does not have", async () => {
    const { service, epics } = bench();

    await expect(service.draftEpic(ORG, USER, RS127, "source-9")).rejects.toMatchObject({
      code: PIPELINE_ERRORS.sourceNotFound,
    });
    expect(epics).toEqual([]);
  });

  it("leaves no epic behind when the drafts are refused", async () => {
    const { service, planning, epics, epicService } = bench();
    const refused = Object.assign(new Error("read-only"), { code: "planning_target_read_only" });

    planning.compose = () => Promise.reject(refused);

    await expect(service.draftEpic(ORG, USER, RS127)).rejects.toBe(refused);
    expect(epicService.remove).toHaveBeenCalledWith(ORG, "epic-1");
    expect(epics).toEqual([]);
  });

  it("keeps a long epic title within Planning's bound", async () => {
    const { service, epics } = bench({
      ...proposals(),
      epic: { title: `  ${"x".repeat(300)}`, label: "EPIC" },
    });

    await service.draftEpic(ORG, USER, RS127);

    expect(epics[0]?.name).toHaveLength(200);
  });

  describe("a gap draft", () => {
    const byId = new Map(LEDGER.map((entry) => [entry.sourceId, entry]));

    it("says which gap it closes, the seed effort, and the sources behind it", () => {
      expect(gapDraftBody("RS-127", proposals().tickets[0], byId)).toBe(
        [
          "Closes the **Wind-compensated docking** gap (HIGH) found by RS-127.",
          "",
          "Proposed effort: M — a seed from the brief; the estimate is the sizer's.",
          "",
          "**Sources**",
          "- [07] Skylink firmware 6.2 release notes — `skylink.example.com/releases/6.2`",
          "- [git] dock_ctrl.c blame — `src/dock/dock_ctrl.c#L214`",
        ].join("\n"),
      );
    });

    it("leaves out what a stub does not have", () => {
      expect(
        gapDraftBody(
          "RS-127",
          stub("DOCK-9", "Bare", { effort: null, sources: [], severity: "med" }),
          byId,
        ),
      ).toBe("Closes the **Wind-compensated docking** gap (MED) found by RS-127.");
    });

    it("cites only records the ledger still holds, each once", () => {
      const drafts = gapDrafts(
        RS127,
        "RS-127",
        { ...proposals(), tickets: [stub("DOCK-1", "MPC", { sources: [S7, "gone", S7] })] },
        LEDGER,
      );

      expect(drafts[0]?.research?.sources).toEqual([S7]);
      expect(drafts[0]?.body).not.toContain("gone");
      expect(drafts[0]).toMatchObject({ localKey: "DOCK-1", title: "MPC" });
    });
  });
});
