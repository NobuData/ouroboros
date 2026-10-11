/**
 * The seeded dry run, as CD.5's rule pack reads it — `security-patch` at draft `v0.3` against
 * `#489` (`R__dev_seed_workspace_copilot.sql`, `R__dev_seed_workspace_replay.sql`).
 *
 * The draft, the result rows and the replay totals are the development seed's own; the two
 * expectations at the bottom are the seed's two `dry_run_suggestions` rows. The seed files and
 * this fixture are held together by `suggestions.seed.spec.ts` on this side and by
 * `ouroboros-db/tests/seed.sql` on the other.
 */

import type { DryRunStage, StoredDraftOperation } from "../db/schema";
import type { DslCatalogue } from "../workflows/dsl.references";
import { effectiveBudget } from "./dry-runs.budget";
import type { ReplayStatistics, RuleInput } from "./suggestions.rules";

const LIMITS = { permissions: { push_fixup: false, touch_ci: false } };

/** A model stage of the seeded draft. */
function llm(
  id: string,
  title: string,
  position: { x: number; y: number },
  config: Record<string, unknown>,
) {
  return { id, type: "llm", title, position, config: { mode: "prompt", ...config, ...LIMITS } };
}

export const REVIEW_PRIMARY = llm(
  "review-primary",
  "review",
  { x: -160, y: 840 },
  {
    prompt_template: "Review the patch against the advisory and the acceptance criteria.",
    routing: { pinned_model: { alias: "coder-max" } },
    limits: { max_retries: 0, token_budget: 150000 },
  },
);

export const REVIEW_SECOND = llm(
  "review-second",
  "review",
  { x: 160, y: 840 },
  {
    prompt_template: "Give an independent second review of the patch.",
    routing: { pinned_model: { alias: "second-opinion" } },
    limits: { max_retries: 0, token_budget: 150000 },
  },
);

/** `security-patch` at `v0.3`. */
export const SEEDED_DRAFT = {
  dsl_version: "1.0",
  trigger: { event: "ticket_queued", conditions: { labels: ["security"] } },
  nodes: [
    { id: "trigger", type: "trigger", title: "trigger", position: { x: 0, y: 0 }, config: {} },
    llm(
      "analyze",
      "analyze",
      { x: 0, y: 120 },
      {
        mode: "skill",
        skill: "advisory-db",
        prompt_template: "Map the code paths {{issue.title}} touches.",
        routing: { pinned_model: { alias: "coder-std" } },
        limits: { max_retries: 1, token_budget: 200000 },
      },
    ),
    llm(
      "plan",
      "plan",
      { x: 0, y: 240 },
      {
        prompt_template: "Plan the patch for {{issue.title}} in small, reviewable steps.",
        routing: { pinned_model: { alias: "coder-max" } },
        limits: { max_retries: 1, token_budget: 200000 },
      },
    ),
    llm(
      "implement",
      "implement",
      { x: 0, y: 360 },
      {
        prompt_template: "Implement the plan; keep the diff to what the plan names.",
        routing: { inherit_task: "implement" },
        limits: { max_retries: 2, token_budget: 400000 },
      },
    ),
    {
      id: "build",
      type: "infra",
      title: "build",
      position: { x: 0, y: 480 },
      config: { runner_pool: "pool-a" },
    },
    {
      id: "test",
      type: "infra",
      title: "test",
      position: { x: 0, y: 600 },
      config: { runner_pool: "pool-a", command: "west twister --all" },
    },
    REVIEW_PRIMARY,
    REVIEW_SECOND,
    {
      id: "open-pr",
      type: "term",
      title: "open PR",
      position: { x: 0, y: 960 },
      config: { action: "needs_review", options: {} },
    },
    llm(
      "exploit-verify",
      "exploit-verify",
      { x: 0, y: 720 },
      {
        prompt_template: "Re-run the CVE proof-of-concept against the patched build.",
        routing: { inherit_task: "exploit-verify" },
        limits: { max_retries: 0, token_budget: 100000 },
      },
    ),
  ],
  edges: [
    { from: "trigger", to: "analyze", kind: "default" },
    { from: "analyze", to: "plan", kind: "default" },
    { from: "plan", to: "implement", kind: "default" },
    { from: "implement", to: "build", kind: "default" },
    { from: "build", to: "test", kind: "default" },
    { from: "review-primary", to: "open-pr", kind: "default" },
    { from: "review-second", to: "open-pr", kind: "default" },
    { from: "test", to: "exploit-verify", kind: "default" },
    { from: "exploit-verify", to: "review-primary", kind: "default" },
    { from: "exploit-verify", to: "review-second", kind: "default" },
  ],
};

