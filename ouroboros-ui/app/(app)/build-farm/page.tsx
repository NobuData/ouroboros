import { requireWorkspace } from "@/app/api/access";
import { readFarm } from "@/app/farm/data";
import { FarmScreen } from "@/app/farm/farm-screen";

/**
 * The build farm (AI.1, [#256](https://github.com/NobuData/ouroboros/issues/256)) — mockup 08's
 * `/build-farm`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, the reader turns it into what the screen draws, and a component draws it.
 * The decisions are in [`app/farm/view.ts`](../../farm/view.ts).
 *
 * **This retires the `/build-farm` placeholder** #49 was to build — an amendment the build farm
 * roadmap recorded, which needed no deletion because the placeholder was never built. The
 * sidebar's **Build Farm** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`), and lights on this route through `BUILD_FARM_PATH`.
 *
 * `requireWorkspace()` is called here rather than in the group's layout for the reason
 * `app/(app)/layout.tsx` sets out. **No role is read from it**: every member may look at the
 * farm, a `viewer` included, and none of the head's three actions can act for anybody yet — the
 * admin gate arrives with the flows it guards (AI.3, #258; AI.4, #259).
 *
 * The read here is the first paint's. From then on the browser keeps the page fresh on the
 * fleet's own cadence (`app/farm/farm-store.tsx`), so this is a Server Component handing one
 * reading to a screen whose live regions are Client Components.
 *
 * @returns The build farm, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();

  return <FarmScreen readings={await readFarm(access)} />;
}
