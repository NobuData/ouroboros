"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import type { Reading } from "@/app/api/reading";
import type { ResearchRoadmap } from "@/app/api/research";
import { Button, Card, CardHead, EmptyState, cx } from "@/app/ui";

import { TINT_CLASS } from "./composer-kinds";
import {
  type FeaturedPipeline,
  NO_PIPELINE_NOTE,
  NO_PIPELINE_TITLE,
  OPEN_LABEL,
  PIPELINE_TITLE,
  PIPELINE_UNREADABLE,
  RELOAD,
  SKILLS_HREF,
  openReason,
  pipelineTitle,
  skillTitle,
} from "./pipeline";
import { PipelineDocument } from "./pipeline-document";
import { PipelineTracker } from "./pipeline-tracker";
import { regionTitleId } from "./view";

/** What the card takes. */
export interface PipelineCardProps {
  /** The roadmap document, and the kind of investigation it came from. */
  readonly featured: FeaturedPipeline;
  /** Whether the reader may apply and dismiss a suggestion — an `owner` or an `admin`. */
  readonly mayAdminister: boolean;
}

/**
 * The roadmap pipeline card (CN.5, [#631](https://github.com/NobuData/ouroboros/issues/631)) —
 * mockup 22's *from brief to roadmap to issues*: the page's proof that research becomes work.
 *
 * The head names the investigation and the two skills behind the card — each chip a link to the
 * Knowledge registry, where the procedure is read — and **Open ROADMAP.md ↗** goes to the pull
 * request or the committed file. Under it the two steps sit side by side, the document and the
 * tracker, so a reader can check the one against the other (`pipeline-document.tsx`,
 * `pipeline-tracker.tsx`).
 *
 * The card holds the service's latest answer: an apply or a dismissal returns the whole card,
 * and both steps redraw from it. A page re-read replaces it.
 *
 * @param props See {@link PipelineCardProps}.
 * @returns The card.
 */
export function PipelineCard({ featured, mayAdminister }: PipelineCardProps) {
  const titleId = regionTitleId("pipeline");
  // The service's latest answer — the page's reading until a write here returns a newer one.
  const [held, setHeld] = useState(featured.roadmap);
  const [seen, setSeen] = useState(featured.roadmap);

  if (seen !== featured.roadmap) {
    setSeen(featured.roadmap);
    setHeld(featured.roadmap);
  }

  const roadmap: ResearchRoadmap = held;
  const inert = openReason(roadmap);

  return (
    <Card aria-labelledby={titleId} as="section">
      <CardHead
        beside={
          <span className={cx("research__kind-chip", TINT_CLASS[featured.kind.tint])}>{featured.kind.name}</span>
        }
        className="research__brief-head"
        title={pipelineTitle(roadmap)}
        titleId={titleId}
        trailing={
          <span className="research__brief-actions">
            {roadmap.skills.map((skill, index) => (
              <Fragment key={skill.slug}>
                {index > 0 && (
                  <span aria-hidden="true" className="research__skill-arrow">
                    →
                  </span>
                )}
                <a className="research__skill-chip" href={SKILLS_HREF} title={skillTitle(skill)}>
                  {skill.label}
                </a>
              </Fragment>
            ))}
            {roadmap.projection.href === null ? (
              <Button reason={inert ?? undefined} size="sm" tone="ghost" type="button">
                {OPEN_LABEL}
              </Button>
            ) : (
              <Button href={roadmap.projection.href} rel="noreferrer" size="sm" target="_blank" tone="ghost">
                {OPEN_LABEL}
              </Button>
            )}
          </span>
        }
      />

      <div className="research__pipe">
        <PipelineDocument mayAdminister={mayAdminister} onChanged={setHeld} roadmap={roadmap} />
        <PipelineTracker roadmap={roadmap} />
      </div>
    </Card>
  );
}

/** What the seat takes. */
export interface FeaturedPipelineSeatProps {
  /** The roadmap to show, null when the workspace has none, or why it could not be read. */
  readonly reading: Reading<FeaturedPipeline | null>;
  /** Whether the reader may apply and dismiss a suggestion. */
  readonly mayAdminister: boolean;
}

/**
 * The pipeline's seat: the card, or what to say without one.
 *
 * @param props See {@link FeaturedPipelineSeatProps}.
 * @returns The card; *No roadmap yet*; or the reason the read failed, with a way to try again.
 */
export function FeaturedPipelineSeat({ reading, mayAdminister }: FeaturedPipelineSeatProps) {
  const router = useRouter();
  const titleId = regionTitleId("pipeline");

  if (!reading.ok) {
    return (
      <Card aria-labelledby={titleId} as="section">
        <CardHead title={PIPELINE_TITLE} titleId={titleId} />
        <EmptyState note={reading.reason} title={PIPELINE_UNREADABLE} variant="flush">
          <Button onClick={() => router.refresh()} tone="ghost">
            {RELOAD}
          </Button>
        </EmptyState>
      </Card>
    );
  }

  if (reading.value === null) {
    return (
      <Card aria-labelledby={titleId} as="section">
        <CardHead title={PIPELINE_TITLE} titleId={titleId} />
        <EmptyState note={NO_PIPELINE_NOTE} title={NO_PIPELINE_TITLE} variant="flush" />
      </Card>
    );
  }

  return (
    <PipelineCard
      featured={reading.value}
      key={reading.value.roadmap.investigation.id}
      mayAdminister={mayAdminister}
    />
  );
}
