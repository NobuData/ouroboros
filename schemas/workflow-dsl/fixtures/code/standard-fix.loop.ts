import { defineLoop, effort, route, trigger, llm, infra, decision, gate, openPr, backToQueue } from "@ouroboros/sdk";

export default defineLoop("standard-fix", {
  dsl: "1.0",
  trigger: {
    on: "issue.queued",
    when: (i) => i.effort.lte(effort.M),
  },
  stages: [
    trigger("issue-queued", {
      title: "Issue queued",
      description: "Runs when a sized issue with effort at most M reaches the queue.",
      next: "analyze",
    }),
    llm("analyze", {
      title: "Understand & scope",
      description: "Reads the issue against a map of the repository and states what the change touches.",
      skill: "repo-map",
      model: route.model("claude-sonnet-5"),
      retries: 2,
      tokenBudget: 200_000,
      permissions: { pushFixup: false, touchCi: false },
      prompt: `Scope the issue.

Issue: {{issue.title}}
Body:  {{issue.body}}

Name the files the change will touch and the risks you can see.`,
      next: "effort-recheck",
    }),
    decision("effort-recheck", {
      title: "Effort re-check",
      description: "Re-estimates after scoping; work that grew past M is split rather than attempted.",
      when: (i) => i.effort.lte(effort.M),
      branches: [
        { to: "plan", when: (i) => i.effort.lte(effort.M) },
        { to: "split", when: (i) => i.effort.gt(effort.M) },
      ],
    }),
    llm("plan", {
      title: "Write attack plan",
      description: "Turns the scope into an ordered plan the implement stage is held to.",
      model: route.model("claude-fable-5"),
      retries: 2,
      tokenBudget: 200_000,
      permissions: { pushFixup: false, touchCi: false },
      prompt: `Write the attack plan.

Scope: {{analyze}}

Order the steps and name every file each one touches.`,
      next: "implement",
    }),
    llm("split", {
      title: "Split into subtasks",
      description: "Creates linked issues for work that is larger than this loop accepts.",
      model: route.task("split"),
      retries: 1,
      tokenBudget: 120_000,
      permissions: { pushFixup: false, touchCi: false },
      prompt: `Split the issue into subtasks no larger than M.

Issue: {{issue.title}}
Scope: {{analyze}}`,
      next: "back-to-queue",
    }),
    backToQueue("back-to-queue", {
      title: "Back to queue",
      description: "The split subtasks are queued and this run ends.",
    }),
    llm("implement", {
      title: "Code the change",
      description: "Writes the change described by the attack plan onto a fresh branch.",
      skill: "zephyr-conventions",
      model: route.task("implement"),
      retries: 2,
      tokenBudget: 400_000,
      permissions: { pushFixup: true, touchCi: false },
      prompt: `Implement the approved plan.

Issue: {{issue.title}}
Plan:  {{plan}}
Rules: touch only files named in the plan; follow the skill.`,
      next: "build",
    }),
    infra("build", {
      title: "Build farm · pool A",
      description: "Builds the branch on the pool the workspace reserves for this loop.",
      farm: "pool-a",
      next: "test",
    }),
    infra("test", {
      title: "Run test suite",
      description: "Runs the suite the repository declares for a native build.",
      farm: "pool-a",
      cmd: "twister -p native_sim",
      next: "review",
    }),
    llm("review", {
      title: "Self-review diff",
      description: "Reads its own diff against the plan before anything is offered for merge.",
      model: route.model("claude-fable-5"),
      retries: 1,
      tokenBudget: 200_000,
      permissions: { pushFixup: true, touchCi: false },
      prompt: `Review the diff against the plan.

Plan: {{plan}}
Diff: {{diff}}

Report anything the plan did not ask for.`,
      next: "checks-green",
    }),
    gate("checks-green", {
      title: "Checks green?",
      description: "Holds until build, test and review all pass; a failure returns to implement.",
      require: ["build", "test", "review"],
      branches: [
        { to: "open-pr", when: (i) => i.checks.allPassed() },
      ],
      onFail: "implement",
    }), // the loop bites its tail
    openPr("open-pr", {
      title: "Open PR & auto-merge",
      description: "Opens the pull request and lets it merge itself once the required checks are green.",
      merge: "squash",
      deleteBranch: true,
    }),
  ],
});

// Round-trips with the visual canvas: every node on the graph is one
// stage call above, and `onFail` is the declared back-edge that
// closes the loop. Publishing writes the next version for both editors.

// @ouroboros/layout v1 — generated; the canvas owns these lines
// node issue-queued 24 40
// node analyze 306 40
// node effort-recheck 588 40
// node plan 588 230
// node split 306 230
// node back-to-queue 32 260
// node implement 588 420
// node build 306 420
// node test 24 420
// node review 24 630
// node checks-green 306 630
// node open-pr 588 630
// edge issue-queued analyze
// edge analyze effort-recheck
// edge effort-recheck plan "≤ M ↓"
// edge effort-recheck split "> M ↘"
// edge split back-to-queue
// edge plan implement
// edge implement build
// edge build test
// edge test review
// edge review checks-green
// edge checks-green open-pr "pass →"
// edge checks-green implement "fail ↺"
