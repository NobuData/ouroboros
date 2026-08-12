import type { ReactNode } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * A surface with nothing on it yet, designed rather than blank.
 *
 * `docs/DESIGN_SYSTEM_APP_SHELL.md` § 3.5: a surface that is not ready is **labelled**,
 * never dead and never a blank region. So this says what will fill it and what has to land
 * first, and the two are separate props because they are separate sentences — a headline
 * naming what is not there, and a note naming what it is waiting on.
 *
 * ### Empty is not zero
 *
 * The distinction this primitive exists to keep is between *nothing has happened yet* and
 * *nothing can tell you yet*. "No loops have run" is a claim about a loop engine that does
 * not exist; "nothing here can answer that yet" is the truth. The copy is the caller's, but
 * the shape is designed for the second: an empty state is where a screen admits what it
 * does not know, not where it reports a count of zero.
 *
 * ### It recedes by surface, never by opacity
 *
 * Every contrast pair the token sheet publishes is measured against a surface, and a
 * translucent layer is not one of them — so a panel carrying sentences somebody is meant to
 * read cannot be dimmed. The well is `--inset` and the boundary is dashed instead.
 */

/** What an empty state takes. */
export interface EmptyStateProps {
  /** The heading — what is not there. Omitted where the note is the whole of it. */
  readonly title?: ReactNode;
  /** One line naming what will fill the surface, and what it is waiting on. */
  readonly note?: ReactNode;
  /**
   * Whether it is a panel in its own right, centred under a card's heading, or a paragraph
   * of explanation in the flow of a card. Defaults to `panel`.
   */
  readonly variant?: "panel" | "flush";
  /**
   * Whether it takes the height its card has left. Needs a card with `fill` set, and is
   * what stops an empty panel being a short box at the top of a tall one.
   */
  readonly fill?: boolean;
  /** Anything beyond the title and the note — a control, a list of what to try. */
  readonly children?: ReactNode;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
}

/**
 * An empty state.
 *
 * @param props See {@link EmptyStateProps}.
 * @returns The panel.
 */
export function EmptyState({
  title,
  note,
  variant = "panel",
  fill,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "ou-empty",
        variant === "panel" ? "ou-empty--center" : "ou-empty--flush",
        fill && "ou-empty--fill",
        className,
      )}
    >
      {title !== undefined && <p className="ou-empty__title">{title}</p>}
      {note !== undefined && <p className="ou-empty__note">{note}</p>}
      {children}
    </div>
  );
}
