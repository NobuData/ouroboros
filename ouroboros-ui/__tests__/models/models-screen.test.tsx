import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ModelsScreen } from "@/app/models/models-screen";
import { MODELS_PATH, PROVIDERS_PATH } from "@/app/paths";

import { readings } from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The `/models` frame (#200) — mockup 06's page head, tab set and health strip, composed.
 *
 * The strip's own behaviour is `provider-strip.test.tsx`'s, the rules behind every label are
 * `view.test.ts`'s, and the tab set — the section's since AE.1 (#227) — is
 * `models-subnav.test.tsx`'s. What is left here is the composition: that the head is the
 * mockup's, that this page is the tab set's Routing tab and the providers page is one link
 * away, and that the page admits what it is not rather than mocking it up.
 */

describe("the page head", () => {
  it("is mockup 06's, eyebrow and promise and all", () => {
    render(<ModelsScreen readings={readings()} />);

    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Route every kind of work to the model that earns it.",
    );
    expect(screen.getByText(/never raw model ids/)).toBeInTheDocument();
    expect(screen.getByText(/never silently below the floor you set/)).toBeInTheDocument();
  });

  it("has exactly one h1, so the page has one title in the outline", () => {
    render(<ModelsScreen readings={readings()} />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("Save routes", () => {
  it("is inert while nothing has been staged, and says so", () => {
    // The ticket's fourth acceptance criterion. `aria-disabled` rather than `disabled`,
    // deliberately: a disabled button leaves the tab order and takes its own explanation
    // with it, so the keyboard reader who most needs the tooltip could never reach it.
    render(<ModelsScreen readings={readings()} />);

    const save = screen.getByRole("button", { name: "Save routes" });

    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save.getAttribute("title")).toMatch(/Nothing to save/);
  });

  it("becomes pressable the moment a route has been changed", () => {
    // Driven through the screen rather than only through the rule, so that what the page
    // renders and what `saveRoutesReason` decides cannot come apart when AA.3 (#202) lands.
    render(<ModelsScreen readings={readings({ pending: 3 })} />);

    const save = screen.getByRole("button", { name: "Save routes" });

    expect(save).not.toHaveAttribute("aria-disabled");
    expect(save).not.toHaveAttribute("title");
  });
});

describe("Simulate routing", () => {
  it("is inert and names the issue that builds the panel", () => {
    render(<ModelsScreen readings={readings()} />);

    const simulate = screen.getByRole("button", { name: "Simulate routing" });

    expect(simulate).toHaveAttribute("aria-disabled", "true");
    expect(simulate.getAttribute("title")).toMatch(/#203/);
  });
});

describe("the tab set", () => {
  it("is a named navigation region, so it is not confused with the sidebar", () => {
    render(<ModelsScreen readings={readings()} />);

    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
  });

  it("wears mockup 06's model purple rather than the accent", () => {
    // The one deliberate divergence between 06 and 07/21, preserved as a tone. What varies
    // is the hue; the gesture — a 2px inset underline with a glow — is the design system's
    // at every level.
    render(<ModelsScreen readings={readings()} />);

    expect(screen.getByRole("navigation", { name: "Models" })).toHaveClass(
      "ou-subnav",
      "ou-subnav--model",
    );
  });

  it("marks Routing as the current page, and only Routing", () => {
    render(<ModelsScreen readings={readings()} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const routing = within(tabs).getByRole("link", { name: "Routing" });

    expect(routing).toHaveAttribute("href", MODELS_PATH);
    expect(routing).toHaveAttribute("aria-current", "page");
    expect(tabs.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("links Providers & keys to its page — the 06 → 07 direction AE.1 (#227) added", () => {
    // The amendment this roadmap filed against #200: the tab that was an honest `soon` stub
    // is a link the moment its page exists, and it points at the route the sidebar and the
    // providers page itself know it by.
    render(<ModelsScreen readings={readings()} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const providers = within(tabs).getByRole("link", { name: "Providers & keys" });

    expect(providers).toHaveAttribute("href", PROVIDERS_PATH);
    expect(providers).not.toHaveAttribute("aria-current");
    expect(within(tabs).getAllByRole("link")).toHaveLength(2);
  });

  it("renders the two unbuilt sibling surfaces as honest `soon` targets, not dead routes", () => {
    // The ticket's fifth acceptance criterion, less the tab AE.1 has since built. The
    // registry and the spend report are other roadmaps' surfaces; rendering them as live
    // links that go nowhere would be worse than not rendering them at all.
    render(<ModelsScreen readings={readings()} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });

    for (const label of ["Model registry", "Spend"]) {
      const tab = within(tabs).getByText(label, { selector: ".ou-subnav__soon" });

      expect(tab.tagName, label).toBe("SPAN");
      expect(tab, label).toHaveTextContent("soon");
      expect(tab.getAttribute("title"), label).toMatch(/arrives with/);
    }
  });

  it("keeps the unbuilt tabs out of the tab order", () => {
    // The sidebar's rule for the same reason: the keyboard never stops on something that
    // cannot be activated.
    render(<ModelsScreen readings={readings()} />);

    for (const tab of document.querySelectorAll(".ou-subnav__soon")) {
      expect(tab.hasAttribute("tabindex")).toBe(false);
      expect(tab.hasAttribute("href")).toBe(false);
    }
  });
});

describe("the strip, in its place on the page", () => {
  it("draws the workspace's providers between the tab set and the rest", () => {
    render(<ModelsScreen readings={readings()} />);

    expect(screen.getByRole("list", { name: "Provider health" })).toBeInTheDocument();
  });

  it("degrades to a reason without taking the rest of the page with it", () => {
    // One failed read is one degraded region, never a blank page: the head, the tab set and
    // the page's foot are all still there.
    render(<ModelsScreen readings={readings({ providers: { ok: false, reason: "Down." } })} />);

    expect(screen.getByRole("status")).toHaveTextContent("Down.");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
  });
});

describe("what the page does not pretend", () => {
  it("names the surfaces that will fill it rather than mocking them up", () => {
    // A placeholder matrix of invented rows would be the one dishonest thing on a page built
    // to be honest — and indistinguishable, in a screenshot, from the real one AA.2 ships.
    render(<ModelsScreen readings={readings()} />);

    expect(screen.getByText("The routing matrix arrives next")).toBeInTheDocument();
    expect(screen.getByText(/#201/)).toBeInTheDocument();
  });

  it("draws no table, no meter and no figure it could not compute", () => {
    const { container } = render(<ModelsScreen readings={readings()} />);

    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector(".ou-meter")).toBeNull();
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the screen in the %s palette", (palette) => {
    renderInPalette(palette, <ModelsScreen readings={readings()} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<ModelsScreen readings={readings()} />);

    expect(light).toBe(dark);
  });
});
