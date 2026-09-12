import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ASSIGN_CARET,
  ASSIGN_LABEL,
  DASHBOARD_QUEUE_HREF,
  NOTHING_QUEUED_TITLE,
  NOT_SIZED_YET,
  type Offender,
  QUEUE_ISSUE_CODES,
  SUGGESTED_TARGET,
  WORKFLOWS,
  deselectLabel,
  estimateLabel,
  isWorkflow,
  leftOutNote,
  offenderLine,
  offendersOf,
  queueUnderLabel,
  queuedToast,
  selectedLabel,
  summarize,
} from "@/app/issues/bar";
import { withSightings } from "@/app/issues/seen-rows";
import { tableRows } from "@/app/issues/table";
import { DASHBOARD_PATH, DASHBOARD_QUEUE_HASH } from "@/app/paths";

import {
  ESTIMATING_ROW,
  SEEDED_ROWS,
  SEEDED_TRIO_MINUTES,
  SELECTED_TRIO,
  issueId,
  queuedSelection,
} from "../helpers/issues";

/**
 * The selection action bar's copy and its decisions (#118).
 *
 * The mockup is read for the copy — the bar's sentence, the trigger, the primary action's
 * shape — and the seeds for the numbers: the mockup's trio sums to M.3's 125 minutes, not the
 * mockup's 70. Around that: the label under every choice, the refusal read defensively out of
 * an open `details` map and worded per issue, and what a press that took says.
 */

/** The mockup this page is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "03-issues.html"),
  "utf8",
);

/** The mockup's `.sel-bar` card alone. */
const SEL_BAR = MOCKUP.slice(
  MOCKUP.indexOf("<!-- selection action bar -->"),
  MOCKUP.indexOf("<!-- side panel: issue detail -->"),
);

/** The contract, for the fixed set. */
const CONTRACT = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "ouroboros-rest", "openapi.yaml"),
  "utf8",
);

/** The seeded rows, as the table has seen them. */
const SEEN = withSightings(new Map(), tableRows(SEEDED_ROWS));

describe("the workflow menu's rows", () => {
  it("are every one a slug the contract's own shape accepts", () => {
    // This used to compare the menu against `QueueSelection.workflow`'s **enum**, which was
    // decision K5's four names and therefore the whole vocabulary. P.4
    // ([#135](https://github.com/NobuData/ouroboros/issues/135)) made the vocabulary a
    // workspace's own workflow registry, so the contract publishes a slug shape instead — and
    // what is still checkable from here is the guarantee that matters to this menu: a row it
    // draws can never be refused by the pipe for its *shape*. Whether the workspace has a
    // workflow by that name is a `422 queue_workflow_unknown` carrying the real list, which is
    // what S.1 (#147) will draw the menu from — see `app/issues/bar.ts`.
    const published = /workflow:\n\s+type: string\n\s+pattern: (\S+)\n\s+maxLength: (\d+)/.exec(
      CONTRACT.slice(CONTRACT.indexOf("    QueueSelection:")),
    );

    expect(published).not.toBeNull();

    const shape = new RegExp(published![1]!);
    const maxLength = Number(published![2]!);

    for (const workflow of WORKFLOWS) {
      expect(workflow).toMatch(shape);
      expect(workflow.length).toBeLessThanOrEqual(maxLength);
    }
  });

  it("lead with the tag the mockup's own button names", () => {
    expect(SEL_BAR).toContain(`Queue → ${WORKFLOWS[0]}`);
  });

  it("recognise a tag from the set and nothing else", () => {
    expect(isWorkflow("standard-fix")).toBe(true);
    expect(isWorkflow("release-train")).toBe(false);
    expect(isWorkflow(null)).toBe(false);
    expect(isWorkflow(["standard-fix"])).toBe(false);
  });

  it("open from the mockup's trigger, caret and all", () => {
    expect(SEL_BAR).toContain(`${ASSIGN_LABEL} ${ASSIGN_CARET}`);
  });
});

describe("the per-issue codes", () => {
  it("are the contract's own spellings, every one described in the queue operation's responses", () => {
    // Held here rather than in `__tests__/api/backlog.test.ts` because the bar, a Client
    // Component, owns them: the resource module sits on the server-side client.
    const responses = CONTRACT.slice(CONTRACT.indexOf("  /api/v1/backlog/queue:"));

    expect(Object.values(QUEUE_ISSUE_CODES)).toEqual([
      "issue_not_found",
      "issue_not_sized",
      "issue_estimate_missing",
      "issue_already_queued",
      "issue_number_taken",
    ]);
    for (const code of Object.values(QUEUE_ISSUE_CODES)) {
      expect(responses, code).toContain(`\`${code}\``);
    }
  });
});

