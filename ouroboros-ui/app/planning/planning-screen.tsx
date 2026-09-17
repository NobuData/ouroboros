import { Button, Card, CardHead, EmptyState, Eyebrow, Tag } from "@/app/ui";

import { BacklogHealthCard } from "./backlog-health-card";
import { SHARE_LABEL, SHARE_SOON_NOTE } from "./gantt";
import { PlanningBanner } from "./planning-banner";
import {
  CARD_UNREAD_NOTE,
  planningFailureReason,
  planningFailures,
  planningHeadline,
  planningReadCount,
} from "./states";
import { GeneratorCard } from "./generator-card";
import { trackerOptions } from "./generator";
import { NewRoadmap } from "./new-roadmap";
import { RoadmapGantt } from "./roadmap-gantt";
import { TrackerSyncCard } from "./tracker-sync-card";
import {
  IMPORT_JIRA_LABEL,
  IMPORT_JIRA_SOON_NOTE,
  PLANNING_EYEBROW,
  PLANNING_SUBLINE,
  PLANNING_TITLE,
  type PlanningReadings,
  ROADMAP_EMPTY_NOTE,
  ROADMAP_EMPTY_TITLE,
  ROADMAP_NO_EPICS_NOTE,
  ROADMAP_NO_EPICS_TITLE,
  ROADMAP_REGION_ID,
  ROADMAP_UNREAD,
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
 * (`c-5`, AM.3 [#285](https://github.com/NobuData/ouroboros/issues/285) —
 * `app/planning/tracker-sync-card.tsx` and `app/planning/backlog-health-card.tsx`), and the roadmap
 * card full width below (`c-12`, AM.4 [#286](https://github.com/NobuData/ouroboros/issues/286) —
 * `app/planning/roadmap-gantt.tsx`). Every region now draws real data, and **a failed read degrades
 * that card alone** rather than the page — which is why each card is handed the whole `readings`
 * object and decides for itself what it could not say. The roadmap card is headed from the real
 * roadmap read, so a roadmap just created shows here; its **Share ↗** is AN.4
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

  // Said once, above the grid — see `planning-banner.tsx` for why the cards no longer say it.
  const failures = planningFailures(readings);

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

      {failures.length > 0 && (
        <PlanningBanner
          headline={planningHeadline(failures, planningReadCount(readings))}
          reason={planningFailureReason(failures)}
        />
      )}

      <div className="planning__grid">
        <div className="planning__generator">
          <GeneratorCard
            batch={readings.batch}
            catalog={readings.catalog}
            mayAdminister={mayAdminister}
            mayContribute={mayContribute}
            sources={readings.sources}
            trackers={trackers}
          />
        </div>
        <div className="planning__side">
          <TrackerSyncCard readings={readings} />
          <BacklogHealthCard readings={readings} />
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
    return <EmptyState note={CARD_UNREAD_NOTE} title={ROADMAP_UNREAD} />;
  }

  if (roadmap.value.lanes.length === 0) {
    // A roadmap that exists but has no lanes is a different sentence from no roadmap at all: the
    // card's own head is already saying its name above this.
    const named = roadmap.value.name !== null;

    return (
      <EmptyState
        note={named ? ROADMAP_NO_EPICS_NOTE : ROADMAP_EMPTY_NOTE}
        title={named ? ROADMAP_NO_EPICS_TITLE : ROADMAP_EMPTY_TITLE}
      >
        <NewRoadmap
          mayAdminister={mayAdminister}
          roadmap={roadmap.value}
          size="sm"
          tone="default"
        />
      </EmptyState>
    );
  }

  return <RoadmapGantt mayAdminister={mayAdminister} readMonth={readMonth} roadmap={roadmap.value} />;
}
