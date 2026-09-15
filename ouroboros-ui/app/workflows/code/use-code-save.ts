"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { CodeDiagnostic, WorkflowCode } from "@/app/api/workflows";

import type { ActionOutcome } from "../action-outcome";
import { type DraftConflict, WORKFLOW_DRAFT_CONFLICT, readConflict } from "../autosave";
import { readDiagnostics } from "./code-diagnostics";
import {
  CODE_SAVE_DELAY_MS,
  CODE_SAVE_IDLE,
  type CodeSaveState,
  type CodeSaveStatus,
  WORKFLOW_CODE_INVALID,
  failureReason,
  isRetryable,
  retryDelay,
} from "./code-save";

/** How a file is saved — `code-actions.ts`' `saveCode`, or a suite's stand-in. */
export type SaveCodeCall = (slug: string, etag: string, text: string) => Promise<ActionOutcome<WorkflowCode>>;

/** What the save loop is given. */
export interface CodeSaveOptions {
  /** The workflow whose file is written. */
  readonly slug: string;
  /** The draft's etag as the page read it. Read once; each save's answer replaces it. */
  readonly etag: string;
  /** The file's text as the page read it — edits equal to it are not written. Read once. */
  readonly stored: string;
  /** Whether this reader may write at all. A member's page schedules nothing. */
  readonly enabled: boolean;
  /** The write. */
  readonly save: SaveCodeCall;
  /** How long typing rests before the file is written. Defaults to {@link CODE_SAVE_DELAY_MS}. */
  readonly delay?: number;
  /** How long to wait before the nth retry of a failed write. Defaults to {@link retryDelay}. */
  readonly backoff?: (attempt: number) => number;
  /** Whether the browser is online. Defaults to `navigator.onLine`. */
  readonly online?: () => boolean;
  /** Told after each write that took: the file as the draft now reads, and the text that was sent. */
  readonly onSaved?: (file: WorkflowCode, sent: string) => void;
  /** Told after each write that did not parse: the diagnostics, and the text they were counted in. */
  readonly onInvalid?: (diagnostics: readonly CodeDiagnostic[], sent: string) => void;
  /** Told once, when a write finds the draft changed elsewhere. The loop has stopped by then. */
  readonly onConflict?: (conflict: DraftConflict) => void;
  /** Told when an edit brings the text back to what the draft holds, so nothing is left to write. */
  readonly onReverted?: () => void;
}

/** The save loop, as its caller drives it. */
export interface CodeSave {
  /** Where the save stands. */
  readonly status: CodeSaveStatus;
  /** Hand over the file after an edit; it is written once typing has rested. */
  readonly schedule: (text: string) => void;
  /**
   * Write whatever is waiting now, and wait for every write in flight — ⌘S, a retry, a page being left.
   *
   * @returns Where the save stands afterwards.
   */
  readonly flush: () => Promise<CodeSaveState>;
  /** Forget whatever is waiting, unwritten — for a buffer the person chose to drop. */
  readonly cancel: () => void;
}

/** Whether the browser says it is online; `true` where it cannot say. */
function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * The code editor's save loop — V.4 ([#172](https://github.com/NobuData/ouroboros/issues/172)), on the
 * canvas's autosave pattern (`use-autosave.ts`, S.6) with the code editor's own answers.
 *
 * **Debounced.** An edit waits {@link CodeSaveOptions.delay}; another edit inside that window restarts it.
 *
 * **Serial, and guarded — so no keystroke is lost.** One write is in flight at most, carrying the etag the
 * previous write was answered with. The latest text typed is always *pending*: an edit made while a write
 * is in flight replaces what is pending and is written when that write lands, on top of it. A write that
 * took never touches the editor's text — the caller measures the dot from what was sent.
 *
 * **Each answer means one thing.** `200` moves the etag. `422 workflow_code_invalid` hands up the
 * diagnostics and keeps going: the draft is untouched, and the next edit is the next attempt. `409` stops
 * the loop for good — the caller asks — and nothing is retried with `*`. Anything else — offline, a
 * service error — keeps the text, says why ({@link failureReason}), and tries again by itself on a doubling
 * wait, at once when the browser comes back online, or when the caller flushes.
 *
 * **Nothing waiting is lost to a closed tab.** When the page is hidden, left or unmounted, whatever is
 * waiting is written at once; while something is unwritten, leaving asks first.
 *
 * @param options See {@link CodeSaveOptions}.
 * @returns The status, `schedule`, `flush` and `cancel`.
 */