describe("the sentence", () => {
  it("counts the selection in the mockup's phrase", () => {
    expect(SEL_BAR).toContain(`<strong>${selectedLabel(3)}</strong>`);
    expect(selectedLabel(1)).toBe("1 issue selected");
  });

  it("sums the mockup's trio to the seeds' minutes, in the mockup's phrase", () => {
    // 45 + 50 + 30: the seeded estimates, and what M.3 answers for the same selection. The
    // mockup's *1h 10m* is design copy over rows that carry no minutes.
    const summary = summarize(SELECTED_TRIO, SEEN);

    expect(summary).toEqual({
      count: 3,
      estMinutes: SEEDED_TRIO_MINUTES,
      unestimated: 0,
      suggested: "standard-fix",
    });
    expect(estimateLabel(summary)).toBe("· est. 2h 5m combined autonomous work");
    expect(SEL_BAR).toContain("· est. 1h 10m combined autonomous work");
  });

  it("sums only the issues that carry an estimate, and counts the ones that do not", () => {
    const summary = summarize([issueId(485), ESTIMATING_ROW.id], SEEN);

    expect(summary.estMinutes).toBe(45);
    expect(summary.unestimated).toBe(1);
    expect(estimateLabel(summary)).toBe("· est. 45m combined autonomous work · 1 issue not sized yet");
  });

  it("says so rather than 0m when nothing selected has an estimate", () => {
    const summary = summarize([ESTIMATING_ROW.id], SEEN);

    expect(summary.estMinutes).toBeNull();
    expect(estimateLabel(summary)).toBe(NOT_SIZED_YET);
  });

  it("treats an issue the table never drew as one with no estimate", () => {
    // No path through the table selects an unseen row; the reading is the honest one anyway.
    const summary = summarize(["5eed0018-0000-4000-8000-000000000999"], SEEN);

    expect(summary.unestimated).toBe(1);
    expect(summary.estMinutes).toBeNull();
  });

  it("is empty over an empty selection", () => {
    expect(summarize([], SEEN)).toEqual({ count: 0, estMinutes: null, unestimated: 0, suggested: null });
  });
});

describe("the primary action's label", () => {
  it("names the chosen workflow", () => {
    expect(queueUnderLabel("docs-loop", summarize(SELECTED_TRIO, SEEN))).toBe("Queue → docs-loop");
  });

  it("names the one workflow the selection agrees on under use suggested — the mockup's own label", () => {
    expect(queueUnderLabel(null, summarize(SELECTED_TRIO, SEEN))).toBe("Queue → standard-fix");
  });

  it("says suggested under use suggested over a mixed selection", () => {
    const mixed = summarize([issueId(485), issueId(488)], SEEN);

    expect(mixed.suggested).toBeNull();
    expect(queueUnderLabel(null, mixed)).toBe(`Queue → ${SUGGESTED_TARGET}`);
  });

  it("says suggested when no selected issue has a workflow to agree on", () => {
    expect(queueUnderLabel(null, summarize([ESTIMATING_ROW.id], SEEN))).toBe("Queue → suggested");
  });
});

describe("offendersOf", () => {
  it("reads the contract's entries, in the service's order", () => {
    expect(
      offendersOf({
        issues: [
          { issueId: issueId(483), code: "issue_not_sized", issueNumber: 483, sizingStatus: "estimating" },
          { issueId: issueId(484), code: "issue_not_found" },
        ],
      }),
    ).toEqual([
      { issueId: issueId(483), code: "issue_not_sized", issueNumber: 483, sizingStatus: "estimating" },
      { issueId: issueId(484), code: "issue_not_found", issueNumber: null, sizingStatus: null },
    ]);
  });

  it("keeps nothing it cannot read as an entry, and draws no #NaN", () => {
    expect(offendersOf({ issues: [null, 42, { issueId: 7, code: "x" }, { issueId: "a" }] })).toEqual([]);
    expect(
      offendersOf({ issues: [{ issueId: "a", code: "issue_not_sized", issueNumber: "483", sizingStatus: 1 }] }),
    ).toEqual([{ issueId: "a", code: "issue_not_sized", issueNumber: null, sizingStatus: null }]);
  });

  it("answers nothing for details that are not about issues", () => {
    expect(offendersOf({})).toEqual([]);
    expect(offendersOf({ issues: "all of them" })).toEqual([]);
    expect(offendersOf(null)).toEqual([]);
    expect(offendersOf("details")).toEqual([]);
  });
});

