/**
 * `ouroboros.config.ts` — the code view's read-only projection of a workspace's workflow
 * configuration. U.3 ([#167](https://github.com/NobuData/ouroboros/issues/167)), decision **C6**.
 *
 * ```ts
 * export default {
 *   workspace: "acme-robotics",
 *   workflows: [
 *     { slug: "standard-fix", name: "Standard Fix", status: "active", version: 14 },
 *     { slug: "hotfix-p0", name: "Hotfix P0", status: "paused", version: 3 },
 *   ],
 * };
 * ```
 *
 * **What a workspace configures about its workflows is its registry**: which workflows it has,
 * which of them are paused, and which version of each is in force. That is the whole file, read
 * from the rail's own statement, so the explorer, the rail and this file list the same workflows
 * in the same order. Nothing is invented beside them — no routing, no skills, no defaults —
 * because those belong to subsystems with surfaces of their own (mockups 06 and 14), and C6 keeps
 * the code view to what exists.
 *
 * **It is printed on every read and stored nowhere**, which is why it is read-only: there is no
 * document behind it for a save to change. Pausing, resuming and publishing are what change it.
 *
 * It is valid TypeScript and deliberately not a `defineLoop` file. It imports nothing, so it
 * claims nothing about `@ouroboros/sdk`, and the parser never reads it.
 */

import { INDENT } from "./code.grammar";
import { quoteString } from "./code.literals";
import type { WorkflowRegistryRow } from "./stats.repository";

/** One workflow, as the configuration lists it. */
export type ConfiguredWorkflow = Pick<
  WorkflowRegistryRow,
  "slug" | "name" | "status" | "current_version"
>;

/** The comment the file opens with: what it is, and where its values are changed. */
export const CONFIG_PREAMBLE: readonly string[] = [
  "// ouroboros.config.ts is read-only. It is this workspace's workflow configuration, printed",
  "// from the registry each time it is opened, and nothing written here is saved. Pause, resume",
  "// or publish a workflow in the studio to change it.",
];

/**
 * Print a workspace's workflow configuration.
 *
 * @param workspace - The workspace's slug.
 * @param workflows - Its non-archived workflows, in the rail's order.
 * @returns The file, ending in a line feed. Deterministic: the same rows print the same bytes, and
 *   every value is a one-line literal, so a name holding a line break cannot change the shape.
 */
export function printWorkflowConfig(
  workspace: string,
  workflows: readonly ConfiguredWorkflow[],
): string {
  const entries = workflows.map((workflow) => `${INDENT.repeat(2)}${configEntry(workflow)},`);
  const list =
    entries.length === 0
      ? [`${INDENT}workflows: [],`]
      : [`${INDENT}workflows: [`, ...entries, `${INDENT}],`];

  return `${[
    ...CONFIG_PREAMBLE,
    "",
    "export default {",
    `${INDENT}workspace: ${quoteString(workspace)},`,
    ...list,
    "};",
  ].join("\n")}\n`;
}

/**
 * One workflow's entry, as an object literal on one line.
 *
 * @param workflow - The workflow.
 * @returns `{ slug: "…", name: "…", status: "…", version: 14 }`, with `version: null` for a
 *   workflow that has published nothing.
 */
function configEntry(workflow: ConfiguredWorkflow): string {
  const version = workflow.current_version === null ? "null" : String(workflow.current_version);

  return (
    `{ slug: ${quoteString(workflow.slug)}, name: ${quoteString(workflow.name)}, ` +
    `status: ${quoteString(workflow.status)}, version: ${version} }`
  );
}
