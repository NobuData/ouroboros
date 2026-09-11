"use client";

import Link from "next/link";

import { Button } from "@/app/ui";

import type { BacklogFilter } from "./filter";
import {
  FIRST_PAGE,
  FIRST_PAGE_LABEL,
  FIRST_PAGE_REASON,
  LAST_PAGE_REASON,
  NEXT_LABEL,
  PAGES_LABEL,
  type Pagination,
  PREVIOUS_LABEL,
  pageHref,
} from "./paging";

/**
 * The pagination footer — drawn under the table for a backlog beyond a page
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)).
 *
 * ### Pages are addresses
 *
 * The page lives in the query string beside the filter (`app/issues/paging.ts`), so the
 * footer's controls are links to the next address rather than buttons that set state: a
 * middle-click opens page two in a new tab, and a pasted address reproduces it. They are
 * `next/link`s — a soft navigation, which re-renders the route from the new address and
 * keeps every Client Component beneath it — because a full navigation would drop the
 * selection store, and *selection persists across filter tweaks* would stop at the first page
 * turn. `push` rather than the bar's `replace`, because a page is a place a reader may want to
 * come back to, and a chip is not.
 *
 * At either end the control is the design system's inert button with the reason as its
 * tooltip, for the reason `app/ui/button.tsx` gives: an inert link has no honest rendering.
 *
 * @param props.filter The filter the address carries — what every page link keeps.
 * @param props.pagination Where this page sits, as `pagination` decided it.
 * @returns The footer.
 */
export function PageFooter({
  filter,
  pagination,
}: Readonly<{ filter: BacklogFilter; pagination: Pagination }>) {
  return (
    <nav aria-label={PAGES_LABEL} className="issues-table__foot">
      <span className="issues-table__range">{pagination.range}</span>
      {pagination.pastEnd && (
        <Link className="ou-btn ou-btn--ghost ou-btn--sm" href={pageHref(filter, FIRST_PAGE)}>
          {FIRST_PAGE_LABEL}
        </Link>
      )}
      <PageLink
        filter={filter}
        label={PREVIOUS_LABEL}
        page={pagination.previous}
        reason={FIRST_PAGE_REASON}
      />
      <PageLink filter={filter} label={NEXT_LABEL} page={pagination.next} reason={LAST_PAGE_REASON} />
    </nav>
  );
}

/**
 * One of the footer's two controls: a link to a page, or an inert button saying why not.
 *
 * @param props.filter The filter every page link keeps.
 * @param props.page The page to go to, or `null` at the end.
 * @param props.label The control's label.
 * @param props.reason Why it is inert at the end.
 * @returns The control.
 */
function PageLink({
  filter,
  page,
  label,
  reason,
}: Readonly<{ filter: BacklogFilter; page: number | null; label: string; reason: string }>) {
  if (page === null) {
    return (
      <Button reason={reason} size="sm" tone="ghost">
        {label}
      </Button>
    );
  }

  return (
    <Link className="ou-btn ou-btn--ghost ou-btn--sm" href={pageHref(filter, page)}>
      {label}
    </Link>
  );
}
