"use client";

import { useId, useState } from "react";

import type { InterventionCause } from "@/app/api/insights";
import { HBars } from "@/app/charts";
import { Button } from "@/app/ui";

import { INTERVENTIONS_TITLE, type KeyedBar, NO_INTERVENTIONS, interventionsView, isCause } from "./bars-view";
import { useInsights } from "./insights-store";
import { type RecategorizeActions, RecategorizePanel } from "./recategorize-panel";
import { SeriesCard, SeriesEmptyState, SeriesSkeleton } from "./series-card";

/** The disclosure's label, closed and open. */
export const RECATEGORIZE_OPEN = "Re-categorize…";
export const RECATEGORIZE_CLOSE = "Done";

/**
 * Mockup 15's **WHERE LOOPS STILL NEED HUMANS** card (BK.4, [#445](https://github.com/NobuData/ouroboros/issues/445)).
 *
 * The `HBars` primitive over BJ.2's intervention causes — the top cause lifted, the smallest
 * receded — with the `30d · 20 total` tag, and under it the service's computed line, *"Fix the
 * top row and interventions drop ~40%."*: arithmetic the service did, drawn only when it had a
 * true sentence to give.
 *
 * **The bars are editable.** BI.3's rules ([#434](https://github.com/NobuData/ouroboros/issues/434))
 * will sometimes be wrong, so a member and above can open the re-categorize panel, pick a bar and
 * one of its events, and move it. The page is then re-read, and the bars **and** the computed
 * line re-render from what the service now counts. A viewer gets no control at all; the service
 * refuses their direct call whatever the screen draws.
 *
 * @param props.mayRecategorize Whether this reader is `owner`, `admin` or `member`.
 * @param props.actions Test seam for the panel's Server Actions; the screen passes none.
 * @returns The card.
 */
export function InterventionsCard({
  mayRecategorize,
  actions,
}: Readonly<{ mayRecategorize: boolean; actions?: RecategorizeActions }>) {
  const { page, retry } = useInsights();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (page === null) {
    return (
      <SeriesCard busy tag={null} title={INTERVENTIONS_TITLE} width="third">
        <SeriesSkeleton width="third" />
      </SeriesCard>
    );
  }

  const view = interventionsView(page.hbars.interventions, page.range);
  const causes = view.rows.filter((row): row is KeyedBar & { key: InterventionCause } => isCause(row.key));
  const editable = mayRecategorize && causes.length > 0;

  return (
    <SeriesCard tag={view.tag} title={view.title} width="third">
      {view.empty !== null ? (
        <SeriesEmptyState empty={NO_INTERVENTIONS} />
      ) : (
        <HBars key={page.range} label={view.label} rows={view.rows} />
      )}
      {view.line !== null && <p className="insights-series__foot">{view.line}</p>}
      {editable && (
        <div className="insights-recat__frame">
          <Button
            aria-controls={open ? panelId : undefined}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            size="sm"
            tone="ghost"
          >
            {open ? RECATEGORIZE_CLOSE : RECATEGORIZE_OPEN}
          </Button>
          {open && (
            <div id={panelId}>
              <RecategorizePanel actions={actions} bars={causes} onMoved={retry} range={page.range} />
            </div>
          )}
        </div>
      )}
    </SeriesCard>
  );
}
