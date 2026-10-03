import { defineLoop, trigger, infra, decision, openPr } from "@ouroboros/sdk";

export default defineLoop("change-paths", {
  dsl: "1.0",
  trigger: {
    on: "issue.queued",
  },
  stages: [
    trigger("start", {
      title: "Issue queued",
      next: "touches-can",
    }),
    decision("touches-can", {
      title: "Touches drivers/can/?",
      when: (i) => i.paths.any(["drivers/can/**"]),
      branches: [
        { to: "flake-retry", when: (i) => i.paths.any(["drivers/can/**"]) },
        { to: "merge", when: (i) => i.paths.none(["drivers/can/**", ".github/workflows/can-*.yml"]) },
      ],
    }),
    infra("flake-retry", {
      title: "Flake-retry under load",
      farm: "hil-can",
      cmd: "make test-can-load RETRIES=3",
      next: "merge",
    }),
    openPr("merge", {
      title: "Merge",
      merge: "squash",
      deleteBranch: true,
    }),
  ],
});

// Round-trips with the visual canvas: every node on the graph is one
// stage call above, and `onFail` is the declared back-edge that
// closes the loop. Publishing writes the next version for both editors.

// @ouroboros/layout v1 — generated; the canvas owns these lines
// node start 0 0
// node touches-can 240 0
// node flake-retry 480 0
// node merge 720 120
// edge start touches-can
// edge touches-can flake-retry "touches CAN"
// edge touches-can merge "elsewhere"
// edge flake-retry merge
