import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "@/app/(app)/dashboard/loading";

/**
 * The dashboard's loading state.
 *
 * The design system asks every surface to design one rather than leave a blank region
 * (§ 3.3), and Next.js's `loading.tsx` is how a route says what it is. Two things can go
 * wrong with a skeleton and both are asserted below: it can be the wrong *shape*, so the
 * page jumps when the data arrives, and it can be read aloud — a dozen empty boxes
 * announced one by one is worse than saying nothing.
 *
 * Since [#86](https://github.com/NobuData/ouroboros/issues/86) the first of those is checked
 * card by card rather than only by column span: nine cards drawn as one shape reserve the
 * wrong height for eight of them, which is a skeleton that satisfies its own test and still
 * lets the page jump.
 */

describe("the dashboard's skeleton", () => {
  it("stands in for the same nine cards, at the same column spans", () => {
    // Not "some boxes": the grid the reader is about to see, so nothing moves when it does.
    const { container } = render(<Loading />);

    const spans = [...container.querySelectorAll(".dash-grid > *")].map(
      (card) => [...card.classList].find((name) => name.startsWith("dash-col--")),
    );

    expect(spans).toEqual([
      "dash-col--3",
      "dash-col--3",
      "dash-col--3",
      "dash-col--3",
      "dash-col--8",
      "dash-col--4",
      "dash-col--4",
      "dash-col--7",
      "dash-col--5",
    ]);
  });

  it("stands in for each card's own shape, not nine of one shape", () => {
    // The point of the whole file: a stat tile is a caption over one large figure, the tables
    // are ruled rows, and the pulse card is a picture over three meters with a switch under a
    // rule. Drawn as one generic block, eight of the nine reserve the wrong height.
    const { container } = render(<Loading />);

    const cards = [...container.querySelectorAll(".dash-grid > .ou-card")];
    const shape = (card: Element) => ({
      rows: card.querySelectorAll(".dash-skeleton__row").length,
      figures: card.querySelectorAll(".dash-skeleton__bar--tall").length,
      meters: card.querySelectorAll(".dash-skeleton__meter").length,
      glyphs: card.querySelectorAll(".dash-skeleton__glyph").length,
    });

    expect(cards.map(shape)).toEqual([
      // The four stat tiles: one tall figure each, and no rows.
      { rows: 0, figures: 1, meters: 0, glyphs: 0 },
      { rows: 0, figures: 1, meters: 0, glyphs: 0 },
      { rows: 0, figures: 1, meters: 0, glyphs: 0 },
      { rows: 0, figures: 1, meters: 0, glyphs: 0 },
      // Active loops: the three runs the seeded workspace draws.
      { rows: 3, figures: 0, meters: 0, glyphs: 0 },
      // The pulse card: the mark's box and its three meters.
      { rows: 0, figures: 0, meters: 3, glyphs: 1 },
      // System: three dependencies. Completions: four. The queue: five.
      { rows: 3, figures: 0, meters: 0, glyphs: 0 },
      { rows: 4, figures: 0, meters: 0, glyphs: 0 },
      { rows: 5, figures: 0, meters: 0, glyphs: 0 },
    ]);
  });

  it("gives every card that has a head a head-shaped bar", () => {
    // So the body of each starts on the line the real card's body will. The stat tiles have
    // no card head, which is why the count is five rather than nine.
    const { container } = render(<Loading />);

    expect(container.querySelectorAll(".dash-skeleton__head")).toHaveLength(5);
  });

  it("reserves the pulse mark's box at the asset's own ratio", () => {
    // The tallest card on the grid, and the one with a picture in it: the box is held at
    // 512×296 by the sheet, exactly as `.dash-pulse__glyph` holds it, so nothing moves when
    // the file arrives.
    const { container } = render(<Loading />);

    expect(container.querySelectorAll(".dash-skeleton__glyph")).toHaveLength(1);
  });

  it("stretches every card, so a short skeleton does not leave a gap its card will not", () => {
    const { container } = render(<Loading />);

    for (const card of container.querySelectorAll(".dash-grid > .ou-card")) {
      expect(card).toHaveClass("ou-card--fill");
    }
  });

  it("uses the page's own frame, so the shell does not reflow when the cards arrive", () => {
    const { container } = render(<Loading />);

    expect(container.querySelector(".dash")).not.toBeNull();
    expect(container.querySelector(".dash__head")).not.toBeNull();
  });

  it("says it is busy, once", () => {
    render(<Loading />);

    expect(screen.getByLabelText("Loading the dashboard")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("hides the bars from the accessibility tree rather than reading them out", () => {
    const { container } = render(<Loading />);

    expect(container.querySelector(".dash-grid")).toHaveAttribute("aria-hidden");
  });

  it("carries no text, so nothing on it can be mistaken for data", () => {
    // A skeleton with a number in it is a number somebody will read.
    const { container } = render(<Loading />);

    expect(container.textContent?.trim()).toBe("");
  });

  it("is not a landmark, because the page it stands in for is the `main` one", () => {
    // Two `main` landmarks in one document — the fallback's and, a moment later, the
    // page's — is a document with no main landmark anyone can rely on.
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("styles itself through classes only", () => {
    const { container } = render(<Loading />);

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
