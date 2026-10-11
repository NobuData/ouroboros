import { requireWorkspace } from "@/app/api/access";
import { mayAdminister, mayContribute } from "@/app/api/membership";
import { readFeaturedBrief } from "@/app/research/brief-data";
import { startGate } from "@/app/research/composer";
import { readComposer } from "@/app/research/composer-data";
import { listQuery } from "@/app/research/investigations";
import { readInvestigationPage, readOpenedInvestigation } from "@/app/research/investigations-data";
import { ResearchScreen } from "@/app/research/research-screen";
import { readWatch } from "@/app/research/side-data";
import { VIEW_PARAM, parseLibraryFilters, parseOpen, parseView } from "@/app/research/view";

/**
 * Research (CN.1, [#627](https://github.com/NobuData/ouroboros/issues/627)) — mockup 22's
 * `/research`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, and a component draws it. The frame reads nothing from the service — its
 * regions do, as their cards mount: the composer's three reads (CN.2,
 * [#628](https://github.com/NobuData/ouroboros/issues/628), `app/research/composer-data.ts`) and
 * the featured brief (CN.4, [#630](https://github.com/NobuData/ouroboros/issues/630),
 * `app/research/brief-data.ts`) and the investigations the address asks for — the active rows,
 * or the library's filtered page and an opened investigation (CN.6,
 * [#632](https://github.com/NobuData/ouroboros/issues/632), `app/research/investigations-data.ts`)
 * — and the regression watch (CN.3, [#629](https://github.com/NobuData/ouroboros/issues/629),
 * `app/research/side-data.ts`; the tools card draws from the composer's reading of the catalog)
 * — are made here, once and together, so each card arrives whole.
 * The decisions are in [`app/research/view.ts`](../../research/view.ts),
 * [`app/research/composer.ts`](../../research/composer.ts) and
 * [`app/research/brief.ts`](../../research/brief.ts).
 *
 * **This retires the `/research` placeholder** #49 was to build — an amendment the research
 * roadmap recorded, which needed no deletion because the placeholder was never built. The
 * sidebar's **Research** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`), and lights on this route through `RESEARCH_PATH`.
 *
 * The address's `?view=library` opens the library — the investigations region, filtered by
 * `kind`, `status` and `quarter`, and `open` names an investigation to open — and anything else
 * opens the page from its top. Every member may read the page; starting an investigation, and
 * drafting work from a brief, is for an `owner`, `admin` or `member` — or for owners and admins
 * only, where the workspace says so for starting — and the reason a reader may not is decided
 * here and handed to the head and the composer alike. Enabling a research tool, dismissing a
 * watch item and capturing a baseline are an `owner`'s or an `admin`'s.
 *
 * @param props.searchParams The address's query.
 * @returns The research page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}) {
  const access = await requireWorkspace();
  const params = (await searchParams) ?? {};
  const view = parseView(params[VIEW_PARAM]);
  const filters = parseLibraryFilters(params);
  const openId = parseOpen(params);
  const [composer, brief, watch, investigations, openedReading] = await Promise.all([
    readComposer(),
    readFeaturedBrief(),
    readWatch(),
    readInvestigationPage(listQuery(view, filters)),
    openId === null ? Promise.resolve(null) : readOpenedInvestigation(openId),
  ]);
  const roles = access.membership.roles;

  return (
    <ResearchScreen
      brief={brief}
      composer={composer}
      filters={filters}
      investigations={investigations}
      mayAdminister={mayAdminister(roles)}
      mayDraft={mayContribute(roles)}
      opened={openId === null || openedReading === null ? null : { id: openId, reading: openedReading }}
      startReason={startGate(mayContribute(roles), mayAdminister(roles), composer.settings)}
      view={view}
      watch={watch}
    />
  );
}
