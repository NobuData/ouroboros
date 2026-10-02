"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { MetricMethodology } from "@/app/api/insights";

import {
  CAVEATS_HEADING,
  FORMULA_HEADING,
  PROXY_NOTE,
  SOURCES_HEADING,
  methodologyVersion,
} from "./view";

/**
 * A KPI card's label, and the methodology popover it opens
 * (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)).
 *
 * **The popover is the honesty mechanism made visible**: every figure on the row can say how it
 * was computed — the formula, the planes it reads, its caveats and the registry version that
 * produced it — straight from BI.1's registry entry
 * ([#432](https://github.com/NobuData/ouroboros/issues/432)), which BJ.2 sends beside the figure.
 * Nothing is written here: *Merged w/o human edits* states the I6 definition because the
 * registry's formula is the I6 definition, the one the scoreboard (#439) shares.
 *
 * A disclosure rather than a modal, the PR page's waiver popover's shape
 * (`app/prs/gates-card.tsx`): the label is a button saying whether it is open (`aria-expanded`),
 * and Escape or a press outside the card closes it. Escape hands focus back to the label.
 *
 * @param props.label The card's caption — the button's text.
 * @param props.methodology The registry entry to print.
 * @returns The label, and beneath it the popover while open.
 */
export function KpiMethodology({
  label,
  methodology,
}: Readonly<{ label: string; methodology: MetricMethodology }>) {
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    /** Close on Escape, and give focus back to the label. */
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;

      setOpen(false);
      trigger.current?.focus();
    }

    /** Close on a press outside the label and its popover. */
    function onPress(event: MouseEvent): void {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
    };
  }, [open]);

  return (
    <span className="insights-kpi__caption" ref={root}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        className="insights-kpi__label"
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        type="button"
      >
        {label}
      </button>
      {open && (
        <span aria-labelledby={titleId} className="insights-kpi__popover" id={panelId} role="group">
          <span className="insights-kpi__popover-title" id={titleId}>
            {methodology.title}
          </span>
          <span className="insights-kpi__popover-heading">{FORMULA_HEADING}</span>
          <span className="insights-kpi__popover-text">{methodology.formula}</span>
          <span className="insights-kpi__popover-heading">{SOURCES_HEADING}</span>
          <span className="insights-kpi__popover-text">{methodology.sources.join(" · ")}</span>
          <span className="insights-kpi__popover-heading">{CAVEATS_HEADING}</span>
          <span className="insights-kpi__popover-text">{methodology.caveats}</span>
          {methodology.proxy && <span className="insights-kpi__popover-text">{PROXY_NOTE}</span>}
          <span className="insights-kpi__popover-version">{methodologyVersion(methodology)}</span>
        </span>
      )}
    </span>
  );
}
