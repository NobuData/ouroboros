import { describe, expect, it } from "vitest";

import { MAX_DIFF_EXCERPT } from "@/app/prs/diff";
import {
  EXCERPT_BOUNDED,
  HUNK_NOT_IN_EXCERPT,
  HUNK_NOT_IN_SNAPSHOT,
  NO_CHANGED_FILES,
  NO_EXCERPT,
  NO_FILES_SNAPSHOT,
  citedLine,
  excerptReach,
  fileMeter,
  filesCard,
  meterScale,
  namedPaths,
  outOfScope,
  planName,
} from "@/app/prs/files";

import {
  FRAME_ORDER_PATH,
  HOST_EXCERPT,
  HOST_URL,
  ISR_PATH,
  REV_1_ID,
  TELEMETRY_PATH,
  filesPage,
  gateRows,
  mockupFiles,
  outOfScopePage,
} from "../helpers/pull-requests";

/**
 * The Changed files card's decisions (#367): meters scaled against the set, the excerpt's
 * honesty, the cited range, and which rows a red diff-vs-plan gate flags.
 */

const CITED = { path: TELEMETRY_PATH, lineStart: 41, lineEnd: 66 };

describe("the meters", () => {
  it("scales against the largest file of the set", () => {
    expect(meterScale(mockupFiles().rows)).toBe(50);
    expect(meterScale([])).toBe(0);
    expect(meterScale([{ path: "a", additions: 0, deletions: 0 }])).toBe(0);
  });

  it("draws files of different magnitude differently", () => {
    const large = fileMeter({ additions: 38, deletions: 12 }, 50);
    const small = fileMeter({ additions: 2, deletions: 1 }, 50);

    expect(large).toEqual({ add: 76, del: 24 });
    expect(small).toEqual({ add: 4, del: 2 });
    expect(large.add + large.del).toBeGreaterThan(10 * (small.add + small.del));
  });

  it("states a share to a tenth", () => {
    expect(fileMeter({ additions: 1, deletions: 2 }, 3)).toEqual({ add: 33.3, del: 66.7 });
  });

  it("draws nothing against no scale, and never past the track", () => {
    expect(fileMeter({ additions: 5, deletions: 5 }, 0)).toEqual({ add: 0, del: 0 });
    expect(fileMeter({ additions: 5, deletions: 5 }, Number.NaN)).toEqual({ add: 0, del: 0 });
    expect(fileMeter({ additions: 90, deletions: 40 }, 100)).toEqual({ add: 90, del: 10 });
    expect(fileMeter({ additions: 400, deletions: 1 }, 100)).toEqual({ add: 100, del: 0 });
  });

  it("reads a count that is not a positive number as none", () => {
    expect(fileMeter({ additions: -3, deletions: Number.NaN }, 10)).toEqual({ add: 0, del: 0 });
    expect(meterScale([{ path: "a", additions: -3, deletions: 4 }])).toBe(4);
  });
});

