import { useId } from "react";

import { Card, CardHead, Chip } from "@/app/ui";

import { EVIDENCE_LABEL, GUARDRAILS_TITLE, type GuardrailRowView, type GuardrailsView, type MarkTone, NO_VERDICTS } from "./cards";

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

/**
 * One verdict: its mark and dot, its sentence, the secrets disclosure where it applies, and its
 * evidence behind a disclosure — open from the start on a failure.
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
          <dl className="run-guard__facts">
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
