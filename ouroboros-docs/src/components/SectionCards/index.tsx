import React, { type ReactNode } from "react";
import Link from "@docusaurus/Link";

import { SECTIONS } from "../../../site.constants";
import styles from "./styles.module.css";

/** One card: a page to go to and why. */
export interface SectionCard {
  /** The card's heading. */
  title: string;
  /** One sentence on what is there. */
  description: string;
  /** Where the card goes — a site route (`/cli/install-sh`) or a full URL. */
  to: string;
}

/** Props of {@link SectionCards}. */
export interface SectionCardsProps {
  /** The cards, in order. Leave out for the site's three sections. */
  cards?: readonly SectionCard[];
}

/** The site's three sections as cards — the default set. */
export const SECTION_CARDS: readonly SectionCard[] = SECTIONS.map((section) => ({
  title: section.label,
  description: section.description,
  to: `/${section.dir}`,
}));

/**
 * A grid of linked cards, for the landing page and section overviews.
 *
 * @param props.cards the cards; defaults to the User Guide, Administration and CLI.
 * @returns the grid, one link per card.
 * @throws {Error} when given an empty list — an empty grid is an authoring mistake.
 */
export default function SectionCards({ cards = SECTION_CARDS }: SectionCardsProps): ReactNode {
  if (cards.length === 0) throw new Error("<SectionCards> needs at least one card");
  return (
    <div className={styles.grid}>
      {cards.map((card) => (
        <Link key={card.to} to={card.to} className={styles.card}>
          <span className={styles.title}>{card.title}</span>
          <span className={styles.description}>{card.description}</span>
        </Link>
      ))}
    </div>
  );
}
