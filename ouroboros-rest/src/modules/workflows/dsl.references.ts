/**
 * Decision **P7**, in full: skill, alias and task-route references are validated *names*, and
 * an unknown one is a warning ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * The skills catalogue (mockup 14) does not exist. A foreign key to a table nobody has written
 * is not a stricter design, it is a design that cannot be built; and refusing to save a
 * workflow because it names a skill the workspace has not defined yet would make the editor
 * unusable during exactly the period the skill is being defined. So the reference is stored as
 * written, and whether it resolves is a question asked at validation, answered as a warning,
 * and rendered by the inspector as a flag on the field.
 *
 * **An alias is the exception at publish, and only there.** CH.6
 * ([#589](https://github.com/NobuData/ouroboros/issues/589)) makes *routes and workflows may only
 * reference registry aliases* a system property: `publish.gate.ts` reads the workspace's
 * registry and promotes this module's `reference.unknown_alias` to a refusal. A draft may still
 * name an alias somebody is about to create; a published version may not.
 *
 * **The caller supplies the vocabulary.** This module holds no list of skills and no list of
 * aliases, so it cannot invent one — the same shape `ouroboros-engine`'s `EstimationContext`
 * takes for the same reason (decisions K5 and K6). A caller that supplies no catalogue gets
 * no warnings of this kind, which is the honest answer to *is this reference known?* when
 * nothing in the system knows.
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
  /** Every alias the workspace's model registry holds, bound or not. */
  aliases?: readonly string[];
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
    aliases: catalogue.aliases && new Set(catalogue.aliases),
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

    if (pinnedModel !== undefined && known.aliases && !known.aliases.has(pinnedModel.alias)) {
      warnings.push({
        code: DslWarningCode.REFERENCE_UNKNOWN_ALIAS,
        path: pointer("nodes", index, "config", "routing", "pinned_model", "alias"),
        node: node.id,
        message: `No alias named \`${pinnedModel.alias}\` is in this workspace's model registry.`,
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
