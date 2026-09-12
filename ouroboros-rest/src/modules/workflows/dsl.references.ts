/**
 * Decision **P7**, in full: skill, model and task-route references are validated *strings*,
 * and an unknown one is a warning ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * The model registry (mockups 06/21) and the skills catalogue (mockup 14) do not exist. A
 * foreign key to a table nobody has written is not a stricter design, it is a design that
 * cannot be built; and refusing to save a workflow because it names a skill the workspace
 * has not defined yet would make the editor unusable during exactly the period the skill is
 * being defined. So the reference is stored as written, and whether it resolves is a
 * question asked at validation, answered as a warning, and rendered by the inspector as a
 * flag on the field rather than as a block on the Publish button.
 *
 * **The caller supplies the vocabulary.** This module holds no list of skills and no list of
 * models, so it cannot invent one — the same shape `ouroboros-engine`'s `EstimationContext`
 * takes for the same reason (decisions K5 and K6). A caller that supplies no catalogue gets
 * no warnings of this kind, which is the honest answer to *is this reference known?* when
 * nothing in the system knows. When P.4 and the model registry land, the catalogue gets a
 * real source and these warnings start firing with no change here.
 *
 * `runner_pool` is deliberately not checked. Which pools exist is a property of a
 * deployment's build farm (mockup 08), not of the workspace's catalogues, and a warning
 * against a list this service does not have would be noise on every document.
 */

import type { DslDiagnostic } from "./dsl.errors";
import { DslWarningCode, pointer } from "./dsl.errors";
import type { WorkflowDocument } from "./dsl.schema";

/**
 * The names that exist, as the caller knows them.
 *
 * Every member is optional and an absent one means *not checked*, which is different from an
 * empty one meaning *nothing is known*. A caller that can enumerate skills but not models
 * says so by supplying only `skills`.
 */
export interface DslCatalogue {
  /** Every skill the workspace has defined. */
  skills?: readonly string[];
  /** Every model identifier the registry resolves. */
  models?: readonly string[];
  /** Every task name the routing table has a route for. */
  tasks?: readonly string[];
}

/**
 * Report every reference the catalogue does not list.
 *
 * @param document - A document the schema and structural stages both accepted.
 * @param catalogue - What the caller knows. Omit it and nothing is reported.
 * @returns The warnings, unsorted — `dsl.validator.ts` orders the whole verdict.
 */
export function checkReferences(
  document: WorkflowDocument,
  catalogue: DslCatalogue | undefined,
): DslDiagnostic[] {
  if (!catalogue) return [];

  const warnings: DslDiagnostic[] = [];
  const known = {
    skills: catalogue.skills && new Set(catalogue.skills),
    models: catalogue.models && new Set(catalogue.models),
    tasks: catalogue.tasks && new Set(catalogue.tasks),
  };

  document.nodes.forEach((node, index) => {
    if (node.type !== "llm") return;
    const { config } = node;

    if (config.skill !== undefined && known.skills && !known.skills.has(config.skill)) {
      warnings.push({
        code: DslWarningCode.REFERENCE_UNKNOWN_SKILL,
        path: pointer("nodes", index, "config", "skill"),
        node: node.id,
        message: `No skill named \`${config.skill}\` is defined in this workspace yet.`,
      });
    }

    const { inherit_task: inheritTask, pinned_model: pinnedModel } = config.routing;

    if (pinnedModel !== undefined && known.models && !known.models.has(pinnedModel)) {
      warnings.push({
        code: DslWarningCode.REFERENCE_UNKNOWN_MODEL,
        path: pointer("nodes", index, "config", "routing", "pinned_model"),
        node: node.id,
        message: `No model named \`${pinnedModel}\` is in the registry.`,
      });
    }

    if (inheritTask !== undefined && known.tasks && !known.tasks.has(inheritTask)) {
      warnings.push({
        code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
        path: pointer("nodes", index, "config", "routing", "inherit_task"),
        node: node.id,
        message: `No route is configured for the task \`${inheritTask}\`.`,
      });
    }
  });

  return warnings;
}
