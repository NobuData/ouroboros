import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FoundationsCard } from "@/app/models/foundations-card";
import {
  CONNECT_PROVIDER,
  DEV_SEED_NOTE,
  FOUNDATIONS_TITLE,
  NO_PROVIDERS_TITLE,
  NO_ROUTES_TITLE,
  PROVIDERS_LINK,
  SEED_ROUTES,
  SEED_ROUTES_REASON,
  SEED_ROUTES_TITLE,
} from "@/app/models/states";
import { PROVIDERS_PATH } from "@/app/paths";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The guidance card (#205) — the path from nothing to a working matrix, drawn.
 *
 * Which step is next and what each says is `states.test.ts`'s. What is here is the drawing:
 * that the path is a list of steps with the current one marked, that the pointer into
 * Providers & keys is a live link and never a dead one, and that the bootstrap says what it
 * is waiting on rather than sitting dead.
 */

describe("the card", () => {
  it("is a named region in the matrix's seat, at the matrix's eight columns", () => {
    render(<FoundationsCard state={{ kind: "no-providers" }} />);

    const card = screen.getByRole("region", { name: FOUNDATIONS_TITLE });

    expect(card).toHaveClass("models-col--8");
    expect(card.tagName).toBe("SECTION");
  });

  it("draws the path as an ordered list of two steps, always both", () => {
    render(<FoundationsCard state={{ kind: "no-providers" }} />);

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");

    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveTextContent(CONNECT_PROVIDER);
    expect(steps[1]).toHaveTextContent(SEED_ROUTES_TITLE);
  });

  it("carries the development note, ruled off from the path", () => {
    render(<FoundationsCard state={{ kind: "no-providers" }} />);

    expect(screen.getByText(DEV_SEED_NOTE)).toHaveClass("models-foundations__dev");
  });
});

describe("no providers", () => {
  it("says routing needs a provider, and marks connecting one as the step the reader is on", () => {
    render(<FoundationsCard state={{ kind: "no-providers" }} />);

    expect(screen.getByText(NO_PROVIDERS_TITLE)).toBeInTheDocument();

    const [provider, routes] = screen.getAllByRole("listitem");

    expect(provider).toHaveAttribute("aria-current", "step");
    expect(provider).toHaveTextContent("next");
    expect(routes).not.toHaveAttribute("aria-current");
    expect(routes).toHaveTextContent("then");
  });

  it("points at Providers & keys with a live link, not a dead one and not a `soon`", () => {
    // The ticket asked for an honest pointer to mockup 07's surface when that surface did
    // not exist. It does now (#227, #231), so the honest pointer is the link.
    render(<FoundationsCard state={{ kind: "no-providers" }} />);

    const link = screen.getByRole("link", { name: PROVIDERS_LINK });

    expect(link).toHaveAttribute("href", PROVIDERS_PATH);
    expect(link).toHaveClass("ou-btn");
    expect(screen.queryByText(/soon/)).toBeNull();
  });

  it("draws no bootstrap control while the provider step is still ahead", () => {
    render(<FoundationsCard state={{ kind: "no-providers" }} />);

    expect(screen.queryByRole("button", { name: SEED_ROUTES })).toBeNull();
  });
});

describe("no routes", () => {
  it("ticks the provider step off with the count, and makes seeding the routes the step the reader is on", () => {
    render(<FoundationsCard state={{ kind: "no-routes", connected: 2 }} />);

    expect(screen.getByText(NO_ROUTES_TITLE)).toBeInTheDocument();

    const [provider, routes] = screen.getAllByRole("listitem");

    expect(provider).toHaveTextContent("2 providers connected");
    expect(provider).toHaveTextContent("done");
    expect(provider).not.toHaveAttribute("aria-current");
    expect(routes).toHaveAttribute("aria-current", "step");
    expect(screen.queryByRole("link", { name: PROVIDERS_LINK })).toBeNull();
  });

  it("draws the bootstrap in its real position, inert with its reason — printed as well as carried", () => {
    // § 3.5: a surface that is not ready is labelled, never dead. `aria-disabled` rather than
    // `disabled`, so it keeps its place in the tab order and its explanation with it.
    render(<FoundationsCard state={{ kind: "no-routes", connected: 1 }} />);

    const seed = screen.getByRole("button", { name: SEED_ROUTES });

    expect(seed).toHaveAttribute("aria-disabled", "true");
    expect(seed).toHaveAttribute("title", SEED_ROUTES_REASON);
    expect(screen.getByText(SEED_ROUTES_REASON)).toHaveClass("models-foundations__reason");
  });

  it("marks the provider step unknown, as a ring with the word, when the strip could not be read", () => {
    // *Nobody could ask* is not *nobody has connected one* — the strip's own rule (M8), kept
    // on the path.
    render(<FoundationsCard state={{ kind: "no-routes", connected: null }} />);

    const [provider] = screen.getAllByRole("listitem");

    expect(provider).toHaveClass("models-foundations__step--unknown");
    expect(provider).toHaveTextContent("unknown");
    expect(provider?.querySelector(".ou-chip__dot--ring")).not.toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders in the %s palette", (palette) => {
    renderInPalette(palette, <FoundationsCard state={{ kind: "no-routes", connected: 1 }} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("region", { name: FOUNDATIONS_TITLE })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<FoundationsCard state={{ kind: "no-providers" }} />);

    expect(light).toBe(dark);
  });

  it("carries every colour and length in a class", () => {
    const { container } = render(<FoundationsCard state={{ kind: "no-routes", connected: 1 }} />);

    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });
});
