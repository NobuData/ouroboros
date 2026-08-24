import type { ReactNode } from "react";

import { Eyebrow, type SubnavTone } from "@/app/ui";

import { ModelsSubnav } from "./models-subnav";
import type { ModelsSurface } from "./view";

import "./models.css";

/**
 * The Models section's page frame: the head — eyebrow, title, subline, actions — and the tab
 * set beneath it, which every page under `/models` shares.
 *
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 2 asks every module page to keep the mockups' content
 * anatomy — page head, optional subnav, then the page's own content — and AE.1
 * ([#227](https://github.com/NobuData/ouroboros/issues/227)) is the moment the Models section
 * had two pages drawing it. Written twice, the head is two copies of one flex layout that can
 * drift by a class name; written here, a page supplies the four things that differ between
 * mockups 06 and 07 and inherits everything that does not.
 *
 * ### What is the page's, and what is the frame's
 *
 * The frame owns the **anatomy**: the `<main>` and its gutter rhythm, the head's two columns
 * and how they wrap, the eyebrow's word (it is always *Models* — that is what the section is
 * called), and the tab set's placement. The page owns the **content**: its title and subline,
 * its two head actions, which tab it is, and everything below the tab row. A page that needed
 * a different anatomy would not be a page of this section.
 *
 * The one thing a page may vary about the frame's own drawing is the underline's hue, because
 * the mockups vary it — see `app/models/models-subnav.tsx` and the primitive's note on tones.
 *
 * A Server Component, like both of the screens built from it. Nothing here reads or decides;
 * it places what it is handed.
 */

/** What a page supplies to the frame. */
export interface ModelsFrameProps {
  /** Which built surface this page is — the tab that carries `aria-current`. */
  readonly active: ModelsSurface;
  /** The tab underline's hue. See {@link ModelsSubnav}. */
  readonly tone?: SubnavTone;
  /** The `<h1>` — the page's one title in the outline. */
  readonly title: string;
  /**
   * The sentence under the title: the promise the page makes. Held by the page as a named
   * constant rather than typed into JSX, because copy that lives in one place is copy a
   * designer — or, for the providers page, a security document — can be pointed at.
   */
  readonly subline: string;
  /** The head's actions, drawn to the right of the headings and under them when narrow. */
  readonly actions: ReactNode;
  /** The page's own content, below the tab set. */
  readonly children: ReactNode;
}

/**
 * The frame.
 *
 * @param props See {@link ModelsFrameProps}.
 * @returns The `<main>` with the head, the tab set, and the page's content in that order.
 */
export function ModelsFrame({ active, tone, title, subline, actions, children }: ModelsFrameProps) {
  return (
    <main className="models">
      <div className="models__head">
        <div className="models__headings">
          <Eyebrow>Models</Eyebrow>
          <h1 className="models__title">{title}</h1>
          <p className="models__sub">{subline}</p>
        </div>
        <div className="models__actions">{actions}</div>
      </div>

      <ModelsSubnav active={active} tone={tone} />

      {children}
    </main>
  );
}
