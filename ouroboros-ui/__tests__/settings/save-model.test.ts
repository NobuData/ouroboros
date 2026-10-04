import { describe, expect, it, vi } from "vitest";

import {
  BATCH_SECTIONS,
  type BatchSectionId,
  CLEAN,
  type Committers,
  type FieldLabels,
  INVALID_REASON,
  NO_COMMITTER,
  type SaveState,
  type SectionCommitResult,
  type SectionCommitter,
  type SectionValues,
  applyOutcome,
  assertBatchSection,
  commitSave,
  dirtyLabel,
  dirtySections,
  discardEdits,
  dropLanded,
  editField,
  failureSummary,
  fieldId,
  firstRefusedField,
  forgetSection,
  isBatchSection,
  landSection,
  pendingCount,
  rebaseSection,
  refuseSection,
  sameValue,
  saveLabel,
  sectionDraft,
  sectionPending,
  validateSave,
} from "@/app/settings/save-model";
import { SETTINGS_SECTIONS, sectionTitleId } from "@/app/settings/view";

/**
 * The settings page's save model (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491), decision S7), as functions: what
 * counts as unsaved, what a save sends and in what order, what a refusal leaves behind, and
 * that the Danger zone cannot be part of any of it.
 */

/** What the fixture service holds for the workspace card. */
const WORKSPACE: SectionValues = { name: "acme-robotics", domain: "acme.ouroboros.dev" };

/** What it holds for the notifications card. */
const NOTIFICATIONS: SectionValues = { digest: true, channel: "#eng-leads" };

/** The labels the two cards give their fields. */
const LABELS: FieldLabels = new Map<BatchSectionId, Readonly<Record<string, string>>>([
  ["workspace", { name: "Workspace name", domain: "Tenant domain" }],
  ["notifications", { channel: "Weekly report channel" }],
]);

/**
 * A committer whose write answers what it is told to.
 *
 * @param baseline The section's saved values.
 * @param result What the write answers. Defaults to success.
 * @param validate The browser's check, if the section has one.
 * @returns The committer, with its `commit` a spy.
 */
function committer(
  baseline: SectionValues,
  result: SectionCommitResult = { ok: true },
  validate?: SectionCommitter["validate"],
) {
  return { baseline, validate, commit: vi.fn(() => Promise.resolve(result)) };
}

/**
 * A page with edits in both fixture sections.
 *
 * @returns The state.
 */
function bothDirty(): SaveState {
  const named = editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE);

  return editField(named, "notifications", "channel", "#eng-all", NOTIFICATIONS);
}

describe("which sections batch", () => {
  it("is every section but the ones whose controls act at once", () => {
    expect(BATCH_SECTIONS).toEqual([
      "workspace",
      "members",
      "policies",
      "audit",
      "integrations",
      "notifications",
    ]);
    // The type's exclusions and the data's agree: nothing immediate is batchable.
    for (const section of SETTINGS_SECTIONS) {
      expect(isBatchSection(section.id)).toBe(section.saves === "batch");
    }
  });

  it("refuses the Danger zone by construction, and says why", () => {
    expect(isBatchSection("danger")).toBe(false);
    expect(() => {
      assertBatchSection("danger");
    }).toThrow(/Danger zone.*act immediately.*cannot be fields saved by Save changes/);
    expect(() => {
      assertBatchSection("appearance");
    }).toThrow(/Appearance/);
    expect(() => {
      assertBatchSection("workspace");
    }).not.toThrow();
  });

  it("will not hold an edit for an immediate section, even past the type", () => {
    expect(() => editField(CLEAN, "danger" as never, "pause", true, {})).toThrow(/act immediately/);
  });
});

