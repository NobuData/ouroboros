"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import type { TicketSource, TicketSourceStatusReport } from "@/app/api/sources";
import { Button, cx } from "@/app/ui";

import { readSourceStatus, setSourceStatus, syncSource, testSource } from "./actions";
import {
  PAUSE_LABEL,
  PAUSE_READ_ONLY,
  PAUSING,
  RESUME_LABEL,
  RESUMING,
  SYNC_LABEL,
  SYNC_PAUSED,
  SYNC_READ_ONLY,
  SYNC_RUNNING,
  SYNC_STARTED,
  SYNC_STARTING,
  TESTING,
  TEST_LABEL,
  TEST_READ_ONLY,
  type TestNote,
  lastSyncLine,
  syncWaitReason,
  testNote,
} from "./view";

import "./sources.css";

/**
 * A row's three live controls — **Test connection**, **Sync now**, **Pause** or **Resume** — and
 * the notes each draws ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * ### Test
 *
 * Press → `testSource` → the note draws what the provider said, whole: `✓ acme-robotics · 4
 * repositories`, `✗ credentials rejected — GitHub refused the token (401)`. Nothing is written
 * by a test, so the route is not refreshed; the note is this island's own state.
 *
 * ### Sync
 *
 * The control is inert, with the reason, wherever the service would refuse it: a member, a
 * paused row, a sync already running, and the minimum interval the status report carries as
 * `retryAfterSeconds` — so a press that would be a `409` is not offered. Press → `syncSource`
 * → the row refreshes to *syncing…*, and the island **watches**: it reads the status every
 * {@link SYNC_POLL_MS} until `running` is false, then refreshes the route once more so the
 * freshness, the counts and — through the backlog — the tickets are on the page. Bounded by
 * {@link SYNC_POLL_LIMIT}, because a watch that never gave up would be a tab that never rested.
 *
 * ### Pause and resume
 *
 * One control, labelled for what pressing it does. Pausing is a `PATCH` to `paused`;
 * resuming is a `PATCH` to `active`, which also clears an `error` — the loop's own filter is
 * `active`, so a failed source is not polled again until somebody acts, and this is how they
 * act without waiting for a sync to say so.
 */

/** How often the island reads the status while a sync it started is landing. */
export const SYNC_POLL_MS = 1500;

/** How many reads before the island stops watching and leaves the row to the next reload. */
export const SYNC_POLL_LIMIT = 40;

/** What the controls take. */
export interface SourceControlsProps {
  /** The source. */
  readonly source: TicketSource;
  /** Its status report, or `null` when it could not be read. */
  readonly status: TicketSourceStatusReport | null;
  /** Whether this reader may press anything. */
  readonly mayAdminister: boolean;
}

/** The test note as drawn. */
type TestDrawn =
  | { readonly kind: "none" }
  | { readonly kind: "pending" }
  | { readonly kind: "result"; readonly note: TestNote }
  | { readonly kind: "refused"; readonly reason: string };

/** The sync note as drawn. */
type SyncDrawn =
  | { readonly kind: "none" }
  | { readonly kind: "pending" }
  | { readonly kind: "watching"; readonly text: string }
  | { readonly kind: "landed"; readonly text: string | null }
  | { readonly kind: "refused"; readonly reason: string };

/** The modifier each note tone adds. */
const NOTE_TONE_CLASS = {
  ok: "sources-row__note--ok",
  err: "sources-row__note--err",
} as const;

/**
 * The controls.
 *
 * @param props See {@link SourceControlsProps}.
 * @returns The three buttons and their notes.
 */