export function useCodeSave(options: CodeSaveOptions): CodeSave {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  const [status, setStatus] = useState<CodeSaveStatus>(CODE_SAVE_IDLE);
  const state = useRef<CodeSaveState>("idle");
  const reason = useRef<string | null>(null);
  const etag = useRef(options.etag);
  const stored = useRef(options.stored);
  const pending = useRef<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saves = useRef(0);
  const attempts = useRef(0);
  // Whether the page is still here to retry for. An unmounted page's last write may still fail after its
  // cleanup ran; it must not start retrying for a page nobody is on.
  const mounted = useRef(true);
  // The latest `flush`, for a retry timer set inside `flush` itself.
  const flushRef = useRef<() => Promise<CodeSaveState>>(() => Promise.resolve("idle"));

  const report = useCallback((next: CodeSaveStatus) => {
    state.current = next.state;
    reason.current = next.reason;
    setStatus(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    timer.current = null;
    retryTimer.current = null;
  }, []);

  /** Where a file stands with nothing waiting: saved once anything has been, else idle. */
  const settledState = useCallback((): CodeSaveState => (saves.current > 0 ? "saved" : "idle"), []);

  const flush = useCallback(async (): Promise<CodeSaveState> => {
    clearTimers();
    // Serial: whatever is in flight lands first, so this write carries the etag it was answered with.
    while (inFlight.current !== null) await inFlight.current;

    if (state.current === "conflict") return "conflict";

    const next = pending.current;
    if (next === null) return state.current;

    pending.current = null;

    if (next === stored.current) {
      const settled = settledState();
      report({ state: settled, reason: null });
      latest.current.onReverted?.();
      return settled;
    }

    const { slug, save, backoff = retryDelay, online = browserOnline } = latest.current;
    let settled: CodeSaveState = "saved";
    // A retry keeps the failure's reason while it is in flight, so its banner reads *Retrying…* rather than vanishing.
    report({ state: "saving", reason: state.current === "failed" ? reason.current : null });

    const write = (async () => {
      let outcome: ActionOutcome<WorkflowCode> | null;
      try {
        outcome = await save(slug, etag.current, next);
      } catch {
        // The action never answered: the network, or the browser going offline mid-request.
        outcome = null;
      }

      if (outcome?.ok === true) {
        etag.current = outcome.value.etag;
        stored.current = next;
        saves.current += 1;
        attempts.current = 0;
        report({ state: pending.current === null ? "saved" : "pending", reason: null });
        latest.current.onSaved?.(outcome.value, next);
        return;
      }

      const refusal = outcome === null ? null : outcome.refusal;

      if (refusal?.code === WORKFLOW_DRAFT_CONFLICT) {
        settled = "conflict";
        pending.current = null;
        report({ state: "conflict", reason: null });
        latest.current.onConflict?.(readConflict(refusal.details));
        return;
      }

      if (refusal?.code === WORKFLOW_CODE_INVALID) {
        // Not kept as pending: sending the same text again would be refused the same way.
        settled = "invalid";
        attempts.current = 0;
        report({ state: pending.current === null ? "invalid" : "pending", reason: null });
        latest.current.onInvalid?.(readDiagnostics(refusal.details), next);
        return;
      }

      // Kept, unless something newer was typed meanwhile — so a retry writes the latest text.
      settled = "failed";
      pending.current ??= next;
      report({ state: "failed", reason: failureReason(refusal?.message ?? null, online()) });

      if (mounted.current && isRetryable(refusal?.code ?? null)) {
        attempts.current += 1;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void flushRef.current().catch(() => undefined);
        }, backoff(attempts.current));
      }
    })();

    inFlight.current = write;
    try {
      await write;
    } finally {
      inFlight.current = null;
    }

    return settled;
  }, [clearTimers, report, settledState]);

  useLayoutEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(
    (text: string) => {
      const { enabled, delay = CODE_SAVE_DELAY_MS } = latest.current;
      if (!enabled || state.current === "conflict") return;

      // Typed back to what the draft holds: nothing to write, and nothing left of a refusal or a failure.
      if (inFlight.current === null && text === stored.current) {
        if (pending.current !== null || state.current === "invalid" || state.current === "failed") {
          pending.current = null;
          clearTimers();
          report({ state: settledState(), reason: null });
          latest.current.onReverted?.();
        }
        return;
      }

      pending.current = text;
      // A failure stays said until the next attempt answers, so its banner does not flicker per keystroke.
      if (state.current !== "failed") report({ state: "pending", reason: null });

      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush().catch(() => undefined);
      }, delay);
    },
    [clearTimers, flush, report, settledState],
  );

  const cancel = useCallback(() => {
    clearTimers();
    pending.current = null;
    if (state.current !== "conflict") report({ state: settledState(), reason: null });
  }, [clearTimers, report, settledState]);

  // Hidden, left, back online or unmounted: write what is waiting now rather than when a timer would.
  useEffect(() => {
    mounted.current = true;
    const unwritten = () => pending.current !== null || inFlight.current !== null;
    const writeNow = () => {
      if (pending.current !== null) void flush().catch(() => undefined);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") writeNow();
    };
    const onOnline = () => {
      if (state.current === "failed") writeNow();
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!unwritten()) return;
      writeNow();
      // The browser's own *leave site?* prompt: text is still on its way to the draft.
      event.preventDefault();
    };

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onLeave);

    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onLeave);
      writeNow();
      // After the last write is sent: a retry of an unmounted page's text is the next page's to make.
      mounted.current = false;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [flush]);

  return { status, schedule, flush, cancel };
}