describe("what is the same value", () => {
  it.each([
    ["two equal strings", "a", "a", true],
    ["two different strings", "a", "b", false],
    ["a number and its string", 1, "1", false],
    ["NaN and NaN", Number.NaN, Number.NaN, true],
    ["null and undefined", null, undefined, false],
    ["two lists with the same entries", ["boot/", "keys/"], ["boot/", "keys/"], true],
    ["the same entries in another order", ["boot/", "keys/"], ["keys/", "boot/"], false],
    ["a list and a longer one", ["boot/"], ["boot/", "keys/"], false],
    ["a list and an object", [], {}, false],
    ["two objects with the same fields", { cap: 250, on: true }, { on: true, cap: 250 }, true],
    ["an object and one with a field more", { cap: 250 }, { cap: 250, on: true }, false],
    ["nested values", { terms: [{ effort: "M" }] }, { terms: [{ effort: "M" }] }, true],
    ["nested values that differ", { terms: [{ effort: "M" }] }, { terms: [{ effort: "L" }] }, false],
  ])("%s", (_name, a, b, same) => {
    expect(sameValue(a, b)).toBe(same);
  });
});

describe("editing", () => {
  it("holds a field that differs from what is saved, and counts it", () => {
    const state = editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE);

    expect(state.edits).toEqual({ workspace: { name: "acme-2" } });
    expect(sectionPending(state, "workspace")).toBe(1);
    expect(pendingCount(state)).toBe(1);
    expect(dirtySections(state)).toEqual(["workspace"]);
  });

  it("drops an edit that lands back on the saved value, so the count is of real changes", () => {
    const edited = editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE);
    const reverted = editField(edited, "workspace", "name", "acme-robotics", WORKSPACE);

    expect(reverted.edits).toEqual({});
    expect(pendingCount(reverted)).toBe(0);
    expect(dirtySections(reverted)).toEqual([]);
  });

  it("counts fields, across sections, in page order", () => {
    const state = editField(bothDirty(), "workspace", "domain", "new.ouroboros.dev", WORKSPACE);

    expect(pendingCount(state)).toBe(3);
    expect(sectionPending(state, "workspace")).toBe(2);
    expect(sectionPending(state, "notifications")).toBe(1);
    expect(sectionPending(state, "members")).toBe(0);
    // Workspace is drawn before Notifications, whichever was edited first.
    expect(dirtySections(state)).toEqual(["workspace", "notifications"]);
  });

  it("counts an edit to the same field once, however many times it is typed in", () => {
    const once = editField(CLEAN, "workspace", "name", "a", WORKSPACE);
    const twice = editField(once, "workspace", "name", "ab", WORKSPACE);

    expect(pendingCount(twice)).toBe(1);
    expect(twice.edits.workspace).toEqual({ name: "ab" });
  });

  it("draws the section as it stands: what is saved, under what is unsaved", () => {
    const state = editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE);

    expect(sectionDraft(state, "workspace", WORKSPACE)).toEqual({
      name: "acme-2",
      domain: "acme.ouroboros.dev",
    });
    expect(sectionDraft(CLEAN, "workspace", WORKSPACE)).toEqual(WORKSPACE);
  });

  it("clears what the last save said about a field when that field is edited again", () => {
    const refused = refuseSection(bothDirty(), "workspace", {
      reason: "Refused.",
      fields: { name: "Taken.", domain: "Also wrong." },
    });
    const edited = editField(refused, "workspace", "name", "acme-3", WORKSPACE);

    expect(edited.errors.workspace).toEqual({ domain: "Also wrong." });
    // The refusal was about the batch that was sent; this is a different one now.
    expect(edited.refusals).toEqual({});
  });

  it("never changes the state it was given", () => {
    const before = bothDirty();
    const snapshot = structuredClone(before);

    editField(before, "workspace", "domain", "x.dev", WORKSPACE);
    landSection(before, "workspace");
    discardEdits(before);

    expect(before).toEqual(snapshot);
  });
});

