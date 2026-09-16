/**
 * The order a batch is pushed in — blockers first.
 *
 * AL.3 ([#279](https://github.com/NobuData/ouroboros/issues/279)). A tracker's native dependency
 * API links issues that already exist, so a blocker must be created before the issue it blocks
 * can reference it. That makes the push a topological walk of the batch's dependency graph — and
 * it is why AK.2's (#273) acyclicity guarantee is load-bearing: a cycle has no valid order.
 *
 * Pure, and deliberately so: the walk that decides what GitHub sees first is the one piece of the
 * push a test can pin without a tracker or a database.
 */

/** One draft to order. */
export interface OrderedDraft {
  /** `ticket_drafts.id`. */
  readonly id: string;
  /** `ticket_drafts.local_key` — the tie-break, and what a cycle is named by. */
  readonly localKey: string;
}

/** One edge between two drafts of the batch: `blockerId` blocks `blockedId`. */
export interface DraftEdge {
  /** The draft that must be pushed first. */
  readonly blockerId: string;
  /** The draft that waits for it. */
  readonly blockedId: string;
}

/**
 * A batch whose drafts block each other in a circle, so no draft of the circle can go first.
 *
 * AK.2 refuses to store one, so meeting this means a row arrived some other way — and the push
 * must stop before it creates anything rather than deadlock half-way.
 */
export class DependencyCycleError extends Error {
  /**
   * @param cycle - The local keys around the cycle, first repeated last — `OTA-1 → OTA-3 → OTA-1`.
   */
  constructor(readonly cycle: readonly string[]) {
    super(`the batch's dependencies form a cycle: ${cycle.join(" → ")}`);
    this.name = "DependencyCycleError";
  }
}

/**
 * Local keys compared the way a person reads them — `OTA-2` before `OTA-10`.
 *
 * @param left - One key.
 * @param right - The other.
 * @returns The comparison.
 */
function byLocalKey(left: OrderedDraft, right: OrderedDraft): number {
  return left.localKey.localeCompare(right.localKey, "en", { numeric: true });
}

/**
 * The drafts, blockers before the drafts they block.
 *
 * Kahn's algorithm, taking the ready draft with the smallest local key each step, so the same
 * batch always pushes in the same order — and a batch with no dependencies at all pushes in the
 * order a person reads its keys.
 *
 * @param drafts - The drafts to push.
 * @param edges - Edges between them. An edge naming a draft that is not in `drafts` is ignored:
 *   a blocker nobody is pushing cannot hold anything back, and a draft that is not being pushed
 *   has no place in the order.
 * @returns The drafts, ordered.
 * @throws {DependencyCycleError} When the edges among `drafts` form a cycle.
 */
export function pushOrder(
  drafts: readonly OrderedDraft[],
  edges: readonly DraftEdge[],
): OrderedDraft[] {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));
  const waitingOn = new Map(drafts.map((draft) => [draft.id, new Set<string>()]));
  const unblocks = new Map(drafts.map((draft) => [draft.id, new Set<string>()]));

  for (const edge of edges) {
    if (byId.has(edge.blockerId) && byId.has(edge.blockedId) && edge.blockerId !== edge.blockedId) {
      waitingOn.get(edge.blockedId)?.add(edge.blockerId);
      unblocks.get(edge.blockerId)?.add(edge.blockedId);
    }
  }

  const ordered: OrderedDraft[] = [];
  const ready = drafts.filter((draft) => waitingOn.get(draft.id)?.size === 0).sort(byLocalKey);

  while (ready.length > 0) {
    const next = ready.shift() as OrderedDraft;

    ordered.push(next);

    for (const blockedId of unblocks.get(next.id) ?? []) {
      const blockers = waitingOn.get(blockedId);

      blockers?.delete(next.id);

      if (blockers?.size === 0) {
        ready.push(byId.get(blockedId) as OrderedDraft);
        ready.sort(byLocalKey);
      }
    }
  }

  if (ordered.length < drafts.length) {
    throw new DependencyCycleError(cycleAmong(waitingOn, byId));
  }

  return ordered;
}

/**
 * One cycle among the drafts the walk could not order, named by local key.
 *
 * Every draft left over is waiting on another left-over draft, so following any one's blockers
 * must revisit a draft; the path from that draft's first visit is the cycle.
 *
 * @param waitingOn - What each remaining draft still waits on.
 * @param byId - The drafts, by id.
 * @returns The cycle's local keys, first repeated last.
 */
function cycleAmong(
  waitingOn: ReadonlyMap<string, ReadonlySet<string>>,
  byId: ReadonlyMap<string, OrderedDraft>,
): string[] {
  const remaining = [...waitingOn.entries()]
    .filter(([, blockers]) => blockers.size > 0)
    .map(([id]) => byId.get(id) as OrderedDraft)
    .sort(byLocalKey);
  const path: string[] = [];
  let current = remaining[0].id;

  while (!path.includes(current)) {
    path.push(current);

    const blockers = [...(waitingOn.get(current) ?? [])]
      .map((id) => byId.get(id) as OrderedDraft)
      .sort(byLocalKey);

    current = blockers[0].id;
  }

  // Walked along "waits on", so reverse to read as "blocks": OTA-1 → OTA-3 means OTA-1 blocks OTA-3.
  const reversed = path
    .slice(path.indexOf(current))
    .reverse()
    .map((id) => byId.get(id) as OrderedDraft);

  // Started at the smallest key, so the same cycle is always named the same way.
  const first = reversed.indexOf([...reversed].sort(byLocalKey)[0]);
  const cycle = [...reversed.slice(first), ...reversed.slice(0, first)];

  return [...cycle, cycle[0]].map((draft) => draft.localKey);
}
