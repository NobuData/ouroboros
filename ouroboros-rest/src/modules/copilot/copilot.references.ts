/**
 * Decision **W7**: what the copilot invents is named, never passed off as real.
 *
 * `exploit-verify` is not a task kind this workspace routes and `advisory-db` is not a skill it
 * defines — and the copilot may still propose both, because a workflow is authored before every
 * piece of it exists. What it may not do is imply they will execute. So after every applied
 * operation the draft is read for references the catalogue does not list (the same three
 * decision **P7** warns on: a skill, an inherited task route, a pinned alias), the model is told
 * which, and the reply the person reads is made to say so — appended by this service when the
 * model's own prose did not name them, because the honesty is the product's and not the model's
 * to forget.
 *
 * Read over the raw document rather than through `dsl.references.ts` on purpose: that check runs
 * only on a document that validates whole, and a draft under construction usually does not yet.
 * The codes and sentences are P7's, so the canvas's warning pill and the conversation's note read
 * the same.
 */

import { DslWarningCode, pointer } from "../workflows/dsl.errors";
import type { DslCatalogue } from "../workflows/dsl.references";

/** One reference the catalogue does not list. */
export interface UnresolvedReference {
  /** Which kind — a P7 warning code. */
  readonly code: DslWarningCode;
  /** The stage that names it. */
  readonly node: string;
  /** The name that resolved to nothing. */
  readonly name: string;
  /** An RFC 6901 pointer to the value. */
  readonly path: string;
  /** What a person should read — P7's own sentence. */
  readonly message: string;
}

/**
 * Every reference in the draft that the catalogue does not list.
 *
 * @param document - The draft, as stored.
 * @param catalogue - The names that exist. A member left out is not checked.
 * @returns The unresolved references, in document order.
 */
export function unresolvedReferences(
  document: unknown,
  catalogue: DslCatalogue | undefined,
): UnresolvedReference[] {
  if (!catalogue) return [];
  const nodes = (document as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return [];

  const known = {
    skills: catalogue.skills && new Set(catalogue.skills),
    aliases: catalogue.aliases && new Set(catalogue.aliases),
    tasks: catalogue.tasks && new Set(catalogue.tasks),
  };
  const found: UnresolvedReference[] = [];

  nodes.forEach((candidate, index) => {
    const node = candidate as { id?: unknown; type?: unknown; config?: unknown } | null;
    if (
      node === null ||
      typeof node !== "object" ||
      node.type !== "llm" ||
      typeof node.id !== "string"
    ) {
      return;
    }
    const config = (node.config ?? {}) as { skill?: unknown; routing?: unknown };
    const routing = (config.routing ?? {}) as { inherit_task?: unknown; pinned_model?: unknown };
    const pinned = (routing.pinned_model ?? {}) as { alias?: unknown };

    if (typeof config.skill === "string" && known.skills && !known.skills.has(config.skill)) {
      found.push({
        code: DslWarningCode.REFERENCE_UNKNOWN_SKILL,
        node: node.id,
        name: config.skill,
        path: pointer("nodes", index, "config", "skill"),
        message: `No skill named \`${config.skill}\` is defined in this workspace yet.`,
      });
    }
    if (
      typeof routing.inherit_task === "string" &&
      known.tasks &&
      !known.tasks.has(routing.inherit_task)
    ) {
      found.push({
        code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
        node: node.id,
        name: routing.inherit_task,
        path: pointer("nodes", index, "config", "routing", "inherit_task"),
        message: `No task route named \`${routing.inherit_task}\` exists in this workspace yet.`,
      });
    }
    if (typeof pinned.alias === "string" && known.aliases && !known.aliases.has(pinned.alias)) {
      found.push({
        code: DslWarningCode.REFERENCE_UNKNOWN_ALIAS,
        node: node.id,
        name: pinned.alias,
        path: pointer("nodes", index, "config", "routing", "pinned_model", "alias"),
        message: `No alias named \`${pinned.alias}\` exists in this workspace's registry yet.`,
      });
    }
  });

  return found;
}

/**
 * The references an operation introduced — in the document after it, not in the one before.
 *
 * @param before - The unresolved references before the operation.
 * @param after - The unresolved references after it.
 * @returns Those of `after` that `before` did not carry.
 */
export function introducedReferences(
  before: readonly UnresolvedReference[],
  after: readonly UnresolvedReference[],
): UnresolvedReference[] {
  const seen = new Set(
    before.map((reference) => `${reference.code}:${reference.node}:${reference.name}`),
  );
  return after.filter(
    (reference) => !seen.has(`${reference.code}:${reference.node}:${reference.name}`),
  );
}

/**
 * The W7 sentence — what the reply says when it invented something.
 *
 * @param references - What does not resolve.
 * @returns One sentence naming each, or an empty string for none.
 */
export function unresolvedSentence(references: readonly UnresolvedReference[]): string {
  if (references.length === 0) return "";
  const named = unique(references.map(describe));
  const plural = named.length > 1;
  return (
    `Note: ${joinNames(named)} ${plural ? "do" : "does"} not exist in this workspace yet, so the ` +
    `draft carries ${plural ? "unresolved-reference warnings" : "an unresolved-reference warning"} ` +
    "and cannot run until " +
    (plural ? "they exist" : "it exists") +
    "."
  );
}

/**
 * Whether a reply already names every unresolved reference.
 *
 * @param body - The reply's prose.
 * @param references - What does not resolve.
 * @returns `true` when each name appears in the body.
 */
export function mentionsAll(body: string, references: readonly UnresolvedReference[]): boolean {
  return references.every((reference) => body.includes(reference.name));
}

function describe(reference: UnresolvedReference): string {
  switch (reference.code) {
    case DslWarningCode.REFERENCE_UNKNOWN_SKILL:
      return `skill \`${reference.name}\``;
    case DslWarningCode.REFERENCE_UNKNOWN_TASK:
      return `task route \`${reference.name}\``;
    default:
      return `alias \`${reference.name}\``;
  }
}

function unique(names: readonly string[]): string[] {
  return [...new Set(names)];
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
