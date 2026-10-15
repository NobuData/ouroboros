/**
 * What **Promote to workflow** would publish, said honestly — CE.1
 * ([#565](https://github.com/NobuData/ouroboros/issues/565)).
 *
 * Mockup 20's promote dialog names the guards a conversation arrived at — *never auto-merge*,
 * *$5/run* — beside the version about to be created. The decision taken for this ticket is that
 * a guard is **not compiled into new configuration** on promote: DSL v1 has no guard construct,
 * so there is nothing to compile it into. What the read does instead is name each guard with
 * **where it is really enforced**, and say so when the answer is *not on real runs yet*:
 *
 *   | guard              | where it comes from                       | enforcement    |
 *   |--------------------|-------------------------------------------|----------------|
 *   | `never_auto_merge` | the document: no ending auto-merges       | `enforced`     |
 *   | `spend_guard`      | the conversation's `set_guard` proposal   | `dry_run_only` |
 *
 * `never_auto_merge` is a property of the graph, not a promise beside it: a terminal's `action`
 * is one of `open_pr_automerge | back_to_queue | needs_review` (`dsl.schema.ts`), merging is
 * what the first of those does, and a draft none of whose endings is that one cannot merge
 * whatever else is true. A draft with no ending at all makes no such claim — it is not a
 * workflow that never merges, it is one that does not end yet.
 *
 * `spend_guard` is the per-run cap `dry-runs.budget.ts` reads off the copilot's tool traces and
 * a dry run really is held to (`min(workspace cap, draft guard)`). Nothing holds a real run to
 * it, and this file says exactly that rather than rounding it up.
 *
 * **References** are decision W7's unresolved names, with the one thing a person about to
 * publish needs added: whether the publish gate will refuse it. `publish.gate.ts` promotes
 * `reference.unknown_alias` to a finding and leaves an unknown skill or task route advisory, so
 * `blocking` is true for exactly that code. The read checks aliases against the workspace's
 * registry, as the gate does (#1745).
 *
 * **The gate's first stage runs here too** (#1745): the in-process DSL validator, whose errors —
 * no ending, an unreachable stage, a value the schema refuses — are blocking reasons, each naming
 * its stage. **The engine's validation does not run** — the publish does, and its
 * `422 workflow_definition_invalid` findings remain the authority; `blocked` here is what can be
 * known without asking, so a dialog can refuse early and never promise a publish it has not
 * attempted.
 *
 * Pure: `copilot.service.ts` reads the rows and this file decides what they mean.
 */

import { DslWarningCode, type DslDiagnostic } from "../workflows/dsl.errors";
import type { UnresolvedReference } from "./copilot.references";
import type {
  CopilotPromotionGuardResource,
  CopilotPromotionReferenceResource,
} from "./copilot.resources";

/** The terminal action that merges on its own — `dsl.schema.ts`' `TERM_OPTION_SCHEMAS`. */
const AUTOMERGE_ACTION = "open_pr_automerge";

/** How each non-merging ending reads in the sentence that names it. */
const ENDING_PHRASES: Readonly<Record<string, string>> = {
  needs_review: "human review (`needs_review`)",
  back_to_queue: "the queue (`back_to_queue`)",
};

/** What the dialog says when there is nothing to promote. */
export const NO_DRAFT_REASON = "There is no draft to promote.";

/** Where the spend guard is honoured, and where it is not. */
export const SPEND_GUARD_ENFORCED_BY =
  "Honoured by dry runs of this workflow. Not enforced on real runs yet — the workflow language has no guard construct.";

/**
 * The `action` of every `term` node of a draft, in document order.
 *
 * Read over the raw document, like `copilot.references.ts`: a draft under construction usually
 * does not validate whole, and the dialog must still be able to describe it.
 *
 * @param definition - The draft, as stored; `null` when there is none.
 * @returns One entry per ending — the action, or `undefined` for an ending that names none yet.
 */
export function terminalActions(definition: unknown): (string | undefined)[] {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return [];

  return nodes
    .filter(
      (node): node is { type: "term"; config?: unknown } =>
        node !== null && typeof node === "object" && (node as { type?: unknown }).type === "term",
    )
    .map((node) => {
      const action = (node.config as { action?: unknown } | null | undefined)?.action;
      return typeof action === "string" ? action : undefined;
    });
}

