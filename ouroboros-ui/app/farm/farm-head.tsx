"use client";

import { Button, Eyebrow } from "@/app/ui";

import { useFarm } from "./farm-store";
import { FARM_ACTIONS, FARM_EYEBROW, FARM_SUBLINE, SOON_MARK, farmHeadline } from "./view";

/**
 * The build farm's page head — mockup 08's eyebrow, computed headline, subline and three actions
 * (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)).
 *
 * **The `h1` is live.** `5 runners. 2 pools. 78% cache hits.` is three values in a sentence, so
 * it is read from the farm's store like the tiles under it and moves with them on every poll;
 * how it degrades is `farmHeadline`'s (`app/farm/view.ts`). That is the one reason this is a
 * Client Component — it decides nothing itself.
 *
 * **The actions are honest.** None of the three has anything to open yet, so each is an inert
 * button carrying a *soon* mark, and its tooltip names the issue that builds its destination
 * (`FARM_ACTIONS`). **✦ Build Analyzer** in particular is a link to a page that does not exist
 * in the mockup; here it navigates nowhere.
 *
 * @returns The head.
 */
export function FarmHead() {
  const { page } = useFarm();

  return (
    <div className="farm__head">
      <div className="farm__headings">
        <Eyebrow>{FARM_EYEBROW}</Eyebrow>
        <h1 className="farm__title">{farmHeadline(page)}</h1>
        <p className="farm__sub">{FARM_SUBLINE}</p>
      </div>
      <div className="farm__actions">
        {FARM_ACTIONS.map((action) => (
          <Button key={action.id} reason={action.soonNote} tone={action.tone}>
            {/* The space keeps the accessible name words apart — "Pool settings soon". */}
            {action.label}{" "}
            <span className="farm__soon">{SOON_MARK}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
