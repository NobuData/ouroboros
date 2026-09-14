import type { ReactNode } from "react";

import { Eyebrow } from "@/app/ui";

import { StudioSubnav } from "./studio-subnav";
import { STUDIO_EYEBROW, type StudioSurface } from "./view";

import "./workflows.css";

/**
 * The studio's page frame: the head — eyebrow, title, subline, actions — and the segmented
 * control beneath it (S.1, [#147](https://github.com/NobuData/ouroboros/issues/147)).
 *
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 2 asks every module page to keep the mockups' content
 * anatomy — page head, optional subnav, then the page's own content — and this is that
 * anatomy for `/workflows`, in the shape `app/models/models-frame.tsx` gave the Models
 * section: the frame owns the `<main>`, its gutter rhythm, the head's two columns and how they
 * wrap, the eyebrow's word (it is always *Workflow Studio*) and the control's placement; the
 * page supplies its title, its subline, its actions and everything below the control.
 *
 * ### The title is a node, and that is the one difference from the Models frame
 *
 * The routing page's title is copy; this page's is the selected workflow's **name**, which
 * depends on the reads. So the skeleton (`app/workflows/studio-skeleton.tsx`) cannot draw the
 * head as itself the way the routing skeleton does — it draws the title and the subline as
 * bars at their own height, and the eyebrow and the control as themselves. Both are drawn by
 * this one component, which is what keeps the head's geometry identical before and after the
 * data lands.
 *
 * A Server Component, like the screen and the skeleton built from it. Nothing here reads or
 * decides; it places what it is handed.
 */

/** What a page supplies to the frame. */
export interface StudioFrameProps {
  /** The selected workflow's slug, or `null` — what the control's live segments link to. */
  readonly slug: string | null;
  /** Which editor this page is — the segment the control marks current (V.1, #169). */
  readonly current: StudioSurface;
  /** The `<h1>` — the workflow's name, or a state's title, or the skeleton's bar. */
  readonly title: ReactNode;
  /** The sentence under the title — the composed subline, a state's sentence, or a bar. */
  readonly subline: ReactNode;
  /** The head's actions, drawn to the right of the headings and under them when narrow. */
  readonly actions: ReactNode;
  /** The page's own content, below the control. */
  readonly children: ReactNode;
  /**
   * What the page is doing while it has nothing to show yet — the skeleton's label. When set,
   * the `<main>` is `aria-busy` and named with it, so a screen reader is told the page is
   * loading once rather than read a column of empty bars.
   */
  readonly busy?: string;
}

/**
 * The frame.
 *
 * @param props See {@link StudioFrameProps}.
 * @returns The `<main>` with the head, the segmented control, and the page's content in that
 *   order.
 */
export function StudioFrame({
  slug,
  current,
  title,
  subline,
  actions,
  children,
  busy,
}: StudioFrameProps) {
  return (
    <main aria-busy={busy === undefined ? undefined : true} aria-label={busy} className="studio">
      <div className="studio__head">
        <div className="studio__headings">
          <Eyebrow>{STUDIO_EYEBROW}</Eyebrow>
          <h1 className="studio__title">{title}</h1>
          <p className="studio__sub">{subline}</p>
        </div>
        <div className="studio__actions">{actions}</div>
      </div>

      <StudioSubnav current={current} slug={slug} />

      {children}
    </main>
  );
}
