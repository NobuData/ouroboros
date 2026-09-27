import { MAX_EPIC_NOTE, actionsExecuted, epicNoteBody, ticketClosure } from "./merge.actions";

/**
 * The post-merge actions' rules (AX.4, [#360](https://github.com/NobuData/ouroboros/issues/360)):
 * a ticket's closure is the host's read-back, never assumed; the epic note is one bounded line; and
 * `actions_executed` lists only what ran and was switched on — V058's `pr_merge_result_valid`.
 */
describe("ticketClosure", () => {
  it("finds the canonical ticket among the host's closures, whatever the case", () => {
    expect(
      ticketClosure("#482", [
        { reference: "acme/other#7", closed: false, detail: "in another repository" },
        { reference: "#482", closed: true, detail: null },
      ]),
    ).toEqual({ key: "#482", closed: true, detail: null });
    expect(ticketClosure("#AB", [{ reference: "#ab", closed: true, detail: null }])).toMatchObject({
      closed: true,
    });
  });

  it("reports a keyword close the host did not honour, with its reason", () => {
    expect(
      ticketClosure("#482", [
        { reference: "#482", closed: false, detail: "#482 is still open after the merge" },
      ]),
    ).toEqual({ key: "#482", closed: false, detail: "#482 is still open after the merge" });
    expect(ticketClosure("#482", [{ reference: "#482", closed: false, detail: null }])).toEqual({
      key: "#482",
      closed: false,
      detail: "#482 is still open after the merge",
    });
  });

  it("detects a ticket no keyword could close — a Jira key on a git host", () => {
    expect(ticketClosure("PROJ-142", [])).toEqual({
      key: "PROJ-142",
      closed: false,
      detail: "PROJ-142 is not closed by a keyword on this host — close it in its tracker",
    });
  });

  it("has nothing to say about a PR without a ticket", () => {
    expect(ticketClosure(null, [{ reference: "#1", closed: true, detail: null }])).toBeNull();
  });
});

describe("epicNoteBody", () => {
  it("is one line: the PR, its ticket and the merge commit", () => {
    expect(
      epicNoteBody(
        { number: 514, title: "fix(can): preserve ISR\nframe order" },
        "#482",
        "9a1f0c2deadbeef",
      ),
    ).toBe("merged PR #514 — fix(can): preserve ISR frame order · closes #482 · 9a1f0c2");
    expect(epicNoteBody({ number: 77, title: "docs" }, null, "d0c5a11")).toBe(
      "merged PR #77 — docs · d0c5a11",
    );
  });

  it("is bounded to V064's 2048", () => {
    expect(epicNoteBody({ number: 1, title: "t".repeat(5000) }, null, "d0c5a11")).toHaveLength(
      MAX_EPIC_NOTE,
    );
  });
});

describe("actionsExecuted", () => {
  const ALL_ON = {
    close_ticket: true,
    comment_evidence: true,
    back_annotate_epic: true,
    delete_branch: true,
  };

  it("lists what ran, in a fixed order", () => {
    expect(
      actionsExecuted(ALL_ON, {
        delete_branch: true,
        back_annotate_epic: false,
        comment_evidence: true,
        close_ticket: true,
      }),
    ).toEqual(["close_ticket", "comment_evidence", "delete_branch"]);
  });

  it("leaves out what ran while switched off — V058 would refuse it", () => {
    expect(
      actionsExecuted({ ...ALL_ON, close_ticket: false }, { ...ALL_ON, close_ticket: true }),
    ).toEqual(["comment_evidence", "back_annotate_epic", "delete_branch"]);
  });
});
