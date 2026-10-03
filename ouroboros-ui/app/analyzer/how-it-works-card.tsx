"use client";

import { useId } from "react";

import { Card, CardHead } from "@/app/ui";

import { useAnalyzer } from "./analyzer-store";
import {
  CORRELATE_LINE,
  HOW_IT_WORKS_TITLE,
  LOCALITY_LINK,
  LOCALITY_NOTE,
  LOCALITY_URL,
  NOT_READ_LABEL,
  STEPS,
  SYNTHESIZE_LINE,
  ingestLine,
} from "./measurements-view";

/**
 * Mockup 18's **How it works** (BW.5, [#520](https://github.com/NobuData/ouroboros/issues/520))
 * — the three steps, each line a statement about the pipeline as it ran.
 *
 * **01 Ingest** is written from the newest run's corpus manifest: the classes it read, a class the
 * window held none of saying so, and — apart from the line, labelled *not read* — any source the
 * deployment does not have, with the manifest's own reason. A deployment with no rig telemetry
 * export is told that, not shown `rig telemetry` among what was ingested. **02 Correlate** and
 * **03 Synthesize** are the mockup's sentences: what attribution ranks a shift against, and the
 * three kinds of suggestion the composer writes.
 *
 * The footer's claim — *nothing leaves the tenant* — is about architecture, so it links to where
 * the security model argues it.
 *
 * @returns The card.
 */
export function HowItWorksCard() {
  const { page } = useAnalyzer();
  const titleId = useId();
  const ingest = page === null ? null : ingestLine(page.run?.manifest ?? null);
  const [first, second, third] = STEPS;

  return (
    <Card aria-busy={page === null || undefined} aria-labelledby={titleId} as="section" className="analyzer-hiw">
      <CardHead title={HOW_IT_WORKS_TITLE} titleId={titleId} />
      <ol className="analyzer-hiw__steps">
        <li className="analyzer-hiw__step">
          <StepLabel name={first.name} number={first.number} />
          {ingest === null ? (
            <div aria-hidden="true" className="analyzer-hiw__skeleton" />
          ) : (
            <>
              <p className="analyzer-hiw__desc">{ingest.read}</p>
              {ingest.absent.map((source) => (
                <p className="analyzer-hiw__absent" key={source.source}>
                  <span className="analyzer-hiw__flag">{NOT_READ_LABEL}</span> {source.name} — {source.reason}
                </p>
              ))}
            </>
          )}
        </li>
        <li className="analyzer-hiw__step">
          <StepLabel name={second.name} number={second.number} />
          <p className="analyzer-hiw__desc">{CORRELATE_LINE}</p>
        </li>
        <li className="analyzer-hiw__step">
          <StepLabel name={third.name} number={third.number} />
          <p className="analyzer-hiw__desc">{SYNTHESIZE_LINE}</p>
        </li>
      </ol>
      <p className="analyzer-hiw__foot">
        {LOCALITY_NOTE}{" "}
        <a className="analyzer-hiw__link" href={LOCALITY_URL} rel="noreferrer" target="_blank">
          {LOCALITY_LINK}
        </a>
      </p>
    </Card>
  );
}

/**
 * A step's label — the mockup's `.h-lbl`: its number, faint, then its name.
 *
 * @param props.number `01`, `02`, `03`.
 * @param props.name The step's name.
 * @returns The label.
 */
function StepLabel({ number, name }: Readonly<{ number: string; name: string }>) {
  return (
    <p className="analyzer-hiw__label">
      <span className="analyzer-hiw__number">{number}</span> {name}
    </p>
  );
}
