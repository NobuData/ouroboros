import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COUNTS_UNREAD,
  ISSUES_EYEBROW,
  ISSUES_SUBLINE,
  NOTHING_QUEUED,
  QUEUE_FAILED,
  QUEUE_NOTHING_SELECTED,
  QUEUE_ROLE_REASON,
  REESTIMATE_LABEL,
  REESTIMATE_NOTHING,
  REESTIMATE_UNCOUNTED,
  backlogCounts,
  fanoutOutcome,
  headline,
  issueCount,
  queueLabel,
  queueReason,
  queueRefusal,
  queuedOutcome,
  reestimateConfirmLabel,
  reestimateRateLimited,
  reestimateReason,
  reestimateScope,
} from "@/app/issues/view";

import { UNCOUNTED, backlogListing, counted, fanout, queuedSelection } from "../helpers/issues";

/**
 * The intake page head's copy and its decisions (#115).
 *
 * Two kinds of truth, as `__tests__/registry/view.test.ts` holds for its page. The **copy** is
 * compared with `docs/mockups/03-issues.html` itself rather than with a string typed twice: the
 * eyebrow, the subline and both labels verbatim, and the headline as *the mockup's sentence over
 * the mockup's own figures* — which is what proves the sentence is the mockup's while the numbers
 * on the real page are the service's. The **decisions** are the inert reasons and the outcomes, and
 * the one worth the most care is which count the re-estimate confirmation states.
 */

/** The mockup this page is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "03-issues.html"),
  "utf8",
);

/** The mockup's page head alone — from `page-head` to the filter bar that follows it. */
const HEAD = MOCKUP.slice(
  MOCKUP.indexOf('<div class="page-head">'),
  MOCKUP.indexOf("<!-- filter bar -->"),
);

/**
 * The text of the first element in the mockup's head matching a pattern.
 *
 * @param pattern A pattern whose first group is the element's inner HTML.
 * @returns That HTML as a reader sees it: tags dropped, `&nbsp;` read as a space, runs of
 *   whitespace collapsed — the mockup spaces its glyph with `&nbsp; ⟳`, which is layout, not copy.
 * @throws {Error} When the head has no such element, so a mockup edit fails loudly here.
 */
function mockupText(pattern: RegExp): string {
  const match = pattern.exec(HEAD);
  if (match === null) throw new Error(`The mockup's page head has nothing matching ${pattern}.`);

  return match[1]!
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the copy, against the mockup", () => {
  it("takes the eyebrow verbatim", () => {
    expect(ISSUES_EYEBROW).toBe(mockupText(/<div class="eyebrow">([\s\S]*?)<\/div>/));
  });

  it("takes the headline's sentence verbatim, with the figures as inputs", () => {
    // The mockup's 42 and 38 are design copy. Fed back in, they must reproduce its h1 exactly —
    // which is the sentence being the mockup's while the real page's numbers are the service's.
    expect(headline(counted({ openCount: 42, sizedCount: 38 }))).toBe(
      mockupText(/<h1>([\s\S]*?)<\/h1>/),
    );
  });

  it("takes the subline verbatim", () => {
    expect(ISSUES_SUBLINE).toBe(mockupText(/<p class="sub">([\s\S]*?)<\/p>/));
  });

  it("labels the ghost action as the mockup does", () => {
    expect(REESTIMATE_LABEL).toBe(mockupText(/<button class="btn ghost">([\s\S]*?)<\/button>/));
  });

  it("labels the primary action as the mockup does, with its figure as the selection count", () => {
    expect(queueLabel(3)).toBe(mockupText(/<button class="btn primary">([\s\S]*?)<\/button>/));
  });
});

describe("the headline", () => {
  it("reads the seeded workspace as the issue says it should", () => {
    // #115's first acceptance criterion: "against the seeds this reads 9 open issues. 7 already
    // sized."
    expect(headline(counted())).toBe("9 open issues. 7 already sized.");
  });

  it("agrees the noun with a count of one", () => {
    expect(headline(counted({ openCount: 1, sizedCount: 1 }))).toBe(
      "1 open issue. 1 already sized.",
    );
  });

  it("draws an empty backlog as the zeros it is", () => {
    // A read that succeeded and counted nothing is a true zero, unlike a read that failed.
    expect(headline(counted({ openCount: 0, sizedCount: 0 }))).toBe(
      "0 open issues. 0 already sized.",
    );
  });

  it("groups a large count the way a person reads one", () => {
    expect(headline(counted({ openCount: 1204, sizedCount: 1180 }))).toBe(
      "1,204 open issues. 1,180 already sized.",
    );
  });

  it("says the backlog could not be counted, with no figure standing in", () => {
    expect(headline(UNCOUNTED)).toBe(COUNTS_UNREAD);
    expect(headline(UNCOUNTED)).not.toMatch(/\d/);
  });
});

