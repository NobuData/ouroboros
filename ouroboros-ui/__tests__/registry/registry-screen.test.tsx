import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Reading } from "@/app/api/reading";
import type { ProviderHealth } from "@/app/api/routing";
import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";
import { RegistryScreen } from "@/app/registry/registry-screen";
import {
  CONNECT_PROVIDER_LABEL,
  IMPORT_LABEL,
  MEMBER_REASON,
  NEW_ALIAS_LABEL,
  NEW_ALIAS_REASON,
  NO_PROVIDERS_REASON,
  PROVIDERS_UNREADABLE_REASON,
  REGISTRY_NEXT_TITLE,
  REGISTRY_SUBLINE,
  REGISTRY_TITLE,
  type RegistryReadings,
} from "@/app/registry/view";

import { seededProviders } from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

/**
 * The `/models/registry` frame (#591) — mockup 21's page head and tab set, composed.
 *
 * The tab set's own behaviour is `models/models-subnav.test.tsx`'s, the dropdown's is
 * `import-menu.test.tsx`'s and the copy's is `view.test.ts`'s. What is left here is the
 * composition the ticket's acceptance criteria describe: the head is the mockup's verbatim,
 * both actions are wired — one to the workspace's providers, one to its reason — the tab set
 * has this page current with its two siblings a link away, and the page admits what it is not
 * rather than mocking it up.
 */

/** The readings for a workspace whose provider read came back clean. */
function readings(providers: readonly ProviderHealth[] = seededProviders()): RegistryReadings {
  return { providers: { ok: true, value: providers } };
}

/** …and for one whose did not. */
const UNREADABLE: Reading<readonly ProviderHealth[]> = { ok: false, reason: "upstream refused" };

/**
 * Render the page.
 *
 * @param over What this case is about — the readings, and whether the reader may administer.
 * @returns The render result.
 */
function page(over: Partial<{ readings: RegistryReadings; mayAdminister: boolean }> = {}) {
  return render(
    <RegistryScreen
      mayAdminister={over.mayAdminister ?? true}
      readings={over.readings ?? readings()}
    />,
  );
}

describe("the page head", () => {
  it("is mockup 21's: the Models eyebrow and the naming promise as the title", () => {
    page();

    expect(screen.getByText("Models")).toHaveClass("ou-eyebrow");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
  });

  it("has exactly one h1, so the page has one title in the outline", () => {
    page();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders the BYOK subline verbatim", () => {
    // The wording is held to the mockup in `view.test.ts`; what is asserted here is that the
    // page renders that constant rather than a sentence of its own.
    page();

    expect(screen.getByText(REGISTRY_SUBLINE)).toHaveClass("models__sub");
  });

  it("is the section's frame rather than one of its own", () => {
    // The gutter rhythm, the sticky tab set and the head's two columns are
    // `app/models/models.css`'s, drawn through `models-frame.tsx` and shared by all three
    // pages. Rendering the section's own `<main>` is what makes the ticket's *type scales at
    // 125%* and *only the pane scrolls* criteria inherited rather than re-solved here.
    const { container } = page();

    expect(container.querySelector("main")).toHaveClass("models");
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("models__title");
  });

  it("contributes no navigation chrome of its own", () => {
    // It renders inside the app shell (§ 2), so the only <nav> on the page is the section's
    // tab set. A topbar here would be a second navigation for a reader to learn.
    page();

    const navs = screen.getAllByRole("navigation");

    expect(navs).toHaveLength(1);
    expect(navs[0]).toHaveAccessibleName("Models");
  });
});

