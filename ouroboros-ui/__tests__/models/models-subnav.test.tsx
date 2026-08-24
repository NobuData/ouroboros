import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelsSubnav } from "@/app/models/models-subnav";
import { MODELS_TABS, type ModelsSurface, isLiveTab } from "@/app/models/view";
import { MODELS_PATH, PROVIDERS_PATH } from "@/app/paths";

import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The Models section's tab set (#227, amending #200) — the one row both `/models` and
 * `/models/providers` draw.
 *
 * The ticket's criterion that matters is that the tab states are correct **from both
 * directions**: navigating 06 → 07 and 07 → 06 must show the same four tabs with only the
 * underline moved. That is a property of one component drawing one list, and this suite is
 * organised around it — every case renders the row for both surfaces and asserts what stays
 * the same and what moves.
 */

/** The two built surfaces, so no sweep below can miss a direction. */
const SURFACES: readonly ModelsSurface[] = ["routing", "providers"];

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
      "Model registrysoon",
      "Providers & keys",
      "Spendsoon",
    ]);
  });

  it.each(SURFACES)("links both built surfaces on %s, not only the one it is", (active) => {
    // The other direction is a link, which is what makes it a direction at all.
    render(<ModelsSubnav active={active} />);

    expect(linkLabels()).toEqual(["Routing", "Providers & keys"]);
    expect(screen.getByRole("link", { name: "Routing" })).toHaveAttribute("href", MODELS_PATH);
    expect(screen.getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "href",
      PROVIDERS_PATH,
    );
  });

  it.each(SURFACES)("draws the same two honest `soon` tabs on %s", (active) => {
    // Registry and Spend are not this ticket's to build, and they must not become live links
    // on one page while still `soon` on the other — one list is what prevents that.
    render(<ModelsSubnav active={active} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });

    for (const label of ["Model registry", "Spend"]) {
      const tab = within(tabs).getByText(label, { selector: ".ou-subnav__soon" });

      expect(tab.tagName, label).toBe("SPAN");
      expect(tab, label).toHaveTextContent("soon");
      expect(tab.hasAttribute("href"), label).toBe(false);
      expect(tab.hasAttribute("tabindex"), label).toBe(false);
    }
  });

  it("names the issue each unbuilt tab waits for", () => {
    render(<ModelsSubnav active="providers" />);

    expect(
      screen.getByText("Model registry", { selector: ".ou-subnav__soon" }).getAttribute("title"),
    ).toMatch(/#591/);
    expect(screen.getByText("Spend", { selector: ".ou-subnav__soon" }).getAttribute("title")).toMatch(
      /#210/,
    );
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
    // 07 → 06: the direction the ticket's amendment to #200 adds.
    render(<ModelsSubnav active="providers" />);

    expect(screen.getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Routing" })).not.toHaveAttribute("aria-current");
  });

  it.each(SURFACES)("marks exactly one tab on %s", (active) => {
    // Two current tabs would be two claims about where the reader is; none would be a row
    // with no underline.
    render(<ModelsSubnav active={active} />);

    expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("differs between the two pages in the mark and nothing else", () => {
    // The property the ticket's criterion reduces to: the two pages draw one row, and the
    // only thing that moves between them is `aria-current`.
    const routing = render(<ModelsSubnav active="routing" />).container.innerHTML;
    document.body.innerHTML = "";
    const providers = render(<ModelsSubnav active="providers" />).container.innerHTML;

    const strip = (html: string) => html.replace(/ aria-current="page"/g, "");

    expect(routing).not.toBe(providers);
    expect(strip(routing)).toBe(strip(providers));
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
