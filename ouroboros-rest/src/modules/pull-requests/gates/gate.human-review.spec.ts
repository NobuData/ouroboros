import { NO_HUMAN_REVIEW, matchHumanReview } from "./gate.human-review";

/**
 * The org policy's `human_review` rule (#461, the #358 amendment): *anything labeled refactor needs
 * a human* — whether a review is required, and which label the policy matched.
 */

/** Policy v7's rule, as `R__dev_seed_workspace_settings.sql` publishes it. */
const POLICY_V7 = {
  enabled: true,
  conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] },
};

describe("matchHumanReview", () => {
  it("requires a review of a refactor-labelled PR, and names the label", () => {
    expect(matchHumanReview(POLICY_V7, { labels: ["bug", "refactor"], effort: "s" })).toEqual({
      required: true,
      label: "refactor",
    });
  });

  it("requires a review of a large PR, but names no label for a match on effort alone", () => {
    expect(matchHumanReview(POLICY_V7, { labels: ["bug"], effort: "xl" })).toEqual({
      required: true,
      label: null,
    });
  });

  it("requires nothing of a small unlabelled PR, nor of an unestimated one", () => {
    expect(matchHumanReview(POLICY_V7, { labels: ["bug"], effort: "m" })).toEqual(NO_HUMAN_REVIEW);
    expect(matchHumanReview(POLICY_V7, { labels: [], effort: undefined })).toEqual(NO_HUMAN_REVIEW);
  });

  it("requires nothing when the rule is off, or the workspace published no policy", () => {
    expect(
      matchHumanReview({ ...POLICY_V7, enabled: false }, { labels: ["refactor"], effort: "s" }),
    ).toEqual(NO_HUMAN_REVIEW);
    expect(matchHumanReview(null, { labels: ["refactor"], effort: "s" })).toEqual(NO_HUMAN_REVIEW);
    expect(matchHumanReview(undefined, { labels: ["refactor"], effort: "s" })).toEqual(
      NO_HUMAN_REVIEW,
    );
  });

  it("never names a label from under a not", () => {
    const rule = {
      enabled: true,
      conditions: { all: [{ not: { label: "docs" } }, { effort_lte: "m" }] },
    };

    expect(matchHumanReview(rule, { labels: [], effort: "s" })).toEqual({
      required: true,
      label: null,
    });
    expect(matchHumanReview(rule, { labels: ["docs"], effort: "s" })).toEqual(NO_HUMAN_REVIEW);
  });

  it("composes all, any and not, and takes the first positive label in document order", () => {
    const rule = {
      enabled: true,
      conditions: {
        all: [{ any: [{ label: "security" }, { label: "refactor" }] }, { effort_gte: "s" }],
      },
    };

    expect(matchHumanReview(rule, { labels: ["refactor", "security"], effort: "m" })).toEqual({
      required: true,
      label: "security",
    });
    expect(matchHumanReview(rule, { labels: ["refactor"], effort: "xs" })).toEqual(NO_HUMAN_REVIEW);
  });

  it("matches nothing for a predicate it does not recognise, rather than guessing", () => {
    for (const conditions of [
      { label: 7 },
      { effort_gte: "huge" },
      { any: [] },
      { any: [{ label: "refactor" }, { path_globs: ["boot/**"] }] },
      { label: "refactor", effort_gte: "l" },
      [],
      null,
    ]) {
      expect(
        matchHumanReview({ enabled: true, conditions }, { labels: ["refactor"], effort: "xl" }),
      ).toEqual(NO_HUMAN_REVIEW);
    }
  });
});
