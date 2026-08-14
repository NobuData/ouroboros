import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card, CardHead } from "@/app/ui";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The card primitive and its head (#46).
 *
 * The property worth protecting here is the accessibility one: a card renders whatever
 * element the caller says, because rendering a `<section>` always would put eight unnamed
 * regions into the accessibility tree of a page that has four, and rendering a `<div>`
 * always would take the names off the four that have them.
 */

describe("which element it renders", () => {
  it("is a plain box by default, naming nothing", () => {
    const { container } = render(<Card>Content</Card>);

    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("is a named region when the caller makes it one", () => {
    render(
      <Card as="section" aria-label="Members">
        3
      </Card>,
    );

    expect(screen.getByRole("region", { name: "Members" })).toBeInTheDocument();
  });

  it("is named by its own heading when it has one", () => {
    render(
      <Card as="section" aria-labelledby="card-title">
        <CardHead title="System" titleId="card-title" />
      </Card>,
    );

    expect(screen.getByRole("region", { name: "System" })).toBeInTheDocument();
  });
});

describe("the surfaces", () => {
  it("wears the class for the surface and size it was given", () => {
    const { container } = render(
      <Card tone="inset" size="lg" fill>
        Waiting
      </Card>,
    );

    expect(container.firstElementChild).toHaveClass(
      "ou-card",
      "ou-card--inset",
      "ou-card--lg",
      "ou-card--fill",
    );
  });

  it("adds no modifier for the defaults", () => {
    const { container } = render(<Card>Content</Card>);

    expect(container.firstElementChild?.className).toBe("ou-card");
  });

  it("lays its children out as a column only when asked", () => {
    // A flex column does not collapse the margins between its children, so a card of prose
    // laid out that way spaces its paragraphs differently from every other block of prose
    // in the product. It is opt-in for exactly that reason.
    const { container } = render(<Card>Prose</Card>);

    expect(container.firstElementChild).not.toHaveClass("ou-card--fill");
  });

  it("keeps a page's own class, which is how a page places one in a grid", () => {
    const { container } = render(<Card className="dash-col--3">Tile</Card>);

    expect(container.firstElementChild).toHaveClass("ou-card", "dash-col--3");
  });
});

describe("the head", () => {
  it("names the card at the heading level the page's outline needs", () => {
    render(<CardHead title="Active loops" as="h3" />);

    expect(
      screen.getByRole("heading", { level: 3, name: "Active loops" }),
    ).toBeInTheDocument();
  });

  it("is an h2 by default, under the page's own h1", () => {
    render(<CardHead title="Active loops" />);

    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
  });

  it("puts what trails the title at the trailing edge, with a spacer between", () => {
    // The spacer is the component's business rather than every caller's — three cards in
    // the mockups put a chip, a count and a link there.
    const { container } = render(
      <CardHead title="System" trailing={<span>operational</span>} />,
    );

    expect(container.querySelector(".ou-card__spacer")).toBeInTheDocument();
    expect(screen.getByText("operational")).toBeInTheDocument();
  });

  it("draws no spacer when nothing trails the title", () => {
    const { container } = render(<CardHead title="System" />);

    expect(container.querySelector(".ou-card__spacer")).not.toBeInTheDocument();
  });

  it("keeps a marker that belongs to the title against it, before the spacer", () => {
    // The mockups' `.card-head` is *title · adornment · spacer · link*: the active-loops
    // card's *live* pill reports on the card's own subject and belongs beside its name, not
    // pushed to the far edge with the controls.
    const { container } = render(
      <CardHead
        title="Active loops"
        beside={<span>live</span>}
        trailing={<span>Open run console</span>}
      />,
    );

    const parts = [...(container.firstElementChild?.children ?? [])].map(
      (part) => part.textContent,
    );

    expect(parts).toEqual(["Active loops", "live", "", "Open run console"]);
  });

  it("leaves that marker out of the card's name, so a region cannot be renamed by a state", () => {
    // `aria-labelledby` points at the heading. A pill rendered *inside* the title would make
    // this region answer to "Active loops live" — and change its name whenever a run started.
    render(
      <Card as="section" aria-labelledby="head">
        <CardHead title="Active loops" titleId="head" beside={<span>live</span>} />
      </Card>,
    );

    expect(screen.getByRole("region", { name: "Active loops" })).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <Card as="section" aria-labelledby="card-title" tone="ground">
        <CardHead title="System" titleId="card-title" />
      </Card>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("region", { name: "System" })).toHaveClass("ou-card--ground");
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <Card tone="inset" fill>
        <CardHead title="Up next" trailing={<span>3</span>} />
      </Card>,
    );

    expect(light).toBe(dark);
  });
});
