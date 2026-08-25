"use client";

/**
 * The card foot's **Test connection** and its result note
 * ([#230](https://github.com/NobuData/ouroboros/issues/230), decision **P9**).
 *
 * Press → `testConnection` → the note draws what the provider said, whole: `✓ 200 · 38ms`,
 * `△ 503 upstream · retrying`, `✗ key rejected (401)`. The service composed the sentence
 * through the adapter taxonomy and wrote it to the connection's status and the health strip's
 * snapshot before answering, so this island then asks the router to re-read the card — which
 * is how the head's pill and the chips beside it change without this island knowing how to
 * draw either. The note is this island's own state and survives that re-render.
 *
 * **The bounded retry is real and small.** An `upstream` failure — the one the mockup draws
 * as `△ 503 upstream · retrying` — earns exactly one automatic re-test after
 * `RETRY_DELAY_MS`; `live.ts` argues why only that class and only once. While it waits the
 * note keeps saying `retrying`, marked busy, and whatever the second answer is stands.
 *
 * Pending is plain state rather than `useTransition`'s flag, for the reason
 * `app/models/simulate-sheet.tsx` gives: this state is *drawn*, and an entangled transition
 * would hold a note's answer behind an unrelated write.
 */

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { Button, cx } from "@/app/ui";

import { TEST_CONNECTION } from "./cards";
import {
  MODELS_NOT_REFRESHED,
  TESTING,
  TEST_READ_ONLY,
  type TestNote,
  retryDelayFor,
  testNote,
} from "./live";
import { testConnection } from "./live-actions";

/** What the island takes. */
export interface TestConnectionProps {
  /** The connection. */
  readonly connectionId: string;
  /** Whether this reader may press the button. */
  readonly mayAdminister: boolean;
}

/** The modifier each tone adds — written out so the sheet's own suite can find each rendered. */
const NOTE_TONE_CLASS: Record<TestNote["tone"], string> = {
  ok: "providers-card__test-note--ok",
  warn: "providers-card__test-note--warn",
  err: "providers-card__test-note--err",
};

/** The note as drawn: the result, or a refusal of the request, or nothing yet. */
type Drawn =
  | { readonly kind: "none" }
  | { readonly kind: "pending" }
  | {
      readonly kind: "result";
      readonly note: TestNote;
      /** What to say under a pass whose refresh did not happen, or null. */
      readonly aside: string | null;
      /** Whether the one automatic retry is on its way. */
      readonly retrying: boolean;
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The button and the note.
 *
 * @param props See {@link TestConnectionProps}.
 * @returns The button, inert for a member, and the note slot beside it.
 */
export function TestConnection({ connectionId, mayAdminister }: TestConnectionProps) {
  const router = useRouter();
  const noteId = useId();
  const [drawn, setDrawn] = useState<Drawn>({ kind: "none" });
  const [retryAt, setRetryAt] = useState<number | null>(null);

  /**
   * Run one test and draw its answer.
   *
   * @param retry Whether this is the one automatic retry — which draws no pending state over
   *   the note it is retrying, and earns no retry of its own.
   */
  async function run(retry: boolean): Promise<void> {
    if (!retry) setDrawn({ kind: "pending" });

    const outcome = await testConnection(connectionId);

    if (!outcome.ok) {
      setDrawn({ kind: "refused", reason: outcome.reason });
      return;
    }

    const delay = retry ? null : retryDelayFor(outcome.result);
    const aside =
      outcome.models !== null && !outcome.models.ok
        ? `${MODELS_NOT_REFRESHED}: ${outcome.models.reason}`
        : null;

    setDrawn({ kind: "result", note: testNote(outcome.result), aside, retrying: delay !== null });
    setRetryAt(delay);
    router.refresh();
  }

  useEffect(() => {
    if (retryAt === null) return;

    const timer = setTimeout(() => {
      setRetryAt(null);
      void run(true);
    }, retryAt);

    return () => clearTimeout(timer);
    // `run` reads only `connectionId`, which is stable for the life of the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryAt]);

  const pending = drawn.kind === "pending" || (drawn.kind === "result" && drawn.retrying);
  const reason = !mayAdminister ? TEST_READ_ONLY : pending ? TESTING : undefined;

  return (
    <>
      <Button
        aria-describedby={drawn.kind === "none" ? undefined : noteId}
        onClick={() => void run(false)}
        reason={reason}
        size="sm"
        tone="ghost"
      >
        {TEST_CONNECTION}
      </Button>
      <span
        aria-busy={pending || undefined}
        aria-live="polite"
        className={cx(
          "providers-card__test-note",
          drawn.kind === "result" && NOTE_TONE_CLASS[drawn.note.tone],
          drawn.kind === "refused" && "providers-card__test-note--err",
          pending && "providers-card__test-note--pending",
        )}
        id={drawn.kind === "none" ? undefined : noteId}
        role={drawn.kind === "none" ? undefined : drawn.kind === "refused" ? "alert" : "status"}
      >
        {drawn.kind === "pending" && TESTING}
        {drawn.kind === "refused" && drawn.reason}
        {drawn.kind === "result" && (
          <>
            <span aria-hidden="true" className="providers-card__test-glyph">
              {drawn.note.glyph}
            </span>{" "}
            {drawn.note.text}
            {drawn.aside !== null && (
              <span className="providers-card__test-aside">{drawn.aside}</span>
            )}
          </>
        )}
      </span>
    </>
  );
}
