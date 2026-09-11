import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { readIssues } from "@/app/issues/data";
import { type SearchParams, parseFilter } from "@/app/issues/filter";
import { IssuesScreen } from "@/app/issues/issues-screen";
import { parsePage } from "@/app/issues/paging";

/**
 * Issue intake ([#115](https://github.com/NobuData/ouroboros/issues/115)) — mockup 03's `/issues`.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate returns
 * the workspace this request may render, a reader turns that into what the screen draws, and a
 * component draws it. The decisions are in [`app/issues/view.ts`](../../issues/view.ts),
 * [`app/issues/filter.ts`](../../issues/filter.ts) and [`app/issues/table.ts`](../../issues/table.ts),
 * and the read in [`app/issues/data.ts`](../../issues/data.ts), all covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out: a layout does not re-render on a client-side navigation and does
 * not control whether the segment beneath it renders anyway. It returns the workspace, so the page
 * that skipped the check is also the page with nothing to draw.
 *
 * **This retires the `/issues` placeholder** #49 was to build — an amendment recorded when the
 * intake roadmap was filed, and one that turned out to need no deletion, because the placeholder
 * was never built. The sidebar's **Issues** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`, amending #41's nav state), because a route that exists and a
 * navigation that still refuses to point at it is the same dead end from the other side.
 *
 * ### Why the filter and the page are read here rather than in the browser
 *
 * The filter bar ([#116](https://github.com/NobuData/ouroboros/issues/116)) keeps every control in
 * `?repo=&labels=&state=&sort=&q=` (decision K8), the table's page
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)) joins them as `&page=`, and the query
 * string is read on the **server**, so the first paint is already the filtered page and the bar
 * already shows what was asked. A client component reading it with `useSearchParams` would render
 * the default bar first, would need a `Suspense` boundary to be prerendered at all, and would
 * answer *which view?* one frame later than the page could have — the argument
 * `app/(app)/models/(routing)/page.tsx` makes for `?route=`. Reading it costs nothing this route
 * was not already paying: `requireWorkspace()` reads the session cookie, so this page is dynamic
 * either way.
 *
 * ### Why the roles are decided here
 *
 * Three of the screen's controls depend on who is looking — **Re-estimate all** is drawn for an
 * `owner` or an `admin` and nobody else, and **Queue N selected ⟳** and the table's freshness tag
 * are inert for a `viewer` — and every answer comes from the membership the gate resolved, once,
 * here. The screen is handed booleans rather than a role, so the one place deciding what a role
 * may do is `app/api/membership.ts`. The gate that **enforces** is the service's;
 * `app/issues/head-actions.ts` says what a press that went around the presentation is answered
 * with.
 *
 * @param props.searchParams The URL's query, which carries the filter bar's state and the page.
 * @returns The intake page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const access = await requireWorkspace();
  const params = await searchParams;
  const filter = parseFilter(params);
  const page = parsePage(params);
  const readings = await readIssues(access, filter, page);
  const { roles, id: organizationId } = access.membership;

  return (
    <IssuesScreen
      filter={filter}
      mayAdminister={mayAdminister(roles)}
      mayContribute={mayContribute(roles)}
      organizationId={organizationId}
      page={page}
      readings={readings}
    />
  );
}
