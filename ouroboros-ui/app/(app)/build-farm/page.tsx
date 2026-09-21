import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, primaryRole } from "@/app/api/membership";
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
 * `app/(app)/layout.tsx` sets out. Every member may look at the farm, a `viewer` included. The
 * gate is also one of the page's **inputs** since the enroll flow arrived (AI.3,
 * [#258](https://github.com/NobuData/ouroboros/issues/258)): minting an enrollment token is
 * `owner` or `admin`, so whether this reader may is answered once, here, through the existing
 * `mayAdminister`, and the screen is handed a boolean rather than a role — with the workspace's
 * slug, which is the enroll command's `--tenant`. The role travels beside the boolean since AI.7
 * ([#262](https://github.com/NobuData/ouroboros/issues/262)), and decides nothing: it is what the
 * read-only note names. The gate that **enforces** is the service's.
 *
 * While this read is in flight the segment draws `loading.tsx` beside this file — the page's own
 * geometry, so nothing moves when the cards land.
 *
 * The read here is the first paint's. From then on the browser keeps the page fresh on the
 * fleet's own cadence (`app/farm/farm-store.tsx`), so this is a Server Component handing one
 * reading to a screen whose live regions are Client Components.
 *
 * @returns The build farm, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();

  return (
    <FarmScreen
      reader={{
        mayAdminister: mayAdminister(access.membership.roles),
        role: primaryRole(access.membership.roles),
        tenant: access.membership.slug,
      }}
      readings={await readFarm(access)}
    />
  );
}
