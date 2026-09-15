import { describe, expect, it } from "vitest";

import {
  EMPTY_TITLE,
  FAILED_SUBLINE,
  FAILED_TITLE,
  MISSING_TITLE,
  SEAT_EMPTY_MEMBER_NOTE,
  SEAT_EMPTY_TITLE,
  SEAT_FAILED_NOTE,
} from "@/app/workflows/states";
import {
  CODE_EMPTY_SUBLINE,
  CODE_SEAT_EMPTY_LINE,
  CODE_SEAT_EMPTY_MEMBER_NOTE,
  CODE_SEAT_EMPTY_NOTE,
  CODE_SEAT_EMPTY_TITLE,
  CODE_SEAT_MISSING_TITLE,
  CODE_SEAT_NOTHING_TITLE,
  CODE_SEAT_UNREAD_NOTE,
  CODE_SUBLINE,
  CONFIG_FILE_PATH,
  EXPLORER_UNREAD_REASON,
  FILE_READ_ONLY_NOTE,
  UNREAD_EXPLORER,
  WORKFLOW_FILE_DIRECTORY,
  baseName,
  closeTabLabel,
  codeEntry,
  codeHead,
  codeMissingSubline,
  codeSeatCopy,
  codeState,
  explorerHead,
  fileEditable,
  fileName,
  fileSource,
  findingLine,
  readFindings,
  slugOfPath,
  workflowFilePath,
} from "@/app/workflows/code/code-view";

import {
  UNPROJECTABLE_FINDINGS,
  codeReadings,
  unprojectableReadings,
  workflowCode,
} from "../../helpers/workflow-code";
import { railEntry, unpublishedEntry } from "../../helpers/workflows";

/**
 * The code route's decisions (V.1, #169): which state two reads put the page in, what mockup
 * 05's head says in each, and how the file is laid out as lines.
 */

describe("the virtual project's paths (V.3, #171)", () => {
  it("places a workflow's file where U.3 serves it", () => {
    expect(workflowFilePath("standard-fix")).toBe("workflows/standard-fix.loop.ts");
    expect(workflowFilePath("hotfix-p0")).toBe(`${WORKFLOW_FILE_DIRECTORY}/${fileName("hotfix-p0")}`);
  });

  it("reads a workflow's slug back out of its file's path", () => {
    for (const slug of ["standard-fix", "feature-loop", "hotfix-p0", "a"]) {
      expect(slugOfPath(workflowFilePath(slug))).toBe(slug);
    }
  });

  it("reads no slug out of anything that is not exactly one workflow's file", () => {
    for (const path of [
      CONFIG_FILE_PATH,
      "workflows/.loop.ts",
      "workflows/nested/deeper.loop.ts",
      "workflows/standard-fix.ts",
      "skills/repo-map.skill.md",
      "other/standard-fix.loop.ts",
      "workflows.loop.ts",
      "",
    ]) {
      expect(slugOfPath(path)).toBeNull();
    }
  });

  it("prints a path's last segment, and a top-level path whole", () => {
    expect(baseName("workflows/standard-fix.loop.ts")).toBe("standard-fix.loop.ts");
    expect(baseName("a/b/c.ts")).toBe("c.ts");
    expect(baseName(CONFIG_FILE_PATH)).toBe("ouroboros.config.ts");
  });

  it("heads the explorer with the workspace, and without a dangling separator when it has no name", () => {
    expect(explorerHead("Acme Robotics")).toBe("Explorer · Acme Robotics");
    expect(explorerHead("")).toBe("Explorer");
  });

  it("names a tab's close button after its file", () => {
    expect(closeTabLabel("workflows/hotfix-p0.loop.ts")).toBe("Close hotfix-p0.loop.ts");
  });

  it("stands an explorer that was never read in as two refused reads, each with its reason", () => {
    expect(UNREAD_EXPLORER).toEqual({
      tree: { ok: false, reason: EXPLORER_UNREAD_REASON },
      config: { ok: false, reason: EXPLORER_UNREAD_REASON },
    });
  });
});

