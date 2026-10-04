/**
 * What the action executor answers with (BN.2, [#462](https://github.com/NobuData/ouroboros/issues/462)):
 * the item, the attempt that answered it and the resolution — the card's receipt.
 */

import type { DecisionChannel } from "../db/schema";
import type { ActionItem, ActionPerson, ActionResolution } from "./inbox-actions.repository";

/** How an item was answered. */
export interface ActionResolutionResource {
  readonly actionId: string;
  /** `human` for a person's answer; `policy` when a policy (or `source_resolved`) closed it. */
  readonly resolver: "human" | "policy";
  readonly policy: string | null;
  /** Who answered — null for a policy, or a person since removed. */
  readonly actor: ActionPerson | null;
  readonly channel: DecisionChannel;
  readonly note: string | null;
  /** The owning plane's receipt — `{merge, merge_sha}`, `{exception_id, control_id}`, `{draft_batch_id}`. */
  readonly outcome: Record<string, unknown>;
  readonly resolvedAt: string;
}

/** `POST /api/v1/inbox/items/{id}/actions/{actionId}`'s answer. */
export interface ActionResultResource {
  readonly itemId: string;
  readonly kindId: string;
  /** Always `resolved`: a press that did not resolve answers with an error instead. */
  readonly status: "resolved";
  /** True when the idempotency key was seen before and this is the first attempt's answer. */
  readonly replayed: boolean;
  readonly attempt: { readonly id: string; readonly idempotencyKey: string };
  readonly resolution: ActionResolutionResource;
}

/**
 * The answer, from the stored rows.
 *
 * @param item - The item.
 * @param attemptId - The attempt that answered it.
 * @param idempotencyKey - That attempt's key.
 * @param resolution - The stored resolution.
 * @param replayed - Whether this repeats an earlier answer.
 * @returns The resource.
 */
export function actionResultResource(
  item: ActionItem,
  attemptId: string,
  idempotencyKey: string,
  resolution: ActionResolution,
  replayed: boolean,
): ActionResultResource {
  return {
    itemId: item.id,
    kindId: item.kindId,
    status: "resolved",
    replayed,
    attempt: { id: attemptId, idempotencyKey },
    resolution: {
      actionId: resolution.actionId,
      resolver: resolution.resolver,
      policy: resolution.policy,
      actor: resolution.actor,
      channel: resolution.channel,
      note: resolution.note,
      outcome: resolution.outcome,
      resolvedAt: resolution.resolvedAt.toISOString(),
    },
  };
}
