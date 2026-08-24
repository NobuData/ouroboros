import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelsSubnav } from "@/app/models/models-subnav";
import { MODELS_TABS, type ModelsSurface, isLiveTab } from "@/app/models/view";
import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The Models section's tab set (#227 and #591, amending #200) — the one row `/models`,
 * `/models/registry` and `/models/providers` all draw.
 *
 * The criterion that matters is that the tab states are correct **from every direction**: AE.1
 * asked for 06 ⇄ 07 and CI.1 for 06 ⇄ 21 ⇄ 07, and both reduce to the same property — the
 * pages draw one row and only the underline moves. This suite is organised around it: every
 * case renders the row for all three surfaces and asserts what stays the same and what moves.
 */

/** The three built surfaces, so no sweep below can miss a direction. */
const SURFACES: readonly ModelsSurface[] = ["routing", "registry", "providers"];

/** The tab labels a page renders as links, in row order. */
function linkLabels(): string[] {
  const tabs = screen.getByRole("navigation", { name: "Models" });

  return within(tabs).getAllByRole("link").map((link) => link.textContent ?? "");
}

describe("the same row on both pages", () => {
  it.each(SURFACES)("draws mockup 06's four tabs in its order on %s", (active) => {
    render(<ModelsSubnav active={active} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });

    expect([...tabs.children].map((tab) => tab.textContent)).toEqual([
      "Routing",
      "Model registry",
      "Providers & keys",
      "Spendsoon",
    ]);
  });

  it.each(SURFACES)("links every built surface on %s, not only the one it is", (active) => {
    // The other directions are links, which is what makes them directions at all.
    render(<ModelsSubnav active={active} />);

    expect(linkLabels()).toEqual(["Routing", "Model registry", "Providers & keys"]);
    expect(screen.getByRole("link", { name: "Routing" })).toHaveAttribute("href", MODELS_PATH);
    expect(screen.getByRole("link", { name: "Model registry" })).toHaveAttribute(
      "href",
      REGISTRY_PATH,
    );
    expect(screen.getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "href",
      PROVIDERS_PATH,
    );
  });

  it.each(SURFACES)("draws the same honest `soon` tab on %s", (active) => {
    // Spend is not this section's to build, and it must not become a live link on one page
    // while still `soon` on another — one list is what prevents that.
    render(<ModelsSubnav active={active} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const tab = within(tabs).getByText("Spend", { selector: ".ou-subnav__soon" });

    expect(tab.tagName).toBe("SPAN");
    expect(tab).toHaveTextContent("soon");
    expect(tab.hasAttribute("href")).toBe(false);
    expect(tab.hasAttribute("tabindex")).toBe(false);
  });

  it("names the issue the unbuilt tab waits for", () => {
    render(<ModelsSubnav active="providers" />);

    expect(screen.getByText("Spend", { selector: ".ou-subnav__soon" }).getAttribute("title")).toMatch(
      /#210/,
    );
  });

  it.each(SURFACES)("draws Model registry as a link rather than a stub on %s", (active) => {
    // The amendment CI.1 (#591) makes, asserted from every direction: the tab that said
    // *soon* on all three pages is a link on all three, because the list they share is one
    // list. A tab live on one page and `soon` on another would be the drift this arrangement
    // exists to prevent.
    render(<ModelsSubnav active={active} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });

    expect(within(tabs).queryByText("Model registry", { selector: ".ou-subnav__soon" })).toBeNull();
    expect(within(tabs).getByRole("link", { name: "Model registry" })).toBeInTheDocument();
  });
});

describe("which tab is current", () => {
  it("marks Routing on /models and leaves Providers & keys a plain link", () => {
    render(<ModelsSubnav active="routing" />);

    expect(screen.getByRole("link", { name: "Routing" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Providers & keys" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks Providers & keys on /models/providers and leaves Routing a plain link", () => {
    // 07 → 06: the direction #227's amendment to #200 adds.
    render(<ModelsSubnav active="providers" />);

    expect(screen.getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Routing" })).not.toHaveAttribute("aria-current");
  });

  it("marks Model registry on /models/registry and leaves its siblings plain links", () => {
    // 21 → 06 and 21 → 07: the third direction, which is CI.1's (#591) own criterion.
    render(<ModelsSubnav active="registry" />);

    expect(screen.getByRole("link", { name: "Model registry" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Routing" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Providers & keys" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it.each(SURFACES)("marks exactly one tab on %s", (active) => {
    // Two current tabs would be two claims about where the reader is; none would be a row
    // with no underline.
    render(<ModelsSubnav active={active} />);

    expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("differs between the three pages in the mark and nothing else", () => {
    // The property every one of these criteria reduces to: the three pages draw one row, and
    // the only thing that moves between them is `aria-current`.
    const strip = (html: string) => html.replace(/ aria-current="page"/g, "");

    const rendered = SURFACES.map((active) => {
      document.body.innerHTML = "";

      return render(<ModelsSubnav active={active} />).container.innerHTML;
    });

    expect(new Set(rendered).size).toBe(SURFACES.length);
    expect(new Set(rendered.map(strip)).size).toBe(1);
  });
});

describe("the underline's hue", () => {
  it("is the accent unless the page says otherwise", () => {
    // Mockup 07's treatment, and 21's: the primitive's base hue.
    render(<ModelsSubnav active="providers" />);

    expect(screen.getByRole("navigation", { name: "Models" })).toHaveClass("ou-subnav");
    expect(screen.getByRole("navigation", { name: "Models" })).not.toHaveClass(
      "ou-subnav--model",
    );
  });

  it("takes mockup 06's model purple when the routing page asks for it", () => {
    render(<ModelsSubnav active="routing" tone="model" />);

    expect(screen.getByRole("navigation", { name: "Models" })).toHaveClass("ou-subnav--model");
  });
});

describe("its placement", () => {
  it("carries the section's placement class, so both pages span the pane the same way", () => {
    render(<ModelsSubnav active="routing" />);

    expect(screen.getByRole("navigation", { name: "Models" })).toHaveClass("models__subnav");
  });

  it("renders every built tab in the list and no other", () => {
    // The component draws the list and invents nothing: a link that was not in `MODELS_TABS`
    // would be a route the type system never checked.
    render(<ModelsSubnav active="routing" />);

    expect(linkLabels()).toEqual(MODELS_TABS.filter(isLiveTab).map((tab) => tab.label));
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the row in the %s palette", (palette) => {
    renderInPalette(palette, <ModelsSubnav active="providers" />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<ModelsSubnav active="providers" />);

    expect(light).toBe(dark);
  });
});
