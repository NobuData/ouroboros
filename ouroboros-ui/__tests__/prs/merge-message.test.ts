import { describe, expect, it } from "vitest";

import {
  MAX_COMMIT_MESSAGE_LENGTH,
  MESSAGE_BLANK,
  MESSAGE_TOO_LONG,
  closeCheck,
  closesTicket,
  draftOf,
  unsendable,
} from "@/app/prs/merge-message";

import { SEEDED_MESSAGE } from "../helpers/pull-requests";

/**
 * The merge message, its unsaved edit, and whether it still closes the ticket (#369): editing
 * `Closes #N` out of the message warns while the close toggle is on.
 */

describe("closesTicket — the service's own keyword rule", () => {
  it("finds the seeded trailer", () => {
    expect(closesTicket(SEEDED_MESSAGE, "#482")).toBe(true);
  });

  it.each([
    "Closes #482.",
    "closes #482",
    "Closed #482",
    "Close #482",
    "Fixes #482",
    "fix #482",
    "Fixed #482",
    "Resolves #482",
    "resolve #482",
    "Resolved #482",
    "Closes: #482",
    "fix(can): reorder frames\n\nThis closes   #482 for good.",
  ])("accepts %j", (message) => {
    expect(closesTicket(message, "#482")).toBe(true);
  });

  it.each([
    ["no keyword at all", "fix(can): preserve ISR frame order in telemetry path"],
    ["the number without a keyword", "See #482 for the background."],
    ["a longer number", "Closes #4821."],
    ["a shorter number", "Closes #48."],
    ["another issue", "Closes #481."],
    ["another repository's issue", "Closes acme/other#482."],
    ["a keyword inside a word", "Discloses #482."],
    ["a keyword with nothing after it", "Closes the issue."],
    ["an empty message", ""],
  ])("refuses %s", (_, message) => {
    expect(closesTicket(message, "#482")).toBe(false);
  });

  it("finds the ticket among several references", () => {
    expect(closesTicket("Fixes #12, closes acme/other#482 and resolves #482.", "#482")).toBe(true);
    expect(closesTicket("Fixes #12 and closes acme/other#482.", "#482")).toBe(false);
  });

  it("answers the same on every call — the pattern keeps no position", () => {
    for (let call = 0; call < 3; call += 1) {
      expect(closesTicket(SEEDED_MESSAGE, "#482")).toBe(true);
    }
  });
});

describe("closeCheck", () => {
  it("says nothing while the message closes the ticket and the toggle is on", () => {
    expect(closeCheck(SEEDED_MESSAGE, "#482", true)).toEqual({ kind: "agrees" });
  });

  it("warns when an edit removed the keyword while the toggle is on", () => {
    const check = closeCheck("can: fix flaky telemetry frame order under ISR load", "#482", true);

    expect(check.kind).toBe("missing");
    expect(check).toMatchObject({ text: expect.stringContaining("no closing keyword for #482") });
    expect(check).toMatchObject({ text: expect.stringContaining("Closes #482.") });
    expect(check).toMatchObject({
      text: expect.stringContaining("the toggle and the message disagree"),
    });
  });

  it("hedges: the PR's description can carry the keyword, and this page does not hold it", () => {
    expect(closeCheck("reworded", "#482", true)).toMatchObject({
      text: expect.stringContaining("unless the PR's description carries one"),
    });
  });

  it("says nothing once the toggle is off — nothing is left to disagree", () => {
    expect(closeCheck("reworded", "#482", false)).toEqual({ kind: "agrees" });
  });

  it("says nothing for a PR with no ticket", () => {
    expect(closeCheck("reworded", null, true)).toEqual({ kind: "agrees" });
  });

  it("says a key no keyword can name is closed in its tracker, in the executor's words", () => {
    expect(closeCheck("fix: reorder\n\nCloses PROJ-142.", "PROJ-142", true)).toEqual({
      kind: "unclosable",
      text: "PROJ-142 is not closed by a keyword on this host — close it in its tracker.",
    });
    expect(closeCheck("fix: reorder", "PROJ-142", false)).toEqual({ kind: "agrees" });
  });

  it("stops warning when the keyword is typed back", () => {
    expect(closeCheck("reworded\n\nFixes #482", "#482", true)).toEqual({ kind: "agrees" });
  });
});

describe("draftOf", () => {
  it("is nothing while the field says what is stored", () => {
    expect(draftOf(SEEDED_MESSAGE, SEEDED_MESSAGE, null)).toBeNull();
  });

  it("is nothing for padding alone — the service refuses padding anyway", () => {
    expect(draftOf(`${SEEDED_MESSAGE}\n`, SEEDED_MESSAGE, null)).toBeNull();
    expect(draftOf(`  ${SEEDED_MESSAGE}`, SEEDED_MESSAGE, null)).toBeNull();
  });

  it("begins from the stored message, and keeps where it began", () => {
    const first = draftOf("reworded", SEEDED_MESSAGE, null);

    expect(first).toEqual({ text: "reworded", base: SEEDED_MESSAGE });
    // The stored message moved under the edit: the draft still knows what it began from.
    expect(draftOf("reworded again", "somebody else's edit", first)).toEqual({
      text: "reworded again",
      base: SEEDED_MESSAGE,
    });
  });

  it("ends when the field is typed back to what is stored", () => {
    const draft = draftOf("reworded", SEEDED_MESSAGE, null);

    expect(draftOf(SEEDED_MESSAGE, SEEDED_MESSAGE, draft)).toBeNull();
  });
});

describe("unsendable", () => {
  it("refuses a blank message and one that is too long", () => {
    expect(unsendable({ text: "   \n ", base: SEEDED_MESSAGE })).toBe(MESSAGE_BLANK);
    expect(unsendable({ text: "", base: SEEDED_MESSAGE })).toBe(MESSAGE_BLANK);
    expect(
      unsendable({ text: "x".repeat(MAX_COMMIT_MESSAGE_LENGTH + 1), base: SEEDED_MESSAGE }),
    ).toBe(MESSAGE_TOO_LONG);
  });

  it("accepts a message at the bound, measured as it is sent — trimmed", () => {
    expect(
      unsendable({ text: `${"x".repeat(MAX_COMMIT_MESSAGE_LENGTH)}\n`, base: SEEDED_MESSAGE }),
    ).toBeNull();
    expect(unsendable({ text: "reworded", base: SEEDED_MESSAGE })).toBeNull();
  });
});