describe("the tab set", () => {
  it("marks Model registry as the page the reader is on", () => {
    page();

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const registry = within(tabs).getByRole("link", { name: "Model registry" });

    expect(registry).toHaveAttribute("href", REGISTRY_PATH);
    expect(registry).toHaveAttribute("aria-current", "page");
    expect(tabs.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it("links both siblings, which is what makes 21 → 06 and 21 → 07 directions", () => {
    page();

    const tabs = screen.getByRole("navigation", { name: "Models" });

    expect(within(tabs).getByRole("link", { name: "Routing" })).toHaveAttribute(
      "href",
      MODELS_PATH,
    );
    expect(within(tabs).getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "href",
      PROVIDERS_PATH,
    );
  });

  it("keeps Spend an honest stub rather than a dead link", () => {
    // The ticket's third acceptance criterion. AB.4 (#210) has not shipped, and a live tab
    // over nothing is a 404 in the section's own navigation.
    page();

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const spend = within(tabs).getByText("Spend", { selector: ".ou-subnav__soon" });

    expect(spend.tagName).toBe("SPAN");
    expect(spend).toHaveTextContent("soon");
    expect(spend.hasAttribute("href")).toBe(false);
    expect(within(tabs).queryByRole("link", { name: /Spend/ })).toBeNull();
  });

  it("takes the accent underline mockup 21 draws, not mockup 06's violet", () => {
    // The one deliberate divergence between the mockups stays on the page that has it.
    page();

    expect(screen.getByRole("navigation", { name: "Models" })).not.toHaveClass(
      "ou-subnav--model",
    );
  });
});

describe("the head's two actions", () => {
  it("draws both, in the mockup's order", () => {
    page();

    const actions = screen.getAllByRole("button");

    expect(actions[0]).toHaveAccessibleName(IMPORT_LABEL);
    expect(actions[1]).toHaveAccessibleName(NEW_ALIAS_LABEL);
  });

  it("opens the import menu over the workspace's connected providers", () => {
    // The ticket's fourth criterion: the list is the workspace's own, not a placeholder.
    page();

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
  });

  it("leaves + New alias inert, naming the issue that builds its dialog", () => {
    page();

    const create = screen.getByRole("button", { name: NEW_ALIAS_LABEL });

    expect(create).toHaveClass("ou-btn--primary");
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).toHaveAttribute("title", NEW_ALIAS_REASON);
  });
});

describe("a workspace with no provider connected", () => {
  it("blocks the import action and says why", () => {
    // The state the mockup does not draw and a fresh workspace hits immediately.
    page({ readings: readings([]) });

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute(
      "title",
      NO_PROVIDERS_REASON,
    );
  });

  it("offers the one link that fixes it", () => {
    page({ readings: readings([]) });

    expect(screen.getByRole("link", { name: CONNECT_PROVIDER_LABEL })).toHaveAttribute(
      "href",
      PROVIDERS_PATH,
    );
  });

  it("offers it nowhere else, because nowhere else can act on it", () => {
    // A member sent to Providers & keys would be sent to a page that also refuses them, and a
    // failed read is not fixed by connecting anything.
    for (const over of [
      { readings: readings() },
      { readings: readings([]), mayAdminister: false },
      { readings: { providers: UNREADABLE } },
    ]) {
      const view = page(over);

      expect(screen.queryByRole("link", { name: CONNECT_PROVIDER_LABEL })).toBeNull();

      view.unmount();
    }
  });
});

describe("a workspace whose providers could not be read", () => {
  it("blocks the import action with the reason that is true, and keeps the page", () => {
    // One failed read is one degraded region, never a blank page: the head, the tab set and
    // everything below them still render.
    page({ readings: { providers: UNREADABLE } });

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute(
      "title",
      PROVIDERS_UNREADABLE_REASON,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
  });
});

describe("a reader whose role may not create aliases", () => {
  it("switches both actions off with the reason that is about them", () => {
    // The full gating pass is CI.6 (#596); what this ticket owes is that the two controls it
    // builds are already honest about who may press them.
    page({ mayAdminister: false });

    for (const label of [IMPORT_LABEL, NEW_ALIAS_LABEL]) {
      const action = screen.getByRole("button", { name: label });

      expect(action, label).toHaveAttribute("aria-disabled", "true");
      expect(action, label).toHaveAttribute("title", MEMBER_REASON);
    }
  });

  it("does not offer a menu over providers they may not import from", () => {
    page({ mayAdminister: false });

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).not.toHaveAttribute(
      "aria-haspopup",
    );
  });

  it("leaves both actions reachable, so their explanations are reachable too", () => {
    page({ mayAdminister: false });

    for (const label of [IMPORT_LABEL, NEW_ALIAS_LABEL]) {
      expect((screen.getByRole("button", { name: label }) as HTMLButtonElement).disabled, label)
        .toBe(false);
    }
  });
});

describe("what the page does not pretend", () => {
  it("names the issues that fill the table's space rather than mocking a table", () => {
    page();

    expect(screen.getByText(REGISTRY_NEXT_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/#592/)).toBeInTheDocument();
  });

  it("draws no table at all, so nothing on the page can be mistaken for data", () => {
    page();

    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the page in the %s palette", (palette) => {
    renderInPalette(palette, <RegistryScreen mayAdminister readings={readings()} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <RegistryScreen mayAdminister readings={readings()} />,
    );

    expect(light).toBe(dark);
  });
});
