import { MAX_TICKETS, proposeFromGaps, rollUpEffort, type GapRow } from "./gap-proposals";
import { matrix, matrixInput, sourceId, stub } from "./rs127.fixture";

/** Proposed from gaps (#621). */

const ROWS: GapRow[] = matrix().rows.map((row) => ({
  capability: row.capability,
  severity: row.severity,
}));

/** RS-127's input with other stubs. */
function withTickets(...tickets: unknown[]): Record<string, unknown> {
  return { ...matrixInput(), tickets };
}

describe("proposed from gaps", () => {
  it("reproduces RS-127's chip row: the epic, two stubs, +3 more, effort L", () => {
    const proposed = proposeFromGaps(matrixInput(), ROWS);

    expect(proposed?.epic).toEqual({ title: "Docking parity", label: "EPIC · Docking parity" });
    expect(proposed?.top.map((ticket) => ticket.label)).toEqual([
      "DOCK-1 wind-feedforward MPC",
      "DOCK-2 re-planned retry",
    ]);
    expect(proposed?.more).toBe(3);
    expect(proposed?.effort).toBe("l");
    expect(proposed?.tickets.map((ticket) => ticket.key)).toEqual([
      "DOCK-1",
      "DOCK-2",
      "DOCK-3",
      "DOCK-4",
      "DOCK-5",
    ]);
  });

  it("gives each stub the gap it closes and its own citations", () => {
    expect(proposeFromGaps(matrixInput(), ROWS)?.tickets[1]).toEqual({
      key: "DOCK-2",
      title: "re-planned retry",
      label: "DOCK-2 re-planned retry",
      effort: "m",
      capability: "Abort & retry recovery logic",
      severity: "med",
      sources: [sourceId(9), sourceId(19)],
    });
  });

  it("keeps only stubs of HIGH and MED rows — by the stored severity, not the proposed one", () => {
    const proposed = proposeFromGaps(
      withTickets(
        stub("DOCK-1", "wind-feedforward MPC", "m", "Docking in >8 m/s gusts"),
        stub("DOCK-6", "finish the A/B updater", "l", "OTA resilience (A/B + rollback)"),
        stub("DOCK-7", "beacon range", "s", "Recovery beacon over BLE"),
        stub("DOCK-8", "something else", "s", "A capability the matrix does not have"),
      ),
      ROWS,
    );

    expect(proposed?.tickets.map((ticket) => ticket.key)).toEqual(["DOCK-1"]);
    expect(proposed?.more).toBe(0);

    // The same input over rows the rule derived differently proposes differently.
    const demoted = ROWS.map((row) => ({ ...row, severity: "low" as const }));
    expect(proposeFromGaps(matrixInput(), demoted)).toBeNull();
  });

  it("matches a stub to its row whatever the capability's case or spacing", () => {
    const proposed = proposeFromGaps(
      withTickets(stub("DOCK-1", "MPC", "m", "  docking in >8 M/S gusts ")),
      ROWS,
    );

    expect(proposed?.tickets[0].capability).toBe("Docking in >8 m/s gusts");
    expect(proposed?.tickets[0].severity).toBe("high");
  });

  it("skips a malformed stub and a repeated key instead of refusing the proposal", () => {
    const gusts = "Docking in >8 m/s gusts";
    const proposed = proposeFromGaps(
      withTickets(
        "DOCK-0",
        stub("dock-1", "a lower-case key", "m", gusts),
        stub("DOCK-2", "  ", "m", gusts),
        { key: "DOCK-3", title: "no capability", effort: "m" },
        { key: 4, title: "a key that is not text", capability: gusts },
        { key: "DOCK-9", title: 9, capability: gusts },
        stub("DOCK-5", "t".repeat(201), "m", gusts),
        stub("DOCK-6", "kept", "huge", gusts),
        stub("DOCK-6", "the key again", "m", gusts),
        { key: "DOCK-7", title: "odd sources", capability: gusts, sources: ["07", sourceId(7), 3] },
        { key: "DOCK-8", title: "sources not a list", capability: gusts, sources: sourceId(7) },
      ),
      ROWS,
    );

    expect(proposed?.tickets.map((ticket) => [ticket.key, ticket.effort, ticket.sources])).toEqual([
      ["DOCK-6", null, []],
      ["DOCK-7", null, [sourceId(7)]],
      ["DOCK-8", null, []],
    ]);
    expect(proposed?.effort).toBeNull();
  });

  it("proposes nothing without an input, an epic or a surviving stub", () => {
    expect(proposeFromGaps(null, ROWS)).toBeNull();
    expect(proposeFromGaps({ ...matrixInput(), epic: undefined }, ROWS)).toBeNull();
    expect(proposeFromGaps({ ...matrixInput(), epic: "  " }, ROWS)).toBeNull();
    expect(proposeFromGaps({ ...matrixInput(), epic: "e".repeat(201) }, ROWS)).toBeNull();
    expect(proposeFromGaps({ ...matrixInput(), tickets: undefined }, ROWS)).toBeNull();
    expect(proposeFromGaps({ ...matrixInput(), tickets: "DOCK-1" }, ROWS)).toBeNull();
    expect(proposeFromGaps(matrixInput(), [])).toBeNull();
  });

  it("reads at most a bounded number of stubs", () => {
    const many = Array.from({ length: MAX_TICKETS + 5 }, (_, index) =>
      stub(`DOCK-${(index + 1).toString()}`, "a stub", "xs", "Docking in >8 m/s gusts"),
    );

    expect(proposeFromGaps(withTickets(...many), ROWS)?.tickets).toHaveLength(MAX_TICKETS);
  });
});

describe("the effort roll-up", () => {
  it("sums points and reads them back as a size", () => {
    expect(rollUpEffort(["xs"])).toBe("xs");
    expect(rollUpEffort(["s"])).toBe("s");
    expect(rollUpEffort(["xs", "s"])).toBe("s");
    expect(rollUpEffort(["m"])).toBe("m");
    expect(rollUpEffort(["m", "m", "s"])).toBe("m");
    expect(rollUpEffort(["m", "m", "m", "l", "s"])).toBe("l");
    expect(rollUpEffort(["l", "l", "l", "l"])).toBe("l");
    expect(rollUpEffort(["xl", "xl", "l"])).toBe("xl");
  });

  it("is never smaller than the largest stub", () => {
    expect(rollUpEffort(["l"])).toBe("l");
    expect(rollUpEffort(["l", "m"])).toBe("l");
    expect(rollUpEffort(["xl"])).toBe("xl");
    expect(rollUpEffort(["xl", "xs"])).toBe("xl");
  });

  it("counts only stubs that carry an effort, and is nothing when none does", () => {
    expect(rollUpEffort([null, "s", null])).toBe("s");
    expect(rollUpEffort([null, null])).toBeNull();
    expect(rollUpEffort([])).toBeNull();
  });
});
