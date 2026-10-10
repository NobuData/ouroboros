"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { Reading } from "@/app/api/reading";
import type { BriefCite } from "@/app/api/research";
import { Button, Card, CardHead, Chip, EmptyState, Tag, cx } from "@/app/ui";

import {
  BRIEF_UNAVAILABLE_TITLE,
  EXPORT_LABEL,
  FEATURED_TITLE,
  type FeaturedBrief,
  type LedgerOutcome,
  NO_BRIEF_NOTE,
  NO_BRIEF_TITLE,
  STATUS_PILLS,
  briefExportUrl,
  briefTitle,
  deliverableChips,
  offersDraftEpic,
  panelSource,
  sourceRowId,
  sourcesTag,
} from "./brief";
import { readBriefLedger } from "./brief-actions";
import { BriefText } from "./brief-body";
import { DeliverablesStrip } from "./brief-deliverables";
import { DraftEpicAction } from "./brief-draft-epic";
import { MatrixTable } from "./brief-matrix";
import { ProposedFromGaps } from "./brief-proposed";
import { LedgerSheet, SourcesPanel } from "./brief-sources";
import { RELOAD_LABEL } from "./composer";
import { TINT_CLASS } from "./composer-kinds";
import { BRIEF_REGION, regionTitleId } from "./view";

/** What the card takes. */
export interface BriefCardProps {
  /** The brief and its investigation's detail. */
  readonly featured: FeaturedBrief;
  /** Whether this reader may draft work from it — `owner`, `admin` or `member`. */
  readonly mayDraft: boolean;
  /** Land on the pipeline's seat — a roadmap document's chip. */
  readonly onLandPipeline: () => void;
  /** The id the card's heading carries, so a seat can name its region by it. */
  readonly titleId?: string;
}

/**
 * Mockup 22's featured investigation card (CN.4,
 * [#630](https://github.com/NobuData/ouroboros/issues/630)) — the deliverable made visible: the
 * head with the kind, the title, the source count and depth, the status, **Export brief ↗** and
 * **Draft epic from gaps →**; the capability matrix beside the brief's text; the sources panel
 * and the proposals beside them; and, for every kind, the strip of what the investigation led
 * to. The investigations list (#632) opens the same card for any investigation.
 *
 * **Citations are usable.** A marker in the text, or a cite in a cell's tooltip, scrolls to the
 * source's row in the panel and lights it; a cite the panel does not list — a cell's record no
 * claim cites — opens the whole ledger on that record.
 *
 * **Both actions are obviously safe.** The export is a download of the service's own file on this
 * origin; the draft action files nothing and lands in Planning for review.
 *
 * @param props See {@link BriefCardProps}.
 * @returns The card.
 */
