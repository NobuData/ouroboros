"use client";

import { DELIVERABLES_PREFIX, type DeliverableChip } from "./brief";

/** What the strip takes. */
export interface DeliverablesStripProps {
  /** The chips, in order. */
  readonly chips: readonly DeliverableChip[];
  /** Land on the pipeline's seat — the roadmap document's chip. */
  readonly onLandPipeline: () => void;
}

/**
 * The deliverables strip (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630)) — the
 * kind variants, from what the investigation led to: a bug root cause's **fix draft** and a
 * forensics brief's **culprit** and draft, a roadmap's **roadmap document** (which lands on the
 * pipeline's seat until #631 mounts its card there), a live run, the evidence run. A chip leads
 * where its deliverable lives; a fact with nowhere to go is drawn as a fact.
 *
 * @param props See {@link DeliverablesStripProps}.
 * @returns The strip, or nothing for a brief that led nowhere yet.
 */
export function DeliverablesStrip({ chips, onLandPipeline }: DeliverablesStripProps) {
  if (chips.length === 0) return null;

  return (
    <div aria-label={DELIVERABLES_PREFIX} className="research__led" role="group">
      <span className="research__led-label">{DELIVERABLES_PREFIX}</span>
      {chips.map((chip) => {
        if (chip.target === null) {
          return (
            <span className="research__led-chip" key={chip.key}>
              {chip.label}
            </span>
          );
        }
        if (chip.target.kind === "seat") {
          return (
            <button className="research__led-chip" key={chip.key} onClick={onLandPipeline} type="button">
              {chip.label}
            </button>
          );
        }

        return (
          <a className="research__led-chip" href={chip.target.href} key={chip.key}>
            {chip.label}
          </a>
        );
      })}
    </div>
  );
}
