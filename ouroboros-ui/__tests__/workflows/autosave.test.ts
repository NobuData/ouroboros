import { describe, expect, it } from "vitest";

import {
  CONFLICT_NOTE,
  DRAFT_EDITS,
  PENDING_NOTE,
  SAVED_NOTE,
  SAVING_NOTE,
  conflictBody,
  draftDiverges,
  readConflict,
  sameDocument,
  saveNote,
} from "@/app/workflows/autosave";

import { standardFixDefinition } from "../helpers/workflows";

/**
 * The autosave's decisions (#152) — what the toolbar says, which documents are the same, when the head
 * says `draft edits`, and what the reload dialog tells a reader whose draft moved underneath them.
 */

describe("the toolbar's save note", () => {
  it("says nothing before anything has been edited", () => {
    expect(saveNote({ state: "idle", reason: null })).toBeNull();
  });

  it.each([
    ["pending", PENDING_NOTE],
    ["saving", SAVING_NOTE],
    ["saved", SAVED_NOTE],
    ["conflict", CONFLICT_NOTE],
  ] as const)("says where a %s save stands", (state, note) => {
    expect(saveNote({ state, reason: null })).toBe(note);
  });

  it("says a failure in the service's words, and that the next edit tries again", () => {
    expect(saveNote({ state: "failed", reason: "the engine is unavailable" })).toBe(
      "Not saved — the engine is unavailable. The next edit tries again.",
    );
  });

  it("says a paused autosave is paused, and what brings it back", () => {
    expect(CONFLICT_NOTE).toMatch(/paused/);
    expect(CONFLICT_NOTE).toMatch(/Reload/);
  });
});

describe("the same document", () => {
  it("is the same object, or the same content in any key order", () => {
    const document = standardFixDefinition();
    const reordered = Object.fromEntries(Object.entries(standardFixDefinition()).reverse());

    expect(sameDocument(document, document)).toBe(true);
    expect(sameDocument(document, reordered)).toBe(true);
  });

  it("is not a document with one position moved", () => {
    const moved = standardFixDefinition();
    (moved.nodes as { position: { x: number } }[])[3].position.x += 5;

    expect(sameDocument(standardFixDefinition(), moved)).toBe(false);
  });

  it("keeps array order, because the order of stages and edges is part of the document", () => {
    expect(sameDocument({ nodes: [{ id: "a" }, { id: "b" }] }, { nodes: [{ id: "b" }, { id: "a" }] })).toBe(false);
  });

  it("is null only for null", () => {
    expect(sameDocument(null, null)).toBe(true);
    expect(sameDocument(null, {})).toBe(false);
  });
});

describe("draft edits", () => {
  it("are what a draft that differs from the version in force has", () => {
    const edited = { ...standardFixDefinition(), dsl_version: "1.1" };

    expect(draftDiverges(edited, standardFixDefinition())).toBe(true);
    expect(DRAFT_EDITS).toBe("draft edits");
  });

  it("are not claimed for a draft equal to the version", () => {
    expect(draftDiverges(standardFixDefinition(), standardFixDefinition())).toBe(false);
  });

  it("are not claimed for a workflow with no version, whose head already says not published", () => {
    expect(draftDiverges(standardFixDefinition(), null)).toBe(false);
  });
});

describe("the conflict", () => {
  it("reads what the 409 says, and reads anything it cannot as unknown", () => {
    expect(
      readConflict({ expected: "a", current: "b", editedIn: "code", updatedAt: "2026-09-13T11:58:00.000Z" }),
    ).toEqual({ current: "b", editedIn: "code", updatedAt: "2026-09-13T11:58:00.000Z" });
    expect(readConflict({ editedIn: "somewhere", current: 4 })).toEqual({
      current: null,
      editedIn: null,
      updatedAt: null,
    });
    expect(readConflict(null)).toEqual({ current: null, editedIn: null, updatedAt: null });
  });

  it("names the editor and the time, and says nothing was overwritten", () => {
    const body = conflictBody(
      { current: "b", editedIn: "code", updatedAt: "2026-09-13T11:58:00.000Z" },
      new Date("2026-09-13T12:00:00.000Z"),
    );

    expect(body).toMatch(/in the code editor 2m ago/);
    expect(body).toMatch(/nothing was overwritten/);
    expect(body).toMatch(/Reload/);
  });

  it("says another visual editor, or somewhere else, when that is all it knows", () => {
    const at = new Date("2026-09-13T12:00:00.000Z");

    expect(conflictBody({ current: null, editedIn: "visual", updatedAt: null }, at)).toMatch(/another tab/);
    expect(conflictBody({ current: null, editedIn: null, updatedAt: null }, at)).toMatch(/somewhere else,/);
  });
});
