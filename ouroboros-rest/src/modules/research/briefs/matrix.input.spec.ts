import { BRIEF_ERRORS } from "./briefs.errors";
import {
  MAX_CELL_SOURCES,
  MAX_MATRIX_RIVALS,
  MAX_MATRIX_ROWS,
  parseMatrixInput,
} from "./matrix.input";
import { matrixInput, sourceId } from "./rs127.fixture";

/** The matrix input, read and held to decision V7 (#621). */

type Row = { capability: string; gap?: unknown; cells: Record<string, unknown>[] };

/** RS-127's input with one change. */
function changed(change: (input: { rows: Row[] } & Record<string, unknown>) => void) {
  const input = structuredClone(matrixInput()) as { rows: Row[] } & Record<string, unknown>;
  change(input);
  return input;
}

function refusal(input: Record<string, unknown>): { code: string; details: unknown } {
  try {
    parseMatrixInput(input);
  } catch (error) {
    const { code, details } = error as { code: string; details: unknown };
    return { code, details };
  }
  throw new Error("the input was accepted");
}

describe("the matrix input", () => {
  it("reads RS-127: five rows of four cells in column order, with the proposed gaps", () => {
    const input = parseMatrixInput(matrixInput());

    expect(input.title).toBe("Autonomous docking vs. the field");
    expect(input.us).toBe("Helios");
    expect(input.rivals).toEqual(["Skylink", "AeroMesh", "Novum"]);
    expect(input.rows.map((row) => row.proposed)).toEqual(["high", "high", "med", "wip", "lead"]);
    expect(input.rows.every((row) => row.cells.length === 4)).toBe(true);
    expect(input.rows[0].cells.map((cell) => cell.rival)).toEqual([null, 0, 1, 2]);
    expect(input.rows[0].cells[0]).toEqual({
      rival: null,
      status: "partial",
      note: null,
      sources: [sourceId(25), sourceId(26)],
    });
  });

  it("stores beta as a partial labelled beta, and in flight as a wip labelled in flight", () => {
    const input = parseMatrixInput(matrixInput());

    expect(input.rows[1].cells[3]).toMatchObject({ status: "partial", note: "beta" });
    expect(input.rows[3].cells[0]).toMatchObject({ status: "wip", note: "in flight" });
    expect(
      parseMatrixInput(changed((each) => void (each.rows[3].cells[0]["status"] = "wip"))).rows[3]
        .cells[0],
    ).toMatchObject({ status: "wip", note: "in flight" });
  });

  it("keeps the honest unknown cell, uncited", () => {
    expect(parseMatrixInput(matrixInput()).rows[4].cells[2]).toEqual({
      rival: 1,
      status: "unknown",
      note: null,
      sources: [],
    });
  });

  it("puts cells in column order however the input lists them, matching names loosely", () => {
    const input = parseMatrixInput(
      changed((each) => {
        each.rows[0].cells.reverse();
        each.rows[0].cells[0]["subject"] = "  novum ";
      }),
    );

    expect(input.rows[0].cells.map((cell) => cell.status)).toEqual([
      "partial",
      "shipping",
      "partial",
      "none",
    ]);
  });

  it("lower-cases and de-duplicates a cell's sources, and takes a row without a gap", () => {
    const input = parseMatrixInput(
      changed((each) => {
        each.rows[0].cells[3]["sources"] = [sourceId(5).toUpperCase(), sourceId(5)];
        delete each.rows[0].gap;
        each.rows[1].gap = null;
      }),
    );

    expect(input.rows[0].cells[3].sources).toEqual([sourceId(5)]);
    expect(input.rows[0].proposed).toBeNull();
    expect(input.rows[1].proposed).toBeNull();
  });

  it("rejects an uncited cell that is not unknown", () => {
    for (const sources of [[], undefined, null]) {
      expect(refusal(changed((each) => void (each.rows[0].cells[1]["sources"] = sources)))).toEqual(
        {
          code: BRIEF_ERRORS.matrixCellUncited,
          details: {
            capability: "Docking in >8 m/s gusts",
            subject: "Skylink",
            status: "shipping",
          },
        },
      );
    }
  });

  it("rejects a row missing a subject's cell, and one with a subject twice", () => {
    expect(refusal(changed((each) => void each.rows[2].cells.pop()))).toEqual({
      code: BRIEF_ERRORS.matrixRowIncomplete,
      details: { capability: "Abort & retry recovery logic", missing: ["Novum"], repeated: [] },
    });
    expect(refusal(changed((each) => void (each.rows[2].cells[3]["subject"] = "Skylink")))).toEqual(
      {
        code: BRIEF_ERRORS.matrixRowIncomplete,
        details: {
          capability: "Abort & retry recovery logic",
          missing: ["Novum"],
          repeated: ["Skylink"],
        },
      },
    );
  });

  const malformed: readonly [string, (input: { rows: Row[] } & Record<string, unknown>) => void][] =
    [
      ["no title", (each) => void delete each["title"]],
      ["a blank us label", (each) => void (each["us"] = "  ")],
      ["a title past its length", (each) => void (each["title"] = "t".repeat(201))],
      ["no rivals", (each) => void (each["rivals"] = [])],
      ["rivals that are not a list", (each) => void (each["rivals"] = "Skylink")],
      [
        "more rivals than columns allow",
        (each) =>
          void (each["rivals"] = Array.from(
            { length: MAX_MATRIX_RIVALS + 1 },
            (_, n) => `R${n.toString()}`,
          )),
      ],
      ["a rival that is not a name", (each) => void (each["rivals"] = ["Skylink", 7])],
      ["a rival named twice", (each) => void (each["rivals"] = ["Skylink", "skylink "])],
      ["a rival named as us", (each) => void (each["rivals"] = ["helios", "Novum"])],
      ["no rows", (each) => void (each.rows = [])],
      ["rows that are not a list", (each) => void ((each as Record<string, unknown>)["rows"] = {})],
      [
        "more rows than a matrix holds",
        (each) =>
          void (each.rows = Array.from({ length: MAX_MATRIX_ROWS + 1 }, (_, n) => ({
            ...each.rows[0],
            capability: `C${n.toString()}`,
          }))),
      ],
      [
        "a row that is not an object",
        (each) => void ((each as Record<string, unknown>)["rows"] = ["gusts"]),
      ],
      ["a row without a capability", (each) => void (each.rows[0].capability = "")],
      [
        "a capability listed twice",
        (each) => void (each.rows[1].capability = each.rows[0].capability),
      ],
      ["a gap outside the vocabulary", (each) => void (each.rows[0].gap = "critical")],
      [
        "cells that are not a list",
        (each) => void ((each.rows[0] as Record<string, unknown>)["cells"] = {}),
      ],
      [
        "a cell that is not an object",
        (each) => void ((each.rows[0].cells as unknown[])[0] = "partial"),
      ],
      ["a cell without a subject", (each) => void delete each.rows[0].cells[0]["subject"]],
      [
        "a subject that is not a column",
        (each) => void (each.rows[0].cells[0]["subject"] = "Zephyr"),
      ],
      [
        "a status outside the vocabulary",
        (each) => void (each.rows[0].cells[0]["status"] = "soon"),
      ],
      ["a status that is not a string", (each) => void (each.rows[0].cells[0]["status"] = 3)],
      [
        "sources that are not a list",
        (each) => void (each.rows[0].cells[0]["sources"] = sourceId(7)),
      ],
      ["a source that is not an id", (each) => void (each.rows[0].cells[0]["sources"] = ["07"])],
      [
        "more sources than a cell may cite",
        (each) =>
          void (each.rows[0].cells[0]["sources"] = Array.from(
            { length: MAX_CELL_SOURCES + 1 },
            (_, n) => sourceId(n + 1),
          )),
      ],
    ];

  it.each(malformed)("rejects %s", (_name, change) => {
    expect(refusal(changed(change)).code).toBe(BRIEF_ERRORS.matrixInputInvalid);
  });
});
