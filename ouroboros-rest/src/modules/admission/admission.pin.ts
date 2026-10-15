/**
 * What admission needs to know about a pinned workflow version (DI.4, #1312): whether it reads
 * at all, and which routes its model stages inherit.
 *
 * ```
 * not a workflow document                  → undefined (workflow_unpublished)
 * llm node, routing.inherit_task <task>    → <task> is a route the item needs to resolve
 * llm node, routing.pinned_model {alias}   → no route; the workspace-wide connection check covers it
 * llm node whose config does not parse     → undefined: a version the publish gate would refuse
 * ```
 */

import { LlmConfigSchema, NodeShapeSchema, WorkflowRootSchema } from "../workflows/dsl.schema";

/**
 * The task kinds a pinned definition's model stages inherit their routes from.
 *
 * @param definition - `workflow_versions.definition`, as stored.
 * @returns The distinct task kinds in document order, or `undefined` when the definition does
 *   not read as a workflow a run could execute.
 */
export function pinnedTaskKinds(definition: unknown): readonly string[] | undefined {
  const root = WorkflowRootSchema.safeParse(definition);

  if (!root.success || root.data.nodes.length === 0) {
    return undefined;
  }

  const tasks = new Set<string>();

  for (const candidate of root.data.nodes) {
    const node = NodeShapeSchema.safeParse(candidate);

    if (!node.success) {
      return undefined;
    }

    if (node.data.type !== "llm") {
      continue;
    }

    const config = LlmConfigSchema.safeParse(node.data.config);

    if (!config.success) {
      return undefined;
    }

    if (config.data.routing.inherit_task !== undefined) {
      tasks.add(config.data.routing.inherit_task);
    }
  }

  return [...tasks];
}
