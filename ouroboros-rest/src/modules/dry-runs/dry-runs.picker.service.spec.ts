import { DryRunPickerService, pickerTicket } from "./dry-runs.picker.service";
import { DryRunRecords } from "./dry-runs.records";
import { MAX_PICKER_CANDIDATES } from "./dry-runs.repository";
import {
  DEFINITION,
  DryRunStore,
  PINNED_SHA,
  TICKET_ID,
  WORKFLOW_ID,
  WORKSPACE,
  ticketRow,
} from "./dry-runs.store.fixture";

function seeded() {
  const store = new DryRunStore();
  store.tickets = [
    ticketRow({
      id: "t-491",
      external_key: "#491",
      title: "CVE-2026-1 in the OTA parser",
      labels: ["security", "cve"],
    }),
    ticketRow(),
    ticketRow({
      id: "t-486",
      external_key: "#486",
      title: "BLE pairing retries",
      labels: ["enhancement", "ble"],
      source_updated_at: new Date("2026-10-10T07:49:06Z"),
    }),
    ticketRow({ id: "t-sup", external_key: "SUP-3200", source_kind: "custom" }),
  ];
  return { store, picker: new DryRunPickerService(store.repository) };
}

describe("the picker over a workspace's tickets", () => {
  it("reads a ticket row as the scorer's ticket, and leaves out a tracker no trigger can name", () => {
    expect(pickerTicket(ticketRow())).toEqual({
      id: TICKET_ID,
      key: "#489",
      title: "CAN arbitration-lost storm under full telemetry load",
      url: "https://github.com/acme-robotics/helios-firmware/issues/489",
      source: "github",
      labels: ["bug", "can-bus"],
      effort: "m",
      updatedAt: new Date("2026-10-10T23:49:06Z"),
    });
    expect(pickerTicket(ticketRow({ source_kind: "custom" }))).toBeUndefined();
  });

  it("ranks the seeded #489-class mismatch first, the matching ticket last", async () => {
    const { store, picker } = seeded();
    const candidates = jest.spyOn(store, "candidates");

    const ranked = await picker.rank(WORKSPACE, DEFINITION, { limit: 10 });

    expect(
      ranked.map((candidate) => [candidate.rank, candidate.ticket.key, candidate.score]),
    ).toEqual([
      [1, "#489", 1],
      [2, "#486", 1],
      [3, "#491", 0],
    ]);
    expect(candidates).toHaveBeenCalledWith(WORKSPACE, MAX_PICKER_CANDIDATES);
  });

  it("filters by key, title or label before ranking, and bounds the answer", async () => {
    const { picker } = seeded();
    const keys = async (query: string, limit = 10) =>
      (await picker.rank(WORKSPACE, DEFINITION, { limit, query })).map(
        (candidate) => candidate.ticket.key,
      );

    expect(await keys("  BLE ")).toEqual(["#486"]);
    expect(await keys("cve")).toEqual(["#491"]);
    expect(await keys("#48")).toEqual(["#489", "#486"]);
    expect(await keys("nothing-like-this")).toEqual([]);
    expect(await keys("", 1)).toEqual(["#489"]);
    expect(await keys("", -3)).toEqual([]);
  });
});

describe("a dry run read back whole", () => {
  it("composes the row, its ticket, its rows and its artifacts", async () => {
    const store = new DryRunStore();
    const run = await store.insert({
      organizationId: WORKSPACE,
      workflowId: WORKFLOW_ID,
      baseVersion: null,
      draftRev: 3,
      sessionId: null,
      ticketId: TICKET_ID,
      pinnedSha: PINNED_SHA,
    });

    const resource = await new DryRunRecords(store.repository).resource(run);

    expect(resource).toMatchObject({
      id: run.id,
      ticket: { key: "#489" },
      stages: [],
      artifacts: [],
    });
  });

  it("says so, rather than invent a ticket, if the run's ticket is gone", async () => {
    const store = new DryRunStore();
    const run = await store.insert({
      organizationId: WORKSPACE,
      workflowId: WORKFLOW_ID,
      baseVersion: null,
      draftRev: 3,
      sessionId: null,
      ticketId: TICKET_ID,
      pinnedSha: PINNED_SHA,
    });
    store.tickets = [];

    await expect(new DryRunRecords(store.repository).resource(run)).rejects.toThrow(
      "names a ticket that no longer exists",
    );
  });
});
