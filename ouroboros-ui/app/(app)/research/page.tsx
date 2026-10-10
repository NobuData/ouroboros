import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { startGate } from "@/app/research/composer";
import { readComposer } from "@/app/research/composer-data";
import { ResearchScreen } from "@/app/research/research-screen";
import { VIEW_PARAM, parseView } from "@/app/research/view";

/**
 * Research (CN.1, [#627](https://github.com/NobuData/ouroboros/issues/627)) — mockup 22's
 * `/research`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, and a component draws it. The frame reads nothing from the service — its
 * regions do, as CN.2–CN.6 mount them; the composer's three reads (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628)) are made here, once, so the card
 * arrives whole (`app/research/composer-data.ts`). The decisions are in
 * [`app/research/view.ts`](../../research/view.ts) and
 * [`app/research/composer.ts`](../../research/composer.ts).
 *
 * **This retires the `/research` placeholder** #49 was to build — an amendment the research
 * roadmap recorded, which needed no deletion because the placeholder was never built. The
 * sidebar's **Research** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`), and lights on this route through `RESEARCH_PATH`.
 *
 * The address's `?view=library` opens the library — the investigations region — and anything else
 * opens the page from its top. Every member may read the page; starting an investigation is for
 * an `owner`, `admin` or `member` — or for owners and admins only, where the workspace says so —
 * and the reason a reader may not is decided here and handed to the head and the composer alike.
 *
 * @param props.searchParams The address's query.
 * @returns The research page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}) {
  const access = await requireWorkspace();
  const [params = {}, composer] = await Promise.all([searchParams, readComposer()]);
  const roles = access.membership.roles;

  return (
    <ResearchScreen
      composer={composer}
      startReason={startGate(mayContribute(roles), mayAdminister(roles), composer.settings)}
      view={parseView(params[VIEW_PARAM])}
    />
  );
}
