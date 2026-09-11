import { Eyebrow } from "@/app/ui";

import type { BacklogFilter } from "./filter";
import { FilterBar } from "./filter-bar";
import { QueueSelectedButton } from "./queue-selected";
import { ReestimateAllButton } from "./reestimate-all";
import { IssueSelectionProvider } from "./selection";
import { ISSUES_EYEBROW, ISSUES_SUBLINE, type IssuesReadings, headline } from "./view";

import "./issues.css";

/**
 * Issue intake ([#115](https://github.com/NobuData/ouroboros/issues/115)) —
 * `docs/mockups/03-issues.html` from its page head, with the filter bar under it
 * ([#116](https://github.com/NobuData/ouroboros/issues/116)).
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
 * {@link IssueSelectionProvider} around this screen holds. The table that writes into it is N.3's
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)); until it lands, the count is zero and
 * the button says what it is waiting for.
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
 * The table, the selection bar and the detail panel are N.3–N.5
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)–[#119](https://github.com/NobuData/ouroboros/issues/119))
 * and mount below the bar, inside the same provider.
 *
 * @param props.readings What the reader was able to read, and why not for the rest.
 * @param props.filter The filter the address carries — what the readings were read for.
 * @param props.organizationId The workspace, for the bar's focus-repository sync.
 * @param props.mayAdminister Whether this reader is an `owner` or an `admin` — the roles
 *   **Re-estimate all** is drawn for.
 * @param props.mayContribute Whether this reader may queue issues — every role but `viewer`.
 * @returns The screen.
 */
export function IssuesScreen({
  readings,
  filter,
  organizationId,
  mayAdminister,
  mayContribute,
}: Readonly<{
  readings: IssuesReadings;
  filter: BacklogFilter;
  organizationId: string;
  mayAdminister: boolean;
  mayContribute: boolean;
}>) {
  const { counts, facets, repos } = readings;

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
      </main>
    </IssueSelectionProvider>
  );
}