describe("discarding", () => {
  it("drops every unsaved field and everything said about them", () => {
    const refused = refuseSection(bothDirty(), "workspace", {
      reason: "Refused.",
      fields: { name: "Taken." },
    });

    expect(discardEdits(refused)).toEqual(CLEAN);
  });

  it("keeps what has already landed — it is saved, and only waiting to be re-read", () => {
    const landed = landSection(bothDirty(), "workspace");
    const discarded = discardEdits(landed);

    expect(discarded.landed).toEqual({ workspace: { name: "acme-2" } });
    expect(pendingCount(discarded)).toBe(0);
  });
});

describe("a section landing", () => {
  it("stops counting its edits, and goes on drawing them until the page re-reads", () => {
    const landed = landSection(bothDirty(), "workspace");

    expect(sectionPending(landed, "workspace")).toBe(0);
    expect(pendingCount(landed)).toBe(1);
    // Without the overlay the card would flash the old name until the refresh arrived.
    expect(sectionDraft(landed, "workspace", WORKSPACE).name).toBe("acme-2");
  });

  it("measures a later edit against what landed, not against the stale read", () => {
    const landed = landSection(editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE), "workspace");

    // Typing the landed value again is not a change…
    expect(pendingCount(editField(landed, "workspace", "name", "acme-2", WORKSPACE))).toBe(0);
    // …and typing the old one back is.
    expect(pendingCount(editField(landed, "workspace", "name", "acme-robotics", WORKSPACE))).toBe(1);
  });

  it("drops the overlay when the fresh baseline arrives", () => {
    const landed = landSection(editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE), "workspace");
    const rebased = rebaseSection(landed, "workspace", { ...WORKSPACE, name: "acme-2" });

    expect(rebased).toEqual(CLEAN);
  });

  it("drops the overlay once the page has been re-read, whatever the re-read said", () => {
    // The service trimmed the name back to what it had: the baseline did not change, and it
    // is still the truth — the sent value must not go on being drawn as saved.
    const landed = landSection(editField(CLEAN, "workspace", "name", "acme-robotics ", WORKSPACE), "workspace");
    const dropped = dropLanded(landed);

    expect(dropped.landed).toEqual({});
    expect(sectionDraft(dropped, "workspace", WORKSPACE).name).toBe("acme-robotics");
    // And typing the true value is then no change at all.
    expect(pendingCount(editField(dropped, "workspace", "name", "acme-robotics", WORKSPACE))).toBe(0);
  });

  it("hands back the same state when there is no overlay to drop", () => {
    const state = bothDirty();

    expect(dropLanded(state)).toBe(state);
    expect(dropLanded(CLEAN)).toBe(CLEAN);
  });
});

describe("a new baseline", () => {
  it("keeps an edit the new values do not already equal", () => {
    const state = editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE);
    const rebased = rebaseSection(state, "workspace", { ...WORKSPACE, domain: "moved.dev" });

    expect(rebased.edits).toEqual({ workspace: { name: "acme-2" } });
  });

  it("drops an edit somebody else already saved, and what was said about it", () => {
    const refused = refuseSection(
      editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE),
      "workspace",
      { reason: "Refused.", fields: { name: "Taken." } },
    );
    const rebased = rebaseSection(refused, "workspace", { ...WORKSPACE, name: "acme-2" });

    expect(rebased).toEqual(CLEAN);
  });

  it("leaves the other sections alone", () => {
    const rebased = rebaseSection(bothDirty(), "workspace", { ...WORKSPACE, name: "acme-2" });

    expect(rebased.edits).toEqual({ notifications: { channel: "#eng-all" } });
  });

  it("hands back the same state for a section holding nothing, so a clean card's re-read renders nothing", () => {
    const state = editField(CLEAN, "notifications", "channel", "#eng-all", NOTIFICATIONS);

    expect(rebaseSection(state, "workspace", { ...WORKSPACE, name: "elsewhere" })).toBe(state);
  });
});

