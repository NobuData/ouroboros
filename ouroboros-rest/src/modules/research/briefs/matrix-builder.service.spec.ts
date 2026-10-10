import { Logger } from "@nestjs/common";

import { RESEARCH_ERRORS } from "../research.errors";
import { BRIEF_ERRORS } from "./briefs.errors";
import type { BriefsRepository } from "./briefs.repository";
import { BriefsService } from "./briefs.service";
import { MatrixBuilderService, planMatrix } from "./matrix-builder.service";
import { parseMatrixInput } from "./matrix.input";
import {
  INVESTIGATION,
  MATRIX,
  MemoryBriefStore,
  OTHER_WORKSPACE,
  WORKSPACE,
  matrixInput,
  seeded,
  sourceId,
} from "./rs127.fixture";

/** The matrix builder (#621, decision V7). */

type Cell = Record<string, unknown>;

/** RS-127's input with one change. */
function changed(change: (rows: { cells: Cell[] }[]) => void): Record<string, unknown> {
  const input = structuredClone(matrixInput());
  change(input["rows"] as { cells: Cell[] }[]);
  return input;
}

/** RS-127 with its input delivered and no matrix built yet. */
function bench(...held: Parameters<typeof seeded>) {
  const store = new MemoryBriefStore(seeded({ matrix: undefined, ...held[0] }));
  const repository = store as unknown as BriefsRepository;
  return {
    store,
    builder: new MatrixBuilderService(repository),
    briefs: new BriefsService(repository),
  };
}

