import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
import { readModels } from "@/app/models/data";
import { ROUTE_PARAM } from "@/app/models/matrix";
import { ModelsScreen } from "@/app/models/models-screen";

/**
 * Model routing (#200) — mockup 06's `/models`.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader turns that into everything the
 * screen draws, and a component draws it. Nothing is decided here, so there is nothing here
 * that has to be tested by driving a route — the decisions are in
 * [`app/models/view.ts`](../../../models/view.ts) and the read in
 * [`app/models/data.ts`](../../../models/data.ts), both covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out at length: a layout does not re-render on a client-side
 * navigation and does not control whether the segment beneath it renders anyway. It returns
 * the workspace, so the page that skipped the check is also the page with nothing to draw.
 *
 * A Server Component, and the read behind it is server-side: `OURO_REST_URL` is not in the
 * browser bundle and the session cookie is `HttpOnly`, so the browser could not make the
 * call even if this were a Client Component. Keeping the fetch here is also what makes the
 * page arrive rendered rather than as a shell that then loads.
 *
 * **This retires the `/models` placeholder** #49 held for it — an amendment recorded when
 * this roadmap was filed. The sidebar's **Models** entry stops being a *soon* row and
 * becomes a link on the same commit (`app/shell/nav-modules.ts`), because a route that
 * exists and a navigation that still refuses to point at it is the same dead end from the
 * other side.
 *
 * There is no `Freshness` boundary here, unlike the dashboard's route. That boundary holds
 * the last render that worked so a *refresh* that fails does not blank a page somebody is
 * reading, and it is worth its client component on a screen of live figures that polls. This
 * page has two reads, does not poll, and degrades each in place — the strip says what it
 * could not read where it would have been, and a refused matrix is the DASH-I.7 banner with
 * the page's one retry (AA.6, [#205](https://github.com/NobuData/ouroboros/issues/205);
 * `app/models/states.ts` decides every state the page can be in).
 *
 * ### Why this file is in a `(routing)` group
 *
 * The group changes no URL — this is still `/models` — and exists for the sibling file: a
 * `loading.tsx` wraps its segment's page and every child segment, so one beside
 * `models/providers/` would stand in for the providers page too, at the wrong geometry. See
 * `loading.tsx` here.
 *
 * ### Why the selected route is read here rather than in the browser
 *
 * The matrix reflects its selection into `?route=` (AA.2,
 * [#201](https://github.com/NobuData/ouroboros/issues/201)), and this is the other half of
 * *a selected route survives a reload*: the parameter is read on the **server**, so the very
 * first paint already has the right row selected and the right route in the inspector's seat.
 * A client component reading it with `useSearchParams` would render an unselected matrix
 * first, would need a `Suspense` boundary to be prerendered at all, and would answer the
 * question *which row?* one frame later than the page could have.
 *
 * Reading it costs nothing this route was not already paying: `requireWorkspace()` reads the
 * session cookie, so this page is dynamic either way.
 *
 * ### Why the role is decided here
 *
 * The rules card (AA.5, [#204](https://github.com/NobuData/ouroboros/issues/204)) draws its
 * switches, its builder and its deletes for an `owner` or an `admin` and for nobody else, and
 * *whether this reader is one* is answered once, here, from the membership the gate resolved
 * — the same shape `app/(app)/models/registry/page.tsx` takes for the registry's controls. The
 * screen is handed a boolean rather than a role, so there is one place deciding what a role
 * may do and it is `app/api/membership.ts`. The gate that **enforces** is the service's;
 * `app/models/rule-actions.ts` says what happens to a member who reaches a write anyway.
 *
 * The role's **name** travels beside the boolean since AA.6, for one sentence: a reader who
 * may not edit is told so, and told as what — *viewing routing as a member* — rather than
 * handed a page with things quietly missing. `primaryRole` collapses the list the contract
 * carries to the strongest word, the same way the account menu names it. The screen decides
 * nothing from the name; it prints it.
 *
 * @param props.searchParams The URL's query, which carries the selected route.
 * @returns The routing page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const access = await requireWorkspace();
  const [readings, query] = await Promise.all([readModels(access), searchParams]);

  return (
    <ModelsScreen
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={readings}
      role={primaryRole(access.membership.roles)}
      route={query[ROUTE_PARAM] ?? null}
    />
  );
}
