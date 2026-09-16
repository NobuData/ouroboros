/**
 * The planning graph's one rule the database cannot hold: **no cycles**.
 *
 * AL.4 ([#280](https://github.com/NobuData/ouroboros/issues/280)). AK.2 (#273) can *represent* a
 * cycle — acyclicity is a walk, and a CHECK cannot walk — so every write that changes a batch's
 * edges passes through {@link assertAcyclic} first. It is load-bearing: AL.3 (#279) pushes blockers
 * first, and a cycle has no first.
 *
 * The walk is AL.3's own `pushOrder`, so *"this batch can be pushed"* and *"this edit is allowed"*
 * are one answer, and the refusal is AL.3's `dependency_cycle` `422`, which **names the cycle** —
 * `OTA-3 → OTA-5 → OTA-3` — because the person needs to know which edge to remove.
 *
 * Pure: the graph goes in, a refusal or nothing comes out.
 */

import { dependencyCycle } from "./push.errors";
import { DependencyCycleError, pushOrder, type DraftEdge, type OrderedDraft } from "./push.order";

/**
 * Refuse a batch graph with a cycle.
 *
 * @param batchId - The batch, for the refusal's details.
 * @param drafts - Every draft of the batch, pushed ones included — an edge through a pushed draft
 *   still orders the unpushed ones around it.
 * @param edges - Every draft-to-draft edge the batch would hold after the write.
 * @throws {InvalidRequestError} `dependency_cycle`, naming the cycle by local key.
 */
export function assertAcyclic(
  batchId: string,
  drafts: readonly OrderedDraft[],
  edges: readonly DraftEdge[],
): void {
  try {
    pushOrder(drafts, edges);
  } catch (error) {
    if (error instanceof DependencyCycleError) {
      throw dependencyCycle(batchId, error.cycle);
    }

    throw error;
  }
}

/**
 * A batch's edges with one draft's blocked-by set replaced.
 *
 * @param edges - The batch's edges now.
 * @param blockedId - The draft being edited.
 * @param blockerIds - Its new blockers.
 * @returns The edges the batch would hold after the edit.
 */
export function withBlockers(
  edges: readonly DraftEdge[],
  blockedId: string,
  blockerIds: readonly string[],
): DraftEdge[] {
  return [
    ...edges.filter((edge) => edge.blockedId !== blockedId),
    ...blockerIds.map((blockerId) => ({ blockerId, blockedId })),
  ];
}
