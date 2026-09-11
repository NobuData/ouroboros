"use client";

import { Button, EmptyState } from "@/app/ui";

import { requestClearFilters } from "./clear-filters";
import { PAST_END } from "./paging";
import {
  CHOOSE_REPOS_LABEL,
  CLEAR_FILTERS_LABEL,
  CLEAR_MARK,
  CLEAR_NOTE,
  CLEAR_TITLE,
  FIRST_SYNC_NOTE,
  FIRST_SYNC_TITLE,
  type GuidanceKind,
  NO_REPOS_MEMBER_NOTE,
  NO_REPOS_NOTE,
  NO_REPOS_TITLE,
  NO_TOKEN_MEMBER_NOTE,
  NO_TOKEN_NOTE,
  NO_TOKEN_TITLE,
  OPEN_SETTINGS_LABEL,
  OPEN_SETTINGS_SOON,
  chooseReposHref,
} from "./states";
import { NOTHING_MIRRORED, NOTHING_MIRRORED_NOTE, NO_MATCHES, NO_MATCHES_NOTE } from "./table";

/**
 * What the backlog card draws instead of rows — the designed states the mockup does not
 * show ([#120](https://github.com/NobuData/ouroboros/issues/120)), each naming the actual
 * situation and the actual next step.
 *
 * ### Every state is the #46 empty state, and none is a blank region
 *
 * Six kinds, decided by `app/issues/states.ts` and drawn here as the design system's
 * `EmptyState` with a control or a sentence under it. The copy is that module's; what this
 * decides is only what sits below the note, and that is where the roles come in.
 *
 * ### The controls respect roles, and never lie about a destination
 *
 * A guidance control is drawn for a reader who can act on it and replaced by a sentence
 * naming who can for one who cannot — the providers page's rule for its own first-run
 * state: the empty state is the first thing a new member sees, and an inert button with a
 * tooltip is a worse first sentence than one that says who can act.
 *
 * **Choose repos** is a link to sign-in's step 2, which exists. **Open settings** is not: the
 * ticket-source settings surface is [#141](https://github.com/NobuData/ouroboros/issues/141)'s
 * and unbuilt, so an admin's control is drawn inert with that as its reason — the dashboard's
 * treatment for a destination that is not built, and #49's *no dead nav links* — rather than
 * linking somewhere that answers `404`. **Clear filters** asks the bar to do what its own
 * **Clear all** does (`app/issues/clear-filters.ts`), since only the bar can clear the
 * header's focus repository and settle its search box in the right order.
 *
 * @param props.kind Which state — `null` for a page past the end of the backlog, whose way
 *   back is the footer's link beneath this.
 * @param props.mayAdminister Whether this reader is an `owner` or an `admin` — the roles the
 *   two guidance controls are drawn for.
 * @param props.workspaceSlug The workspace's slug, for **Choose repos**'s address.
 * @returns The empty state.
 */
export function Guidance({
  kind,
  mayAdminister,
  workspaceSlug,
}: Readonly<{ kind: GuidanceKind | null; mayAdminister: boolean; workspaceSlug: string }>) {
  switch (kind) {
    case null:
      return <EmptyState title={PAST_END} />;

    case "matches":
      return (
        <EmptyState className="issues-guidance" note={NO_MATCHES_NOTE} title={NO_MATCHES}>
          <Button onClick={requestClearFilters} size="sm" tone="ghost">
            {CLEAR_FILTERS_LABEL}
          </Button>
        </EmptyState>
      );

    case "no-token":
      return (
        <EmptyState className="issues-guidance" note={NO_TOKEN_NOTE} title={NO_TOKEN_TITLE}>
          {mayAdminister ? (
            <Button reason={OPEN_SETTINGS_SOON} size="sm" tone="primary">
              {OPEN_SETTINGS_LABEL}
            </Button>
          ) : (
            <p className="issues-guidance__note">{NO_TOKEN_MEMBER_NOTE}</p>
          )}
        </EmptyState>
      );

    case "no-repos":
      return (
        <EmptyState className="issues-guidance" note={NO_REPOS_NOTE} title={NO_REPOS_TITLE}>
          {mayAdminister ? (
            <Button href={chooseReposHref(workspaceSlug)} size="sm" tone="primary">
              {CHOOSE_REPOS_LABEL}
            </Button>
          ) : (
            <p className="issues-guidance__note">{NO_REPOS_MEMBER_NOTE}</p>
          )}
        </EmptyState>
      );

    case "first-sync":
      return (
        <div aria-busy="true" className="issues-guidance--busy" role="status">
          <EmptyState className="issues-guidance" note={FIRST_SYNC_NOTE} title={FIRST_SYNC_TITLE} />
        </div>
      );

    case "clear":
      return (
        <EmptyState
          className="issues-guidance"
          note={CLEAR_NOTE}
          title={
            <>
              <span aria-hidden="true" className="issues-guidance__mark">
                {CLEAR_MARK}
              </span>{" "}
              {CLEAR_TITLE}
            </>
          }
        />
      );

    case "mirrored":
      return <EmptyState note={NOTHING_MIRRORED_NOTE} title={NOTHING_MIRRORED} />;
  }
}
