"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ErrorEnvelope } from "@/app/api/errors";
import type { WorkflowDefinition, WorkflowDraft } from "@/app/api/workflows";

import {
  AUTOSAVE_DELAY_MS,
  type DraftConflict,
  IDLE,
  type SaveState,
  type SaveStatus,
  WORKFLOW_DRAFT_CONFLICT,
  readConflict,
  sameDocument,
} from "./autosave";

/** How a save is made — `draft-actions.ts`' `saveDraft`, or a suite's stand-in. */
export type SaveDraftCall = (
  id: string,
  etag: string,
  definition: WorkflowDefinition,
) => Promise<{ readonly ok: true; readonly value: WorkflowDraft } | { readonly ok: false; readonly refusal: ErrorEnvelope }>;

/** What the autosave is given. */
export interface AutosaveOptions {
  /** The workflow whose draft is written. */
  readonly workflowId: string;
  /** The etag of the draft as the page read it. Read once; each save's answer replaces it. */
  readonly etag: string;
  /** The document the draft slot holds as the page read it — edits equal to it are not written. Read once. */
  readonly stored: WorkflowDefinition;
  /** Whether this reader may write at all. A member's page schedules nothing. */
  readonly enabled: boolean;
  /** The write. */
  readonly save: SaveDraftCall;
  /** How long an edit rests before it is written. Defaults to {@link AUTOSAVE_DELAY_MS}. */
  readonly delay?: number;
  /** Told the draft slot after each write that took — the next etag and the *Last edited* stamp. */
  readonly onSaved?: (draft: WorkflowDraft) => void;
  /** Told once, when a write finds the draft changed elsewhere. Autosave has stopped by then. */
  readonly onConflict?: (conflict: DraftConflict) => void;
}

/** The autosave, as its caller drives it. */
export interface Autosave {
  /** Where the save stands — what the canvas's toolbar prints. */
  readonly status: SaveStatus;
  /** Hand over the draft after an edit; it is written once it has rested. */
  readonly schedule: (definition: WorkflowDefinition) => void;
  /**
   * Write whatever is waiting now, and wait for every write in flight.
   *
   * @returns Where the save stands afterwards: `idle` or `saved` when the stored draft is the latest
   *   edit, `conflict` or `failed` when it is not.
   */
  readonly flush: () => Promise<SaveState>;
}

/**
 * The draft's autosave — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * **Debounced.** An edit waits {@link AutosaveOptions.delay}; another edit inside that window restarts
 * it, so a drag and an Apply are one write.
 *
 * **Serial, and guarded.** One write is in flight at most. Each carries the etag the previous write was
 * answered with, so an edit made while a write is in flight is written after it, on top of it, rather
 * than racing it with a stale token. A `409` stops autosave for good — `onConflict` opens the reload
 * dialog, and nothing is retried with `*`.
 *
 * **Nothing is written that the draft already holds.** The opening document the editor hands up, and
 * an undo back to it, cost no request.
 *
 * **Nothing waiting is lost to a closed tab.** When the page is hidden, left or unmounted, whatever is
 * waiting is written at once; while something is unwritten, leaving asks first.
 *
 * @param options See {@link AutosaveOptions}.
 * @returns The status, `schedule` and `flush`.
 */
export function useAutosave(options: AutosaveOptions): Autosave {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const [status, setStatus] = useState<SaveStatus>(IDLE);
  const state = useRef<SaveState>("idle");
  const etag = useRef(options.etag);
  const stored = useRef(options.stored);
  const pending = useRef<WorkflowDefinition | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saves = useRef(0);

  const report = useCallback((next: SaveStatus) => {
    state.current = next.state;
    setStatus(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const flush = useCallback(async (): Promise<SaveState> => {
    clearTimer();
    // Serial: whatever is in flight lands first, so this write carries the etag it was answered with.
    while (inFlight.current !== null) await inFlight.current;

    if (state.current === "conflict") return "conflict";

    const next = pending.current;
    if (next === null) return state.current;

    pending.current = null;

    if (sameDocument(next, stored.current)) {
      const settled: SaveState = saves.current > 0 ? "saved" : "idle";
      report({ state: settled, reason: null });
      return settled;
    }

    const { workflowId, save, onSaved, onConflict } = latest.current;
    let settled: SaveState = "saved";
    report({ state: "saving", reason: null });

    const write = (async () => {
      const outcome = await save(workflowId, etag.current, next);

      if (outcome.ok) {
        etag.current = outcome.value.etag;
        stored.current = next;
        saves.current += 1;
        report({ state: pending.current === null ? "saved" : "pending", reason: null });
        onSaved?.(outcome.value);
      } else if (outcome.refusal.code === WORKFLOW_DRAFT_CONFLICT) {
        settled = "conflict";
        pending.current = null;
        report({ state: "conflict", reason: null });
        onConflict?.(readConflict(outcome.refusal.details));
      } else {
        // Kept, so the next edit — or a publish's flush — tries the same document again.
        settled = "failed";
        pending.current ??= next;
        report({ state: "failed", reason: outcome.refusal.message });
      }
    })();

    inFlight.current = write;
    try {
      await write;
    } finally {
      inFlight.current = null;
    }

    return settled;
  }, [clearTimer, report]);

  const schedule = useCallback(
    (definition: WorkflowDefinition) => {
      const { enabled, delay = AUTOSAVE_DELAY_MS } = latest.current;
      if (!enabled || state.current === "conflict") return;

      // An edit that leaves the draft as it is stored is no edit: the opening document, or an undo back to it.
      if (inFlight.current === null && sameDocument(definition, stored.current)) {
        if (pending.current !== null) {
          pending.current = null;
          clearTimer();
          report({ state: saves.current > 0 ? "saved" : "idle", reason: null });
        }
        return;
      }

      pending.current = definition;
      report({ state: "pending", reason: null });
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        flush().catch(() => {
          report({ state: "failed", reason: "the save could not be sent" });
        });
      }, delay);
    },
    [clearTimer, flush, report],
  );

  // Hidden, left or unmounted: write what is waiting now rather than when the timer would have.
  useEffect(() => {
    const unwritten = () => pending.current !== null || inFlight.current !== null;
    const writeNow = () => {
      if (pending.current !== null) void flush().catch(() => undefined);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") writeNow();
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!unwritten()) return;
      writeNow();
      // The browser's own *leave site?* prompt: an edit is still on its way to the draft.
      event.preventDefault();
    };

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("beforeunload", onLeave);

    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("beforeunload", onLeave);
      writeNow();
    };
  }, [flush]);

  return { status, schedule, flush };
}