describe("backlogCounts", () => {
  it("takes the head's two figures from the view's meta, which the contract scopes by repository", () => {
    // A repository selected in the bar: the view counts three, the workspace still mirrors nine.
    expect(
      backlogCounts(backlogListing({ openCount: 3, sizedCount: 2, total: 3 }), backlogListing()),
    ).toEqual({
      openCount: 3,
      sizedCount: 2,
      mirroredCount: 9,
    });
  });

  it("takes the mirrored count from the scope's total, which differs from the open count once one closes", () => {
    // The scope listing is asked for `state=all`, so its `total` is every mirrored issue — the
    // set `estimate-all` claims from — while `meta.openCount` stays the open ones.
    expect(backlogCounts(backlogListing(), backlogListing({ openCount: 9, total: 12 }))).toEqual({
      openCount: 9,
      sizedCount: 7,
      mirroredCount: 12,
    });
  });
});

describe("issueCount", () => {
  it("agrees the noun with the count", () => {
    expect(issueCount(0)).toBe("0 issues");
    expect(issueCount(1)).toBe("1 issue");
    expect(issueCount(9)).toBe("9 issues");
  });
});

describe("Queue N selected ⟳", () => {
  it("carries the selection's count in its label", () => {
    expect(queueLabel(0)).toBe("Queue 0 selected ⟳");
    expect(queueLabel(1)).toBe("Queue 1 selected ⟳");
    expect(queueLabel(1204)).toBe("Queue 1,204 selected ⟳");
  });

  it("may be pressed by a contributor with something selected", () => {
    expect(queueReason(3, true)).toBeUndefined();
  });

  it("is inert at zero, and names the issue that builds the table a selection is made in", () => {
    expect(queueReason(0, true)).toBe(QUEUE_NOTHING_SELECTED);
    expect(QUEUE_NOTHING_SELECTED).toMatch(/#117/);
  });

  it("is inert for a viewer whatever is selected, and says so before anything about selecting", () => {
    // Telling a viewer to select issues would send them to do something that ends in a refusal.
    expect(queueReason(3, false)).toBe(QUEUE_ROLE_REASON);
    expect(queueReason(0, false)).toBe(QUEUE_ROLE_REASON);
  });

  it("reports a press that took by the rows the service created", () => {
    expect(queuedOutcome(queuedSelection(3))).toBe("Queued 3 issues.");
    expect(queuedOutcome(queuedSelection(1))).toBe("Queued 1 issue.");
  });

  it("reports a refusal in the service's words, and that nothing was queued", () => {
    // All or nothing: every refusal took nothing, and the reader should not have to guess which
    // of the selection went through.
    expect(queueRefusal("Some of those issues have not been sized yet.")).toBe(
      `Some of those issues have not been sized yet. ${NOTHING_QUEUED}`,
    );
  });

  it("falls back to its own sentence when the service gave none", () => {
    expect(queueRefusal("")).toBe(`${QUEUE_FAILED} ${NOTHING_QUEUED}`);
  });
});

describe("Re-estimate all", () => {
  it("may be pressed when the backlog was counted and holds something", () => {
    expect(reestimateReason(counted())).toBeUndefined();
  });

  it("is inert when the backlog could not be counted, since the dialog would have no number", () => {
    expect(reestimateReason(UNCOUNTED)).toBe(REESTIMATE_UNCOUNTED);
  });

  it("is inert for a workspace that mirrors nothing", () => {
    expect(reestimateReason(counted({ openCount: 0, sizedCount: 0, mirroredCount: 0 }))).toBe(
      REESTIMATE_NOTHING,
    );
  });

  it("is offered when every issue is closed, because closed issues are re-estimated too", () => {
    expect(
      reestimateReason(counted({ openCount: 0, sizedCount: 0, mirroredCount: 4 })),
    ).toBeUndefined();
  });

  it("states its scope as a count of issues", () => {
    expect(reestimateScope(9)).toBe("This re-estimates 9 issues.");
    expect(reestimateScope(1)).toBe("This re-estimates 1 issue.");
  });

  it("puts the same count on the control that commits to it", () => {
    expect(reestimateConfirmLabel(9)).toBe("Re-estimate 9 issues");
    expect(reestimateConfirmLabel(1)).toBe("Re-estimate 1 issue");
  });

  it("reports a press that started everything", () => {
    expect(fanoutOutcome(fanout())).toBe("Re-estimating 9 issues.");
  });

  it("reports what it left alone, since that is why fewer started than the dialog counted", () => {
    expect(fanoutOutcome(fanout({ enqueued: 7, skipped: 2 }))).toBe(
      "Re-estimating 7 issues. 2 issues already being estimated were left alone.",
    );
    expect(fanoutOutcome(fanout({ enqueued: 8, skipped: 1 }))).toBe(
      "Re-estimating 8 issues. 1 issue already being estimated was left alone.",
    );
  });

  it("reports an empty backlog as having nothing to do, not as a failure", () => {
    expect(fanoutOutcome({ enqueued: 0, skipped: 0, total: 0 })).toMatch(/nothing to re-estimate/);
  });

  it("gives a rate-limited reader the wait in whole seconds", () => {
    expect(reestimateRateLimited(24)).toMatch(/Try again in 24 seconds\.$/);
    expect(reestimateRateLimited(1)).toMatch(/Try again in 1 second\.$/);
    expect(reestimateRateLimited(0.4)).toMatch(/Try again in 1 second\.$/);
  });

  it("says 'shortly' when the refusal carries no wait anybody can act on", () => {
    for (const wait of [undefined, null, "24", Number.NaN, 0, -3]) {
      expect(reestimateRateLimited(wait)).toMatch(/Try again shortly\.$/);
    }
  });
});
