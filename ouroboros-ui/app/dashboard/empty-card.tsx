import { Card, CardHead, EmptyState } from "@/app/ui";

/**
 * A panel of the mockup that has no data source yet, drawn as a designed empty state.
 *
 * Mockup 02 fills three of its cards — active loops, recently closed, up next in the queue
 * — from a loop engine that does not exist. Nothing in the contract can answer any of those
 * questions today, so nothing on this screen invents an answer: the card keeps its place in
 * the grid, names what will fill it, and says what has to land first
 * (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5 — a surface that is not ready is *labelled*,
 * never dead, and never a blank region).
 *
 * That is deliberately not the same thing as *zero*. "No loops have run" would be a claim
 * about the loop engine; "nothing here can tell you yet" is the truth. The copy each card
 * passes says the second.
 *
 * Both shapes are #46 primitives: the card and its head, and the empty state inside it.
 * What this component contributes is the pairing and the column span, which are the
 * dashboard's.
 */

/** One future panel: what it is called, what it will hold, and what has to land first. */
export interface EmptyPanel {
  /** Stable identifier, and the React key. */
  readonly id: string;
  /** The card's heading, as the mockup titles it. */
  readonly title: string;
  /** The empty state's own heading — what is not there. */
  readonly headline: string;
  /** One line naming what will fill it and what it is waiting on. */
  readonly note: string;
  /** Which of the grid's column spans the card takes. */
  readonly span: 5 | 7 | 8;
}

/**
 * One empty panel.
 *
 * @param props.panel What the card is, and what it is waiting for.
 * @returns The card.
 */
export function EmptyCard({ panel }: Readonly<{ panel: EmptyPanel }>) {
  const titleId = `dash-${panel.id}-title`;

  return (
    <Card
      as="section"
      fill
      className={`dash-col--${panel.span}`}
      aria-labelledby={titleId}
    >
      <CardHead title={panel.title} titleId={titleId} />
      {/*
        `fill` on both: the grid stretches every card in a row to the tallest, so without it
        the panel would be a short dashed box floating at the top of a tall card.
      */}
      <EmptyState title={panel.headline} note={panel.note} fill />
    </Card>
  );
}