export function SourceControls({ source, status, mayAdminister }: SourceControlsProps) {
  const router = useRouter();
  const testNoteId = useId();
  const syncNoteId = useId();
  const [test, setTest] = useState<TestDrawn>({ kind: "none" });
  const [sync, setSync] = useState<SyncDrawn>({ kind: "none" });
  const [watching, setWatching] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [pauseNote, setPauseNote] = useState<string | null>(null);

  /** Run one test and draw its answer. */
  async function runTest(): Promise<void> {
    setTest({ kind: "pending" });

    const outcome = await testSource(source.id);

    setTest(
      outcome.ok
        ? { kind: "result", note: testNote(outcome.result) }
        : { kind: "refused", reason: outcome.reason },
    );
  }

  /** Start a sync, and watch it land. */
  async function runSync(): Promise<void> {
    setSync({ kind: "pending" });

    const outcome = await syncSource(source.id);

    if (!outcome.ok) {
      setSync({ kind: "refused", reason: outcome.reason });
      return;
    }

    setSync({ kind: "watching", text: SYNC_STARTED });
    setWatching(true);
    router.refresh();
  }

  /** Move the source to the other position. */
  async function togglePause(): Promise<void> {
    setPausing(true);
    setPauseNote(null);

    const next = source.status === "active" ? "paused" : "active";
    const outcome = await setSourceStatus(source.id, next);

    setPausing(false);

    if (!outcome.ok) {
      setPauseNote(outcome.reason);
      return;
    }

    router.refresh();
  }

  useEffect(() => {
    if (!watching) return;

    let attempts = 0;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      if (cancelled) return;

      const reading = await readSourceStatus(source.id);

      if (cancelled) return;

      attempts += 1;

      if (reading.ok && reading.status.running && attempts < SYNC_POLL_LIMIT) {
        timer = setTimeout(() => void tick(), SYNC_POLL_MS);
        return;
      }

      setWatching(false);
      setSync({ kind: "landed", text: reading.ok ? lastSyncLine(reading.status) : reading.reason });
      router.refresh();
    };

    let timer = setTimeout(() => void tick(), SYNC_POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `source.id` is stable for the life of the row, and `router` for the life of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching]);

  const running = watching || status?.running === true;
  const wait = status?.retryAfterSeconds ?? null;
  const syncReason = !mayAdminister
    ? SYNC_READ_ONLY
    : source.status === "paused"
      ? SYNC_PAUSED
      : running
        ? SYNC_RUNNING
        : sync.kind === "pending"
          ? SYNC_STARTING
          : wait !== null && wait > 0 && sync.kind === "none"
            ? syncWaitReason(wait)
            : undefined;
  const testReason = !mayAdminister ? TEST_READ_ONLY : test.kind === "pending" ? TESTING : undefined;
  const pauseReason = !mayAdminister
    ? PAUSE_READ_ONLY
    : pausing
      ? source.status === "active"
        ? PAUSING
        : RESUMING
      : undefined;

  return (
    <div className="sources-row__controls">
      <Button
        aria-describedby={test.kind === "none" ? undefined : testNoteId}
        onClick={() => void runTest()}
        reason={testReason}
        size="sm"
        tone="ghost"
      >
        {TEST_LABEL}
      </Button>
      <Button
        aria-describedby={sync.kind === "none" ? undefined : syncNoteId}
        onClick={() => void runSync()}
        reason={syncReason}
        size="sm"
        tone="ghost"
      >
        {SYNC_LABEL}
      </Button>
      <Button onClick={() => void togglePause()} reason={pauseReason} size="sm" tone="ghost">
        {source.status === "active" ? PAUSE_LABEL : RESUME_LABEL}
      </Button>

      <span
        aria-busy={test.kind === "pending" || undefined}
        aria-live="polite"
        className={cx(
          "sources-row__note",
          test.kind === "result" && NOTE_TONE_CLASS[test.note.tone],
          test.kind === "refused" && NOTE_TONE_CLASS.err,
          test.kind === "pending" && "sources-row__note--pending",
        )}
        id={test.kind === "none" ? undefined : testNoteId}
        role={test.kind === "none" ? undefined : test.kind === "refused" ? "alert" : "status"}
      >
        {test.kind === "pending" && TESTING}
        {test.kind === "refused" && test.reason}
        {test.kind === "result" && (
          <>
            <span aria-hidden="true" className="sources-row__glyph">
              {test.note.glyph}
            </span>{" "}
            {test.note.text}
          </>
        )}
      </span>

      <span
        aria-busy={sync.kind === "pending" || sync.kind === "watching" || undefined}
        aria-live="polite"
        className={cx(
          "sources-row__note",
          sync.kind === "refused" && NOTE_TONE_CLASS.err,
          sync.kind === "landed" && NOTE_TONE_CLASS.ok,
          (sync.kind === "pending" || sync.kind === "watching") && "sources-row__note--pending",
        )}
        id={sync.kind === "none" ? undefined : syncNoteId}
        role={sync.kind === "none" ? undefined : sync.kind === "refused" ? "alert" : "status"}
      >
        {sync.kind === "pending" && SYNC_STARTING}
        {sync.kind === "watching" && sync.text}
        {sync.kind === "landed" && sync.text}
        {sync.kind === "refused" && sync.reason}
      </span>

      {pauseNote !== null && (
        <span className={cx("sources-row__note", NOTE_TONE_CLASS.err)} role="alert">
          {pauseNote}
        </span>
      )}
    </div>
  );
}
