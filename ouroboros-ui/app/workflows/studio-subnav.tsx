import { PageSubnav, SubnavInert, SubnavSoon } from "@/app/ui";

import { ModeLink } from "./mode-guard";
import { STUDIO_EYEBROW, type StudioSurface, isLiveTab, studioTabs } from "./view";

import "./workflows.css";

/**
 * Mockups 04 and 05's segmented control — Visual · Code · Copilot — as the CP.4 `PageSubnav`
 * (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147); Code live since V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)).
 *
 * The mockups draw it as a `.seg` pill beside the actions. The shell compliance addendum
 * (`docs/ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md` § UI/UX Shell Compliance) renders it as the
 * section's tab row instead — the same primitive Models' Routing / Registry / Providers row
 * is, sticky inside the pane's own scroll — because the three segments *are* sub-surfaces of
 * one sidebar entry (design system § 1.2): the code view is a tab of this surface, not a
 * sidebar entry of its own, and **Workflows** stays lit on all three.
 *
 * ### Visual and Code are one workflow's two URLs
 *
 * Each links to the selected workflow's own surface, and each is a `ModeLink`
 * (`app/workflows/mode-guard.tsx`): a plain client-side link, unless pressing it would discard
 * code that has not parsed yet (decision **C4**), in which case the reader is asked first.
 * Nothing else about a switch needs guarding — both editors read the one draft (**C3**).
 *
 * ### Two kinds of segment lead nowhere, and say so
 *
 * **Copilot** is not built: it is `SubnavSoon`, a `<span>` out of the tab order with its note as
 * the tooltip and the word *soon* in the text, naming CE.1
 * ([#565](https://github.com/NobuData/ouroboros/issues/565)). **Code** on a page with no workflow
 * selected is built but has nothing to open, so it is `SubnavInert` — the same span without the
 * mark, because *soon* would be untrue.
 *
 * A Server Component: it reads nothing. `PageSubnav` and `ModeLink` are Client Components, and
 * rendering them from here is the ordinary direction.
 */

/**
 * The segmented control, stuck to the top of the pane.
 *
 * @param props.slug The selected workflow's slug, or `null` when nothing is selected — what
 *   the live segments link to.
 * @param props.current The surface this page is — the segment marked current.
 * @returns The `PageSubnav`, placed by `.studio__subnav`.
 */
export function StudioSubnav({
  slug,
  current,
}: Readonly<{ slug: string | null; current: StudioSurface }>) {
  return (
    <PageSubnav className="studio__subnav" label={STUDIO_EYEBROW}>
      {studioTabs(slug).map((tab) => {
        if (isLiveTab(tab)) {
          return (
            <ModeLink current={current} href={tab.href} key={tab.id} surface={tab.id}>
              {tab.label}
            </ModeLink>
          );
        }

        return tab.soon ? (
          <SubnavSoon key={tab.id} label={tab.label} note={tab.note} />
        ) : (
          <SubnavInert key={tab.id} label={tab.label} note={tab.note} />
        );
      })}
    </PageSubnav>
  );
}
