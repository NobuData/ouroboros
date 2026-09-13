import { defineLoop, trigger, needsReview, stage } from "@ouroboros/sdk";

export default defineLoop("three-mistakes", {
  dsl: "1.0",
  trigger: {
    on: "issue.queued",
  },
  stages: [
    trigger("start", {
      title: "Issue queued"
      next: "done",
    }),
    needsReview("done", {
      title: "Needs review",
      retries: 2,
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
