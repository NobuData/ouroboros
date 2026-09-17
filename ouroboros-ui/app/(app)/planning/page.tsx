import { requireWorkspace } from "@/app/api/access";
import { mayAdminister } from "@/app/api/membership";
import { readPlanning } from "@/app/planning/data";
import { PlanningScreen } from "@/app/planning/planning-screen";

/**
 * Planning ([#283](https://github.com/NobuData/ouroboros/issues/283)) — mockup 09's `/planning`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, the reader turns it into what the screen draws, and a component draws it.
 * The decisions are in [`app/planning/view.ts`](../../planning/view.ts) and
 * [`app/planning/create.ts`](../../planning/create.ts).
 *
 * **This retires the `/planning` placeholder** #49 was to build — an amendment the planning
 * roadmap recorded, which needed no deletion because the placeholder was never built. The
 * sidebar's **Planning** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`).
 *
 * The role is decided here, once: **New roadmap** acts for an `owner` or an `admin` and is inert
 * with its reason for anyone else. The gate that enforces it is the service's.
 *
 * @returns The planning page, for the workspace this request is operating in.
 */
export default async function Page() {
  const access = await requireWorkspace();
  const readings = await readPlanning(access);

  return (
    <PlanningScreen mayAdminister={mayAdminister(access.membership.roles)} readings={readings} />
  );
}
