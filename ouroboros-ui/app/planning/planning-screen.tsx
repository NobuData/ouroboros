import { Button, Card, CardHead, EmptyState, Eyebrow, Tag } from "@/app/ui";

import { SHARE_LABEL, SHARE_SOON_NOTE } from "./gantt";
import { GeneratorCard } from "./generator-card";
import { SOURCES_UNREAD, trackerOptions } from "./generator";
import { NewRoadmap } from "./new-roadmap";
import { RoadmapGantt } from "./roadmap-gantt";
import {
  IMPORT_JIRA_LABEL,
  IMPORT_JIRA_SOON_NOTE,
  PLANNING_EYEBROW,
  PLANNING_SUBLINE,
  PLANNING_TITLE,
  type PlanningReadings,
  type PlanningRegion,
  ROADMAP_EMPTY_NOTE,
  ROADMAP_EMPTY_TITLE,
  ROADMAP_REGION_ID,
  ROADMAP_UNREAD,
  SIDE_REGIONS,
  SOON_MARK,
  roadmapTitle,
} from "./view";

import "./planning.css";

/**
 * Planning ([#283](https://github.com/NobuData/ouroboros/issues/283)) —
 * `docs/mockups/09-planning.html`'s page head and the frame its three regions sit in.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome of
 * its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll
 * container, and the sidebar's **Planning** entry is how a reader arrives. The mockup's topbar is
 * superseded by the shell.
 *
 * ### The head: verbatim copy, honest actions
 *
 * **Import from Jira** is AN.3 ([#291](https://github.com/NobuData/ouroboros/issues/291)) and does
 * not exist, so it is an inert ghost button marked *soon*, its note naming the issue — it opens
 * nothing. **New roadmap** is live for an owner or an admin and names a roadmap by creating its
 * first epic (`app/planning/new-roadmap.tsx`).
 *
 * ### The grid: the mockup's 7 / 5, then 12
 *
 * The generator card (`c-7`, AM.2 [#284](https://github.com/NobuData/ouroboros/issues/284) —
 * `app/planning/generator-card.tsx`) beside a column of the tracker sync and backlog health cards
 * (`c-5`, AM.3 [#285](https://github.com/NobuData/ouroboros/issues/285)), and the roadmap card full
 * width below (`c-12`, AM.4 [#286](https://github.com/NobuData/ouroboros/issues/286) —
 * `app/planning/roadmap-gantt.tsx`). Each region that a later issue fills says which issue, rather
 * than drawing a mock of what it will hold. The roadmap card is headed from the real roadmap read, so a
 * roadmap just created shows here; its **Share ↗** is AN.4
 * ([#292](https://github.com/NobuData/ouroboros/issues/292)), inert and marked *soon*.
 *
 * @param props.readings What the reader was able to read, and why not for the rest.
 * @param props.mayAdminister Whether this reader is an `owner` or an `admin` — the roles the
 *   roadmap's writes and the generator's push are for.
 * @param props.mayContribute Whether this reader may draft tickets — `owner`, `admin` or `member`.
 * @param props.readMonth The month the page was read in (`gantt.ts`'s `currentMonth`), which a roadmap
 *   with no months at all draws its columns from.
 * @returns The screen.
 */
export function PlanningScreen({
  readings,
  mayAdminister,
  mayContribute,
  readMonth,
}: Readonly<{
  readings: PlanningReadings;
  mayAdminister: boolean;
  mayContribute: boolean;
  readMonth: number;
}>) {
  const { roadmap } = readings;
  const trackers = trackerOptions(readings.sources.ok ? readings.sources.value.items : [], readings.catalog);

  return (
    <main className="planning">
      <div className="planning__head">
        <div className="planning__headings">
          <Eyebrow>{PLANNING_EYEBROW}</Eyebrow>
          <h1 className="planning__title">{PLANNING_TITLE}</h1>
          <p className="planning__sub">{PLANNING_SUBLINE}</p>
        </div>
        <div className="planning__actions">
          <Button reason={IMPORT_JIRA_SOON_NOTE} tone="ghost">
            {/* The space keeps the accessible name two words — "Import from Jira soon". */}
            {IMPORT_JIRA_LABEL}{" "}
            <span className="planning__soon">{SOON_MARK}</span>
          </Button>
          <NewRoadmap mayAdminister={mayAdminister} roadmap={roadmap.ok ? roadmap.value : null} />
        </div>
      </div>

      <div className="planning__grid">
        <div className="planning__generator">
          <GeneratorCard
            batch={readings.batch}
            mayAdminister={mayAdminister}
            mayContribute={mayContribute}
            trackers={trackers}
            trackersUnread={readings.sources.ok ? null : `${SOURCES_UNREAD} ${readings.sources.reason}`}
          />
        </div>
        <div className="planning__side">
          {SIDE_REGIONS.map((region) => (
            <RegionCard key={region.id} region={region} />
          ))}
        </div>
        <div className="planning__roadmap">
          <Card aria-labelledby={ROADMAP_REGION_ID} as="section">
            <CardHead
              beside={
                roadmap.ok && roadmap.value.window !== null ? (
                  <Tag>{roadmap.value.window}</Tag>
                ) : undefined
              }
              title={roadmapTitle(roadmap)}
              titleId={ROADMAP_REGION_ID}
              trailing={
                <Button reason={SHARE_SOON_NOTE} size="sm" tone="ghost">
                  {SHARE_LABEL}{" "}
                  <span className="planning__soon">{SOON_MARK}</span>
                </Button>
              }
            />
            <RoadmapBody mayAdminister={mayAdminister} readMonth={readMonth} readings={readings} />
          </Card>
        </div>
      </div>
    </main>
  );
}

/**
 * One region a later issue fills: its card, its title, and the line naming that issue.
 *
 * @param props.region The region.
 * @returns The card.
 */
function RegionCard({ region }: Readonly<{ region: PlanningRegion }>) {
  return (
    <Card aria-labelledby={region.id} as="section" className="planning__region">
      <CardHead title={region.title} titleId={region.id} />
      <EmptyState note={region.note} />
    </Card>
  );
}

/**
 * The roadmap card's body: why it could not be read, the empty state, or the gantt.
 *
 * @param props.readings What the frame read.
 * @param props.mayAdminister Whether this reader may change the roadmap.
 * @param props.readMonth The month the page was read in.
 * @returns The body.
 */
function RoadmapBody({
  readings,
  mayAdminister,
  readMonth,
}: Readonly<{ readings: PlanningReadings; mayAdminister: boolean; readMonth: number }>) {
  const { roadmap } = readings;

  if (!roadmap.ok) {
    return <EmptyState note={roadmap.reason} title={ROADMAP_UNREAD} />;
  }

  if (roadmap.value.lanes.length === 0) {
    return <EmptyState note={ROADMAP_EMPTY_NOTE} title={ROADMAP_EMPTY_TITLE} />;
  }

  return <RoadmapGantt mayAdminister={mayAdminister} readMonth={readMonth} roadmap={roadmap.value} />;
}
