import { Card, CardHead, Eyebrow, cx } from "@/app/ui";

import { LOADING_LABEL, SKELETON_ROWS } from "./states";
import {
  RESEARCH_EYEBROW,
  RESEARCH_HEADLINE,
  RESEARCH_SUBLINE,
  type RegionPlace,
  type ResearchRegion,
  type ResearchRegionId,
  regionsAt,
} from "./view";

import "./research.css";

/**
 * What the reader sees while Research's reads are in flight (CN.7,
 * [#633](https://github.com/NobuData/ouroboros/issues/633)) — the densest page in the product
 * must not blank while it loads.
 *
 * `app/(app)/research/loading.tsx` returns this, and Next.js wraps the page in a Suspense
 * boundary with it as the fallback, so the shell and the sidebar paint at once and only the page
 * waits (the DASH-I.7 pattern, [#86](https://github.com/NobuData/ouroboros/issues/86)).
 *
 * ### The head is the real head, and so is every card's title
 *
 * The eyebrow, the headline and the subline are copy that depends on no read, so they are drawn
 * as themselves; so are the six cards' titles, which are the regions' own. Only the two actions
 * are bars — one of them is inert for a role the skeleton cannot know.
 *
 * ### Under each title, that region's shape
 *
 * The grid is the page's (`regionsAt`), so the seats are where they will be. Inside each, the
 * bars reserve what the card draws: the composer's question field, its kind segments, its chips
 * and its foot; one row per tool and per watch item; the brief's paragraphs beside its sources;
 * the pipeline's document beside its issue rows; one row per investigation. The counts are the
 * seeded workspace's (`SKELETON_ROWS`), the height most first paints resolve to.
 *
 * **It says one thing to a screen reader.** The bars carry no text and are `aria-hidden`; the
 * `<main>` is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide.
 */

/** The class for each place — the seats' own, so the skeleton sits in the page's grid. */
const PLACE_CLASS: Record<RegionPlace, string> = {
  main: "research__seat--main",
  side: "research__seat--side",
  wide: "research__seat--wide",
};

/**
 * A run of identical bars.
 *
 * @param props.count How many.
 * @param props.className Each bar's class.
 * @returns The bars.
 */
function Bars({ count, className }: Readonly<{ count: number; className: string }>) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <span className={cx("research__sk-bar", className)} key={index} />
      ))}
    </>
  );
}

/** The bars standing in for each region's card body. */
const BODIES: Readonly<Record<ResearchRegionId, () => React.ReactNode>> = {
  composer: () => (
    <div className="research__sk-stack">
      <span className="research__sk-bar research__sk-bar--field" />
      <div className="research__sk-row">
        <Bars className="research__sk-bar--seg" count={SKELETON_ROWS.kinds} />
      </div>
      <div className="research__sk-row">
        <Bars className="research__sk-bar--chip" count={SKELETON_ROWS.chips} />
      </div>
      <div className="research__sk-row research__sk-row--end">
        <span className="research__sk-bar research__sk-bar--line" />
        <span className="research__sk-bar research__sk-bar--action" />
      </div>
    </div>
  ),
  tools: () => (
    <div className="research__sk-stack">
      <Bars className="research__sk-bar--side-row" count={SKELETON_ROWS.tools} />
    </div>
  ),
  watch: () => (
    <div className="research__sk-stack">
      <Bars className="research__sk-bar--side-row" count={SKELETON_ROWS.watch} />
    </div>
  ),
  brief: () => (
    <div className="research__sk-split">
      <div className="research__sk-stack">
        <Bars className="research__sk-bar--para" count={SKELETON_ROWS.brief} />
      </div>
      <div className="research__sk-stack">
        <Bars className="research__sk-bar--side-row" count={SKELETON_ROWS.brief} />
      </div>
    </div>
  ),
  pipeline: () => (
    <div className="research__sk-split">
      <span className="research__sk-bar research__sk-bar--doc" />
      <div className="research__sk-stack">
        <Bars className="research__sk-bar--side-row" count={SKELETON_ROWS.pipeline} />
      </div>
    </div>
  ),
  investigations: () => (
    <div className="research__sk-stack">
      <Bars className="research__sk-bar--list-row" count={SKELETON_ROWS.list} />
    </div>
  ),
};

/**
 * One region's seat, with its title and its bars.
 *
 * @param props.region The region.
 * @returns The grid cell.
 */
function SkeletonSeat({ region }: Readonly<{ region: ResearchRegion }>) {
  return (
    <div className={cx("research__seat", PLACE_CLASS[region.place])}>
      <Card>
        <CardHead title={region.title} />
        <div aria-hidden="true">{BODIES[region.id]()}</div>
      </Card>
    </div>
  );
}

/**
 * The seats at one place.
 *
 * @param place The place.
 * @returns Its skeleton seats, in the page's order.
 */
function seats(place: RegionPlace) {
  return regionsAt(place).map((region) => <SkeletonSeat key={region.id} region={region} />);
}

/**
 * The skeleton.
 *
 * @returns The page's frame, with bars where the reads' regions will be.
 */
export function ResearchSkeleton() {
  return (
    <main aria-busy="true" aria-label={LOADING_LABEL} className="research">
      <div className="research__head">
        <div className="research__headings">
          <Eyebrow>{RESEARCH_EYEBROW}</Eyebrow>
          <h1 className="research__title">{RESEARCH_HEADLINE}</h1>
          <p className="research__sub">{RESEARCH_SUBLINE}</p>
        </div>
        <div aria-hidden="true" className="research__actions">
          <span className="research__sk-bar research__sk-bar--action" />
          <span className="research__sk-bar research__sk-bar--action" />
        </div>
      </div>
      <div className="research__grid">
        {seats("main")}
        <div className="research__side">{seats("side")}</div>
        {seats("wide")}
      </div>
    </main>
  );
}
