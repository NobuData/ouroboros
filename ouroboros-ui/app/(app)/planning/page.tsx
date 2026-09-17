import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { readPlanning } from "@/app/planning/data";
import { BATCH_PARAM, parseBatchParam } from "@/app/planning/generator";
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
 * The roles are decided here, once: **New roadmap** and the generator's push act for an `owner` or
 * an `admin`; drafting acts for a `member` too; a `viewer` reads. The gates that enforce them are
 * the service's.
 *
 * `?batch=<id>` opens the generator card on a stored batch (AM.2,
 * [#284](https://github.com/NobuData/ouroboros/issues/284)) — the address a generation leaves
 * behind, and the deep link other surfaces edit drafts through.
 *
 * @param props.searchParams The address's query.
 * @returns The planning page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const access = await requireWorkspace();
  const params = await searchParams;
  const readings = await readPlanning(access, parseBatchParam(params[BATCH_PARAM]));
  const { roles } = access.membership;

  return (
    <PlanningScreen
      mayAdminister={mayAdminister(roles)}
      mayContribute={mayContribute(roles)}
      readings={readings}
    />
  );
}