/**
 * The `never auto-merge` guard, when the draft's own shape guarantees it.
 *
 * @param definition - The draft, as stored.
 * @returns The guard, or `undefined` for a draft with no ending or with one that auto-merges.
 */
export function neverAutoMergeGuard(
  definition: unknown,
): CopilotPromotionGuardResource | undefined {
  const actions = terminalActions(definition);
  if (actions.length === 0 || actions.includes(AUTOMERGE_ACTION)) return undefined;

  const endings = [...new Set(actions)]
    .map((action) => (action === undefined ? undefined : ENDING_PHRASES[action]))
    .filter((phrase): phrase is string => phrase !== undefined);
  const where = endings.length === 0 ? "" : `every run ends at ${endings.join(" or ")}, and `;

  return {
    id: "never_auto_merge",
    label: "never auto-merge",
    source: "definition",
    enforcement: "enforced",
    enforcedBy: `Enforced by the workflow itself: ${where}no ending of this workflow merges on its own (\`${AUTOMERGE_ACTION}\`).`,
  };
}

/**
 * The spend guard, when the conversation set one.
 *
 * @param capCents - `draftSpendGuardCents()` of the workflow's guard traces; `null` for none.
 * @returns The guard, or `undefined`.
 */
export function spendGuard(capCents: number | null): CopilotPromotionGuardResource | undefined {
  if (capCents === null) return undefined;

  return {
    id: "spend_guard",
    label: `spend cap $${(capCents / 100).toFixed(2)}/run`,
    source: "conversation",
    enforcement: "dry_run_only",
    enforcedBy: SPEND_GUARD_ENFORCED_BY,
  };
}

/**
 * The guards a promotion carries, each with its real enforcement status.
 *
 * @param definition - The draft, as stored; `null` when there is none.
 * @param spendCapCents - The draft's per-run spend guard in cents, or `null`.
 * @returns The guards — the document's first, then the conversation's.
 */
export function promotionGuards(
  definition: unknown,
  spendCapCents: number | null,
): CopilotPromotionGuardResource[] {
  return [neverAutoMergeGuard(definition), spendGuard(spendCapCents)].filter(
    (guard): guard is CopilotPromotionGuardResource => guard !== undefined,
  );
}

/**
 * An unresolved reference, with whether the publish gate refuses it.
 *
 * @param reference - The reference.
 * @returns The resource; `blocking` exactly for an unknown alias.
 */
export function promotionReference(
  reference: UnresolvedReference,
): CopilotPromotionReferenceResource {
  return {
    code: reference.code,
    node: reference.node,
    name: reference.name,
    path: reference.path,
    message: reference.message,
    blocking: reference.code === DslWarningCode.REFERENCE_UNKNOWN_ALIAS,
  };
}

/**
 * Why a promotion cannot go ahead, as far as can be known without asking the engine.
 *
 * @param draftPresent - Whether the workflow has a draft.
 * @param references - The draft's unresolved references.
 * @param findings - The DSL validator's errors over the draft (#1745) — the publish gate's first
 *   stage. Empty when the draft validates.
 * @returns A sentence per reason, the validator's first and in document order, then each blocking
 *   reference — empty when nothing known stands in the way.
 */
export function blockedReasons(
  draftPresent: boolean,
  references: readonly CopilotPromotionReferenceResource[],
  findings: readonly DslDiagnostic[] = [],
): string[] {
  if (!draftPresent) return [NO_DRAFT_REASON];

  return [
    ...findings.map(findingReason),
    ...references
      .filter((reference) => reference.blocking)
      .map(
        (reference) =>
          `Stage \`${reference.node}\` pins the alias \`${reference.name}\`, which is not in this workspace's registry — publishing refuses it.`,
      ),
  ];
}

/**
 * One validator error as the dialog's sentence: the stage it is about, when it is about one.
 *
 * @param finding - The error.
 * @returns The sentence.
 */
function findingReason(finding: DslDiagnostic): string {
  return finding.node === undefined
    ? finding.message
    : `Stage \`${finding.node}\`: ${finding.message}`;
}
