"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import type { Reading } from "@/app/api/reading";
import type { InvestigationList } from "@/app/api/research";
import { claimPaneLanding, landOn } from "@/app/shell/pane-anchor";

import type { FeaturedBrief } from "./brief";
import { FeaturedBriefSeat } from "./brief-card";
import type { ComposerReadings } from "./composer";
import { ComposerCard } from "./composer-card";
import type { OpenedInvestigation } from "./investigations";
import { InvestigationsCard } from "./investigations-card";
import type { ProgressSourceFactory } from "./progress";
import { ResearchHead } from "./research-head";
import { ResearchSeat } from "./research-seat";
import {
  BRIEF_REGION,
  COMPOSER_REGION,
  type LibraryFilters,
  PIPELINE_REGION,
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
  /** The featured brief — the newest finished investigation's — read on the server (#630). */
  readonly brief: Reading<FeaturedBrief | null>;
  /** Whether this reader may draft work from a brief — `owner`, `admin` or `member`. */
  readonly mayDraft: boolean;
  /** The investigations the address asked for — the active rows, or the library's page (#632). */
  readonly investigations: Reading<InvestigationList>;
  /** The library's facets, from the address. */
  readonly filters: LibraryFilters;
  /** The investigation the address opened, read on the server; null for none. */
  readonly opened: { readonly id: string; readonly reading: Reading<OpenedInvestigation> } | null;
  /** How the composer and the live rows open their progress streams. A test hands in a fake. */
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
 * says what is coming until its card exists. **The composer's card** (CN.2, #628) and **the
 * featured brief's** (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630)) are here: a
 * run that produces a brief lands the reader on the brief's seat and re-reads the page, so the
 * new brief is the one featured; a roadmap brief's document chip lands on the pipeline's seat —
 * the placeholder until CN.5 (#631) mounts its card there, which needs no change here.
 *
 * **The head's actions land on a seat.** *New investigation* scrolls to the composer's, focuses
 * it and rings it; the library's address (`?view=library`) does the same for the investigations
 * seat when the page opens. The ring lasts until focus moves on. **The investigations card** (CN.6,
 * [#632](https://github.com/NobuData/ouroboros/issues/632)) fills the last seat: the active rows,
 * or — at the library's address — every investigation with its facets, and a row opened
 * full-width; its links land on the brief's and the pipeline's seats through the same landing.
 *
 * @param props See {@link ResearchScreenProps}.
 * @returns The screen.
 */
export function ResearchScreen({
  view,
  startReason,
  composer,
  brief,
  mayDraft,
  investigations,
  filters,
  opened,
  openProgress,
}: ResearchScreenProps) {
  const router = useRouter();
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

  // A finished run's brief is read in the brief's seat — and the page is re-read, so the newest
  // brief is the one featured there.
  const onBriefReady = useCallback(() => {
    enter(BRIEF_REGION);
    router.refresh();
  }, [enter, router]);

  const onLandPipeline = useCallback(() => enter(PIPELINE_REGION), [enter]);
  const onLand = useCallback((seat: typeof BRIEF_REGION | typeof PIPELINE_REGION) => enter(seat), [enter]);
  const featuredId = brief.ok && brief.value !== null ? brief.value.brief.investigation.id : null;
  const kinds = composer.kinds.ok ? composer.kinds.value.kinds : [];

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
    brief: <FeaturedBriefSeat mayDraft={mayDraft} onLandPipeline={onLandPipeline} reading={brief} />,
    investigations: (
      <InvestigationsCard
        featuredId={featuredId}
        filters={filters}
        initial={investigations}
        kinds={kinds}
        mayDraft={mayDraft}
        onLand={onLand}
        openSource={openProgress}
        opened={opened}
        view={view}
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