describe("offenderLine", () => {
  /**
   * An entry, as the service would send it.
   *
   * @param number The issue's number, or `null` for an entry that carries none.
   * @param code What is wrong with it.
   * @param sizingStatus Its status, where the code carries one.
   * @returns The entry.
   */
  function offender(number: number | null, code: string, sizingStatus: string | null = null): Offender {
    return { issueId: number === null ? "elsewhere" : issueId(number), code, issueNumber: number, sizingStatus };
  }

  it("names a not-sized issue by what it is actually doing", () => {
    expect(offenderLine(offender(483, QUEUE_ISSUE_CODES.notSized, "estimating"), SEEN)).toBe(
      "#483 is still being sized.",
    );
    expect(offenderLine(offender(490, QUEUE_ISSUE_CODES.notSized, "needs_human"), SEEN)).toBe(
      "#490 needs a human before it can be queued.",
    );
    expect(offenderLine(offender(492, QUEUE_ISSUE_CODES.notSized, "unsized"), SEEN)).toBe(
      "#492 has not been sized yet.",
    );
    expect(offenderLine(offender(492, QUEUE_ISSUE_CODES.notSized), SEEN)).toBe("#492 has not been sized yet.");
  });

  it("names the other three the contract can answer", () => {
    expect(offenderLine(offender(485, QUEUE_ISSUE_CODES.estimateMissing), SEEN)).toBe(
      "#485 has lost its estimate — re-estimate it first.",
    );
    expect(offenderLine(offender(484, QUEUE_ISSUE_CODES.alreadyQueued), SEEN)).toBe("#484 is already in the queue.");
    expect(offenderLine(offender(484, QUEUE_ISSUE_CODES.numberTaken), SEEN)).toMatch(
      /^#484 is two issues in this selection/,
    );
  });

  it("names a 404 from the rows the table saw, since the entry carries no number", () => {
    expect(offenderLine({ ...offender(null, QUEUE_ISSUE_CODES.notFound), issueId: issueId(485) }, SEEN)).toBe(
      "#485 is not in this workspace.",
    );
  });

  it("says one of the selected issues when nothing on the page can name it", () => {
    expect(offenderLine(offender(null, QUEUE_ISSUE_CODES.notFound), SEEN)).toBe(
      "One of the selected issues is not in this workspace.",
    );
  });

  it("says a code it does not know as plainly as it can, and never prints the code", () => {
    const line = offenderLine(offender(485, "issue_frozen"), SEEN);

    expect(line).toBe("#485 cannot be queued.");
    expect(line).not.toContain("issue_frozen");
  });
});

describe("the dialog's other sentences", () => {
  it("is titled by what the transaction did", () => {
    expect(NOTHING_QUEUED_TITLE).toBe("Nothing was queued");
  });

  it("offers to deselect exactly the issues named", () => {
    expect(deselectLabel(1)).toBe("Deselect 1 issue");
    expect(deselectLabel(2)).toBe("Deselect 2 issues");
  });

  it("explains the rest of the selection by the all-or-nothing rule, and only when there is a rest", () => {
    expect(leftOutNote(3, 1)).toBe(
      "The queue takes a selection whole or not at all, so the other 2 issues were left out with it.",
    );
    expect(leftOutNote(3, 2)).toBe(
      "The queue takes a selection whole or not at all, so the other 1 issue was left out with them.",
    );
    expect(leftOutNote(2, 2)).toBeNull();
    expect(leftOutNote(1, 3)).toBeNull();
  });
});

describe("the toast", () => {
  it("prints the service's count and sum, not the preview's", () => {
    expect(queuedToast(queuedSelection(3, 125))).toBe("Queued 3 issues · est. 2h 5m combined autonomous work.");
    expect(queuedToast(queuedSelection(1, 45))).toBe("Queued 1 issue · est. 45m combined autonomous work.");
  });

  it("drops the estimate when the service summed nothing", () => {
    expect(queuedToast(queuedSelection(1, 0))).toBe("Queued 1 issue.");
  });

  it("links to the dashboard's queue card, by the fragment paths.ts owns", () => {
    expect(DASHBOARD_QUEUE_HREF).toBe(`${DASHBOARD_PATH}#${DASHBOARD_QUEUE_HASH}`);
  });
});
