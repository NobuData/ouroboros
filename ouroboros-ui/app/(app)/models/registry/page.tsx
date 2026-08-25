import { requireWorkspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { ALIAS_PARAM } from "@/app/paths";
import { readRegistry } from "@/app/registry/data";
import { RegistryScreen } from "@/app/registry/registry-screen";

/**
 * The model registry ([#591](https://github.com/NobuData/ouroboros/issues/591)) — mockup 21's
 * `/models/registry`, replacing the `#49` placeholder this route was.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader composes what it can read, and a
 * component draws it. The decisions are in
 * [`app/registry/view.ts`](../../../registry/view.ts), covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out at length: a layout does not re-render on a client-side
 * navigation and does not control whether the segment beneath it renders anyway. Here the gate
 * is also one of the page's two **inputs**: both head actions are gated on the reader's role,
 * and the roles come from the membership the gate resolved — the session/role context the
 * ticket lists as its BA-D.5 dependency, arriving through the same call every other signed-in
 * screen makes.
 *
 * **Under `/models`, not beside it.** The sidebar highlights the entry whose route the URL is
 * under (`app/shell/nav.ts`), so this segment's placement is what keeps **Models** lit on all
 * three pages of the section — the ticket's *all three directions* criterion (06 ⇄ 21 ⇄ 07),
 * met by the URL rather than by a special case in the sidebar.
 *
 * ### Why the selected alias is read here rather than in the browser
 *
 * The allowed-models table (CI.2, [#592](https://github.com/NobuData/ouroboros/issues/592))
 * reflects its selection into `?alias=` — `app/paths.ts`'s `ALIAS_PARAM`, the same parameter
 * the provider card's *not listed upstream* flag links with — and this is the other half of
 * *a selected alias survives a reload*: the parameter is read on the **server**, so the very
 * first paint already has the right row selected and the right name in the inspector's seat.
 * A client component reading it with `useSearchParams` would render an unselected table
 * first, would need a `Suspense` boundary to be prerendered at all, and would answer *which
 * row?* one frame later than the page could have. It is the same arrangement
 * `app/(app)/models/(routing)/page.tsx` makes for `?route=`, and it costs nothing this route
 * was not already paying: `requireWorkspace()` reads the session cookie, so the page is
 * dynamic either way.
 *
 * @param props.searchParams The URL's query, which may carry the selected alias.
 * @returns The registry page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const access = await requireWorkspace();
  const [readings, query] = await Promise.all([readRegistry(access), searchParams]);

  return (
    <RegistryScreen
      alias={query[ALIAS_PARAM] ?? null}
      mayAdminister={mayAdminister(access.membership.roles)}
      readings={readings}
    />
  );
}
