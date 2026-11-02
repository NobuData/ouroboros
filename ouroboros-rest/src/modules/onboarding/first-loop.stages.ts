/**
 * Which stage of a first loop's pinned workflow is its *plan* (BD.1,
 * [#396](https://github.com/NobuData/ouroboros/issues/396)) — the wizard's timeline marks *draft
 * plan posted* when that stage's first attempt finishes.
 */

import { NodeShapeSchema, WorkflowRootSchema } from "../workflows/dsl.schema";

/**
 * The node id of the first model (`llm`) stage of a definition, in document order — the stage key
 * the run console reports it under.
 *
 * @param definition - A `workflow_versions.definition`.
 * @returns The id, or `undefined` when the document does not read or has no model stage.
 */
export function firstModelStageKey(definition: unknown): string | undefined {
  const root = WorkflowRootSchema.safeParse(definition);

  if (!root.success) {
    return undefined;
  }

  for (const candidate of root.data.nodes) {
    const node = NodeShapeSchema.safeParse(candidate);

    if (node.success && node.data.type === "llm") {
      return node.data.id;
    }
  }

  return undefined;
}
