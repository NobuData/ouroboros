import { requireWorkspace } from "@/app/api/access";
import { readInsights } from "@/app/insights/data";
import { InsightsScreen } from "@/app/insights/insights-screen";
import { RANGE_PARAM, parseRange } from "@/app/insights/range";

/**
 * Insights (BK.2, [#443](https://github.com/NobuData/ouroboros/issues/443)) — mockup 15's
 * `/insights`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, the reader turns it into what the screen draws, and a component draws it.
 * The decisions are in [`app/insights/view.ts`](../../insights/view.ts).
 *
 * **This retires the `/insights` placeholder** #49 was to build — an amendment the insights
 * roadmap recorded, which needed no deletion because the placeholder was never built. The
 * sidebar's **Insights** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`), and lights on this route through `INSIGHTS_PATH`.
 *
 * The address's `?range=7d|30d|90d` names the window (`app/insights/range.ts`); absent or not one
 * of those, the page is the default `30d`. Every member may read the page, a `viewer` included.
 *
 * @param props.searchParams The address's query.
 * @returns The insights page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}) {
  const access = await requireWorkspace();
  const params = (await searchParams) ?? {};

  return <InsightsScreen readings={await readInsights(access, parseRange(params[RANGE_PARAM]))} />;
}
