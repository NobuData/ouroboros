import type { CodeSymbol, LoopCheckRow } from "@/app/api/workflows";
import { EmptyState, cx } from "@/app/ui";

import {
  CHECKS_EMPTY_NOTE,
  CHECKS_FAILED_TITLE,
  CHECKS_HEAD,
  CHECKS_STALE_NOTE,
  CHECK_STATUS_WORDS,
  LOOPBACK_GLYPH,
  OUTLINE_EMPTY_NOTE,
  OUTLINE_HEAD,
  type OutlineRow,
  PANEL_LABEL,
  PANEL_TOGGLE_LABEL,
  STAGE_GLYPH,
  SYMBOLS_FAILED_NOTE,
  TYPES_HEAD,
  backEdgeNote,
  checksStale,
  drawnCheckRows,
  jumpToStageTitle,
} from "./code-panel";
import { CodeToggle } from "./code-toggle";
import type { PanelReadings } from "./code-view";
import { HoverDocCard } from "./hover-doc";

import "./code-panel.css";

/**
 * The code view's right panel — V.5 ([#173](https://github.com/NobuData/ouroboros/issues/173)):
 * mockup 05's `.rp`, beside the editor.
 *
 * Every decision is `code-panel.ts`'s; this draws them. Three sections, each its own degraded region:
 *
 * - **Loop Checks** — W.2's rows, ok/warn/err with their notes, and never an infra row (decision C7).
 *   A refused read says why in place of the rows.
 * - **Types** — the hover-doc card for the symbol at the editor's cursor, or **nothing** when the
 *   table does not describe it.
 * - **Outline** — one button per stage call; a loopback row in the accent with its `back-edge → NN`
 *   note. Pressing one puts the editor's cursor on that stage.
 *
 * ### Below 1000px
 *
 * Mockup 05 hides the panel there. It is hidden here too, and {@link CodePanelToggle} shows it again,
 * under the editor, so its content is never out of reach. Above 1000px the toggle is not drawn and the
 * panel always shows. Both are CSS's doing, so the markup is one in every width and both palettes.
 */

/** What the panel takes. */
export interface CodePanelProps {
  /** Its element id, which the toggle controls. */
  readonly id: string;
  /** Whether the narrow viewport's toggle has shown it. No effect above 1000px. */
  readonly open: boolean;
  /** The Loop Checks and the symbol table, each read or explained. */
  readonly readings: PanelReadings;
  /** The draft's etag as the page last knew it — tells rows about an older file apart. */
  readonly etag: string | null;
  /** The described symbol at the cursor, or `null` for none. */
  readonly symbol: CodeSymbol | null;
  /** The outline's rows. */
  readonly outline: readonly OutlineRow[];
  /** Put the editor's cursor on a stage. */
  readonly onJump: (row: OutlineRow) => void;
}

/** Each check status's modifier. */
const CHECK_CLASS: Readonly<Record<LoopCheckRow["status"], string>> = {
  ok: "code-panel__check code-panel__check--ok",
  warn: "code-panel__check code-panel__check--warn",
  err: "code-panel__check code-panel__check--err",
};

/**
 * The panel.
 *
 * @param props See {@link CodePanelProps}.
 * @returns The aside.
 */