export function BriefCard({ featured, mayDraft, onLandPipeline, titleId }: BriefCardProps) {
  const router = useRouter();
  const { brief, detail } = featured;
  const [lit, setLit] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ open: boolean; focus: string | null }>({ open: false, focus: null });
  const [ledger, setLedger] = useState<LedgerOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  /** Open the whole ledger, reading it the first time. */
  const openLedger = useCallback(
    (focus: string | null) => {
      setSheet({ open: true, focus });
      if (ledger === null) void readBriefLedger(brief.investigation.id).then(setLedger);
    },
    [brief.investigation.id, ledger],
  );

  /** Follow a marker: the panel's row when it lists the record, else the ledger on it. */
  const follow = useCallback(
    (cite: BriefCite) => {
      const source = panelSource(brief.sources.panel, cite.sourceId);
      if (source === undefined) {
        openLedger(cite.sourceId);
        return;
      }

      setLit(source.sourceId);
      document.getElementById(sourceRowId(source))?.scrollIntoView({ block: "center" });
    },
    [brief.sources.panel, openLedger],
  );

  const pill = STATUS_PILLS[brief.investigation.status];
  const chips = deliverableChips(detail, brief);

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        beside={
          <span className="research__brief-beside">
            <span className={cx("research__kind-chip", TINT_CLASS[brief.investigation.tintKey])}>
              {brief.investigation.kindLabel}
            </span>
            <Tag>{sourcesTag(brief)}</Tag>
          </span>
        }
        className="research__brief-head"
        title={
          <>
            <span className="research__brief-id">{brief.investigation.displayId}</span>
            {" — "}
            <span className="research__brief-title">{briefTitle(brief)}</span>
          </>
        }
        titleId={titleId}
        trailing={
          <span className="research__brief-actions">
            <Chip tone={pill.tone}>{pill.label}</Chip>
            <Button
              download={brief.exportFilename}
              href={briefExportUrl(brief.investigation.id)}
              size="sm"
              tone="ghost"
            >
              {EXPORT_LABEL}
            </Button>
            {offersDraftEpic(brief) && (
              <DraftEpicAction
                investigationId={brief.investigation.id}
                mayDraft={mayDraft}
                onDrafted={(href) => router.push(href)}
                onRefusal={setRefusal}
              />
            )}
          </span>
        }
      />

      <div className="research__brief">
        <div className="research__brief-main">
          {brief.matrix !== null && <MatrixTable matrix={brief.matrix} onCite={follow} />}
          <BriefText onCite={follow} paragraphs={brief.brief.paragraphs} />
        </div>
        <div className="research__brief-side">
          <SourcesPanel
            cited={brief.sources.cited}
            lit={lit}
            onAll={() => openLedger(null)}
            panel={brief.sources.panel}
          />
          {brief.proposed !== null && <ProposedFromGaps proposed={brief.proposed} />}
          <DeliverablesStrip chips={chips} onLandPipeline={onLandPipeline} />
        </div>
      </div>

      {refusal !== null && (
        <p className="research__refusal" role="alert">
          {refusal}
        </p>
      )}

      <LedgerSheet
        displayId={brief.investigation.displayId}
        focus={sheet.focus}
        ledger={ledger}
        onClose={() => setSheet({ open: false, focus: null })}
        open={sheet.open}
        panel={brief.sources.panel}
      />
    </Card>
  );
}

/** What the featured seat takes. */
export interface FeaturedBriefSeatProps {
  /** The featured brief, none yet, or why it could not be read. */
  readonly reading: Reading<FeaturedBrief | null>;
  /** Whether this reader may draft work from it. */
  readonly mayDraft: boolean;
  /** Land on the pipeline's seat. */
  readonly onLandPipeline: () => void;
}

/**
 * The **Featured brief** seat's card (CN.4): the newest brief, or an honest note — no
 * investigation has finished yet, or the brief could not be read and a reload is offered.
 *
 * @param props See {@link FeaturedBriefSeatProps}.
 * @returns The card.
 */
export function FeaturedBriefSeat({ reading, mayDraft, onLandPipeline }: FeaturedBriefSeatProps) {
  const router = useRouter();
  const titleId = regionTitleId(BRIEF_REGION);

  if (!reading.ok) {
    return (
      <Card aria-labelledby={titleId} as="section">
        <CardHead title={FEATURED_TITLE} titleId={titleId} />
        <EmptyState note={reading.reason} title={BRIEF_UNAVAILABLE_TITLE} variant="flush">
          <Button onClick={() => router.refresh()} tone="ghost">
            {RELOAD_LABEL}
          </Button>
        </EmptyState>
      </Card>
    );
  }
  if (reading.value === null) {
    return (
      <Card aria-labelledby={titleId} as="section">
        <CardHead title={FEATURED_TITLE} titleId={titleId} />
        <EmptyState note={NO_BRIEF_NOTE} title={NO_BRIEF_TITLE} variant="flush" />
      </Card>
    );
  }

  return (
    <BriefCard featured={reading.value} mayDraft={mayDraft} onLandPipeline={onLandPipeline} titleId={titleId} />
  );
}