/** The names the seeded workspace defines — `advisory-db` and the `exploit-verify` task are not among them. */
export const SEEDED_CATALOGUE: DslCatalogue = {
  skills: ["pr-etiquette", "zephyr-style"],
  aliases: ["coder-std", "coder-max", "second-opinion"],
  tasks: ["implement", "review"],
};

/**
 * One result row.
 *
 * @param seq - Its position.
 * @param key - Its key and name.
 * @param overrides - Fields to change.
 * @returns The row, `ok` unless overridden.
 */
export function stageRow(
  seq: number,
  key: string,
  overrides: Partial<DryRunStage> = {},
): DryRunStage {
  return {
    id: `stage-${String(seq)}`,
    organization_id: "acme-robotics-id",
    dry_run_id: "5eed008b-0000-4000-8000-000000000001",
    seq,
    stage_key: key,
    display_name: key,
    verdict: "ok",
    how: "llm",
    note: `${key} done`,
    metrics: {},
    skip_reason: null,
    skip_kind: null,
    skip_input: null,
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

/** The seeded run's seven rows. */
export const SEEDED_STAGES: DryRunStage[] = [
  stageRow(1, "analyze", { metrics: { tokens: 18200, cost_cents: 6, files_touched: 4 } }),
  stageRow(2, "plan", { metrics: { tokens: 12400, cost_cents: 5 } }),
  stageRow(3, "implement", { metrics: { tokens: 84000, cost_cents: 14, simulated_writes: 1 } }),
  stageRow(4, "build", { how: "replayed", metrics: { estimate_ms: 220000, sample_count: 204 } }),
  stageRow(5, "exploit-verify", {
    verdict: "skipped",
    how: "skipped",
    note: "no PoC exists: stage had nothing to do",
    skip_reason: "no PoC exists: stage had nothing to do",
    skip_kind: "nothing_to_do",
    skip_input: "cve",
  }),
  stageRow(6, "review", { display_name: "review ×2", metrics: { tokens: 16600, cost_cents: 6 } }),
  stageRow(7, "open-pr", { verdict: "not_reached", how: "deterministic", note: "" }),
];

/** The ten seeded `review_replay_pairs`, counted. */
export const SEEDED_REPLAY: ReplayStatistics = {
  replaySet: "5eed008d-0000-4000-8000-000000000000",
  reviewerStages: ["review-primary", "review-second"],
  pairs: 10,
  styleDisagreements: 6,
  substanceDisagreements: 0,
};

/**
 * The seeded run as the pack reads it.
 *
 * @param overrides - Fields to change.
 * @returns The input: `$0.31` of a `$5.00` draft guard, #489, the draft at `v0.3`.
 */
export function seededInput(overrides: Partial<RuleInput> = {}): RuleInput {
  return {
    run: { status: "complete", costCents: 31 },
    stages: SEEDED_STAGES,
    ticket: { key: "#489", labels: ["bug", "can-bus"] },
    draft: SEEDED_DRAFT,
    budget: effectiveBudget(1000, 500),
    catalogue: SEEDED_CATALOGUE,
    unresolved: [],
    replay: SEEDED_REPLAY,
    ...overrides,
  };
}

/** The 93% row's operations, as `R__dev_seed_workspace_replay.sql` writes them. */
export const SEEDED_CONDITIONAL_OPS: StoredDraftOperation[] = [
  {
    kind: "add_stage",
    params: {
      node: {
        id: "has-cve",
        type: "flow",
        title: "has CVE?",
        position: { x: 0, y: 660 },
        config: {
          kind: "decision",
          predicate: { kind: "labels", op: "any", values: ["cve"] },
        },
      },
    },
  },
  { kind: "remove_edge", params: { from: "test", to: "exploit-verify" } },
  { kind: "add_edge", params: { edge: { from: "test", to: "has-cve", kind: "default" } } },
  {
    kind: "add_edge",
    params: {
      edge: {
        from: "has-cve",
        to: "exploit-verify",
        kind: "branch",
        label: "cve",
        condition: { kind: "labels", op: "any", values: ["cve"] },
      },
    },
  },
  {
    kind: "add_edge",
    params: {
      edge: {
        from: "has-cve",
        to: "review-primary",
        kind: "branch",
        label: "no cve",
        condition: { kind: "labels", op: "none", values: ["cve"] },
      },
    },
  },
  {
    kind: "add_edge",
    params: {
      edge: {
        from: "has-cve",
        to: "review-second",
        kind: "branch",
        label: "no cve",
        condition: { kind: "labels", op: "none", values: ["cve"] },
      },
    },
  },
];
