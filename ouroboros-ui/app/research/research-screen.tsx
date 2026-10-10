"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";

import { claimPaneLanding, landOn } from "@/app/shell/pane-anchor";

import type { ComposerReadings } from "./composer";
import { ComposerCard } from "./composer-card";
import type { ProgressSourceFactory } from "./progress";
import { ResearchHead } from "./research-head";
import { ResearchSeat } from "./research-seat";
import {
  BRIEF_REGION,
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
  /**
   * Why this reader may not start an investigation here, or null when they may. Decided on the
   * server from the reader's roles and the workspace's setting (`composer.ts` § `startGate`).
   */
  readonly startReason: string | null;
  /** What the composer is drawn from, read on the server. */
  readonly composer: ComposerReadings;
  /** How the composer opens its progress stream. A test hands in a fake. */
  readonly openProgress?: ProgressSourceFactory;
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
 * says what is coming until CN.2–CN.6 mount their cards in it. **The composer's card is here**
 * (CN.2, [#628](https://github.com/NobuData/ouroboros/issues/628)): it fills its seat, and a run
 * that produces a brief lands the reader on the brief's seat — the placeholder until CN.4 (#630)
 * mounts the brief card there, which needs no change here.
 *
 * **The head's actions land on a seat.** *New investigation* scrolls to the composer's, focuses
 * it and rings it; the library's address (`?view=library`) does the same for the investigations
 * seat when the page opens. The ring lasts until focus moves on.
 *
 * @param props See {@link ResearchScreenProps}.
 * @returns The screen.
 */
export function ResearchScreen({ view, startReason, composer, openProgress }: ResearchScreenProps) {
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

  // A finished run's brief is read in the brief's seat.
  const onBriefReady = useCallback(() => enter(BRIEF_REGION), [enter]);

  /** The cards that exist, by the region they fill. */
  const cards: Partial<Record<ResearchRegionId, ReactNode>> = {
    composer: (
      <ComposerCard
        gate={startReason}
        onBriefReady={onBriefReady}
        openSource={openProgress}
        readings={composer}
      />
    ),
  };

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
      >
        {cards[region.id]}
      </ResearchSeat>
    ));

  return (
    <main className="research">
      <ResearchHead onNewInvestigation={() => enter(COMPOSER_REGION)} startReason={startReason} />
      <div className="research__grid">
        {seats("main")}
        <div className="research__side">{seats("side")}</div>
        {seats("wide")}
      </div>
    </main>
  );
}
