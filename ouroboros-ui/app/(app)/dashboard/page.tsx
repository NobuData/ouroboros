import { requireWorkspace } from "@/app/api/access";
import { readDashboard } from "@/app/dashboard/data";
import { DashboardScreen } from "@/app/dashboard/dashboard-screen";

/**
 * The dashboard (#45) — where a signed-in request with a chosen workspace lands.
 *
 * The route is thin on purpose, and it is the shape every screen in `(app)` takes: the gate
 * returns the workspace this request may render, a reader turns that into everything the
 * screen draws, and a component draws it. Nothing is decided here, so there is nothing here
 * that has to be tested by driving a route — the decisions are in
 * [`app/dashboard/view.ts`](../../dashboard/view.ts) and the reads in
 * [`app/dashboard/data.ts`](../../dashboard/data.ts), both covered directly.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out at length: a layout does not re-render on a client-side
 * navigation and does not control whether the segment beneath it renders anyway. It returns
 * the workspace, so the page that skipped the check is also the page with nothing to draw.
 *
 * A Server Component, and every read behind it is server-side: `OURO_REST_URL` is not in
 * the browser bundle and the session cookie is `HttpOnly`, so the browser could not make
 * any of these calls even if this were a Client Component. Keeping the fetching here is
 * also what makes the page arrive rendered rather than as a shell that then loads —
 * `loading.tsx` beside this file is what the reader sees while it does.
 *
 * @returns The dashboard, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();

  return <DashboardScreen readings={await readDashboard(access)} />;
}
