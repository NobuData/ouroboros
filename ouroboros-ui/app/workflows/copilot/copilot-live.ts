import { useSyncExternalStore } from "react";

import type { CopilotDraft, CopilotWarning } from "@/app/api/workflow-copilot";

import type { OperationShape } from "./conversation";

/**
 * What the conversation has done to the draft in this page session, for the regions beside it
 * (CE.2, [#566](https://github.com/NobuData/ouroboros/issues/566)) — the seam CE.3's stage list
 * ([#567](https://github.com/NobuData/ouroboros/issues/567)) subscribes to, so a row can appear
 * in step with the marker that caused it.
 *
 * ### What it holds
 *
 * Per workflow: every operation a reply **applied** or **proposed** since the page loaded, in the
 * order the stream delivered them, each with the W7 warnings it introduced; whether a reply is
 * arriving now; and the draft as the last finished reply left it (the stream's `done.draft`).
 * A bounced operation changed nothing and is not here.
 *
 * ### What it is not
 *
 * Not the draft's source of truth. The page reads the draft from the service on every arrival
 * and the card calls `router.refresh()` when a reply finishes, so the server-read regions catch
 * up by themselves; this store is only the *in-between* — what lets a client component animate
 * from the stream instead of waiting for that re-read. It is module state, so it lives as long
 * as the tab's document and is empty after a reload.
 *
 * ```tsx
 * const { operations, draft, streaming } = useCopilotLive(workflowId);
 * ```
 */

/** One operation the conversation applied or proposed. */
export interface LiveOperation {
  /** Its place in this page session's sequence, from 1 — a stable React key. */
  readonly ordinal: number;
  /** The operation, as the service spells it. */
  readonly op: OperationShape;
  /** `applied` to the draft, or `proposed` — a guard, recorded beside it. */
  readonly outcome: "applied" | "proposed";
  /** The draft revision it produced — `applied` only. */
  readonly draftRev: number | null;
  /** The unresolved references it introduced (decision W7). */
  readonly warnings: readonly CopilotWarning[];
}

/** What the store holds for one workflow. */
export interface CopilotLive {
  /** The operations so far, oldest first. */
  readonly operations: readonly LiveOperation[];
  /** The draft as the last finished reply left it, or `null` before one finished here. */
  readonly draft: CopilotDraft | null;
  /** Whether a reply is arriving now. */
  readonly streaming: boolean;
}

/** What a workflow nobody has conversed with on this page holds. The same object every time. */
export const EMPTY_LIVE: CopilotLive = { operations: [], draft: null, streaming: false };

const held = new Map<string, CopilotLive>();
const listeners = new Set<() => void>();

/**
 * Replace one workflow's entry and tell every subscriber.
 *
 * @param workflowId The workflow.
 * @param change What to make of the entry.
 */
function update(workflowId: string, change: (current: CopilotLive) => CopilotLive): void {
  held.set(workflowId, change(held.get(workflowId) ?? EMPTY_LIVE));
  for (const listener of listeners) listener();
}

/**
 * Read one workflow's entry.
 *
 * @param workflowId The workflow.
 * @returns The entry — the same object until it changes.
 */
export function readCopilotLive(workflowId: string): CopilotLive {
  return held.get(workflowId) ?? EMPTY_LIVE;
}

/**
 * Be told after every change.
 *
 * @param listener What to call.
 * @returns The unsubscribe.
 */
export function subscribeCopilotLive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Record an operation a reply applied or proposed.
 *
 * @param workflowId The workflow.
 * @param operation The operation, without its ordinal.
 */
export function publishOperation(workflowId: string, operation: Omit<LiveOperation, "ordinal">): void {
  update(workflowId, (current) => ({
    ...current,
    operations: [...current.operations, { ...operation, ordinal: current.operations.length + 1 }],
  }));
}

/**
 * Record whether a reply is arriving.
 *
 * @param workflowId The workflow.
 * @param streaming Whether one is.
 */
export function publishStreaming(workflowId: string, streaming: boolean): void {
  if (readCopilotLive(workflowId).streaming === streaming) return;
  update(workflowId, (current) => ({ ...current, streaming }));
}

/**
 * Record the draft as a finished reply left it.
 *
 * @param workflowId The workflow.
 * @param draft The draft.
 */
export function publishDraft(workflowId: string, draft: CopilotDraft): void {
  update(workflowId, (current) => ({ ...current, draft }));
}

/**
 * Forget one workflow's entry — a new conversation starts from nothing — or all of them.
 *
 * @param workflowId The workflow. Omitted, every entry (a test's reset).
 */
export function resetCopilotLive(workflowId?: string): void {
  if (workflowId === undefined) held.clear();
  else held.delete(workflowId);
  for (const listener of listeners) listener();
}

/**
 * What the conversation has done to a workflow's draft in this page session.
 *
 * @param workflowId The workflow.
 * @returns The entry, re-rendering the caller when it changes. On the server, and for the
 *   hydrating render, {@link EMPTY_LIVE}.
 */
export function useCopilotLive(workflowId: string): CopilotLive {
  return useSyncExternalStore(
    subscribeCopilotLive,
    () => readCopilotLive(workflowId),
    () => EMPTY_LIVE,
  );
}