export function CodePanel({ id, open, readings, etag, symbol, outline, onJump }: CodePanelProps) {
  return (
    <aside aria-label={PANEL_LABEL} className={cx("code-panel", open && "code-panel--open")} id={id}>
      <h3 className="code-panel__head">{CHECKS_HEAD}</h3>
      <Checks etag={etag} readings={readings} />

      <h3 className="code-panel__head code-panel__head--later">{TYPES_HEAD}</h3>
      {readings.symbols.ok ? (
        symbol !== null && <HoverDocCard symbol={symbol} />
      ) : (
        <p className="code-panel__quiet">{SYMBOLS_FAILED_NOTE}</p>
      )}

      <h3 className="code-panel__head code-panel__head--later">{OUTLINE_HEAD}</h3>
      {outline.length === 0 ? (
        <p className="code-panel__quiet">{OUTLINE_EMPTY_NOTE}</p>
      ) : (
        <ol className="code-panel__outline">
          {outline.map((row, index) => (
            // Position, not id: a draft that still round-trips may repeat an id.
            <li key={index}>
              <button
                className={cx("code-panel__row", row.loop !== null && "code-panel__row--loopback")}
                onClick={() => onJump(row)}
                title={jumpToStageTitle(row.node)}
                type="button"
              >
                <span className="code-panel__number">{row.number}</span>
                <span aria-hidden className="code-panel__glyph">
                  {row.loop === null ? STAGE_GLYPH : LOOPBACK_GLYPH}
                </span>
                <span className="code-panel__name">{row.node}</span>
                {row.loop !== null && <span className="code-panel__back-edge">{backEdgeNote(row.loop)}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

/**
 * The Loop Checks section's body.
 *
 * @param props.readings The panel's readings.
 * @param props.etag The draft's etag as the page last knew it.
 * @returns The rows and, once a save has moved the draft past them, the note that says so — or why
 *   they could not be read.
 */
function Checks({ readings, etag }: Readonly<{ readings: PanelReadings; etag: string | null }>) {
  if (!readings.checks.ok) {
    return (
      <EmptyState className="code-panel__failed" note={readings.checks.reason} title={CHECKS_FAILED_TITLE} variant="flush" />
    );
  }

  const rows = drawnCheckRows(readings.checks.value);
  if (rows.length === 0) return <p className="code-panel__quiet">{CHECKS_EMPTY_NOTE}</p>;

  return (
    <>
      <ul className="code-panel__checks">
        {rows.map((row) => (
          <li className={CHECK_CLASS[row.status]} key={row.id}>
            <CheckGlyph status={row.status} />
            <span className="code-panel__check-text">
              <span className="sr-only">{CHECK_STATUS_WORDS[row.status]}: </span>
              {row.title}
              {row.note !== undefined && <small className="code-panel__note">{row.note}</small>}
            </span>
          </li>
        ))}
      </ul>
      {checksStale(readings.checks.value, etag) && <p className="code-panel__quiet">{CHECKS_STALE_NOTE}</p>}
    </>
  );
}

/**
 * A check's glyph, as the mockup draws it: `✓` in the ok hue, the warn dot, the error mark.
 *
 * @param props.status The row's status.
 * @returns The glyph, hidden from assistive technology — the row says its status in words.
 */
function CheckGlyph({ status }: Readonly<{ status: LoopCheckRow["status"] }>) {
  switch (status) {
    case "ok":
      return (
        <span aria-hidden className="code-panel__icon code-panel__icon--ok">
          ✓
        </span>
      );
    case "warn":
      return (
        <span aria-hidden className="code-panel__icon">
          <span className="code-panel__dot" />
        </span>
      );
    case "err":
      return (
        <span aria-hidden className="code-panel__icon code-panel__icon--err">
          ✕
        </span>
      );
  }
}

/** What the toggle takes. */
export interface CodePanelToggleProps {
  /** The panel's element id. */
  readonly controls: string;
  /** Whether the panel is shown. */
  readonly open: boolean;
  /** Show or hide it. */
  readonly onToggle: () => void;
}

/**
 * The narrow viewport's way to the panel: a disclosure button, drawn only below 1000px.
 *
 * @param props See {@link CodePanelToggleProps}.
 * @returns The button.
 */
export function CodePanelToggle({ controls, open, onToggle }: CodePanelToggleProps) {
  return (
    <CodeToggle
      className="code-panel-toggle"
      controls={controls}
      label={PANEL_TOGGLE_LABEL}
      onToggle={onToggle}
      open={open}
    />
  );
}
