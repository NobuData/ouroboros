import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KnowledgeSkeleton, LOADING_LABEL } from "@/app/knowledge/knowledge-skeleton";
import {
  SKELETON_FACTS,
  SKELETON_PLAYBOOKS,
  SKELETON_PROFILE_ROWS,
  SKELETON_SKILLS,
  SKELETON_STEPS,
} from "@/app/knowledge/states";
import { KNOWLEDGE_SUBLINE, KNOWLEDGE_TITLE } from "@/app/knowledge/view";

/**
 * The knowledge route's loading state (#417): the head is drawn for real, the seats are reserved
 * in the page's own classes, and a screen reader is told one thing. Each seat is its card's own
 * geometry since #422.
 */

describe("the skeleton", () => {
  it("draws the head for real and marks the page busy once", () => {
    render(<KnowledgeSkeleton />);

    const main = screen.getByRole("main");

    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAccessibleName(LOADING_LABEL);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(KNOWLEDGE_TITLE);
    expect(screen.getByText(KNOWLEDGE_SUBLINE)).toBeInTheDocument();
  });

  it("reserves the grid in the page's own classes, hidden from assistive technology", () => {
    const { container } = render(<KnowledgeSkeleton />);

    expect(container.querySelector(".knowledge__grid")).toHaveAttribute("aria-hidden");
    expect(container.querySelector(".knowledge__actions")).toHaveAttribute("aria-hidden");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reserves a seat for every card the screen draws — two on the left, three on the right (#421)", () => {
    const { container } = render(<KnowledgeSkeleton />);

    expect(container.querySelectorAll(".knowledge__main > .ou-card")).toHaveLength(2);
    expect(container.querySelectorAll(".knowledge__aside > .ou-card")).toHaveLength(3);
  });

  it("draws each seat at its card's own geometry, in the page's order (#422)", () => {
    const { container } = render(<KnowledgeSkeleton />);

    /** The rows a seat draws. */
    const rows = (seat: string): number =>
      container.querySelectorAll(`[data-skeleton="${seat}"] .knowledge-skeleton__row`).length;

    expect([...container.querySelectorAll("[data-skeleton]")].map((seat) => seat.getAttribute("data-skeleton"))).toEqual([
      "skills",
      "facts",
      "playbooks",
      "profile",
      "scope",
    ]);
    expect(rows("skills")).toBe(SKELETON_SKILLS);
    expect(rows("facts")).toBe(SKELETON_FACTS);
    expect(rows("playbooks")).toBe(SKELETON_PLAYBOOKS);
    expect(rows("profile")).toBe(SKELETON_PROFILE_ROWS);
    expect(container.querySelectorAll('[data-skeleton="scope"] .knowledge-skeleton__step')).toHaveLength(SKELETON_STEPS);
  });

  it("gives a table row its switch, a profile row its key, and the two cards with a block theirs", () => {
    const { container } = render(<KnowledgeSkeleton />);

    expect(container.querySelectorAll('[data-skeleton="skills"] .knowledge-skeleton__pill')).toHaveLength(SKELETON_SKILLS);
    expect(container.querySelectorAll('[data-skeleton="profile"] .knowledge-skeleton__key')).toHaveLength(SKELETON_PROFILE_ROWS);
    // The dashed tile under the playbooks; the environment block under the profile's rows.
    expect(container.querySelectorAll('[data-skeleton="playbooks"] .knowledge-skeleton__block')).toHaveLength(1);
    expect(container.querySelectorAll('[data-skeleton="profile"] .knowledge-skeleton__block')).toHaveLength(1);
  });

  it("carries no text below the head, so nothing is announced but the one label", () => {
    const { container } = render(<KnowledgeSkeleton />);

    expect(container.querySelector(".knowledge__grid")?.textContent).toBe("");
  });
});
