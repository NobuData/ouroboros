import Link from "next/link";

import { PageSubnav, SubnavSoon, type SubnavTone } from "@/app/ui";

import { MODELS_TABS, type ModelsSurface, isLiveTab } from "./view";

import "./models.css";

/**
 * The Models section's tab set — Routing · Model registry · Providers & keys · Spend — as
 * every page under `/models` draws it.
 *
 * It was `app/models/models-screen.tsx`'s own markup until AE.1
 * ([#227](https://github.com/NobuData/ouroboros/issues/227)) gave the section a second page,
 * and it moved here for the reason the ticket states as its acceptance criterion: **the tab
 * states have to be correct from both directions.** Navigating 06 → 07 and 07 → 06 must show
 * the same four tabs with the underline moved, and the sidebar's **Models** entry lit on both.
 * One component drawing one list (`MODELS_TABS`, `app/models/view.ts`) is what makes that a
 * property rather than a coincidence: the two pages differ in exactly one prop.
 *
 * ### What a page decides, and what it does not
 *
 * A page says which tab it *is* — {@link ModelsSurface}, so it cannot claim a tab that does
 * not lead anywhere — and which hue the underline takes. The hue is the one deliberate
 * divergence between the mockups (`app/ui/page-subnav.tsx` § Tones): 06 draws the active tab
 * in the model purple, 07 and 21 in the accent, and the primitive keeps that as a prop rather
 * than normalising it away. Everything else — the order, the labels, which tabs are built and
 * what the unbuilt ones say — is the list's, and a page cannot override it.
 *
 * ### The tab that leads nowhere yet
 *
 * A `soon` tab is `SubnavSoon`'s: a `<span>` rather than an `<a>`, out of the tab order, its
 * note as the tooltip and the word *soon* in the text. The sidebar makes the same choice for
 * the same reason — the keyboard never stops on something that cannot be activated, and a
 * screen reader announces *"Model registry, soon"* rather than offering a link to a `404`.
 *
 * A Server Component: it renders links and reads nothing. `PageSubnav` itself is a Client
 * Component (it measures its own height for the stacking contract), and rendering one from
 * here is the ordinary direction.
 */

/** What the tab set needs to be told. */
export interface ModelsSubnavProps {
  /** Which built surface this page is — the tab that carries `aria-current="page"`. */
  readonly active: ModelsSurface;
  /**
   * The underline hue. `"model"` on `/models` (mockup 06's purple), the accent everywhere
   * else. Defaults to the accent, which is what `PageSubnav` draws when told nothing.
   */
  readonly tone?: SubnavTone;
}

/**
 * The section's tab row, stuck to the top of the pane.
 *
 * @param props See {@link ModelsSubnavProps}.
 * @returns The `PageSubnav`, placed by `.models__subnav`, with one link per built surface
 *   and one honest *soon* tab per unbuilt one.
 */
export function ModelsSubnav({ active, tone }: ModelsSubnavProps) {
  return (
    <PageSubnav className="models__subnav" label="Models" tone={tone}>
      {MODELS_TABS.map((tab) =>
        isLiveTab(tab) ? (
          // `aria-current="page"` is what marks the active tab, in the same spelling the
          // sidebar uses and the stylesheet reads. Every other built tab is a plain link, so
          // the page on the far side of it renders this same row with the mark moved.
          <Link
            aria-current={tab.id === active ? "page" : undefined}
            href={tab.href}
            key={tab.id}
          >
            {tab.label}
          </Link>
        ) : (
          <SubnavSoon key={tab.id} label={tab.label} note={tab.note} />
        ),
      )}
    </PageSubnav>
  );
}
