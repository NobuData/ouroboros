import { requireWorkspace } from "@/app/api/access";
import { readModels } from "@/app/models/data";
import { ModelsScreen } from "@/app/models/models-screen";

/**
 * Model routing (#200) — mockup 06's `/models`.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader turns that into everything the
 * screen draws, and a component draws it. Nothing is decided here, so there is nothing here
 * that has to be tested by driving a route — the decisions are in
 * [`app/models/view.ts`](../../models/view.ts) and the read in
 * [`app/models/data.ts`](../../models/data.ts), both covered directly.
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
 * page has one read, does not poll, and degrades that read in place — the strip says what it
 * could not read, where it would have been. AA.6 ([#205](https://github.com/NobuData/ouroboros/issues/205))
 * is where this page's full state and guard treatment is decided, once there are cards for
 * it to be about.
 *
 * @returns The routing page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readModels(access);

  return <ModelsScreen readings={readings} />;
}
