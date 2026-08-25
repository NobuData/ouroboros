import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";
import {
  GRID_LABEL,
  NO_PROVIDERS_TITLE,
  PROVIDERS_UNAVAILABLE,
  switchLabel,
} from "@/app/providers/cards";
import {
  ADD_CARD_NOTE,
  ADD_DIALOG_TITLE,
  ADD_PROVIDER_READ_ONLY,
  BROWSE_CATALOG_LABEL,
  CATALOG_LIST_LABEL,
} from "@/app/providers/catalog";
import type { ProvidersReadings } from "@/app/providers/data";
import {
  ADD_PROVIDER_LABEL,
  AUDIT_LOADING,
  AUDIT_LOG_LABEL,
  AUDIT_SHEET_TITLE,
  PROVIDERS_TITLE,
  type AuditReading,
  providersSubline,
} from "@/app/providers/view";

import { seededTrail } from "../helpers/audit";
import { membership } from "../helpers/login";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import { fakeConnection, fakeEntry, readings, seededCards, seededCatalog } from "../helpers/providers";

/**
 * The `/models/providers` screen (#227) with its cards (#228) — mockup 07's page head, tab
 * set and grid, composed.
 *
 * The tab set's own behaviour is `models/models-subnav.test.tsx`'s, the sheet's is
 * `audit-trail.test.tsx`'s, the copy's is `view.test.ts`'s, and each card's is
 * `provider-card.test.tsx`'s. What is left here is the composition the tickets' acceptance
 * criteria describe: the head is the mockup's with the security model's sentence in it, both
 * actions are wired, the tab set has this page current, and **the seeded grid reproduces the
 * five mockup cards in both themes** with the dashed card last — and every way the grid
 * degrades is drawn rather than blank.
 *
 * The Server Actions behind the sheet, the dialog and the switch are mocked, not the API.
 */

const readAuditTrail = vi.fn<() => Promise<AuditReading>>();
const readCatalog = vi.fn();

