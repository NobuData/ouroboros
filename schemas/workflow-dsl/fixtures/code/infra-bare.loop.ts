import { defineLoop, trigger, infra, needsReview } from "@ouroboros/sdk";

export default defineLoop("infra-bare", {
  dsl: "1.0",
  trigger: {
    on: "issue.queued",
  },
  stages: [
    trigger("start", {
      title: "Issue queued",
      next: "build",
    }),
    infra("build", {
      title: "Build",
      description: "Neither a pool nor a command: the repository's defaults on the default pool.",
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
// node build 240 0
// node done 480 0
// edge start build
// edge build done
