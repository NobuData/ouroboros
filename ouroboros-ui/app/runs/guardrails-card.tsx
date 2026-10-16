import { useId } from "react";

import { Card, CardHead, Chip } from "@/app/ui";

import {
  EVIDENCE_LABEL,
  GUARDRAILS_TITLE,
  type GuardrailMode,
  type GuardrailRowView,
  type GuardrailsView,
  type MarkTone,
  NO_VERDICTS,
} from "./cards";

/** A row's mark, per tone — the mockup's `.mark.ok` / `.mark.idle`, and err and warn. */
const MARK_CLASS: Readonly<Record<MarkTone, string>> = {
  ok: "run-guard__mark run-guard__mark--ok",
  err: "run-guard__mark run-guard__mark--err",
  idle: "run-guard__mark run-guard__mark--idle",
  warn: "run-guard__mark run-guard__mark--warn",
};

/** A row's dot, per tone. */
const DOT_CLASS: Readonly<Record<MarkTone, string>> = {
  ok: "run-guard__dot run-guard__dot--ok",
  err: "run-guard__dot run-guard__dot--err",
  idle: "run-guard__dot run-guard__dot--idle",
  warn: "run-guard__dot run-guard__dot--warn",
};

/** A failed row's note, per mode — a block fail in the err tone, a warn fail in the warn tone. */
const NOTE_CLASS: Readonly<Record<GuardrailMode, string>> = {
  block: "run-guard__note run-guard__note--block",
  warn: "run-guard__note run-guard__note--warn",
};

/** A failed row's evidence box, per mode; any other row keeps the plain box. */
const FACTS_CLASS: Readonly<Record<GuardrailMode, string>> = {
  block: "run-guard__facts",
  warn: "run-guard__facts run-guard__facts--warn",
};

/**
 * One verdict: its mark and dot, its sentence, the secrets disclosure where it applies, and its
 * evidence behind a disclosure — open from the start on a failure. A failure says what it did to
 * the run (#315): a `block` fail keeps its `✗` and says the run needs a person; a `warn` fail
 * takes the warn tone and `!` and says it did not stop the run.
 *
 * @param props.row The row, from `guardrailsView`.
 * @returns The list item.
 */
function Row({ row }: Readonly<{ row: GuardrailRowView }>) {
  return (
    <li aria-label={row.accessibleName} className="run-guard__row">
      <div className="run-guard__line">
        <span aria-hidden className={MARK_CLASS[row.tone]}>
          {row.glyph}
        </span>
        <span aria-hidden className={DOT_CLASS[row.tone]} />
        <span className="run-guard__text">
          {row.text}
          {row.caption !== null && <span className="run-guard__caption"> {row.caption}</span>}
          {row.failMode !== null && row.note !== null && (
            <span className={NOTE_CLASS[row.failMode]}> {row.note}</span>
          )}
        </span>
        {row.disclosure !== null && (
          <span className="run-guard__info" title={row.disclosure}>
            <span aria-hidden>ⓘ</span>
            <span className="sr-only">{row.disclosure}</span>
          </span>
        )}
      </div>

      {row.evidence.length > 0 && (
        <details className="run-guard__evidence" open={row.expanded}>
          <summary className="run-guard__summary">{EVIDENCE_LABEL}</summary>
          <dl className={row.failMode === null ? "run-guard__facts" : FACTS_CLASS[row.failMode]}>
            {row.evidence.map((line) => (
              <div className="run-guard__fact" key={line.term}>
                <dt className="run-guard__term">{line.term}</dt>
                <dd className={line.mono ? "run-guard__value run-guard__value--mono" : "run-guard__value"}>
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

/**
 * Mockup 10's *Guardrails* ([#313](https://github.com/NobuData/ouroboros/issues/313)) — AP.3's
 * stored verdicts, one row each, under a pill computed from them.
 *
 * Nothing here is a default: a card with no verdicts says so under a `not evaluated` pill, and
 * the secrets row's `ⓘ` carries the ruleset's own statement of what a pass does not mean — as
 * a tooltip for a pointer, and as text for a screen reader.
 *
 * @param props.view The card, from `guardrailsView`.
 * @returns The card.
 */
export function GuardrailsCard({ view }: Readonly<{ view: GuardrailsView }>) {
  const titleId = useId();

  return (
    <Card aria-labelledby={titleId} as="section" className="run-guardrails">
      <CardHead
        title={GUARDRAILS_TITLE}
        titleId={titleId}
        trailing={
          <Chip dot={view.pill.dot} tone={view.pill.tone}>
            {view.pill.label}
          </Chip>
        }
      />

      {view.rows.length === 0 ? (
        <p className="run-card__empty">{NO_VERDICTS}</p>
      ) : (
        <ul className="run-guard__list">
          {view.rows.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </ul>
      )}

      <hr className="run-card__divider" />
      <p className="run-guard__policy">{view.policy}</p>
    </Card>
  );
}
