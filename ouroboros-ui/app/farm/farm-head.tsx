"use client";

import { Button, Eyebrow } from "@/app/ui";

import { ENROLL_COPY_ID, ENROLL_MEMBER_REASON, ENROLL_POOL_FIELD_ID } from "./enroll";
import { useFarm } from "./farm-store";
import { usePools } from "./pool-store";
import { POOLS_UNREAD } from "./pools";
import { SUBMIT_BUILD, SUBMIT_NO_POOLS, SUBMIT_UNREAD } from "./submit";
import { useSubmit } from "./submit-store";
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
 * **The actions are honest.** One of the three has nothing to open yet, so it is an inert button
 * carrying a *soon* mark, and its tooltip names the issue that builds its destination
 * (`FARM_ACTIONS`). **✦ Build Analyzer** is a link to a page that does not exist in the mockup;
 * here it navigates nowhere.
 *
 * **Pool settings acts** (AI.4, [#259](https://github.com/NobuData/ouroboros/issues/259)): it
 * opens the pool configuration sheet — the one the pools card's `Configure →` opens, held by
 * `app/farm/pool-store.tsx` so the two doors lead to one room. Every member may open it; with no
 * page read there are no pools to configure, and it says so instead.
 *
 * **+ Enroll runner acts** (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)): it
 * moves focus to the enroll card's first control, which scrolls the card into the pane's view on
 * the narrow layouts where it sits under the table. A button that moves focus rather than a
 * fragment link, because the pane — not the window — is the scroll container and focus is the
 * one mechanism that scrolls it natively. For a reader who may not mint it is the same control,
 * inert, with the reason.
 *
 * **Submit build** (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)) stands
 * beside the mockup's three — the issue's *head-adjacent* door to the submit dialog, the other
 * being each pool's row (`app/farm/submit-store.tsx`). Unlike **+ Enroll runner** it is
 * **absent, not inert, for a member**: the issue asks that a member session see no action
 * affordances at all. For an administrator with no pool to submit to it is inert and says why.
 *
 * @param props.mayAdminister Whether this reader may mint an enrollment token and submit a
 *   build — `app/api/membership.ts`'s `mayAdminister`, decided once by the route.
 * @returns The head.
 */
export function FarmHead({ mayAdminister = false }: Readonly<{ mayAdminister?: boolean }>) {
  const { page } = useFarm();
  const { pools, openSheet } = usePools();
  const { open: openSubmit } = useSubmit();
  const submitReason =
    pools === null ? SUBMIT_UNREAD : pools.length === 0 ? SUBMIT_NO_POOLS : undefined;

  return (
    <div className="farm__head">
      <div className="farm__headings">
        <Eyebrow>{FARM_EYEBROW}</Eyebrow>
        <h1 className="farm__title">{farmHeadline(page)}</h1>
        <p className="farm__sub">{FARM_SUBLINE}</p>
      </div>
      <div className="farm__actions">
        {mayAdminister && (
          <Button onClick={() => openSubmit()} reason={submitReason} tone="ghost">
            {SUBMIT_BUILD}
          </Button>
        )}
        {FARM_ACTIONS.map((action) =>
          action.id === "pools" ? (
            <Button
              key={action.id}
              onClick={openSheet}
              reason={pools === null ? POOLS_UNREAD : undefined}
              tone={action.tone}
            >
              {action.label}
            </Button>
          ) : action.soonNote === null ? (
            <Button
              key={action.id}
              onClick={focusEnrollCard}
              reason={mayAdminister ? undefined : ENROLL_MEMBER_REASON}
              tone={action.tone}
            >
              {action.label}
            </Button>
          ) : (
            <Button key={action.id} reason={action.soonNote} tone={action.tone}>
              {/* The space keeps the accessible name words apart — "✦ Build Analyzer soon". */}
              {action.label}{" "}
              <span className="farm__soon">{SOON_MARK}</span>
            </Button>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * Move the reader to the enroll card: its pool selector, or — in a workspace with no pools, where
 * there is no selector — its copy control, which is where the reason is said.
 */
function focusEnrollCard(): void {
  const target =
    document.getElementById(ENROLL_POOL_FIELD_ID) ?? document.getElementById(ENROLL_COPY_ID);

  target?.focus();
}