describe("codeState", () => {
  it("is populated when the rail and the file both answered", () => {
    const state = codeState(codeReadings());

    expect(state).toEqual({ kind: "populated", entry: railEntry(), file: workflowCode() });
  });

  it("is failed when the rail was refused, whatever else is true", () => {
    const state = codeState(
      codeReadings({ rail: { ok: false, reason: "The service is unavailable." }, selected: null }),
    );

    expect(state).toEqual({ kind: "failed", reason: "The service is unavailable." });
  });

  it("is empty for a workspace with no workflows", () => {
    expect(codeState(codeReadings({ rail: { ok: true, value: [] }, selected: null }))).toEqual({
      kind: "empty",
    });
  });

  it("is missing, naming the slug, when the rail does not hold it", () => {
    expect(codeState(codeReadings({ requested: "retired-loop", selected: null }))).toEqual({
      kind: "missing",
      slug: "retired-loop",
    });
  });

  it("is unread when the file was refused, keeping the rail entry", () => {
    const state = codeState(
      codeReadings({
        selected: { entry: railEntry(), file: { kind: "failed", reason: "Internal error." } },
      }),
    );

    expect(state).toEqual({ kind: "unread", entry: railEntry(), reason: "Internal error." });
  });

  it("is unprojectable, with the findings, for a draft with no faithful spelling as code", () => {
    const state = codeState(unprojectableReadings());

    expect(state.kind).toBe("unprojectable");
    expect(state.kind === "unprojectable" && state.entry).toEqual(unpublishedEntry());
    expect(state.kind === "unprojectable" && state.findings).toHaveLength(2);
  });
});

describe("codeEntry", () => {
  it("is the rail entry in the three states that have a workflow", () => {
    expect(codeEntry(codeState(codeReadings()))).toEqual(railEntry());
    expect(codeEntry(codeState(unprojectableReadings()))).toEqual(unpublishedEntry());
    expect(
      codeEntry({ kind: "unread", entry: railEntry(), reason: "Internal error." }),
    ).toEqual(railEntry());
  });

  it("is null in the three that do not", () => {
    expect(codeEntry({ kind: "failed", reason: "x" })).toBeNull();
    expect(codeEntry({ kind: "empty" })).toBeNull();
    expect(codeEntry({ kind: "missing", slug: "x" })).toBeNull();
  });
});

