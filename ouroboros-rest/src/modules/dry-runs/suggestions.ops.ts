/**
 * A suggestion's operations, folded over a draft (CD.5,
 * [#563](https://github.com/NobuData/ouroboros/issues/563)).
 *
 * Apply uses the one write path — `apply_draft_batch()` — but checks first, in this service's
 * language, that every operation still fits the draft **as it is now**: a draft that moved on
 * since the dry run may have lost the stage or the edge an operation names, and that is a
 * conflict to surface, not a change to force. The same fold validates what the copilot proposes
 * before it is recorded.
 *
 * The check is the copilot's own (`checkOperation`: shape, typed config, preconditions), so a
 * suggestion's operation is held to exactly what a conversation's operation is.
 */

import { checkOperation, type DraftOperation } from "../copilot/copilot.operations";
import type { StoredDraftOperation } from "../db/schema";
import type { DslCatalogue } from "../workflows/dsl.references";

/** A batch that fits, or the first operation that does not. */
export type FoldResult =
  | { readonly ok: true; readonly operations: DraftOperation[]; readonly document: unknown }
  | {
      readonly ok: false;
      /** The position of the operation that did not fit, from 0. */
      readonly operation: number;
      readonly kind: string;
      /** The validator's sentence. */
      readonly reason: string;
    };

/**
 * Apply operations to a document in order, stopping at the first that does not fit.
 *
 * @param document - The draft, as stored.
 * @param operations - The operations, in order.
 * @param catalogue - The names that exist, for the validator's warnings.
 * @returns The validated operations and the resulting document, or where it stopped.
 */
export function foldOperations(
  document: unknown,
  operations: readonly StoredDraftOperation[],
  catalogue?: DslCatalogue,
): FoldResult {
  const validated: DraftOperation[] = [];
  let current = document;

  for (const [index, operation] of operations.entries()) {
    const check = checkOperation(current, operation, catalogue);
    if (!check.ok) {
      return { ok: false, operation: index, kind: operation.kind, reason: check.message };
    }
    validated.push(check.operation);
    current = check.document;
  }

  return { ok: true, operations: validated, document: current };
}
