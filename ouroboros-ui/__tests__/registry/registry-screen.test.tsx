import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Reading } from "@/app/api/reading";
import type { RegistryAlias } from "@/app/api/registry";
import type { ProviderConnection } from "@/app/api/providers";
import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";
import {
  INSPECTOR_EMPTY_TITLE,
  TABLE_EMPTY_TITLE,
  TABLE_FAILED_TITLE,
  TABLE_TITLE,
} from "@/app/registry/table";
import {
  CONNECT_PROVIDER_LABEL,
  IMPORT_LABEL,
  MEMBER_REASON,
  NEW_ALIAS_LABEL,
  NO_PROVIDERS_REASON,
  PROVIDERS_UNREADABLE_REASON,
  REGISTRY_SUBLINE,
  REGISTRY_TITLE,
  type RegistryReadings,
} from "@/app/registry/view";

import { CREATE_TITLE, NAME_LABEL, NAME_TAKEN, PROVIDER_LABEL } from "@/app/registry/create";
import { wizardTitle } from "@/app/registry/wizard";

import { seededCards } from "../helpers/providers";
import { PALETTES, maskIds, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { seededRegistry } from "../helpers/registry";

// The table's switches write through a Server Action on the server-only client; the action is
// `switch-actions.test.ts`'s subject and the switch `alias-switch.test.tsx`'s.
vi.mock("@/app/registry/switch-actions", () => ({ setAliasEnabled: vi.fn() }));
// The two flows behind the head's actions write through Server Actions on the server-only
// client; the actions are `create-actions.test.ts`'s and `import-actions.test.ts`'s subjects,
// and the dialog and the wizard are `new-alias.test.tsx`'s and `import-wizard.test.tsx`'s.
vi.mock("@/app/registry/create-actions", () => ({
  createAlias: vi.fn(),
  readModelOptions: () => new Promise(() => {}),
  readParamSchema: () => new Promise(() => {}),
}));
vi.mock("@/app/registry/import-actions", () => ({
  importAliases: vi.fn(),
  readCandidates: () => new Promise(() => {}),
}));
// …and the inspector's three writes (#593), whose own suites are `inspector-actions.test.ts`'s
// and `alias-inspector.test.tsx`'s.
vi.mock("@/app/registry/inspector-actions", () => ({
  saveAlias: vi.fn(),
  duplicateAlias: vi.fn(),
  removeAlias: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

const { RegistryScreen } = await import("@/app/registry/registry-screen");

/**
 * The `/models/registry` page (#591) — mockup 21's page head and tab set, composed — and,
 * since #592, the allowed-models table in the seat below them.
 *
 * The tab set's own behaviour is `models/models-subnav.test.tsx`'s, the dropdown's is
 * `import-menu.test.tsx`'s, the table's is `registry-table.test.tsx`'s and the copy's is
 * `view.test.ts`'s. What is left here is the composition the tickets' acceptance criteria
 * describe: the head is the mockup's verbatim, both actions are wired — one to the workspace's
 * providers, one to its reason — the tab set has this page current with its two siblings a
 * link away, the table stands below them with the URL's alias selected, and the two states in
 * which there is no table are told apart.
 */

/**
 * The readings for a workspace whose two reads came back clean.
 *
 * @param providers The connections. Defaults to the seeded five.
 * @param aliases The registry. Defaults to the seeded eight.
 * @returns The readings.
 */
function readings(
  providers: readonly ProviderConnection[] = seededCards(),
  aliases: readonly RegistryAlias[] = seededRegistry(),
): RegistryReadings {
  return { providers: { ok: true, value: providers }, aliases: { ok: true, value: aliases } };
}

/** …and a provider read that did not. */
const UNREADABLE: Reading<readonly ProviderConnection[]> = {
  ok: false,
  reason: "upstream refused",
};

/** …and a registry read that did not. */
const TABLE_UNREADABLE: Reading<readonly RegistryAlias[]> = { ok: false, reason: "registry away" };

/**
 * Render the page.
 *
 * @param over What this case is about — the readings, whether the reader may administer, and
 *   the alias the URL asked for.
 * @returns The render result.
 */
function page(
  over: Partial<{ readings: RegistryReadings; mayAdminister: boolean; alias: string | string[] | null }> = {},
) {
  return render(
    <RegistryScreen
      alias={over.alias ?? null}
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

  it("draws + New alias as the head's one primary action, and lets an admin press it", () => {
    // CI.4 (#594) built the dialog behind it, so the *not built yet* reason is gone rather
    // than reworded and the control acts.
    page();

    const create = screen.getByRole("button", { name: NEW_ALIAS_LABEL });

    expect(create).toHaveClass("ou-btn--primary");
    expect(create).not.toHaveAttribute("aria-disabled");
    expect(create).not.toHaveAttribute("title");
  });
});

describe("the two flows the head's actions open (#594)", () => {
  it("opens the create dialog from + New alias, over the page it was pressed on", () => {
    // The composition this ticket owes the page: the action is a control on the head, and what
    // it opens is a dialog outside the pane rather than a second screen.
    page();

    fireEvent.click(screen.getByRole("button", { name: NEW_ALIAS_LABEL }));

    expect(screen.getByRole("dialog")).toHaveAccessibleName(CREATE_TITLE);
    expect(screen.getByRole("heading", { name: REGISTRY_TITLE })).toBeInTheDocument();
  });

  it("hands the dialog the workspace's own names, so a taken one is caught with no round trip", () => {
    // The same read the table draws — a second read would be a second answer to *what is taken*.
    page();
    fireEvent.click(screen.getByRole("button", { name: NEW_ALIAS_LABEL }));
    fireEvent.change(screen.getByLabelText(NAME_LABEL), { target: { value: "coder-max" } });

    expect(screen.getByText(NAME_TAKEN)).toBeInTheDocument();
  });

  it("hands the dialog the workspace's connections, so bind-now can offer them", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: NEW_ALIAS_LABEL }));

    const options = [...(screen.getByLabelText(PROVIDER_LABEL) as HTMLSelectElement).options];

    expect(options.slice(1).map((option) => option.textContent)).toEqual(
      seededCards().map((health) => health.displayName),
    );
  });

  it("opens the import wizard on the connection a menu row names", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: IMPORT_LABEL }));
    fireEvent.click(screen.getAllByRole("menuitem")[0]!);

    expect(screen.getByRole("dialog")).toHaveAccessibleName(wizardTitle("Anthropic Claude"));
  });

  it("leaves both flows unreachable for a member, from the head rather than from a 403", () => {
    // The ticket's last criterion. The gate that enforces is the service's; what the page owes
    // is that a member is not walked into it.
    page({ mayAdminister: false });

    for (const label of [IMPORT_LABEL, NEW_ALIAS_LABEL]) {
      const button = screen.getByRole("button", { name: label });

      expect(button, label).toHaveAttribute("title", MEMBER_REASON);
      fireEvent.click(button);
    }

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
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
      { readings: { ...readings(), providers: UNREADABLE } },
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
    page({ readings: { ...readings(), providers: UNREADABLE } });

    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute(
      "title",
      PROVIDERS_UNREADABLE_REASON,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
    // …and the table, which is a different read, is still drawn.
    expect(screen.getByRole("grid")).toBeInTheDocument();
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

describe("the allowed-models table (#592)", () => {
  it("stands below the tab set, with the seeded eight rows and a true count", () => {
    page();

    expect(screen.getByRole("heading", { level: 2, name: TABLE_TITLE })).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(9);
    expect(screen.getByText("8 aliases")).toBeInTheDocument();
  });

  it("selects the row the URL asked for, so a selected alias survives a reload", () => {
    page({ alias: "coder-max" });

    expect(screen.getByRole("row", { selected: true })).toHaveAttribute("data-row-key", "coder-max");
    expect(screen.getByRole("heading", { level: 2, name: "Edit — coder-max" })).toBeInTheDocument();
  });

  it("selects nothing for an alias the workspace does not have, or a repeated parameter", () => {
    for (const alias of ["nope", ["coder-max", "sizer"]]) {
      const view = page({ alias });

      expect(screen.queryByRole("row", { selected: true })).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "Edit" })).toBeInTheDocument();

      view.unmount();
    }
  });

  it("hands the reader's role to the switches", () => {
    page({ mayAdminister: false });

    for (const control of screen.getAllByRole("switch")) {
      expect(control).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("opens the inspector on the row the URL asked for, with the page's own two facts in it", () => {
    // The card is the inspector rather than a placeholder, and what it offers is the *page's*
    // connections — one list for the import menu, the create dialog and the rebind select —
    // and the *page's* alias names, one set for a create's refusal and a rename's.
    page({ alias: "coder-max" });

    const card = screen.getByRole("region", { name: "Edit — coder-max" });

    expect(within(card).getByLabelText("Alias")).toHaveValue("coder-max");
    expect(
      within(card).getByRole("option", { name: /Anthropic Claude — key/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(INSPECTOR_EMPTY_TITLE)).toBeNull();
  });

  it("says how to select one when nothing is, rather than heading a card with a hole in it", () => {
    page();

    expect(screen.getByText(INSPECTOR_EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Edit" })).toBeInTheDocument();
  });
});

describe("a workspace whose registry could not be read", () => {
  it("says so where the table would be, with the service's sentence, and keeps the page", () => {
    // One failed read is one degraded region: the head, the tab set, the import menu and the
    // inspector's seat all still render, and *could not be read* is not drawn as *no aliases*.
    page({ readings: { ...readings(), aliases: TABLE_UNREADABLE } });

    expect(screen.getByText(TABLE_FAILED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/registry away/)).toBeInTheDocument();
    expect(screen.queryByText(TABLE_EMPTY_TITLE)).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
    expect(screen.getByRole("button", { name: IMPORT_LABEL })).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getByRole("heading", { level: 2, name: "Edit" })).toBeInTheDocument();
  });
});

describe("a workspace with no aliases yet", () => {
  it("says so rather than drawing an empty grid, and keeps the two states apart", () => {
    page({ readings: readings(seededCards(), []) });

    expect(screen.getByText(TABLE_EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText("0 aliases")).toBeInTheDocument();
    expect(screen.queryByText(TABLE_FAILED_TITLE)).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the page in the %s palette", (palette) => {
    renderInPalette(palette, <RegistryScreen alias="coder-max" mayAdminister readings={readings()} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(REGISTRY_TITLE);
    expect(screen.getByRole("row", { selected: true })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <RegistryScreen alias="coder-max" mayAdminister readings={readings()} />,
    );

    expect(maskIds(light)).toBe(maskIds(dark));
  });
});
