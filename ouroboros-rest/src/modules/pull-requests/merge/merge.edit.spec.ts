import {
  EDITABLE_FIELDS,
  changedFields,
  changesNothing,
  editedFields,
  fieldsOf,
  needsEpic,
  type MergePlanFields,
} from "./merge.edit";
import type { StoredMergePlan } from "./merge.repository";

/**
 * What an edit of a merge plan changes (AY.7, [#369](https://github.com/NobuData/ouroboros/issues/369))
 * — the table in `merge.edit.ts`'s header, row by row.
 */

const EPIC = "5eed001f-0000-4000-8000-000000000001";
const OTHER_EPIC = "5eed001f-0000-4000-8000-000000000002";

/** The seeded plan: close and comment on, back-annotate off, no epic. */
const SEEDED: MergePlanFields = {
  commitMessage: "fix(can): preserve ISR frame order\n\nCloses #482.",
  closeTicket: true,
  commentEvidence: true,
  backAnnotateEpic: false,
  epicId: null,
};

/** The seeded plan, annotating an epic. */
const ANNOTATING: MergePlanFields = { ...SEEDED, backAnnotateEpic: true, epicId: EPIC };

describe("editedFields", () => {
  it("changes only what was sent", () => {
    expect(editedFields(SEEDED, { closeTicket: false })).toEqual({ ...SEEDED, closeTicket: false });
    expect(editedFields(SEEDED, { commentEvidence: false })).toEqual({
      ...SEEDED,
      commentEvidence: false,
    });
    expect(editedFields(SEEDED, { commitMessage: "fix(can): reworded" })).toEqual({
      ...SEEDED,
      commitMessage: "fix(can): reworded",
    });
  });

  it("leaves everything alone when nothing was sent — every field present and undefined", () => {
    // What a DTO instance is under ES2023's define semantics.
    const nothing = {
      commitMessage: undefined,
      closeTicket: undefined,
      commentEvidence: undefined,
      backAnnotateEpic: undefined,
      epicId: undefined,
    };

    expect(editedFields(ANNOTATING, nothing)).toEqual(ANNOTATING);
    expect(editedFields(ANNOTATING, {})).toEqual(ANNOTATING);
  });

  it("chooses an epic without touching the toggle", () => {
    expect(editedFields(SEEDED, { epicId: EPIC })).toEqual({ ...SEEDED, epicId: EPIC });
    expect(editedFields(ANNOTATING, { epicId: OTHER_EPIC })).toEqual({
      ...ANNOTATING,
      epicId: OTHER_EPIC,
    });
  });

  it("switches back-annotate off when the epic is cleared — there is nothing left to annotate", () => {
    expect(editedFields(ANNOTATING, { epicId: null })).toEqual({
      ...ANNOTATING,
      backAnnotateEpic: false,
      epicId: null,
    });
  });

  it("keeps a toggle the edit itself asks for, so the contradiction can be refused", () => {
    const next = editedFields(ANNOTATING, { epicId: null, backAnnotateEpic: true });

    expect(next).toMatchObject({ backAnnotateEpic: true, epicId: null });
    expect(needsEpic(next)).toBe(true);
  });

  it("tells a false from an absent toggle", () => {
    expect(editedFields(ANNOTATING, { backAnnotateEpic: false })).toMatchObject({
      backAnnotateEpic: false,
      epicId: EPIC,
    });
  });
});

describe("changedFields", () => {
  it("lists only the fields whose value differs", () => {
    expect(changedFields(SEEDED, { ...SEEDED, closeTicket: false })).toEqual({
      closeTicket: false,
    });
    expect(changedFields(ANNOTATING, editedFields(ANNOTATING, { epicId: null }))).toEqual({
      backAnnotateEpic: false,
      epicId: null,
    });
  });

  it("is empty for an edit that restates the plan", () => {
    const changes = changedFields(SEEDED, editedFields(SEEDED, { closeTicket: true }));

    expect(changes).toEqual({});
    expect(changesNothing(changes)).toBe(true);
  });

  it("counts a cleared epic and a switched-off toggle as changes", () => {
    expect(changesNothing({ epicId: null })).toBe(false);
    expect(changesNothing({ closeTicket: false })).toBe(false);
    expect(changesNothing({})).toBe(true);
  });
});

describe("needsEpic", () => {
  it("is V058's pr_merge_plans_back_annotate_has_epic, asked before the write", () => {
    expect(needsEpic(editedFields(SEEDED, { backAnnotateEpic: true }))).toBe(true);
    expect(needsEpic(editedFields(SEEDED, { backAnnotateEpic: true, epicId: EPIC }))).toBe(false);
    expect(needsEpic(SEEDED)).toBe(false);
    expect(needsEpic(ANNOTATING)).toBe(false);
  });
});

describe("fieldsOf", () => {
  it("reads the five editable fields, and neither the strategy nor the arm", () => {
    const plan: StoredMergePlan = {
      id: "plan-1",
      prId: "pr-514",
      strategy: "squash",
      deleteBranch: true,
      ...ANNOTATING,
      armed: false,
      armedBy: null,
      armedAt: null,
      armedAgainstRevisionId: null,
      disarmReason: null,
      mergedResult: null,
      updatedAt: new Date("2026-09-27T10:00:00Z"),
    };

    expect(fieldsOf(plan)).toEqual(ANNOTATING);
    expect(Object.keys(fieldsOf(plan)).sort()).toEqual([...EDITABLE_FIELDS].sort());
  });
});
