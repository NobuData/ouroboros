import { Card, Eyebrow } from "@/app/ui";

import {
  SKELETON_FACTS,
  SKELETON_PLAYBOOKS,
  SKELETON_PROFILE_ROWS,
  SKELETON_SKILLS,
  SKELETON_STEPS,
} from "./states";
import { KNOWLEDGE_EYEBROW, KNOWLEDGE_SUBLINE, KNOWLEDGE_TITLE } from "./view";

import "./knowledge.css";

/**
 * What the reader sees while the knowledge page's reads are in flight
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417); each card at its own geometry
 * since BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)).
 *
 * The design system asks every surface to design its loading state rather than leave a blank region
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.3), and Next.js's `loading.tsx` is how a route says what
 * that is. The head is drawn for real — its copy is constants, so none of it is read — and only the
 * two actions are bars, because whether they are drawn at all depends on a role this component has
 * not been told. The grid reserves the five seats the screen draws — two in the left column, three
 * in the right — and **each seat is its card's own shape**: the skills table's rows with a switch
 * at the end of each, the facts' two-line rows with a status, the playbooks' rows over the dashed
 * tile, the profile's keyed rows over the environment block, the ladder's three steps. A page that
 * loads into five identical boxes tells the reader nothing about what is coming, and jumps when it
 * does.
 *
 * The bars do not pulse, for the PR page skeleton's reason (`app/prs/pr-loading.tsx`): a bar is a
 * placeholder's geometry, not a progress report. It says one thing to a screen reader, not
 * several: the bars carry no text, the grid is `aria-hidden`, and the page is marked busy and
 * labelled once.
 */

/** What the `<main>` is named while it loads. */
export const LOADING_LABEL = "Loading knowledge";

/**
 * Rows of one shape, for a card's seat.
 *
 * @param props.count How many rows.
 * @param props.children One row's bars — drawn once per row.
 * @returns The rows.
 */
function Rows({ count, children }: Readonly<{ count: number; children: React.ReactNode }>) {
  return (
    <div className="knowledge-skeleton__rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="knowledge-skeleton__row" key={index}>
          {children}
        </div>
      ))}
    </div>
  );
}

/** A row's two lines — a name over its description, a fact over its source. */
function Lines() {
  return (
    <span className="knowledge-skeleton__lines">
      <span className="knowledge-skeleton__bar" />
      <span className="knowledge-skeleton__bar knowledge-skeleton__bar--short" />
    </span>
  );
}

/**
 * The skeleton.
 *
 * @returns The page's head, drawn for real, over the grid's five seats at their cards' geometry.
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
          {/* The skills table: a row per skill, its switch at the end. */}
          <Card data-skeleton="skills">
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <Rows count={SKELETON_SKILLS}>
              <Lines />
              <span className="knowledge-skeleton__pill" />
            </Rows>
          </Card>
          {/* The learned facts: text over its source, the status trailing. */}
          <Card data-skeleton="facts">
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <Rows count={SKELETON_FACTS}>
              <Lines />
              <span className="knowledge-skeleton__pill" />
            </Rows>
          </Card>
        </div>
        <div className="knowledge__aside">
          {/* The playbooks: a row per recipe, over the dashed tile. */}
          <Card data-skeleton="playbooks">
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <Rows count={SKELETON_PLAYBOOKS}>
              <Lines />
              <span className="knowledge-skeleton__pill" />
            </Rows>
            <span className="knowledge-skeleton__block" />
          </Card>
          {/* The repo profile: keyed rows over the environment block. */}
          <Card data-skeleton="profile">
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            <Rows count={SKELETON_PROFILE_ROWS}>
              <span className="knowledge-skeleton__key" />
              <span className="knowledge-skeleton__lines">
                <span className="knowledge-skeleton__bar" />
              </span>
            </Rows>
            <span className="knowledge-skeleton__block" />
          </Card>
          {/* The scope ladder: three steps. */}
          <Card data-skeleton="scope">
            <span className="knowledge-skeleton__bar knowledge-skeleton__bar--title" />
            {Array.from({ length: SKELETON_STEPS }, (_, index) => (
              <span className="knowledge-skeleton__step" key={index} />
            ))}
          </Card>
        </div>
      </div>
    </main>
  );
}
