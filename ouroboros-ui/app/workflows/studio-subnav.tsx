import Link from "next/link";

import { PageSubnav, SubnavSoon } from "@/app/ui";

import { STUDIO_EYEBROW, isLiveTab, studioTabs } from "./view";

import "./workflows.css";

/**
 * Mockup 04's segmented control — **Visual** · Code · Copilot — as the CP.4 `PageSubnav`
 * (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * The mockup draws it as a `.seg` pill beside the actions. The shell compliance addendum
 * (`docs/ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md` § UI/UX Shell Compliance) renders it as the
 * section's tab row instead — the same primitive Models' Routing / Registry / Providers row
 * is, sticky inside the pane's own scroll — because the three segments *are* sub-surfaces of
 * one sidebar entry (design system § 1.2): the code view is a tab of this surface, not a
 * sidebar entry of its own, and **Workflows** stays lit on all three.
 *
 * ### Two segments lead nowhere yet, and say so
 *
 * The ticket's own honesty obligation: *the segmented control offers Code and Copilot — surfaces
 * whose roadmaps do not exist yet. They ship visibly disabled and labelled, not as buttons
 * that quietly do nothing.* A `soon` segment is `SubnavSoon`'s: a `<span>` rather than an
 * `<a>`, out of the tab order, its note as the tooltip and the word *soon* in the text, so a
 * screen reader announces *"Code, soon"* rather than offering a link to a `404`. The
 * amendments recorded on the ticket name what turns each live: V.1
 * ([#169](https://github.com/NobuData/ouroboros/issues/169)) for Code, CE.1
 * ([#565](https://github.com/NobuData/ouroboros/issues/565)) for Copilot.
 *
 * A Server Component: it renders links and reads nothing. `PageSubnav` itself is a Client
 * Component (it measures its own height for the stacking contract), and rendering one from
 * here is the ordinary direction.
 */

/**
 * The segmented control, stuck to the top of the pane.
 *
 * @param props.slug The selected workflow's slug, or `null` when nothing is selected — what
 *   the one live segment links to.
 * @returns The `PageSubnav`, placed by `.studio__subnav`, with **Visual** current and the two
 *   unbuilt segments labelled *soon*.
 */
export function StudioSubnav({ slug }: Readonly<{ slug: string | null }>) {
  return (
    <PageSubnav className="studio__subnav" label={STUDIO_EYEBROW}>
      {studioTabs(slug).map((tab) =>
        isLiveTab(tab) ? (
          // Visual is the one built surface, so it is always the current one — the spelling
          // the sidebar uses and the stylesheet reads. V.1 makes this a prop.
          <Link aria-current="page" href={tab.href} key={tab.id}>
            {tab.label}
          </Link>
        ) : (
          <SubnavSoon key={tab.id} label={tab.label} note={tab.note} />
        ),
      )}
    </PageSubnav>
  );
}
