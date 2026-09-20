"use client";

import { Button, Eyebrow } from "@/app/ui";

import { ENROLL_COPY_ID, ENROLL_MEMBER_REASON, ENROLL_POOL_FIELD_ID } from "./enroll";
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
 * **The actions are honest.** Two of the three have nothing to open yet, so each is an inert
 * button carrying a *soon* mark, and its tooltip names the issue that builds its destination
 * (`FARM_ACTIONS`). **✦ Build Analyzer** in particular is a link to a page that does not exist
 * in the mockup; here it navigates nowhere.
 *
 * **+ Enroll runner acts** (AI.3, [#258](https://github.com/NobuData/ouroboros/issues/258)): it
 * moves focus to the enroll card's first control, which scrolls the card into the pane's view on
 * the narrow layouts where it sits under the table. A button that moves focus rather than a
 * fragment link, because the pane — not the window — is the scroll container and focus is the
 * one mechanism that scrolls it natively. For a reader who may not mint it is the same control,
 * inert, with the reason.
 *
 * @param props.mayAdminister Whether this reader may mint an enrollment token —
 *   `app/api/membership.ts`'s `mayAdminister`, decided once by the route.
 * @returns The head.
 */
export function FarmHead({ mayAdminister = false }: Readonly<{ mayAdminister?: boolean }>) {
  const { page } = useFarm();

  return (
    <div className="farm__head">
      <div className="farm__headings">
        <Eyebrow>{FARM_EYEBROW}</Eyebrow>
        <h1 className="farm__title">{farmHeadline(page)}</h1>
        <p className="farm__sub">{FARM_SUBLINE}</p>
      </div>
      <div className="farm__actions">
        {FARM_ACTIONS.map((action) =>
          action.soonNote === null ? (
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
              {/* The space keeps the accessible name words apart — "Pool settings soon". */}
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
