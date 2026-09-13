import { defineLoop, effort, trigger, decision, openPr, backToQueue, needsReview } from "@ouroboros/sdk";

export default defineLoop("predicate-kinds", {
  dsl: "1.0",
  trigger: {
    on: "issue.queued",
    when: (i) => i.effort.lte(effort.L) && i.labels.all(["bug", "regression"]) && i.source.is("github"),
  },
  stages: [
    trigger("start", {
      title: "Issue queued",
      next: "route",
    }),
    decision("route", {
      title: "Which path?",
      when: () => true,
      branches: [
        { to: "small", when: (i) => i.effort.lte(effort.S) },
        { to: "labelled", when: (i) => i.labels.any(["regression"]) },
        { to: "foreign", when: (i) => i.source.notIn(["github"]) },
        { to: "verified", when: () => true },
      ],
    }),
    needsReview("small", {
      title: "Needs review",
    }),
    backToQueue("labelled", {
      title: "Back to queue",
    }),
    openPr("foreign", {
      title: "Open PR",
      merge: "rebase",
      deleteBranch: false,
    }),
    openPr("verified", {
      title: "Merge",
      merge: "merge",
      deleteBranch: true,
    }),
  ],
});

// Round-trips with the visual canvas: every node on the graph is one
// stage call above, and `onFail` is the declared back-edge that
// closes the loop. Publishing writes the next version for both editors.

// @ouroboros/layout v1 — generated; the canvas owns these lines
// node start 0 0
// node route 240 0
// node small 480 0
// node labelled 480 120
// node foreign 480 240
// node verified 480 360
// edge start route
// edge route small "≤ S"
// edge route labelled "regressions"
// edge route foreign "not GitHub"
// edge route verified "otherwise"
