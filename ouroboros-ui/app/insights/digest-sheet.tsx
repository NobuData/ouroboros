"use client";

import { useState } from "react";

import type { InsightsDigest } from "@/app/api/insights";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Toggle } from "@/app/ui";

import { type DigestSheetReadings, readDigestSheet, setDigestSubscription } from "./digest-actions";
import {
  DIGEST_LEAD,
  DIGEST_TITLE,
  DIGEST_TOGGLE,
  DIGEST_UNREADABLE,
  MAILPIT_NOTE,
  PREVIEW_FRAME_TITLE,
  PREVIEW_HEADING,
  PREVIEW_UNREADABLE,
  UNSUBSCRIBE_NOTE,
  previewSubject,
  scheduleLine,
  toggleReason,
} from "./digest-view";

/** The sheet's state: closed, opening (reading), or open on what was read. */
type SheetState =
  | { readonly phase: "closed" }
  | { readonly phase: "loading" }
  | { readonly phase: "open"; readonly readings: DigestSheetReadings };

/**
 * The head's **Email weekly digest** action and the subscribe sheet it opens
 * (BK.6, [#447](https://github.com/NobuData/ouroboros/issues/447)).
 *
 * Pressing it reads the reader's digest and its preview (`digest-actions.ts`) and opens the shell's
 * modal overlay on them: the weekly toggle, when and to whom it is sent, the preview — the
 * service's own HTML render in a **sandboxed** frame, so what is shown is what is sent and nothing
 * in it can run — the development mailpit note, and the way back out. Every sentence is
 * `digest-view.ts`'s.
 *
 * A failure reading either half degrades the sheet, never the page: an unreadable digest says so
 * in the sheet, and an unrenderable preview leaves the toggle working.
 *
 * @param props.label The button's text — the mockup's.
 * @returns The button, and the sheet while open.
 */
export function DigestAction({ label }: Readonly<{ label: string }>) {
  const [state, setState] = useState<SheetState>({ phase: "closed" });

  /** Read, then open on what was read. A second press while reading does nothing. */
  function open(): void {
    if (state.phase !== "closed") return;

    setState({ phase: "loading" });
    void readDigestSheet().then((readings) => setState({ phase: "open", readings }));
  }

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={open}
        reason={state.phase === "loading" ? "Opening…" : undefined}
        tone="ghost"
      >
        {label}
      </Button>
      <ShellOverlay
        label={DIGEST_TITLE}
        onClose={() => setState({ phase: "closed" })}
        open={state.phase === "open"}
      >
        {state.phase === "open" && (
          <DigestSheet
            onDigest={(digest) =>
              setState({ phase: "open", readings: { ...state.readings, digest: { ok: true, value: digest } } })
            }
            readings={state.readings}
          />
        )}
      </ShellOverlay>
    </>
  );
}

/**
 * The sheet's body.
 *
 * @param props.readings The digest and its preview, each read or explained.
 * @param props.onDigest Hand back the digest as a change left it.
 * @returns The body.
 */
function DigestSheet({
  readings,
  onDigest,
}: Readonly<{ readings: DigestSheetReadings; onDigest: (digest: InsightsDigest) => void }>) {
  return (
    <div className="insights-digest">
      <h2 className="shell-overlay__title">{DIGEST_TITLE}</h2>
      <p className="insights-digest__lead">{DIGEST_LEAD}</p>
      {readings.digest.ok ? (
        <DigestSubscription digest={readings.digest.value} onDigest={onDigest} />
      ) : (
        <p className="insights-digest__error" role="alert">
          {DIGEST_UNREADABLE}
        </p>
      )}
      {process.env.NODE_ENV !== "production" && <p className="insights-digest__note">{MAILPIT_NOTE}</p>}
      <DigestPreview preview={readings.preview} />
    </div>
  );
}

/**
 * The toggle, the schedule and the unsubscribe path.
 *
 * @param props.digest The digest, as served.
 * @param props.onDigest Hand back the digest as a change left it.
 * @returns The subscription block.
 */
function DigestSubscription({
  digest,
  onDigest,
}: Readonly<{ digest: InsightsDigest; onDigest: (digest: InsightsDigest) => void }>) {
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  /** Flip the reader's own subscription — once at a time. */
  function flip(): void {
    if (saving || toggleReason(digest, false) !== undefined) return;

    setSaving(true);
    setRefusal(null);
    void setDigestSubscription(!digest.subscribed).then((outcome) => {
      setSaving(false);
      if (outcome.ok) onDigest(outcome.value);
      else setRefusal(outcome.reason);
    });
  }

  return (
    <div className="insights-digest__subscription">
      <Toggle checked={digest.subscribed} label={DIGEST_TOGGLE} onClick={flip} reason={toggleReason(digest, saving)} />
      <p className="insights-digest__schedule">{scheduleLine(digest)}</p>
      {digest.subscribed && <p className="insights-digest__note">{UNSUBSCRIBE_NOTE}</p>}
      {refusal !== null && (
        <p className="insights-digest__error" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * The preview — the service's render, sandboxed.
 *
 * @param props.preview The rendered digest, or why it could not be rendered.
 * @returns The preview block.
 */
function DigestPreview({ preview }: Readonly<{ preview: DigestSheetReadings["preview"] }>) {
  return (
    <section className="insights-digest__preview" aria-label={PREVIEW_HEADING}>
      <h3 className="insights-digest__heading">{PREVIEW_HEADING}</h3>
      {preview.ok ? (
        <>
          <p className="insights-digest__subject">{previewSubject(preview.value)}</p>
          {/* No permissions at all: the digest is static HTML with every style inline. */}
          <iframe
            className="insights-digest__frame"
            sandbox=""
            srcDoc={preview.value.html}
            title={PREVIEW_FRAME_TITLE}
          />
        </>
      ) : (
        <p className="insights-digest__note">{PREVIEW_UNREADABLE}</p>
      )}
    </section>
  );
}