describe("the head", () => {
  it("is mockup 05's: the file name, and the subline verbatim", () => {
    const head = codeHead(codeState(codeReadings()));

    expect(head.title).toBe("standard-fix.loop.ts");
    // Copied from docs/mockups/05-workflow-code.html, character for character — em dash included.
    expect(head.subline).toBe(
      "The same loop as the visual canvas — every graph compiles to this typed DSL and back, losslessly.",
    );
    expect(CODE_SUBLINE).toBe(head.subline);
  });

  it("names the file from the slug", () => {
    expect(fileName("hotfix-p0")).toBe("hotfix-p0.loop.ts");
  });

  it("keeps the file name and the promise when the file could not be shown", () => {
    // The name is the rail's fact; why the file is missing is the banner's or the seat's to say.
    expect(codeHead({ kind: "unread", entry: railEntry(), reason: "x" })).toEqual({
      title: "standard-fix.loop.ts",
      subline: CODE_SUBLINE,
    });
    expect(codeHead(codeState(unprojectableReadings())).title).toBe("hotfix-p1.loop.ts");
  });

  it("says what failed, what is empty, and which slug is missing, pointing at Visual's rail", () => {
    expect(codeHead({ kind: "failed", reason: "x" })).toEqual({
      title: FAILED_TITLE,
      subline: FAILED_SUBLINE,
    });
    expect(codeHead({ kind: "empty" })).toEqual({ title: EMPTY_TITLE, subline: CODE_EMPTY_SUBLINE });
    expect(codeHead({ kind: "missing", slug: "retired-loop" })).toEqual({
      title: MISSING_TITLE,
      subline: codeMissingSubline("retired-loop"),
    });
    expect(codeMissingSubline("retired-loop")).toBe(
      'This workspace has no workflow called "retired-loop". The Visual tab lists every workflow it has.',
    );
    expect(CODE_EMPTY_SUBLINE).toMatch(/Visual tab's rail/);
  });
});

describe("the seat", () => {
  it("has copy for every state with no file, each a different fact", () => {
    expect(codeSeatCopy({ kind: "failed", reason: "x" })).toEqual({
      title: CODE_SEAT_NOTHING_TITLE,
      note: SEAT_FAILED_NOTE,
    });
    expect(codeSeatCopy({ kind: "empty" }, true)).toEqual({
      title: CODE_SEAT_EMPTY_TITLE,
      note: CODE_SEAT_EMPTY_NOTE,
    });
    expect(codeSeatCopy({ kind: "missing", slug: "retired-loop" })).toEqual({
      title: CODE_SEAT_MISSING_TITLE,
      note: "Nothing in this workspace is called retired-loop.loop.ts.",
    });
    expect(codeSeatCopy({ kind: "unread", entry: railEntry(), reason: "x" })).toEqual({
      title: CODE_SEAT_NOTHING_TITLE,
      note: CODE_SEAT_UNREAD_NOTE,
    });
  });

  it("mirrors the visual editor's empty seat: its title, and a role-aware note (V.7, #175)", () => {
    expect(CODE_SEAT_EMPTY_TITLE).toBe(SEAT_EMPTY_TITLE);
    // A member is told who can create one, in the visual editor's words — and that is the default.
    expect(CODE_SEAT_EMPTY_MEMBER_NOTE).toBe(SEAT_EMPTY_MEMBER_NOTE);
    expect(codeSeatCopy({ kind: "empty" })).toEqual({ title: CODE_SEAT_EMPTY_TITLE, note: CODE_SEAT_EMPTY_MEMBER_NOTE });
    expect(codeSeatCopy({ kind: "empty" }, false)).toEqual(codeSeatCopy({ kind: "empty" }));
    // The code view has no rail, so a reader who may create is not pointed at one.
    expect(CODE_SEAT_EMPTY_NOTE).not.toMatch(/rail/);
    expect(CODE_SEAT_EMPTY_LINE).toMatch(/\.loop\.ts/);
  });

  it("says the same about every other state whoever is reading", () => {
    for (const state of [
      { kind: "failed", reason: "x" },
      { kind: "missing", slug: "retired-loop" },
      { kind: "unread", entry: railEntry(), reason: "x" },
    ] as const) {
      expect(codeSeatCopy(state, true)).toEqual(codeSeatCopy(state, false));
    }
  });
});

describe("readFindings", () => {
  it("reads each finding's message, node and path, in the service's order", () => {
    expect(readFindings({ findings: UNPROJECTABLE_FINDINGS })).toEqual([
      { message: "This property is required.", node: null, path: "/dsl_version" },
      { message: "A model stage needs a route.", node: "implement", path: "/nodes/1/config" },
    ]);
  });

  it("reads nothing out of details that carry no findings list", () => {
    expect(readFindings(undefined)).toEqual([]);
    expect(readFindings(null)).toEqual([]);
    expect(readFindings([])).toEqual([]);
    expect(readFindings({})).toEqual([]);
    expect(readFindings({ findings: "none" })).toEqual([]);
  });

  it("skips an entry with no message rather than printing a blank line", () => {
    expect(
      readFindings({ findings: [null, 3, { path: "/x" }, { message: "Kept.", node: 7, path: 9 }] }),
    ).toEqual([{ message: "Kept.", node: null, path: "" }]);
  });
});

describe("findingLine", () => {
  it("leads with the stage a finding is about, and is the message alone otherwise", () => {
    expect(findingLine({ message: "A model stage needs a route.", node: "implement", path: "" })).toBe(
      "implement: A model stage needs a route.",
    );
    expect(findingLine({ message: "This property is required.", node: null, path: "/dsl_version" })).toBe(
      "This property is required.",
    );
  });
});

describe("the file", () => {
  it("says it was printed from the draft, which is the one both editors share", () => {
    expect(fileSource(workflowCode())).toBe("Printed from the draft");
  });

  it("says when it was printed from the version in force because no draft is open", () => {
    expect(fileSource(workflowCode({ version: 14 }))).toBe("Printed from v14 · no draft open");
  });

  it("is editable only for a role that may publish, on a file the service does not mark read-only", () => {
    expect(fileEditable(workflowCode(), true)).toBe(true);
    expect(fileEditable(workflowCode(), false)).toBe(false);
    expect(fileEditable(workflowCode({ readOnly: true }), true)).toBe(false);
    expect(fileEditable(workflowCode({ readOnly: true }), false)).toBe(false);
  });

  it("says a file the reader cannot change is read-only — an editable one says where its save stands (code-save.ts)", () => {
    expect(FILE_READ_ONLY_NOTE).toBe("Read-only");
  });
});
