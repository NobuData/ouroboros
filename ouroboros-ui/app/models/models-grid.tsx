import type { ReactNode } from "react";

import "./models.css";

/**
 * Mockup 06's two-column layout below the health strip: the matrix at eight of twelve
 * columns, and a right column at four that stacks the inspector, the rules card and the
 * spend card.
 *
 * One component rather than the grid's markup written where each caller needs it, because
 * the grid is drawn from two places that must agree about it: `app/models/routing-matrix.tsx`
 * when there are rows, and `app/models/models-screen.tsx` when there are none and the
 * matrix's seat holds an empty state instead. Two copies of a twelve-column grid are two
 * places a breakpoint can drift.
 *
 * The right column is a **flex column, not three grid items**. Three `span 4` cards would
 * each take the next grid row, landing the second one under the matrix rather than under the
 * inspector; a column wrapper is what keeps the mockup's stack — inspector, rules, spend —
 * beside the matrix at any height, and is what the mockup's own `.c-4.col` does.
 *
 * A Server Component with nothing to decide. `RoutingMatrix` is a Client Component and renders
 * this with its two cards, which is the ordinary direction — a Client Component may render a
 * Server Component it is handed or imports, provided the module itself needs no client-only
 * API, and this one needs none.
 */

/** What the grid places. */
export interface ModelsGridProps {
  /** The matrix's seat — the table, or the empty state that stands where it would be. */
  readonly main: ReactNode;
  /** The right column, top to bottom: the inspector's seat, then AA.5's two cards. */
  readonly aside: ReactNode;
}

/**
 * The grid.
 *
 * @param props See {@link ModelsGridProps}.
 * @returns The two columns.
 */
export function ModelsGrid({ main, aside }: ModelsGridProps) {
  return (
    <div className="models-grid">
      {main}
      <div className="models-col--4 models-aside">{aside}</div>
    </div>
  );
}
