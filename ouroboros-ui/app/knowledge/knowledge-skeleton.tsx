import { Card, Eyebrow } from "@/app/ui";

import { KNOWLEDGE_EYEBROW, KNOWLEDGE_SUBLINE, KNOWLEDGE_TITLE } from "./view";

import "./knowledge.css";

/**
 * What the reader sees while the knowledge page's reads are in flight
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * The design system asks every surface to design its loading state rather than leave a blank region
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is how a route says what
 * that is. The head is drawn for real — its copy is constants, so none of it is read — and only the
 * two actions are bars, because whether they are drawn at all depends on a role this component has
 * not been told. The grid reserves the five seats the screen draws — two in the left column, three
 * in the right (the scope card since #421) — in the page's own classes, so nothing moves when the
 * data lands.
 *
 * It says one thing to a screen reader, not several: the bars carry no text, the grid is
 * `aria-hidden`, and the page is marked busy and labelled once.
 */

/** What the `<main>` is named while it loads. */
export const LOADING_LABEL = "Loading knowledge";

/**
 * The skeleton.
 *
 * @returns The page's head, drawn for real, over the grid's reserved seats.
 */
export function KnowledgeSkeleton() {
  return (
    <main aria-busy="true" aria-label={LOADING_LABEL} className="knowledge">
      <div className="knowledge__head">
        <div className="knowledge__headings">
          <Eyebrow>{KNOWLEDGE_EYEBROW}</Eyebrow>
          <h1 className="knowledge__title">{KNOWLEDGE_TITLE}</h1>
          <p className="knowledge__sub">{KNOWLEDGE_SUBLINE}</p>
        </div>
        <div aria-hidden className="knowledge__actions">
          <span className="knowledge-skeleton__button" />
          <span className="knowledge-skeleton__button" />
        </div>
      </div>

      <div aria-hidden className="knowledge__grid">
        <div className="knowledge__main">
          <Card>
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <span className="knowledge-skeleton__bar" />
          </Card>
          <Card>
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <span className="knowledge-skeleton__bar" />
          </Card>
        </div>
        <div className="knowledge__aside">
          <Card>
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <span className="knowledge-skeleton__bar" />
          </Card>
          <Card>
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <span className="knowledge-skeleton__bar" />
          </Card>
          <Card>
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <span className="knowledge-skeleton__bar" />
          </Card>
        </div>
      </div>
    </main>
  );
}