describe("the seeded card", () => {
  it("states mockup 12's totals, link and rows", () => {
    const view = filesCard(filesPage(), null);

    expect(view.totals).toBe("+68 −15");
    expect(view.fullDiffUrl).toBe(`${HOST_URL}/files`);
    expect(view.empty).toBeNull();
    expect(view.explanation).toBeNull();
    expect(view.cited).toBeNull();
    expect(view.rows).toEqual([
      {
        path: TELEMETRY_PATH,
        additions: "+38",
        deletions: "−12",
        meter: { add: 76, del: 24 },
        flagged: false,
      },
      {
        path: ISR_PATH,
        additions: "+9",
        deletions: "−3",
        meter: { add: 18, del: 6 },
        flagged: false,
      },
      {
        path: FRAME_ORDER_PATH,
        additions: "+21",
        deletions: "−0",
        meter: { add: 42, del: 0 },
        flagged: false,
      },
    ]);
  });

  it("draws the excerpt's first file open, and says how far the excerpt reaches", () => {
    const view = filesCard(filesPage(), null);

    expect(view.excerpt.map((file) => [file.path, file.open])).toEqual([[TELEMETRY_PATH, true]]);
    expect(view.excerpt[0]!.hunks[0]!.lines.map((line) => line.kind)).toEqual([
      "ctx",
      "del",
      "del",
      "add",
      "add",
      "add",
    ]);
    expect(view.excerptNotes).toEqual([excerptReach(1, 3)]);
    expect(excerptReach(1, 3)).toBe("1 of 3 changed files is in the excerpt.");
    expect(excerptReach(2, 3)).toBe("2 of 3 changed files are in the excerpt.");
    expect(excerptReach(0, 1)).toBe("0 of 1 changed file are in the excerpt.");
  });

  it("says nothing of reach when every file is in the excerpt", () => {
    const rows = mockupFiles().rows.slice(0, 2);
    const view = filesCard(filesPage({ files: mockupFiles({ rows, diffExcerpt: HOST_EXCERPT }) }), null);

    expect(view.excerpt.map((file) => [file.path, file.open])).toEqual([
      [TELEMETRY_PATH, true],
      [ISR_PATH, false],
    ]);
    expect(view.excerptNotes).toEqual([]);
  });

  it("says when the excerpt ends at its bound", () => {
    const head = `--- ${TELEMETRY_PATH}\n@@ -1 +1 @@\n+`;
    const diffExcerpt = head + "x".repeat(MAX_DIFF_EXCERPT - head.length);
    const view = filesCard(filesPage({ files: mockupFiles({ diffExcerpt }) }), null);

    expect(view.excerptNotes).toEqual([excerptReach(1, 3), EXCERPT_BOUNDED]);
  });

  it("says when there is no excerpt, no changed file, or no snapshot", () => {
    expect(filesCard(filesPage({ files: mockupFiles({ diffExcerpt: null }) }), null)).toMatchObject({
      excerpt: [],
      excerptNotes: [NO_EXCERPT],
    });
    expect(
      filesCard(filesPage({ files: mockupFiles({ rows: [], additions: 0, deletions: 0 }) }), null),
    ).toMatchObject({ totals: "+0 −0", empty: NO_CHANGED_FILES, rows: [] });
    expect(filesCard(filesPage({ files: null }), CITED)).toEqual({
      totals: null,
      fullDiffUrl: null,
      empty: NO_FILES_SNAPSHOT,
      rows: [],
      explanation: null,
      excerpt: [],
      excerptNotes: [],
      cited: { path: TELEMETRY_PATH, line: citedLine(CITED), note: HUNK_NOT_IN_SNAPSHOT },
    });
  });

  it("links the whole diff only to an http(s) address", () => {
    const files = mockupFiles({ fullDiffUrl: "javascript:alert(1)" });

    expect(filesCard(filesPage({ files }), null).fullDiffUrl).toBeNull();
  });
});

