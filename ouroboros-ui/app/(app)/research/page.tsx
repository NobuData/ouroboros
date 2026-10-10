import { requireWorkspace } from "@/app/api/access";
import { mayContribute } from "@/app/api/membership";
import { ResearchScreen } from "@/app/research/research-screen";
import { VIEW_PARAM, parseView } from "@/app/research/view";

/**
 * Research (CN.1, [#627](https://github.com/NobuData/ouroboros/issues/627)) — mockup 22's
 * `/research`.
 *
 * Thin on purpose, the shape every screen in `(app)` takes: the gate returns the workspace this
 * request may render, and a component draws it. The frame reads nothing from the service — its
 * regions do, as CN.2–CN.6 mount them. The decisions are in
 * [`app/research/view.ts`](../../research/view.ts).
 *
 * **This retires the `/research` placeholder** #49 was to build — an amendment the research
 * roadmap recorded, which needed no deletion because the placeholder was never built. The
 * sidebar's **Research** entry stops being a *soon* row on the same commit
 * (`app/shell/nav-modules.ts`), and lights on this route through `RESEARCH_PATH`.
 *
 * The address's `?view=library` opens the library — the investigations region — and anything else
 * opens the page from its top. Every member may read the page; starting an investigation is for
 * an `owner`, `admin` or `member`.
 *
 * @param props.searchParams The address's query.
 * @returns The research page, for the workspace this request is operating in.
 */
export default async function Page({
  searchParams,
}: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}) {
  const access = await requireWorkspace();
  const params = (await searchParams) ?? {};

  return (
    <ResearchScreen
      mayStart={mayContribute(access.membership.roles)}
      view={parseView(params[VIEW_PARAM])}
    />
  );
}
