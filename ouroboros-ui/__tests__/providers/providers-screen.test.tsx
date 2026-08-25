import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";
import {
  ADD_CARD_NOTE,
  ADD_DIALOG_TITLE,
  ADD_PROVIDER_READ_ONLY,
  BROWSE_CATALOG_LABEL,
  CATALOG_LIST_LABEL,
} from "@/app/providers/catalog";
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
import { seededCatalog } from "../helpers/providers";

/**
 * The `/models/providers` frame (#227) — mockup 07's page head and tab set, composed.
 *
 * The tab set's own behaviour is `models/models-subnav.test.tsx`'s, the sheet's is
 * `audit-trail.test.tsx`'s and the copy's is `view.test.ts`'s. What is left here is the
 * composition the ticket's acceptance criteria describe: the head is the mockup's with the
 * security model's sentence in it, both actions are wired — one to the trail, one to its
 * reason — the tab set has this page current with the routing page a link away, and the page
 * admits what it is not rather than mocking it up.
 *
 * The Server Actions behind the sheet and the add dialog are mocked, not the API: what is
 * under test is that the head's actions open AD.4's trail and AE.5's catalog, and
 * `audit-actions.test.ts` and `add-actions.test.ts` are those modules' own suites — as
 * `add-provider.test.tsx` is the dialog's.
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ProvidersScreen } = await import("@/app/providers/providers-screen");

/** The seeded workspace's display name — what the gate hands the page. */
const WORKSPACE = membership().name;

/**
 * Render the page for the seeded workspace.
 *
 * @param mayAdminister Whether the reader may connect a provider. Defaults to an owner's.
 */
function seeded(mayAdminister = true) {
  return render(<ProvidersScreen mayAdminister={mayAdminister} workspaceName={WORKSPACE} />);
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
    // The ticket's second acceptance criterion at the DOM: the sentence on the page is the
    // one `providersSubline` produces, and that function is held to § 7.2 verbatim in
    // `view.test.ts`. Nothing between the two is allowed to rephrase it.
    seeded();

    expect(screen.getByText(providersSubline(WORKSPACE))).toHaveClass("models__sub");
    expect(screen.getByText(/Acme Robotics/)).toBeInTheDocument();
  });

  it("carries none of the mockup's wording about tokens or tenants", () => {
    // The mockup's line describes a system this is not (AD.3 proxies invocation; workers
    // never receive keys at all), and `tenant` is a word no user-facing string uses.
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
    // The ticket's fifth acceptance criterion: the button is the visible end of the trail,
    // not a button. The rows are the seeded history; what each says is `audit-trail.test.tsx`'s.
    seeded();

    fireEvent.click(screen.getByRole("button", { name: AUDIT_LOG_LABEL }));

    const sheet = await screen.findByRole("dialog", { name: AUDIT_SHEET_TITLE });

    await waitFor(() => {
      expect(within(sheet).queryByText(AUDIT_LOADING)).not.toBeInTheDocument();
    });

    expect(readAuditTrail).toHaveBeenCalledOnce();
    expect(within(sheet).getByRole("table")).toBeInTheDocument();
    expect(within(sheet).getAllByRole("row").length).toBeGreaterThan(1);
    expect(within(sheet).getByText("revealed the credential")).toBeInTheDocument();
  });

  it("does not read the trail until it is pressed", () => {
    // A page-load read would make every visit pay for a query a `member` is not even allowed
    // to make — `audit-actions.ts` says why the sheet reads on open.
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
    // The head's action is one of the dialog's two openers; what the dialog does from here
    // is `add-provider.test.tsx`'s.
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
    // `aria-disabled` rather than `disabled`, deliberately: a disabled button leaves the tab
    // order and takes its own explanation with it, so the keyboard reader who most needs the
    // tooltip could never reach it. The gate that enforces is the service's.
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
    // Mockup 07's treatment: the accent, where 06 draws the model purple. The primitive keeps
    // the divergence as a tone, and this page asks for nothing — the accent is the base rule.
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
    // The tab was an honest `soon` stub when this page shipped and is a link now that #591
    // has built its page, without this file changing: the row is drawn from the section's one
    // list, so all three pages learned it at once.
    seeded();

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const registry = within(tabs).getByRole("link", { name: "Model registry" });

    expect(registry).toHaveAttribute("href", REGISTRY_PATH);
    expect(registry).not.toHaveAttribute("aria-current");
  });

  it("renders Spend as an honest `soon` target, not a dead route", () => {
    // The ticket's fourth acceptance criterion, less the tab CI.1 has since built.
    seeded();

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const tab = within(tabs).getByText("Spend", { selector: ".ou-subnav__soon" });

    expect(tab.tagName).toBe("SPAN");
    expect(tab).toHaveTextContent("soon");
    expect(tab.hasAttribute("href")).toBe(false);

    expect(within(tabs).getAllByRole("link")).toHaveLength(3);
  });
});

describe("what the page does not pretend", () => {
  it("names the surfaces that will fill it rather than mocking them up", () => {
    seeded();

    expect(screen.getByText("The provider cards arrive next")).toBeInTheDocument();
    expect(screen.getByText(/#228/)).toBeInTheDocument();
  });

  it("draws no provider card, no meter and no figure it could not compute", () => {
    // Five invented cards would be indistinguishable, in a screenshot, from the real ones
    // AE.2 ships — and would be a mock-up of a page somebody else is building. The two cards
    // it does draw are the labelled empty state and the dashed add card, which is real.
    const { container } = seeded();

    expect(container.querySelectorAll(".ou-card")).toHaveLength(2);
    expect(container.querySelector(".ou-meter")).toBeNull();
    expect(container.querySelector(".ou-switch")).toBeNull();
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it("brings no chrome of its own into the pane", () => {
    // Header and sidebar stay fixed while the pane scrolls because the shell owns both and
    // the page draws neither: it starts at its head, and the one navigation landmark it adds
    // is the tab set. Whether the shell's chrome is fixed is `shell-styles.test.ts`'s.
    const { container } = seeded();

    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("[class*='shell-']")).toBeNull();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });
});

describe("both palettes", () => {
  it.each(PALETTES)("renders the screen in the %s palette", (palette) => {
    renderInPalette(palette, <ProvidersScreen mayAdminister workspaceName={WORKSPACE} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(PROVIDERS_TITLE);
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(
      <ProvidersScreen mayAdminister workspaceName={WORKSPACE} />,
    );

    expect(light).toBe(dark);
  });
});
