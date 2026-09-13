import { defineLoop, effort, trigger, needsReview } from "@ouroboros/sdk";

export default defineLoop("malformed-predicate", {
  dsl: "1.0",
  trigger: {
    on: "issue.queued",
    when: (i) => i.effort <= effort.M,
  },
  stages: [
    trigger("start", {
      title: "Issue queued",
      next: "done",
    }),
    needsReview("done", {
      title: "Needs review",
    }),
  ],
});

// Round-trips with the visual canvas: every node on the graph is one
// stage call above, and `onFail` is the declared back-edge that
// closes the loop. Publishing writes the next version for both editors.

// @ouroboros/layout v1 — generated; the canvas owns these lines
// node start 0 0
// node done 240 0
// edge start done
