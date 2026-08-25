import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MATRIX_FAILED_TITLE, NO_KINDS_NOTE, NO_KINDS_TITLE } from "@/app/models/matrix";
import { ADD_RULE, NO_RULES_TITLE, RULES_TITLE } from "@/app/models/rules";
import { FULL_REPORT, NO_SPEND_TITLE, UNPRICED } from "@/app/models/spend";
import { MODELS_PATH, PROVIDERS_PATH, REGISTRY_PATH } from "@/app/paths";

import { emptyMatrix, readings, seededMatrix, unmeasuredMatrix } from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";

// The rules card's actions sit on the server-only client, and its rows want the App Router
// mounted for `router.refresh()`. Both are subjects of their own suites (`rule-actions.test.ts`,
// `rules-card.test.tsx`); here they are replaced so the screen can be composed in jsdom.
vi.mock("@/app/models/rule-actions", () => ({
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
  readRuleTargets: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ModelsScreen } = await import("@/app/models/models-screen");

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
    expect(within(tabs).getAllByRole("link")).toHaveLength(3);
  });

  it("links Model registry to its page — the 06 → 21 direction CI.1 (#591) added", () => {
    // The second half of the same amendment against #200, and the reason both halves cost one
    // edit each: the tab set is one list, so a page built elsewhere turns its stub into a link
    // here without this file being touched.
    render(<ModelsScreen readings={readings()} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const registry = within(tabs).getByRole("link", { name: "Model registry" });

    expect(registry).toHaveAttribute("href", REGISTRY_PATH);
    expect(registry).not.toHaveAttribute("aria-current");
  });

  it("renders the one unbuilt sibling surface as an honest `soon` target, not a dead route", () => {
    // The ticket's fifth acceptance criterion, less the two tabs AE.1 and CI.1 have since
    // built. The spend report is another roadmap's surface; rendering it as a live link that
    // goes nowhere would be worse than not rendering it at all.
    render(<ModelsScreen readings={readings()} />);

    const tabs = screen.getByRole("navigation", { name: "Models" });
    const tab = within(tabs).getByText("Spend", { selector: ".ou-subnav__soon" });

    expect(tab.tagName).toBe("SPAN");
    expect(tab).toHaveTextContent("soon");
    expect(tab.getAttribute("title")).toMatch(/arrives with/);
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
    // One failed read is one degraded region, never a blank page: the head, the tab set, the
    // matrix and the page's foot are all still there.
    render(<ModelsScreen readings={readings({ providers: { ok: false, reason: "Down." } })} />);

    expect(screen.getByText("Down.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});

describe("the matrix, in its place on the page", () => {
  it("draws the eight seeded rows below the strip", () => {
    render(<ModelsScreen readings={readings()} />);

    // Eight rows and a head row.
    expect(screen.getAllByRole("row")).toHaveLength(9);
    expect(screen.getByText("8 task kinds")).toBeInTheDocument();
  });

  it("degrades to the service's reason without taking the strip with it", () => {
    // The other direction of the same rule. The two are separate reads and the page shows it.
    render(
      <ModelsScreen readings={readings({ matrix: { ok: false, reason: "Routing is down." } })} />,
    );

    expect(screen.getByText(MATRIX_FAILED_TITLE)).toBeInTheDocument();
    expect(screen.getByText("Routing is down.")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Provider health" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("tells a workspace with no kinds apart from one whose matrix could not be read", () => {
    // *Nobody has configured this* and *nobody could read this* are different facts, and the
    // page says something different for each. Neither is a blank region (§ 3.3).
    render(<ModelsScreen readings={readings({ matrix: { ok: true, value: emptyMatrix() } })} />);

    expect(screen.getByText(NO_KINDS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_KINDS_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(MATRIX_FAILED_TITLE)).not.toBeInTheDocument();
  });
});

describe("what the page does not pretend", () => {
  it("names the surface that will fill the inspector's seat rather than mocking it up", () => {
    // An invented chain of hops there would be the one dishonest thing on a page built to be
    // honest — and indistinguishable, in a screenshot, from the real one AA.4 ships.
    render(<ModelsScreen readings={readings()} route="implement" />);

    expect(screen.getByText(/#203/)).toBeInTheDocument();
  });

  it("draws a meter only where the ledger computed one", () => {
    // The matrix's figures and the spend card's meters *are* computed — from the ledger, by
    // #198 — so they are drawn: one meter per priced row, and none at all for a workspace
    // that has spent nothing.
    const seeded = render(<ModelsScreen readings={readings()} />);

    expect(seeded.container.querySelectorAll(".ou-meter")).toHaveLength(4);
    seeded.unmount();

    const unmeasured = render(
      <ModelsScreen readings={readings({ matrix: { ok: true, value: unmeasuredMatrix() } })} />,
    );

    expect(unmeasured.container.querySelector(".ou-meter")).toBeNull();
  });

  it("draws an em-dash rather than a zero for a workspace that has run nothing", () => {
    // Decision M7, end to end through the screen: `$0.00` and `0.0s` are figures, and a
    // workspace with an empty ledger has neither.
    const { container } = render(
      <ModelsScreen readings={readings({ matrix: { ok: true, value: unmeasuredMatrix() } })} />,
    );

    expect(container.textContent).not.toMatch(/\$\d/);
    expect(container.textContent).not.toMatch(/\ds\b/);
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

describe("the right column (#204)", () => {
  it("draws the rules card and the spend card under the inspector's seat, beside the matrix", () => {
    render(<ModelsScreen readings={readings()} />);

    const aside = document.querySelector(".models-aside");

    expect(aside).not.toBeNull();
    expect(within(aside as HTMLElement).getByRole("region", { name: RULES_TITLE })).toBeInTheDocument();
    expect(within(aside as HTMLElement).getByRole("region", { name: /Spend by provider/ })).toBeInTheDocument();
    // Order is the mockup's: inspector, rules, spend.
    const titles = [...(aside as HTMLElement).querySelectorAll("h2")].map((h) => h.textContent);
    expect(titles).toEqual(["Route", RULES_TITLE, "Spend by provider · 30d"]);
  });

  it("draws the seeded cards with the seeded figures", () => {
    render(<ModelsScreen readings={readings()} />);

    expect(screen.getByText("3 active")).toBeInTheDocument();
    expect(screen.getByText("$412.80")).toBeInTheDocument();
    expect(screen.getByText("Local models served 31% of all tokens.")).toBeInTheDocument();
  });

  it("draws no switch, no builder and no delete for a role that may not change rules", () => {
    // The default, so that a caller which forgot the prop renders what a member sees rather
    // than controls the service would refuse.
    render(<ModelsScreen readings={readings()} />);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ADD_RULE })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete rule/ })).not.toBeInTheDocument();
  });

  it("draws the switches, the builder and the deletes for a role that may", () => {
    render(<ModelsScreen mayAdminister readings={readings()} />);

    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getByRole("button", { name: ADD_RULE })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Delete rule/ })).toHaveLength(3);
  });

  it("gives an unseeded workspace its zero-states rather than no column at all", () => {
    // The spend zero-state is the state the ticket asks for by name, and it only exists on a
    // card that is drawn.
    render(<ModelsScreen readings={readings({ matrix: { ok: true, value: emptyMatrix() } })} />);

    expect(screen.getByText(NO_KINDS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_RULES_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_SPEND_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("says a refused matrix once, rather than once per card", () => {
    // The three regions are one read; a refusal is one region.
    render(
      <ModelsScreen readings={readings({ matrix: { ok: false, reason: "Routing is down." } })} />,
    );

    expect(screen.getAllByText("Routing is down.")).toHaveLength(1);
    expect(screen.queryByRole("region", { name: RULES_TITLE })).not.toBeInTheDocument();
    expect(screen.queryByText(FULL_REPORT)).not.toBeInTheDocument();
  });

  it("keeps an unpriced row apart from a genuine $0.00 on the same card", () => {
    const spend = seededMatrix().spend;
    const unpricedRow = {
      ...spend.providers[1],
      key: "custom",
      kinds: ["custom"],
      spendCents: null,
      meterFraction: null,
      pricedCalls: 0,
      unpricedCalls: 9,
    };

    render(
      <ModelsScreen
        readings={readings({
          matrix: {
            ok: true,
            value: seededMatrix({ spend: { ...spend, providers: [...spend.providers, unpricedRow] } }),
          },
        })}
      />,
    );

    const card = screen.getByRole("region", { name: /Spend by provider/ });

    expect(within(card).getByText(UNPRICED)).toBeInTheDocument();
    expect(within(card).getByText("$0.00")).toBeInTheDocument();
    expect(within(card).getByText("5 unpriced calls")).toBeInTheDocument();
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(<ModelsScreen mayAdminister readings={readings()} />);

    expect(light).toBe(dark);
    expect(PALETTES).toHaveLength(2);
  });
});
