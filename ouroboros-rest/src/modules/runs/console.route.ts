/**
 * Which route a stage's spend is capped by — read out of the run's pinned workflow.
 *
 * AP.2 ([#304](https://github.com/NobuData/ouroboros/issues/304)), decision **R8**: the Resources
 * card's `$2.50 cap` is `routes.max_cost_cents_per_run` (Z.1, #194), and a route belongs to a
 * **task kind**. What joins a run to a task kind is its pinned document: a model stage's
 * `config.routing` either *inherits a task's route* — `{"inherit_task": "implement"}` — or *pins a
 * model* — `{"pinned_model": {"alias": "coder-max"}}` (`docs/WORKFLOW_DSL.md`). Only the first
 * has a route, so only the first has a cap; a pinned stage is answered as *no cap* rather than
 * with some other route's.
 *
 * Like `guardrails/guardrails.policy.ts`, this **reads** rather than validates: a stored version
 * passed the publish gate, and a document or node this reader cannot parse yields `undefined`,
 * which the card renders as count-only rather than as a `500`.
 */

import { NodeShapeSchema, WorkflowRootSchema } from "../workflows/dsl.schema";

/**
 * The task kind a stage inherits its route from.
 *
 * @param definition - `workflow_versions.definition`, as the database returns it.
 * @param stageKey - The DSL node id — `run_stages.stage_key`.
 * @returns The `inherit_task` name, or `undefined` when the document is unreadable, the node is
 *   absent, or the node pins a model instead of inheriting a route.
 */
export function inheritedTaskOf(definition: unknown, stageKey: string): string | undefined {
  const root = WorkflowRootSchema.safeParse(definition);

  if (!root.success) {
    return undefined;
  }

  for (const candidate of root.data.nodes) {
    const node = NodeShapeSchema.safeParse(candidate);

    if (!node.success || node.data.id !== stageKey) {
      continue;
    }

    const routing = node.data.config.routing;

    if (typeof routing !== "object" || routing === null) {
      return undefined;
    }

    const task = (routing as Record<string, unknown>).inherit_task;

    return typeof task === "string" && task !== "" ? task : undefined;
  }

  return undefined;
}