async function code(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "resolved",
    (error: unknown) => (error as { code?: string }).code ?? String(error),
  );
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("the matrix builder", () => {
  it("builds RS-127's matrix from its input: the seeded cells, citations and chips", async () => {
    const { builder, briefs, store } = bench();

    const built = await builder.build(WORKSPACE, INVESTIGATION);
    const { matrix } = await briefs.brief(WORKSPACE, INVESTIGATION);

    expect(built).toEqual({ outcome: "built", matrixId: store.of(INVESTIGATION)?.matrix?.id });
    expect(matrix?.columns.map((column) => column.label)).toEqual([
      "Helios",
      "Skylink",
      "AeroMesh",
      "Novum",
    ]);
    expect(
      matrix?.rows.map((row) => [
        row.capability,
        ...row.cells.map((cell) => `${cell.glyph} ${cell.label}`),
        row.gap.label,
      ]),
    ).toEqual([
      ["Docking in >8 m/s gusts", "◐ partial", "● shipping", "◐ partial", "○ none", "HIGH"],
      [
        "Visual-inertial approach (no beacon)",
        "○ none",
        "● shipping",
        "● shipping",
        "◐ beta",
        "HIGH",
      ],
      ["Abort & retry recovery logic", "◐ partial", "● shipping", "◐ partial", "○ none", "MED"],
      ["OTA resilience (A/B + rollback)", "◐ in flight", "● shipping", "○ none", "○ none", "WIP"],
      ["Recovery beacon over BLE", "● shipping", "○ none", "? unknown", "○ none", "LEAD"],
    ]);
    expect(matrix?.rows[0].cells[1].cites.map((cite) => cite.label)).toEqual([
      "[01]",
      "[08]",
      "[40]",
    ]);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      "RS-127 matrix built: 5 capabilities × 4 subjects",
    );
  });

  it("stores each severity with the inputs that derived it", async () => {
    const { builder, store } = bench();
    await builder.build(WORKSPACE, INVESTIGATION);

    expect(store.of(INVESTIGATION)?.matrix?.rows.map((row) => row.derivation)).toEqual([
      "Helios: partial · best rival: shipping (Skylink) · rivals: 1 shipping, 1 partial, 1 none · proposed: high · one step behind the best rival, proposed high → high",
      "Helios: none · best rival: shipping (Skylink, AeroMesh) · rivals: 2 shipping, 1 partial · proposed: high · two steps behind the best rival → high",
      "Helios: partial · best rival: shipping (Skylink) · rivals: 1 shipping, 1 partial, 1 none · proposed: med · one step behind the best rival → med",
      "Helios: wip · best rival: shipping (Skylink) · rivals: 1 shipping, 2 none · proposed: wip · ours is in flight → wip",
      "Helios: shipping · best rival: none (Skylink, Novum) · rivals: 2 none, 1 unknown · proposed: lead · we are ahead of every known rival → lead",
    ]);
  });

  it("derives the severity itself — a proposed gap the cells do not support is not stored", async () => {
    const input = matrixInput();
    (input["rows"] as { gap: string }[])[4].gap = "high";
    const { builder, store } = bench({ matrixInput: input });
    await builder.build(WORKSPACE, INVESTIGATION);

    const lead = store.of(INVESTIGATION)?.matrix?.rows[4];
    expect(lead?.severity).toBe("lead");
    expect(lead?.derivation).toContain("proposed: high (clamped — the cells do not support it)");
  });

  it("rejects an uncited non-unknown cell, and stores nothing", async () => {
    const { builder, store } = bench({
      matrixInput: changed((rows) => void (rows[1].cells[2]["sources"] = [])),
    });

    expect(await code(builder.build(WORKSPACE, INVESTIGATION))).toBe(
      BRIEF_ERRORS.matrixCellUncited,
    );
    expect(store.of(INVESTIGATION)?.matrix).toBeUndefined();
  });

  it("rejects an incomplete row and a malformed input, and stores nothing", async () => {
    const incomplete = bench({ matrixInput: changed((rows) => void rows[0].cells.pop()) });
    expect(await code(incomplete.builder.build(WORKSPACE, INVESTIGATION))).toBe(
      BRIEF_ERRORS.matrixRowIncomplete,
    );
    expect(incomplete.store.of(INVESTIGATION)?.matrix).toBeUndefined();

    const malformed = bench({ matrixInput: { rows: [] } });
    expect(await code(malformed.builder.build(WORKSPACE, INVESTIGATION))).toBe(
      BRIEF_ERRORS.matrixInputInvalid,
    );
  });

  it("rejects a cell citing a source that is not in this investigation's ledger", async () => {
    const { builder, store } = bench({
      matrixInput: changed(
        (rows) => void (rows[0].cells[0]["sources"] = [sourceId(25), sourceId(99), sourceId(98)]),
      ),
    });

    await expect(builder.build(WORKSPACE, INVESTIGATION)).rejects.toMatchObject({
      code: BRIEF_ERRORS.matrixSourceUnknown,
      details: { sources: [sourceId(99), sourceId(98)] },
    });
    expect(store.of(INVESTIGATION)?.matrix).toBeUndefined();
  });

  it("is idempotent: a second build answers with the matrix already there", async () => {
    const { builder } = bench();
    const first = await builder.build(WORKSPACE, INVESTIGATION);

    expect(await builder.build(WORKSPACE, INVESTIGATION)).toEqual({
      outcome: "exists",
      matrixId: first.matrixId,
    });
    expect(Logger.prototype.log).toHaveBeenCalledTimes(1);
  });

  it("leaves a seeded matrix alone", async () => {
    const store = new MemoryBriefStore(seeded());
    const builder = new MatrixBuilderService(store as unknown as BriefsRepository);

    expect(await builder.build(WORKSPACE, INVESTIGATION)).toEqual({
      outcome: "exists",
      matrixId: MATRIX,
    });
  });

  it("has nothing to build for an investigation whose playbook produced no matrix", async () => {
    const { builder } = bench({ matrixInput: undefined });

    expect(await builder.build(WORKSPACE, INVESTIGATION)).toEqual({
      outcome: "no_input",
      matrixId: null,
    });
  });

  it("answers 404 for an unknown investigation, another workspace's, and one deleted mid-build", async () => {
    const { builder, store } = bench();

    expect(await code(builder.build(WORKSPACE, "5eed0084-0000-4000-8000-000000000999"))).toBe(
      RESEARCH_ERRORS.investigationNotFound,
    );
    expect(await code(builder.build(OTHER_WORKSPACE, INVESTIGATION))).toBe(
      RESEARCH_ERRORS.investigationNotFound,
    );

    jest.spyOn(store, "createMatrix").mockResolvedValueOnce({ outcome: "not_found" });
    expect(await code(builder.build(WORKSPACE, INVESTIGATION))).toBe(
      RESEARCH_ERRORS.investigationNotFound,
    );
  });

  it("adds a rival the registry does not have, and reuses one it does", async () => {
    const { builder, store } = bench();
    store.registry.set(WORKSPACE, [{ id: "known-skylink", name: "SKYLINK" }]);
    await builder.build(WORKSPACE, INVESTIGATION);

    expect(store.registry.get(WORKSPACE)?.map((rival) => rival.name)).toEqual([
      "SKYLINK",
      "AeroMesh",
      "Novum",
    ]);
    expect(store.of(INVESTIGATION)?.matrix?.rivals[0].id).toBe("known-skylink");
  });
});

describe("planning a matrix", () => {
  it("keeps the title, labels, column order and cells, and adds each row's severity", () => {
    const plan = planMatrix(parseMatrixInput(matrixInput()));

    expect(plan.title).toBe("Autonomous docking vs. the field");
    expect(plan.usLabel).toBe("Helios");
    expect(plan.rivals).toEqual(["Skylink", "AeroMesh", "Novum"]);
    expect(plan.rows.map((row) => row.severity)).toEqual(["high", "high", "med", "wip", "lead"]);
    expect(plan.rows[4].cells[2]).toEqual({ rival: 1, status: "unknown", note: null, sources: [] });
  });
});
