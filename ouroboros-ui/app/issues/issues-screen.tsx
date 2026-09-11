import { Eyebrow } from "@/app/ui";

import { BacklogTable } from "./backlog-table";
import type { BacklogFilter } from "./filter";
import { FilterBar } from "./filter-bar";
import { FIRST_PAGE } from "./paging";
import { QueueSelectedButton } from "./queue-selected";
import { ReestimateAllButton } from "./reestimate-all";
import { IssueSelectionProvider } from "./selection";
import { ISSUES_EYEBROW, ISSUES_SUBLINE, type IssuesReadings, headline } from "./view";

import "./issues.css";

/**
 * Issue intake ([#115](https://github.com/NobuData/ouroboros/issues/115)) —
 * `docs/mockups/03-issues.html` from its page head, with the filter bar under it
 * ([#116](https://github.com/NobuData/ouroboros/issues/116)) and the backlog table under that
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome of
 * its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll container,
 * and the sidebar's **Issues** entry is how a reader arrives. It is a component rather than markup
 * written in the route, for the reason every screen here is: it can then be rendered and asserted
 * on without Next.js's routing around it.
 *
 * ### The head carries two cross-cutting truths
 *
 * *The data is real*: the sentence is the mockup's and its two figures are the service's, so the
 * seeded workspace reads *"9 open issues. 7 already sized."* rather than the mockup's 42 and 38. A
 * backlog that could not be counted says so, with the service's reason, rather than drawing zeros.
 *
 * *The selection reaches outside the table*: **Queue N selected ⟳** reads the selection the
 * {@link IssueSelectionProvider} around this screen holds, and the table's checkboxes write it.
 * The provider is above everything the route re-renders, which is what lets a selection survive
 * a chip press and a page turn.
 *
 * ### The filter bar is a query-string editor
 *
 * The card under the head is the mockup's `.filter-bar`, and every control in it lives in the
 * address (decision K8): the bar writes the next `?repo=&labels=&state=&sort=&q=`, this screen is
 * rendered again from it, and the head's counts follow the repository the bar selected — the
 * contract scopes them that way, and by nothing else in the bar. It scrolls with the page, as the
 * mockup draws it; the page's one sticky slot is the selection bar's, N.4's
 * ([#118](https://github.com/NobuData/ouroboros/issues/118)).
 *
 * ### The table is the address's page, kept fresh
 *
 * The card under the bar draws the page the route read for this address and then polls for it,
 * so a status the pipeline moves is a pill that moves. Its page is the address's `&page=`, beside
 * the bar's five controls and reset by every one of them. The selection bar and the detail panel
 * are N.4's and N.5's ([#118](https://github.com/NobuData/ouroboros/issues/118),
 * [#119](https://github.com/NobuData/ouroboros/issues/119)) and mount beside it, inside the same
 * provider.
 *
 * @param props.readings What the reader was able to read, and why not for the rest.
 * @param props.filter The filter the address carries — what the readings were read for.
 * @param props.page The page the address carries. Defaults to the first.
 * @param props.organizationId The workspace, for the bar's focus-repository sync.
 * @param props.mayAdminister Whether this reader is an `owner` or an `admin` — the roles
 *   **Re-estimate all** is drawn for.
 * @param props.mayContribute Whether this reader may queue issues and sync the backlog — every
 *   role but `viewer`.
 * @returns The screen.
 */
export function IssuesScreen({
  readings,
  filter,
  page = FIRST_PAGE,
  organizationId,
  mayAdminister,
  mayContribute,
}: Readonly<{
  readings: IssuesReadings;
  filter: BacklogFilter;
  page?: number;
  organizationId: string;
  mayAdminister: boolean;
  mayContribute: boolean;
}>) {
  const { counts, facets, repos, listing, readAt } = readings;

  return (
    <IssueSelectionProvider>
      <main className="issues">
        <div className="issues__head">
          <div className="issues__headings">
            <Eyebrow>{ISSUES_EYEBROW}</Eyebrow>
            <h1 className="issues__title">{headline(counts)}</h1>
            {!counts.ok && (
              <p className="issues__unread" role="status">
                {counts.reason}
              </p>
            )}
            <p className="issues__sub">{ISSUES_SUBLINE}</p>
          </div>
          <div className="issues__actions">
            {mayAdminister && <ReestimateAllButton counts={counts} />}
            <QueueSelectedButton mayContribute={mayContribute} />
          </div>
        </div>
        <FilterBar facets={facets} filter={filter} organizationId={organizationId} repos={repos} />
        <BacklogTable
          filter={filter}
          listing={listing}
          mayContribute={mayContribute}
          page={page}
          readAt={readAt}
        />
      </main>
    </IssueSelectionProvider>
  );
}
