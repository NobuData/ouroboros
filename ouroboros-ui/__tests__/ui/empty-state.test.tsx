import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState, Eyebrow } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The empty state and the eyebrow (#46) — the two smallest primitives, and the two whose
 * whole point is editorial rather than visual.
 *
 * An empty state is where a screen admits what it does not know. The design system's § 3.5
 * asks that a surface which is not ready be *labelled* rather than blank or dead, and the
 * shape of this component is that rule: a headline naming what is not there, and a note
 * naming what it is waiting on.
 *
 * An eyebrow is a caption for the heading beneath it, which is why it is a paragraph and
 * not a heading of its own — a second entry in the page's outline for one title would have
 * a reader navigating by heading hear the caption and the title as two separate things.
 */

describe("the empty state", () => {
  it("says what is not there and what it is waiting on", () => {
    render(
      <EmptyState
        title="No loops yet"
        note="The run console arrives with mockup 10."
      />,
    );

    expect(screen.getByText("No loops yet")).toBeInTheDocument();
    expect(screen.getByText("The run console arrives with mockup 10.")).toBeInTheDocument();
  });

  it("is a panel by default, centred under the card's heading", () => {
    const { container } = render(<EmptyState title="No loops yet" />);

    expect(container.firstElementChild).toHaveClass("ou-empty", "ou-empty--center");
  });

  it("is a paragraph in the flow of a card when the caller asks for that", () => {
    const { container } = render(<EmptyState variant="flush" note="Nothing here yet." />);

    expect(container.firstElementChild).toHaveClass("ou-empty--flush");
    expect(container.firstElementChild).not.toHaveClass("ou-empty--center");
  });

  it("takes the height its card has left only when asked", () => {
    const { container } = render(<EmptyState note="Nothing here yet." fill />);

    expect(container.firstElementChild).toHaveClass("ou-empty--fill");
  });

  it("draws only the parts it was given", () => {
    // The login screen's use has a note and no headline: the note is the whole of it, and a
    // headline invented to fill the shape would be copy nobody wrote.
    const { container } = render(<EmptyState note="Nothing here yet." />);

    expect(container.querySelector(".ou-empty__title")).not.toBeInTheDocument();
    expect(container.querySelector(".ou-empty__note")).toBeInTheDocument();
  });

  it("carries markup in its note, so a name inside a sentence can be emphasised", () => {
    render(
      <EmptyState
        note={
          <>
            <strong>Acme Robotics</strong> is already here.
          </>
        }
      />,
    );

    expect(screen.getByText("Acme Robotics").tagName).toBe("STRONG");
  });

  it("keeps a page's own class, which is how a page spaces one", () => {
    const { container } = render(
      <EmptyState note="Nothing here yet." className="login-step__empty" />,
    );

    expect(container.firstElementChild).toHaveClass("ou-empty", "login-step__empty");
  });
});

describe("the eyebrow", () => {
  it("is a caption, not a heading, so it adds nothing to the page's outline", () => {
    render(<Eyebrow>Mission Control</Eyebrow>);

    expect(screen.getByText("Mission Control").tagName).toBe("P");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("has a quiet form for a head that must not compete with the one beside it", () => {
    render(<Eyebrow tone="quiet">After sign-in · Step 2</Eyebrow>);

    expect(screen.getByText("After sign-in · Step 2")).toHaveClass("ou-eyebrow--quiet");
  });

  it("adds no modifier for the accent form the mockups draw", () => {
    render(<Eyebrow>Mission Control</Eyebrow>);

    expect(screen.getByText("Mission Control").className).toBe("ou-eyebrow");
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <>
        <Eyebrow>Mission Control</Eyebrow>
        <EmptyState title="No loops yet" note="Nothing runs loops yet." fill />
      </>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByText("Mission Control")).toHaveClass("ou-eyebrow");
    expect(screen.getByText("No loops yet")).toHaveClass("ou-empty__title");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <>
        <Eyebrow tone="quiet">After sign-in · Step 2</Eyebrow>
        <EmptyState title="No loops yet" note="Nothing runs loops yet." />
      </>,
    );

    expect(light).toBe(dark);
  });
});