describe("a cited hunk", () => {
  it("marks the lines inside the range, and anchors the first", () => {
    const view = filesCard(filesPage(), { path: TELEMETRY_PATH, lineStart: 42, lineEnd: 43 });
    const lines = view.excerpt[0]!.hunks[0]!.lines;

    expect(view.cited).toEqual({
      path: TELEMETRY_PATH,
      line: `Cited: ${TELEMETRY_PATH} · lines 42–43`,
      note: null,
    });
    expect(lines.map((line) => line.cited)).toEqual([false, true, true, true, true, false]);
    expect(lines.map((line) => line.anchor)).toEqual([false, true, false, false, false, false]);
  });

  it("opens the cited file, wherever it is in the excerpt", () => {
    const files = mockupFiles({ diffExcerpt: HOST_EXCERPT });
    const view = filesCard(filesPage({ files }), { path: ISR_PATH, lineStart: 8, lineEnd: 8 });

    expect(view.excerpt.map((file) => file.open)).toEqual([true, true]);
    expect(view.excerpt[0]!.hunks[0]!.lines.some((line) => line.cited)).toBe(false);
    expect(view.excerpt[1]!.hunks[0]!.lines.map((line) => line.anchor)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("says when the excerpt does not reach the range", () => {
    expect(
      filesCard(filesPage(), { path: TELEMETRY_PATH, lineStart: 300, lineEnd: 310 }).cited?.note,
    ).toBe(HUNK_NOT_IN_EXCERPT);
    expect(filesCard(filesPage(), { path: ISR_PATH, lineStart: 1, lineEnd: 2 }).cited?.note).toBe(
      HUNK_NOT_IN_EXCERPT,
    );
  });

  it("says when the snapshot does not hold the path", () => {
    expect(
      filesCard(filesPage(), { path: "src/removed.c", lineStart: 1, lineEnd: 2 }).cited?.note,
    ).toBe(HUNK_NOT_IN_SNAPSHOT);
  });
});

describe("out-of-scope rows", () => {
  it("flags nothing while diff-vs-plan is not red", () => {
    expect(outOfScope(filesPage())).toBeNull();

    for (const verdict of ["green", "waived", "pending", "not_required", "unavailable"] as const) {
      const rows = gateRows({ diff_vs_plan: [verdict, `1 out-of-scope edit: ${ISR_PATH}`] });

      expect(outOfScope(outOfScopePage(null, { gates: { revisionId: mockupFiles().revisionId, aggregate: null, rows } }))).toBeNull();
    }
  });

  it("flags the paths the gate's line names, and names the plan", () => {
    const page = outOfScopePage();
    const scope = outOfScope(page);

    expect([...scope!.paths]).toEqual([ISR_PATH]);
    expect(scope!.explanation).toBe(
      "Diff vs plan is red on this revision: 1 changed file falls outside the planned file list of the plan of issue #482.",
    );
    expect(filesCard(page, null).rows.map((row) => row.flagged)).toEqual([false, true, false]);
    expect(filesCard(page, null).explanation).toBe(scope!.explanation);
  });

  it("flags several, in the plural", () => {
    const scope = outOfScope(
      outOfScopePage(`2 out-of-scope edits: ${ISR_PATH}, ${FRAME_ORDER_PATH}`),
    );

    expect([...scope!.paths]).toEqual([ISR_PATH, FRAME_ORDER_PATH]);
    expect(scope!.explanation).toContain("2 changed files fall outside the planned file list");
  });

  it("states what the gate's bounded line had no room to name", () => {
    const scope = outOfScope(outOfScopePage(`4 out-of-scope edits: ${ISR_PATH} +3 more`));

    expect([...scope!.paths]).toEqual([ISR_PATH]);
    expect(scope!.explanation).toMatch(
      /The gate flags 3 more that its line had no room to name\.$/,
    );
  });

  it("matches a path whole: a comma inside one, and never a part of another", () => {
    const rows = [
      { path: "docs/a, b.md", additions: 1, deletions: 0 },
      { path: "b.md", additions: 1, deletions: 0 },
      { path: "docs/a", additions: 1, deletions: 0 },
    ];
    const scope = outOfScope(
      outOfScopePage("1 out-of-scope edit: docs/a, b.md", { files: mockupFiles({ rows }) }),
    );

    expect([...scope!.paths]).toEqual(["docs/a, b.md"]);
    expect(namedPaths("x/docs/a, b.md", ["docs/a", "b.md"])).toEqual(["b.md"]);
    expect(namedPaths("west.yml, docs/a, west.yml, docs/a", ["docs/a"])).toEqual(["docs/a"]);
    expect(namedPaths("", ["docs/a"])).toEqual([]);
    expect(namedPaths("docs/a", [""])).toEqual([]);
  });

  it("flags no row, and quotes the gate, when its line names nothing of the snapshot", () => {
    for (const line of ["2 out-of-scope edits:  +2 more", "out of scope", "1 out-of-scope edit: west.yml"]) {
      const scope = outOfScope(outOfScopePage(line));

      expect(scope!.paths.size, line).toBe(0);
      expect(scope!.explanation, line).toBe(
        `Diff vs plan is red on this revision — ${line} — and its line names no file of this snapshot.`,
      );
    }
  });

  it("says when the gate recorded no line", () => {
    expect(outOfScope(outOfScopePage(null))!.explanation).toBe(
      "Diff vs plan is red on this revision, and the gate recorded no line naming the files outside the plan of issue #482.",
    );
  });

  it("names the plan without a ticket", () => {
    const page = outOfScopePage(undefined, { pullRequest: { ticket: null } });

    expect(planName(page)).toBe("the plan");
    expect(outOfScope(page)!.explanation).toMatch(/planned file list of the plan\.$/);
  });

  it("flags nothing from gates that are another revision's", () => {
    const page = outOfScopePage();

    expect(outOfScope({ ...page, gates: { ...page.gates!, revisionId: REV_1_ID } })).toBeNull();
    expect(outOfScope({ ...page, gates: null })).toBeNull();
    expect(outOfScope({ ...page, files: null })).toBeNull();
  });
});