describe("a card leaving the page", () => {
  it("takes everything held for its section with it", () => {
    const refused = refuseSection(bothDirty(), "workspace", { reason: "Refused.", fields: { name: "x" } });
    const gone = forgetSection(refused, "workspace");

    expect(gone.edits).toEqual({ notifications: { channel: "#eng-all" } });
    expect(gone.errors).toEqual({});
    expect(gone.refusals).toEqual({});
  });
});

describe("validating before anything is sent", () => {
  it("passes a page whose sections have no check or nothing wrong", () => {
    const committers: Committers = new Map([
      ["workspace", committer(WORKSPACE, { ok: true }, () => ({}))],
      ["notifications", committer(NOTIFICATIONS)],
    ]);

    expect(validateSave(bothDirty(), committers)).toEqual([]);
  });

  it("hands the check the whole draft and only the changes", () => {
    const validate = vi.fn(() => ({}));
    const committers: Committers = new Map([["workspace", committer(WORKSPACE, { ok: true }, validate)]]);

    validateSave(editField(CLEAN, "workspace", "name", "acme-2", WORKSPACE), committers);

    expect(validate).toHaveBeenCalledWith(
      { name: "acme-2", domain: "acme.ouroboros.dev" },
      { name: "acme-2" },
    );
  });

  it("reports every invalid section, not only the first", () => {
    const committers: Committers = new Map([
      ["workspace", committer(WORKSPACE, { ok: true }, () => ({ name: "Required." }))],
      ["notifications", committer(NOTIFICATIONS, { ok: true }, () => ({ channel: "Starts with #." }))],
    ]);

    expect(validateSave(bothDirty(), committers)).toEqual([
      { section: "workspace", fields: { name: "Required." } },
      { section: "notifications", fields: { channel: "Starts with #." } },
    ]);
  });

  it("does not check a section nobody touched", () => {
    const validate = vi.fn(() => ({ name: "Required." }));
    const committers: Committers = new Map([["workspace", committer(WORKSPACE, { ok: true }, validate)]]);

    expect(validateSave(CLEAN, committers)).toEqual([]);
    expect(validate).not.toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("writes each dirty section once, in page order, with all of its changes", async () => {
    const workspace = committer(WORKSPACE);
    const notifications = committer(NOTIFICATIONS);
    const order: string[] = [];
    workspace.commit.mockImplementation(() => {
      order.push("workspace");
      return Promise.resolve({ ok: true });
    });
    notifications.commit.mockImplementation(() => {
      order.push("notifications");
      return Promise.resolve({ ok: true });
    });
    const state = editField(bothDirty(), "workspace", "domain", "new.dev", WORKSPACE);

    const outcome = await commitSave(
      state,
      new Map<"workspace" | "notifications", SectionCommitter>([
        ["notifications", notifications],
        ["workspace", workspace],
      ]),
    );

    expect(outcome).toEqual({ kind: "saved", landed: ["workspace", "notifications"] });
    expect(order).toEqual(["workspace", "notifications"]);
    // One request per section — the section's atomicity — carrying only what changed, and
    // the whole draft beside it for a write that sends the section entire.
    expect(workspace.commit).toHaveBeenCalledOnce();
    expect(workspace.commit).toHaveBeenCalledWith(
      { name: "acme-2", domain: "new.dev" },
      { name: "acme-2", domain: "new.dev" },
    );
    expect(notifications.commit).toHaveBeenCalledWith(
      { channel: "#eng-all" },
      { digest: true, channel: "#eng-all" },
    );
  });

  it("sends nothing at all when the browser's check fails anywhere", async () => {
    const workspace = committer(WORKSPACE);
    const notifications = committer(NOTIFICATIONS, { ok: true }, () => ({ channel: "Starts with #." }));

    const outcome = await commitSave(
      bothDirty(),
      new Map<"workspace" | "notifications", SectionCommitter>([
        ["workspace", workspace],
        ["notifications", notifications],
      ]),
    );

    expect(outcome).toEqual({
      kind: "invalid",
      invalid: [{ section: "notifications", fields: { channel: "Starts with #." } }],
    });
    // The valid section is not written either: anything invalid means nothing sent.
    expect(workspace.commit).not.toHaveBeenCalled();
    expect(notifications.commit).not.toHaveBeenCalled();
  });

  it("stops at the first section the service refuses, and does not send the ones after it", async () => {
    const workspace = committer(WORKSPACE, {
      ok: false,
      reason: "The workspace was not changed.",
      fields: { domain: "Already in use." },
    });
    const notifications = committer(NOTIFICATIONS);

    const outcome = await commitSave(
      bothDirty(),
      new Map<"workspace" | "notifications", SectionCommitter>([
        ["workspace", workspace],
        ["notifications", notifications],
      ]),
    );

    expect(outcome).toEqual({
      kind: "refused",
      landed: [],
      section: "workspace",
      refusal: { reason: "The workspace was not changed.", fields: { domain: "Already in use." } },
      unsent: ["notifications"],
    });
    expect(notifications.commit).not.toHaveBeenCalled();
  });

  it("keeps what landed before a refusal landed", async () => {
    const workspace = committer(WORKSPACE);
    const notifications = committer(NOTIFICATIONS, { ok: false, reason: "The routes were not changed." });

    const outcome = await commitSave(
      bothDirty(),
      new Map<"workspace" | "notifications", SectionCommitter>([
        ["workspace", workspace],
        ["notifications", notifications],
      ]),
    );

    expect(outcome).toEqual({
      kind: "refused",
      landed: ["workspace"],
      section: "notifications",
      // A refusal that names no field carries none.
      refusal: { reason: "The routes were not changed.", fields: {} },
      unsent: [],
    });
  });

  it("never reports saved for a dirty section with no card on the page to write it", async () => {
    // It should not happen — a card that leaves takes its edits with it — and so it is said
    // rather than skipped: the save stops there, like any section that was not written.
    const notifications = committer(NOTIFICATIONS);

    const outcome = await commitSave(bothDirty(), new Map([["notifications", notifications]]));

    expect(outcome).toEqual({
      kind: "refused",
      landed: [],
      section: "workspace",
      refusal: { reason: NO_COMMITTER, fields: {} },
      unsent: ["notifications"],
    });
    expect(notifications.commit).not.toHaveBeenCalled();
  });

  it("has nothing to do on a clean page", async () => {
    const workspace = committer(WORKSPACE);

    expect(await commitSave(CLEAN, new Map([["workspace", workspace]]))).toEqual({
      kind: "saved",
      landed: [],
    });
    expect(workspace.commit).not.toHaveBeenCalled();
  });
});

describe("what a save leaves behind", () => {
  it("is a clean count when everything landed", () => {
    const next = applyOutcome(bothDirty(), { kind: "saved", landed: ["workspace", "notifications"] });

    expect(pendingCount(next)).toBe(0);
    expect(next.errors).toEqual({});
    expect(next.landed).toEqual({
      workspace: { name: "acme-2" },
      notifications: { channel: "#eng-all" },
    });
  });

  it("is every edit kept, with the errors at their fields, when the browser's check failed", () => {
    const next = applyOutcome(bothDirty(), {
      kind: "invalid",
      invalid: [{ section: "workspace", fields: { name: "Required." } }],
    });

    expect(pendingCount(next)).toBe(2);
    expect(next.errors).toEqual({ workspace: { name: "Required." } });
    expect(next.refusals).toEqual({ workspace: INVALID_REASON });
    expect(next.landed).toEqual({});
  });

  it("is the landed sections saved and the refused one still unsaved, with its errors", () => {
    const next = applyOutcome(bothDirty(), {
      kind: "refused",
      landed: ["workspace"],
      section: "notifications",
      refusal: { reason: "Refused.", fields: { channel: "Starts with #." } },
      unsent: [],
    });

    expect(sectionPending(next, "workspace")).toBe(0);
    expect(sectionPending(next, "notifications")).toBe(1);
    expect(pendingCount(next)).toBe(1);
    expect(next.errors).toEqual({ notifications: { channel: "Starts with #." } });
    expect(next.refusals).toEqual({ notifications: "Refused." });
  });

  it("leaves a section that was never sent exactly as it was", () => {
    const next = applyOutcome(bothDirty(), {
      kind: "refused",
      landed: [],
      section: "workspace",
      refusal: { reason: "Refused.", fields: { name: "Taken." } },
      unsent: ["notifications"],
    });

    expect(next.edits.notifications).toEqual({ channel: "#eng-all" });
    expect(next.errors.notifications).toBeUndefined();
    expect(pendingCount(next)).toBe(2);
  });
});

describe("what the page says", () => {
  it("counts on the button only while there is something to count", () => {
    expect(saveLabel(0)).toBe("Save changes");
    expect(saveLabel(1)).toBe("Save changes (1)");
    expect(saveLabel(3)).toBe("Save changes (3)");
  });

  it("counts on the bar in the singular and the plural", () => {
    expect(dirtyLabel(1)).toBe("1 unsaved change");
    expect(dirtyLabel(3)).toBe("3 unsaved changes");
  });

  it("says nothing about a save that landed whole", () => {
    expect(failureSummary({ kind: "saved", landed: ["workspace"] }, LABELS)).toBeNull();
    expect(firstRefusedField({ kind: "saved", landed: ["workspace"] })).toBeNull();
  });

  it("names the section and the field the browser's check stopped at, and that nothing was sent", () => {
    const outcome = {
      kind: "invalid" as const,
      invalid: [{ section: "workspace" as const, fields: { name: "A workspace needs a name." } }],
    };

    expect(failureSummary(outcome, LABELS)).toBe(
      "Nothing was saved. Workspace: Workspace name — A workspace needs a name.",
    );
    expect(firstRefusedField(outcome)).toEqual({ section: "workspace", field: "name" });
  });

  it("names the section and the field the service refused, and what was and was not written", () => {
    const outcome = {
      kind: "refused" as const,
      landed: ["workspace" as const],
      section: "notifications" as const,
      refusal: { reason: "Refused.", fields: { channel: "A channel starts with #." } },
      unsent: ["audit" as const],
    };

    expect(failureSummary(outcome, LABELS)).toBe(
      "Not saved — Notifications: Weekly report channel — A channel starts with #. " +
        "Saved: Workspace. Not sent: Audit log.",
    );
    expect(firstRefusedField(outcome)).toEqual({ section: "notifications", field: "channel" });
  });

  it("falls back to the section's reason when the refusal names no field, and to the key when a field has no label", () => {
    expect(
      failureSummary(
        {
          kind: "refused",
          landed: [],
          section: "workspace",
          refusal: { reason: "The service could not be reached.", fields: {} },
          unsent: [],
        },
        LABELS,
      ),
    ).toBe("Not saved — Workspace: The service could not be reached.");

    expect(
      failureSummary(
        {
          kind: "refused",
          landed: [],
          section: "members",
          refusal: { reason: "Refused.", fields: { role: "Unknown role." } },
          unsent: [],
        },
        LABELS,
      ),
    ).toBe("Not saved — Members & roles: role — Unknown role.");
  });

  it("has no field to focus when the refusal names none", () => {
    expect(
      firstRefusedField({
        kind: "refused",
        landed: [],
        section: "workspace",
        refusal: { reason: "Unreachable.", fields: {} },
        unsent: [],
      }),
    ).toBeNull();
  });

  it("gives a field's control one id, so a refusal can find it", () => {
    expect(fieldId("workspace", "domain")).toBe("settings-workspace-field-domain");
  });

  it("keeps a field's id apart from its section's own ids, whatever the field is called", () => {
    // A field named `title` must not take the id the section's heading carries.
    for (const section of BATCH_SECTIONS) {
      expect(fieldId(section, "title")).not.toBe(sectionTitleId(section));
    }
  });
});
