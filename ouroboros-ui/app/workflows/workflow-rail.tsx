import Link from "next/link";

import type { WorkflowRailEntry } from "@/app/api/workflows";
import { cx } from "@/app/ui";

import { NewWorkflow } from "./new-workflow";
import { RAIL_LABEL, type StudioSurface, railItems } from "./view";

import "./workflows.css";

/**
 * Mockup 04's `.wf-list` — the rail of workflows down the studio's left edge, with the dashed
 * **+ New workflow** tile under it (S.1,
 * [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * ### Every string on it is served
 *
 * The name is `WorkflowRailEntry.name`, the caption is `caption` as P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)) composed it — `12 stages ·
 * auto-merge`, `5 stages · needs review`, `5 stages · paused`, `not published` — and nothing
 * here derives a second sentence from `stageCount` or `terminal`. `app/api/workflows.ts` says
 * why; what this component adds is the two treatments the mockup draws beside the words: the
 * accent-gradient item for the selected workflow, and the err-dot for a paused one.
 *
 * ### The two states, and how each is said twice
 *
 * The selected item carries `aria-current="page"` as well as its gradient, so a screen reader
 * hears which workflow is open. The paused item carries its dot **and** the word `paused` in
 * its caption — the caption is the fact and the dot is the mockup's picture of it, hidden from
 * the accessibility tree because it repeats in colour what the caption says in words
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.4).
 *
 * ### The rail is a `<nav>`
 *
 * It moves a reader between workflows, which is navigation, and it is named so a rotor can
 * tell it from the sidebar's *Primary navigation* and the segmented control's *Workflow
 * Studio*. The items are links (`next/link`, so the navigation is client-side and the pane's
 * scroll restoration sees it) to `/workflows/<slug>` — the ticket's *linkable* — rather than
 * buttons that select in place. On the copilot they link to `/workflows/<slug>/copilot`.
 *
 * A Server Component: it renders links and reads nothing. The tile at its foot is the one
 * Client Component, because it owns a dialog.
 */

/** What the rail needs to be told. */
export interface WorkflowRailProps {
  /** The rail as served, in the service's order. Empty for a workspace with no workflows. */
  readonly entries: readonly WorkflowRailEntry[];
  /** The selected workflow's slug, or `null` when nothing is selected. */
  readonly activeSlug: string | null;
  /** Whether the tile may open its dialog — see `NewWorkflow`. */
  readonly mayAdminister: boolean;
  /**
   * The surface the page is. Defaults to `visual`, the rail's behaviour since S.1. On the copilot
   * (CE.1, [#565](https://github.com/NobuData/ouroboros/issues/565)) each item links to that
   * workflow's own conversation and the tile's dialog opens with **Copilot** chosen, so the rail
   * changes the workflow and never the surface.
   */
  readonly surface?: StudioSurface;
}

/**
 * The rail.
 *
 * @param props See {@link WorkflowRailProps}.
 * @returns The navigation region: one link per workflow, then the tile.
 */
export function WorkflowRail({ entries, activeSlug, mayAdminister, surface = "visual" }: WorkflowRailProps) {
  const items = railItems(entries, activeSlug, surface);

  return (
    <nav aria-label={RAIL_LABEL} className="studio-rail">
      {/* No list at all for an empty rail, rather than an empty `<ul>` a rotor would announce. */}
      {items.length > 0 && (
        <ul className="studio-rail__list">
          {items.map((item) => (
            <li key={item.slug}>
              <Link
                aria-current={item.active ? "page" : undefined}
                className={cx("studio-rail__item", item.active && "studio-rail__item--active")}
                href={item.href}
              >
                <span className="studio-rail__row">
                  <span className="studio-rail__name">{item.name}</span>
                  {item.paused && <span aria-hidden className="studio-rail__dot" />}
                </span>
                <span className="studio-rail__caption">{item.caption}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewWorkflow
        mayAdminister={mayAdminister}
        slugs={items.map((item) => item.slug)}
        start={surface === "copilot" ? "copilot" : "canvas"}
      />
    </nav>
  );
}
