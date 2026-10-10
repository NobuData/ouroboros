"use client";

import { useCallback, useEffect, useState } from "react";

import { claimPaneLanding, landOn } from "@/app/shell/pane-anchor";

import { ResearchHead } from "./research-head";
import { ResearchSeat } from "./research-seat";
import {
  COMPOSER_REGION,
  type RegionPlace,
  type ResearchRegionId,
  type ResearchView,
  landingRegion,
  regionsAt,
} from "./view";

import "./research.css";

/** What the screen takes. */
export interface ResearchScreenProps {
  /** Which view the address opened — the page from its top, or the library. */
  readonly view: ResearchView;
  /** Whether this reader may start an investigation. */
  readonly mayStart: boolean;
}

/**
 * Bring a region's seat into the pane and put focus on it.
 *
 * @param id The region.
 * @returns Whether the seat was on the page to land on.
 */
function enterRegion(id: ResearchRegionId): boolean {
  const seat = document.getElementById(id);
  if (seat === null) return false;

  landOn(seat);
  // The scroll above is the landing; focus must not move the pane a second time.
  seat.focus({ preventScroll: true });

  return true;
}

/**
 * Research (CN.1, [#627](https://github.com/NobuData/ouroboros/issues/627)) —
 * `docs/mockups/22-research.html`'s head and the frame its six regions mount into.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome of
 * its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll
 * container and the sidebar's **Research** entry is how a reader arrives. The mockup's topbar is
 * superseded by the shell.
 *
 * **The grid is the mockup's.** The composer at `c-7` beside a `c-5` side column — the tools card
 * over the regression watch — then the featured brief, the roadmap pipeline and the
 * investigations list at `c-12`. Each region is a seat (`app/research/research-seat.tsx`) that
 * says what is coming until CN.2–CN.6 mount their cards in it.
 *
 * **The head's actions land on a seat.** *New investigation* scrolls to the composer's, focuses
 * it and rings it; the library's address (`?view=library`) does the same for the investigations
 * seat when the page opens. The ring lasts until focus moves on.
 *
 * @param props See {@link ResearchScreenProps}.
 * @returns The screen.
 */
export function ResearchScreen({ view, mayStart }: ResearchScreenProps) {
  const landing = landingRegion(view);
  const [highlight, setHighlight] = useState<ResearchRegionId | null>(landing);

  // The address's own landing: by now the seats are in the document. The claim is what keeps it —
  // the shell returns the pane to its top when a route with no fragment becomes current, in an
  // effect that may run after this one (`claimPaneLanding`, `app/shell/pane-anchor.ts`).
  useEffect(() => {
    if (landing === null) return undefined;

    const release = claimPaneLanding();
    enterRegion(landing);

    return release;
  }, [landing]);

  const enter = useCallback((id: ResearchRegionId) => {
    if (enterRegion(id)) setHighlight(id);
  }, []);

  /**
   * The seats at one place.
   *
   * @param place The place.
   * @returns Its seats, in the page's order.
   */
  const seats = (place: RegionPlace) =>
    regionsAt(place).map((region) => (
      <ResearchSeat
        highlighted={highlight === region.id}
        key={region.id}
        onLeave={() => setHighlight((current) => (current === region.id ? null : current))}
        region={region}
      />
    ));

  return (
    <main className="research">
      <ResearchHead mayStart={mayStart} onNewInvestigation={() => enter(COMPOSER_REGION)} />
      <div className="research__grid">
        {seats("main")}
        <div className="research__side">{seats("side")}</div>
        {seats("wide")}
      </div>
    </main>
  );
}