vi.mock("@/app/providers/audit-actions", () => ({
  readAuditTrail: () => readAuditTrail(),
}));
vi.mock("@/app/providers/add-actions", () => ({
  readCatalog: () => readCatalog(),
  addProvider: vi.fn(),
}));
vi.mock("@/app/providers/card-actions", () => ({ setProviderEnabled: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ProvidersScreen } = await import("@/app/providers/providers-screen");

/** The seeded workspace's display name — what the gate hands the page. */
const WORKSPACE = membership().name;

/**
 * Render the page for the seeded workspace.
 *
 * @param mayAdminister Whether the reader may connect a provider. Defaults to an owner's.
 * @param over What this case is about, over the seeded readings.
 */
function seeded(mayAdminister = true, over: Partial<ProvidersReadings> = {}) {
  return render(
    <ProvidersScreen
      mayAdminister={mayAdminister}
      readings={readings(over)}
      workspaceName={WORKSPACE}
    />,
  );
}

/** The grid region. */
function grid(): HTMLElement {
  return screen.getByRole("region", { name: GRID_LABEL });
}

beforeEach(() => {
  readAuditTrail.mockReset();
  readAuditTrail.mockResolvedValue({ ok: true, events: seededTrail(), total: 7 });
  readCatalog.mockReset();
  readCatalog.mockResolvedValue({ ok: true, entries: seededCatalog(), existing: [] });
});

describe("the page head", () => {
  it("is mockup 07's: the Models eyebrow and the Providers & keys title", () => {
    seeded();

    expect(screen.getByText("Models")).toHaveClass("ou-eyebrow");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PROVIDERS_TITLE);
  });

  it("has exactly one h1, so the page has one title in the outline", () => {
    seeded();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders the security model's subline with the workspace's name in it", () => {
    seeded();

    expect(screen.getByText(providersSubline(WORKSPACE))).toHaveClass("models__sub");
    expect(screen.getByText(/Acme Robotics/)).toBeInTheDocument();
  });

  it("carries none of the mockup's wording about tokens or tenants", () => {
    const { container } = seeded();
    const head = container.querySelector(".models__head")?.textContent ?? "";

    expect(head).not.toMatch(/15-minute|short-lived|token/i);
    expect(head).not.toMatch(/tenant/i);
  });
});

describe("Audit log", () => {
  it("is the head's ghost action, and it acts", () => {
    seeded();

    const audit = screen.getByRole("button", { name: AUDIT_LOG_LABEL });

    expect(audit).toHaveClass("ou-btn--ghost");
    expect(audit).not.toHaveAttribute("aria-disabled");
  });

  it("opens AD.4's sheet and renders the workspace's trail", async () => {
    seeded();

    fireEvent.click(screen.getByRole("button", { name: AUDIT_LOG_LABEL }));

    const sheet = await screen.findByRole("dialog", { name: AUDIT_SHEET_TITLE });

    await waitFor(() => {
      expect(within(sheet).queryByText(AUDIT_LOADING)).not.toBeInTheDocument();
    });

    expect(readAuditTrail).toHaveBeenCalledOnce();
    expect(within(sheet).getByRole("table")).toBeInTheDocument();
    expect(within(sheet).getByText("revealed the credential")).toBeInTheDocument();
  });

  it("does not read the trail until it is pressed", () => {
    seeded();

    expect(readAuditTrail).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("+ Add provider", () => {
  it("is the head's primary action, and it acts", () => {
    seeded();

    const add = screen.getByRole("button", { name: ADD_PROVIDER_LABEL });

    expect(add).toHaveClass("ou-btn--primary");
    expect(add).not.toHaveAttribute("aria-disabled");
  });

  it("opens AE.5's catalog, drawn from the registry", async () => {
    seeded();

    fireEvent.click(screen.getByRole("button", { name: ADD_PROVIDER_LABEL }));

    const dialog = await screen.findByRole("dialog", { name: ADD_DIALOG_TITLE });

    expect(readCatalog).toHaveBeenCalledOnce();
    expect(
      await within(dialog).findByRole("list", { name: CATALOG_LIST_LABEL }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Anthropic/ })).toBeInTheDocument();
  });

  it("is inert for a member, with the reason, and the flow never opens", () => {
    seeded(false);

    const add = screen.getByRole("button", { name: ADD_PROVIDER_LABEL });

    expect(add).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveAttribute("title", ADD_PROVIDER_READ_ONLY);

    fireEvent.click(add);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readCatalog).not.toHaveBeenCalled();
  });

  it("sits beside the ghost action, in the mockup's order", () => {
    seeded();

    const actions = document.querySelector(".models__actions") as HTMLElement;
    const buttons = within(actions).getAllByRole("button");

    expect(buttons.map((button) => button.textContent)).toEqual([
      AUDIT_LOG_LABEL,
      ADD_PROVIDER_LABEL,
    ]);
  });
});

describe("the grid", () => {
  it("draws the five seeded cards in the listing's order, and the dashed card last", () => {
    // The ticket's first criterion at the DOM: five named regions, mockup 07's cards, in the
    // order the service lists them — by display name — with the add card closing the grid.
    seeded();

    const cards = within(grid()).getAllByRole("region");
    expect(cards.map((card) => card.getAttribute("aria-label") ?? within(card).getByRole("heading").textContent)).toEqual(
      seededCards().map((card) => card.displayName),
    );

    const items = [...grid().children];
    expect(items).toHaveLength(6);
    expect(items[5]).toHaveClass("providers-add-card");
  });

  it("lays every card out of the primitives — five switches, five meters, chips and buttons", () => {
    const { container } = seeded();

    expect(container.querySelectorAll(".providers-card")).toHaveLength(5);
    expect(container.querySelectorAll(".ou-switch")).toHaveLength(5);
    // Four capped or local meters carry a bar; the Ollama and vLLM lanes draw the ok sliver.
    expect(container.querySelectorAll(".providers-card .ou-meter")).toHaveLength(5);
    // Nine model chips across the four chip cards, and Anthropic's one tier pill.
    expect(container.querySelectorAll(".ou-chip--model")).toHaveLength(8);
    expect(screen.getByText("priority tier")).toHaveClass("ou-chip--ok");
    expect(container.querySelectorAll(".ou-empty")).toHaveLength(0);
  });

  it("draws each card's switch in the position the listing holds, named for its card", () => {
    seeded();

    for (const card of seededCards()) {
      expect(screen.getByRole("switch", { name: switchLabel(card.displayName) })).toHaveAttribute(
        "aria-checked",
        String(card.enabled),
      );
    }
  });

  it("dims a switched-off card and keeps it in the grid", () => {
    const [first, ...rest] = seededCards();
    seeded(true, { connections: { ok: true, value: [{ ...first, enabled: false }, ...rest] } });

    const card = screen.getByRole("region", { name: first.displayName });
    expect(card).toHaveClass("providers-card--off");
    expect(within(grid()).getAllByRole("region")).toHaveLength(5);
  });

  it("draws a sixth card for a kind no file names, from its catalog entry alone", () => {
    // The schema-driven proof at the page: the fake adapter's connection is one more item in
    // the listing and one more entry in the catalog, and the grid gains a correct card.
    seeded(true, {
      connections: { ok: true, value: [...seededCards(), fakeConnection()] },
      catalog: { ok: true, value: [...seededCatalog(), fakeEntry()] },
    });

    const card = screen.getByRole("region", { name: fakeConnection().displayName });
    expect(within(grid()).getAllByRole("region")).toHaveLength(6);
    expect(within(card).getByLabelText("Base URL")).toHaveValue("https://fake.invalid/v1");
    expect(within(card).getByLabelText("API key")).toHaveValue("••••cret");
    expect(within(card).getByText("unknown")).toHaveClass("ou-chip--warn");
  });

  it("draws the empty state beside the dashed card for a workspace that has connected nothing", () => {
    seeded(true, { connections: { ok: true, value: [] }, models: new Map() });

    expect(screen.getByText(NO_PROVIDERS_TITLE)).toBeInTheDocument();
    expect(within(grid()).queryAllByRole("region")).toHaveLength(0);
    expect(within(grid()).getByRole("button", { name: BROWSE_CATALOG_LABEL })).toBeInTheDocument();
  });

  it("says why when the listing could not be read, and keeps the dashed card", () => {
    seeded(true, { connections: { ok: false, reason: "the vault is away" }, models: new Map() });

    const state = within(grid()).getByRole("status");
    expect(state).toHaveTextContent(PROVIDERS_UNAVAILABLE);
    expect(state).toHaveTextContent("the vault is away");
    expect(within(grid()).queryAllByRole("region")).toHaveLength(0);
    expect(within(grid()).getByRole("button", { name: BROWSE_CATALOG_LABEL })).toBeInTheDocument();
  });

  it("degrades one region of every card when the catalog could not be read, and no more", () => {
    // The key rows fall back to their labels; the switches, meters and chips are untouched.
    const { container } = seeded(true, { catalog: { ok: false, reason: "registry away" } });

    expect(container.querySelectorAll(".providers-card")).toHaveLength(5);
    expect(screen.getAllByLabelText("Credential")).toHaveLength(3);
    expect(screen.getAllByLabelText("Address")).toHaveLength(2);
    expect(container.querySelectorAll(".ou-switch")).toHaveLength(5);
    expect(screen.getByText("$412.80")).toBeInTheDocument();
  });

  it("reads every meter as *no spend recorded* when the month could not be read", () => {
    const { container } = seeded(true, { spend: { ok: false, reason: "ledger away" } });

    expect(screen.getAllByText("no spend recorded")).toHaveLength(5);
    expect(container.querySelectorAll(".providers-card")).toHaveLength(5);
    expect(screen.queryByText("$412.80")).toBeNull();
  });
});

describe("the dashed card", () => {
  it("is mockup 07's add-provider card, honest about what is live, with Browse catalog on it", () => {
    seeded();

    const card = document.querySelector(".providers-add-card") as HTMLElement;

    expect(card).toHaveClass("ou-card");
    expect(within(card).getByText(ADD_CARD_NOTE)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: BROWSE_CATALOG_LABEL })).toHaveClass(
      "ou-btn--ghost",
    );
  });

  it("opens the same dialog the head's action opens", async () => {
    seeded();

    fireEvent.click(screen.getByRole("button", { name: BROWSE_CATALOG_LABEL }));

    expect(await screen.findByRole("dialog", { name: ADD_DIALOG_TITLE })).toBeInTheDocument();
    expect(readCatalog).toHaveBeenCalledOnce();
  });

  it("is inert for a member, with the same reason", () => {
    seeded(false);

    const browse = screen.getByRole("button", { name: BROWSE_CATALOG_LABEL });

    expect(browse).toHaveAttribute("aria-disabled", "true");
    expect(browse).toHaveAttribute("title", ADD_PROVIDER_READ_ONLY);
  });
});

describe("the tab set", () => {
  it("is a named navigation region, so it is not confused with the sidebar", () => {
    seeded();

    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
  });

  it("marks Providers & keys as the current page, on the accent underline", () => {
    seeded();

    const tabs = screen.getByRole("navigation", { name: "Models" });

    expect(tabs).not.toHaveClass("ou-subnav--model");
    expect(within(tabs).getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "href",
      PROVIDERS_PATH,
    );
  });

  it("links Routing back to /models — the other direction of 06 ⇄ 07", () => {
    seeded();

    const routing = within(screen.getByRole("navigation", { name: "Models" })).getByRole(
      "link",
      { name: "Routing" },
    );

    expect(routing).toHaveAttribute("href", MODELS_PATH);
    expect(routing).not.toHaveAttribute("aria-current");
  });

  it("links Model registry back — the 07 → 21 direction CI.1 (#591) added", () => {
    seeded();

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const registry = within(tabs).getByRole("link", { name: "Model registry" });

    expect(registry).toHaveAttribute("href", REGISTRY_PATH);
    expect(registry).not.toHaveAttribute("aria-current");
  });

  it("renders Spend as an honest `soon` target, not a dead route", () => {
    seeded();

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const tab = within(tabs).getByText("Spend", { selector: ".ou-subnav__soon" });

    expect(tab.tagName).toBe("SPAN");
    expect(tab).toHaveTextContent("soon");
    expect(within(tabs).getAllByRole("link")).toHaveLength(3);
  });
});

describe("what the page does not pretend", () => {
  it("draws no figure it could not compute, and no placeholder naming the cards", () => {
    // The cards are on the page now: the empty state that named #228 is gone, and every
    // dollar figure on the grid is one the seeded ledger produced.
    const { container } = seeded();

    expect(screen.queryByText(/arrive next/)).toBeNull();
    expect(container.textContent).not.toMatch(/#228/);
    expect(container.textContent).toContain("$412.80");
    expect(container.textContent).toContain("$64.10");
    expect(container.textContent).toContain("$76.00");
    expect(container.textContent).not.toContain("$0.00");
  });

  it("brings no chrome of its own into the pane", () => {
    const { container } = seeded();

    expect(container.querySelector(".shell-header")).toBeNull();
    expect(container.querySelector("[class*='shell-']")).toBeNull();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the screen in the %s palette", (palette) => {
    renderInPalette(
      palette,
      <ProvidersScreen mayAdminister readings={readings()} workspaceName={WORKSPACE} />,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PROVIDERS_TITLE);
    expect(document.querySelectorAll(".providers-card")).toHaveLength(5);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <ProvidersScreen mayAdminister readings={readings()} workspaceName={WORKSPACE} />,
    );

    expect(light).toBe(dark);
  });
});
