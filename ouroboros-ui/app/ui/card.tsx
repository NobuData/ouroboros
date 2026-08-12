import type { ElementType, ReactNode } from "react";

import { cx } from "./class-names";

import "./ui.css";

/**
 * The mockups' `.card`: the raised plane every panel in the product is drawn on, and the
 * head that names one.
 *
 * ### Why the element is a prop
 *
 * A card is a box, and what that box *is* changes per use: the dashboard's cards are
 * regions with headings, the login screen's steps are the sections of a form, and a
 * skeleton standing in for a card while it loads is a `<div>` that names nothing. Rendering
 * a `<section>` always would put eight unnamed regions into the accessibility tree of a
 * page that has four; rendering a `<div>` always would take the names off the four that
 * have them. So the caller says which, and passes the labelling attributes that go with it.
 *
 * ### The three surfaces
 *
 * A card is defined by what it sits on. On the page it is `--surface`; inside an
 * already-raised panel — the login screen's auth column — it is `--ground`, so the card
 * still reads as a card; and one whose interior is waiting rather than filled is `--inset`.
 * All three are the token sheet's own surfaces, and each carries published contrast for the
 * ink drawn on it.
 */

/** Which surface a card is drawn on. */
export type CardTone =
  /** The default: a card on the page. */
  | "surface"
  /** A card inside an already-raised panel, which the page's own ground separates. */
  | "ground"
  /** A well: a card whose content is recessed rather than raised. */
  | "inset";

/** How much room a card gives its content. */
export type CardSize =
  /** The default — the mockups' `.card`. */
  | "md"
  /** Roomier, for a card that is the whole of a column rather than one of a grid. */
  | "lg";

/** What a card takes. */
export interface CardProps {
  /** Which surface. Defaults to `surface`. */
  readonly tone?: CardTone;
  /** How much padding. Defaults to `md`. */
  readonly size?: CardSize;
  /**
   * Whether the card lays its children out as a column that fills its height. Needed by a
   * card whose body must stretch — an {@link EmptyState} taking the height a grid row gave
   * the card — and off by default, because a flex column does not collapse the margins
   * between its children and a card of prose laid out that way spaces its paragraphs
   * differently from every other block of prose in the product.
   */
  readonly fill?: boolean;
  /** Which element to render. Defaults to `div`. */
  readonly as?: ElementType;
  /** Classes from the page — placement only, never colour or type. */
  readonly className?: string;
  /** The card's content. */
  readonly children?: ReactNode;
  /** The id of the heading that names this card, when it is a region. */
  readonly "aria-labelledby"?: string;
  /** Its accessible name, when there is no heading to point at. */
  readonly "aria-label"?: string;
}

/** The modifier each surface adds, or nothing for the default one. */
const TONE_CLASS: Record<CardTone, string> = {
  surface: "",
  ground: "ou-card--ground",
  inset: "ou-card--inset",
};

/** The modifier each size adds, or nothing for the default one. */
const SIZE_CLASS: Record<CardSize, string> = {
  md: "",
  lg: "ou-card--lg",
};

/**
 * A card.
 *
 * @param props See {@link CardProps}.
 * @returns The card, as whichever element `as` names.
 */
export function Card({
  tone = "surface",
  size = "md",
  fill,
  as: Element = "div",
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element
      {...rest}
      className={cx(
        "ou-card",
        TONE_CLASS[tone],
        SIZE_CLASS[size],
        fill && "ou-card--fill",
        className,
      )}
    >
      {children}
    </Element>
  );
}

/**
 * A card's head: its title, and whatever sits at the trailing edge beside it.
 *
 * The `trailing` slot is a slot rather than a second child so that the spacer between the
 * two is the component's business and not every caller's — the mockups put a status chip, a
 * count or a link there, and each one of them would otherwise re-invent the same flexible
 * gap.
 *
 * @param props.title What the card is called.
 * @param props.titleId The id the card's `aria-labelledby` points at, when it is a region.
 * @param props.as The heading level, as the page's outline requires. Defaults to `h2`.
 * @param props.trailing What sits at the trailing edge — a chip, a count, a link.
 * @param props.className Classes from the page.
 * @returns The head.
 */
export function CardHead({
  title,
  titleId,
  as: Heading = "h2",
  trailing,
  className,
}: Readonly<{
  title: ReactNode;
  titleId?: string;
  as?: ElementType;
  trailing?: ReactNode;
  className?: string;
}>) {
  return (
    <header className={cx("ou-card__head", className)}>
      <Heading className="ou-card__title" id={titleId}>
        {title}
      </Heading>
      {trailing !== undefined && (
        <>
          <span className="ou-card__spacer" />
          {trailing}
        </>
      )}
    </header>
  );
}
