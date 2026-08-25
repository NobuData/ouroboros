import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CAP_LABEL,
  CAP_SOON,
  DETECTED_LABEL,
  MODELS_LABEL,
  NO_MODELS,
  REVEAL,
  ROTATE,
  SAVE_KEY,
  TEST_CONNECTION,
  cardModel,
  switchLabel,
} from "@/app/providers/cards";
import { menuLabel } from "@/app/providers/keys";

import { provider, seededProviders } from "../helpers/models";
import { PALETTES, renderInBothPalettes, renderInPalette } from "../helpers/palettes";
import {
  ADDER,
  READ_AT,
  SEEDED_ANTHROPIC_ID,
  anthropicEntry,
  anthropicModels,
  connection,
  copilotEntry,
  cursorEntry,
  fakeConnection,
  fakeEntry,
  providerModel,
  providerModels,
  ollamaEntry,
  readings,
  seededCards,
  seededCatalog,
  seededSpend,
  spendRow,
} from "../helpers/providers";

/**
 * The provider card (#228): one component, drawn per connection from what `cards.ts` decided.
 *
 * The decisions are `cards.test.ts`'s. What is left here is the composition the ticket's
 * acceptance criteria describe — every region of every seeded card is on the page, drawn out
 * of the #46 primitives — and the ticket's own proof: **a sixth fake-adapter connection
 * renders correctly with zero card-code changes.** The card is fed a kind no file in
 * `app/providers/` names, and the assertions read the same card anatomy off it.
 *
 * The write actions and `useRouter()`/`usePathname()` are replaced, because a suite that drove
 * the real ones would be testing the API client through a button; each control has its own
 * suite (`provider-switch.test.tsx`, `key-row.test.tsx`, `address-row.test.tsx`,
 * `card-menu.test.tsx`). This suite reads the card's anatomy: which controls are present, for
 * whom, and drawn from which primitives.
 */

vi.mock("@/app/providers/card-actions", () => ({ setProviderEnabled: vi.fn() }));
vi.mock("@/app/providers/key-actions", () => ({
  revealCredential: vi.fn(),
  rotateCredential: vi.fn(),
  removeProvider: vi.fn(),
  saveProviderAddress: vi.fn(),
  reauthenticate: vi.fn(),
}));
vi.mock("@/app/providers/live-actions", () => ({
  testConnection: vi.fn(),
  refreshModels: vi.fn(),
  startPull: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/models/providers",
}));

const { ProviderCard } = await import("@/app/providers/provider-card");

/** The instant the seeded page is read at. */
const NOW = new Date(READ_AT);

/**
 * What a card's meter line reads — the figure and its note, as one string.
 *
 * @param card The card.
 * @returns `$412.80 of $600 cap`, `no metered spend 2.1M tokens on-box`, …
 */
function meterReads(card: HTMLElement): string {
  return card.querySelector(".providers-card__meter-figure")?.textContent?.trim() ?? "";
}

/**
 * The seeded card of one kind, composed exactly as the screen composes it.
 *
 * @param kind Which of the five.
 * @param mayAdminister Whether the reader may press the switch. Defaults to an owner's.
 * @returns The rendered card's element.
 */
function seeded(kind: string, mayAdminister = true): HTMLElement {
  const seededReadings = readings();
  const card = seededCards().find((one) => one.kind === kind)!;
  const model = cardModel({
    connection: card,
    entry: seededCatalog().find((entry) => entry.kind === kind) ?? null,
    health: seededProviders().find((row) => row.id === card.id) ?? null,
    spend: seededSpend().providers.find((row) => row.kind === kind) ?? null,
    models: seededReadings.models.get(card.id) ?? null,
    aliases: { ok: true, value: [] },
    now: NOW,
  });

  render(<ProviderCard mayAdminister={mayAdminister} model={model} />);

  return screen.getByRole("region", { name: card.displayName });
}

describe("the seeded Anthropic card", () => {
  it("is a named region with the monogram, the name, the capability line, the pill and the switch in its head", () => {
    const card = seeded("anthropic");

    expect(card).toHaveClass("ou-card");
    expect(card.querySelector(".providers-card__monogram")).toHaveTextContent("AN");
    expect(card.querySelector(".providers-card__monogram")).toHaveClass(
      "providers-card__monogram--model",
    );
    expect(within(card).getByRole("heading", { level: 2 })).toHaveTextContent("Anthropic Claude");
    expect(within(card).getByText("api.anthropic.com · primary coding lane")).toHaveClass(
      "providers-card__note",
    );
    expect(within(card).getByText("connected")).toHaveClass("ou-chip--ok");
    expect(within(card).getByRole("switch", { name: switchLabel("Anthropic Claude") })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("draws the masked key row with Reveal and Rotate, live for an administrator", () => {
    const card = seeded("anthropic");
    const key = within(card).getByLabelText("API key");

    expect(key).toHaveAttribute("readonly");
    expect(key).toHaveValue("••••Xq4A");
    expect(key).toHaveClass("ou-input--mono");

    // Live since AE.3 — the buttons act rather than announcing an issue that will wire them.
    for (const label of [REVEAL, ROTATE]) {
      const button = within(card).getByRole("button", { name: label });

      expect(button).not.toHaveAttribute("aria-disabled");
    }
  });

  it("carries the overflow menu for an administrator", () => {
    const card = seeded("anthropic");

    expect(
      within(card).getByRole("button", { name: menuLabel("Anthropic Claude") }),
    ).toHaveAttribute("aria-haspopup", "menu");
  });

  it("draws the meta row as the mockup writes it", () => {
    expect(seeded("anthropic").querySelector(".providers-card__meta")).toHaveTextContent(
      `Added by ${ADDER} · 2026-06-12 · last used 3m ago`,
    );
  });

  it("draws four model chips and the priority-tier pill, from real signals", () => {
    const card = seeded("anthropic");
    const chips = within(card).getByRole("list", { name: MODELS_LABEL });

    expect(within(chips).getAllByRole("listitem")).toHaveLength(5);
    expect(card.querySelectorAll(".ou-chip--model")).toHaveLength(4);
    expect(within(chips).getByText("priority tier")).toHaveClass("ou-chip--ok");
  });

  it("draws the meter at the seeded figure, with the bar as decoration", () => {
    const card = seeded("anthropic");

    expect(within(card).getByText("This month")).toHaveClass("providers-card__meter-label");
    expect(meterReads(card)).toBe("$412.80 of $600 cap");
    const meter = card.querySelector(".ou-meter") as HTMLElement;
    expect(meter).toHaveAttribute("aria-hidden", "true");
    expect(meter.querySelector(".ou-meter__fill")?.getAttribute("style")).toContain("68.8%");
  });

  it("draws the foot: a live Test connection, the empty note slot, and the cap read-only", () => {
    const card = seeded("anthropic");
    const test = within(card).getByRole("button", { name: TEST_CONNECTION });

    expect(test).toHaveClass("ou-btn--ghost");
    expect(test).not.toHaveAttribute("aria-disabled");
    expect(card.querySelector(".providers-card__test-note")).toBeEmptyDOMElement();

    const cap = within(card).getByLabelText(CAP_LABEL);
    expect(cap).toHaveValue("$600");
    expect(cap).toHaveAttribute("readonly");
    expect(cap).toHaveAttribute("title", CAP_SOON);
  });
});

describe("the other four seeded cards", () => {
  it("draws Cursor with its accent monogram, one chip, and no tier pill", () => {
    const card = seeded("cursor");

    expect(card.querySelector(".providers-card__monogram")).toHaveTextContent("CU");
    expect(card.querySelectorAll(".ou-chip--model")).toHaveLength(1);
    expect(within(card).getByText("cursor/composer-2")).toBeInTheDocument();
    expect(within(card).queryByText(/tier/)).toBeNull();
    expect(meterReads(card)).toBe("$64.10 of $120 cap");
  });

  it("draws Copilot's warn monogram, error pill with the check's detail, and the warn meter at 80%", () => {
    const card = seeded("copilot");

    expect(card.querySelector(".providers-card__monogram")).toHaveClass(
      "providers-card__monogram--warn",
    );
    expect(within(card).getByText("error")).toHaveClass("ou-chip--err");
    expect(within(card).getByText("error")).toHaveAttribute("title", "elevated latency");
    // No `· 4 seats`: the seeded check reported no count, and nothing invents one.
    expect(meterReads(card)).toBe("$76.00 of $95 cap");
    expect(card.querySelector(".ou-meter")).toHaveClass("ou-meter--warn");
  });

  it("draws vLLM with a Base URL field, the empty optional key row with Save, and no metered spend", () => {
    const card = seeded("openai_compatible");

    expect(within(card).getByLabelText("Base URL")).toHaveValue("http://10.0.4.20:8000/v1");
    expect(within(card).getByLabelText("API key")).toHaveValue("");
    expect(within(card).getByLabelText("API key")).toHaveAttribute(
      "placeholder",
      "API key — optional, no auth configured",
    );
    // The empty optional key's one action is Save, live; there is no Reveal for a key that
    // is not stored.
    expect(within(card).getByRole("button", { name: SAVE_KEY })).not.toHaveAttribute("aria-disabled");
    expect(within(card).queryByRole("button", { name: REVEAL })).toBeNull();
    expect(meterReads(card)).toBe("no metered spend 2.6M tokens on-box");
    expect(meterReads(card)).not.toMatch(/\$/);
    expect(card.querySelector(".ou-meter")).toHaveClass("ou-meter--ok");
    expect(within(card).getByLabelText(CAP_LABEL)).toHaveValue("—");
  });

  it("draws Ollama with a Host field, no key row, the pull-list with its sizes, and the on-box tokens", () => {
    const card = seeded("ollama");

    expect(within(card).getByLabelText("Host")).toHaveValue("http://ken-station.local:11434");
    expect(within(card).queryByLabelText("API key")).toBeNull();
    expect(card.querySelector(".providers-card__key-row")).toBeNull();

    // The mockup's rows, element for element: the mono name, the `19 GB` tag, the action.
    const list = within(card).getByRole("list", { name: DETECTED_LABEL });
    expect(within(list).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "qwen3-coder:32b19 GBPull latest",
      "llama4:scout63 GBPull latest",
      "phi4:14b9.1 GBPull latest",
    ]);
    for (const pull of within(list).getAllByRole("button", { name: "Pull latest" })) {
      expect(pull).not.toHaveAttribute("aria-disabled");
    }
    expect(card.querySelectorAll(".ou-chip--model")).toHaveLength(0);
    expect(meterReads(card)).toBe("no metered spend 2.1M tokens on-box");
    expect(card.querySelector(".providers-card__meta")).toHaveTextContent("last used 41s ago");
  });
});

describe("the sixth card — the schema-driven proof", () => {
  /** The fake adapter's card, exactly as the screen would compose it. */
  function fake(overrides: Parameters<typeof fakeConnection>[0] = {}) {
    const model = cardModel({
      connection: fakeConnection(overrides),
      entry: fakeEntry(),
      health: provider({ id: fakeConnection().id, kind: "custom", status: "unknown", checkedAt: null }),
      spend: null,
      models: {
        ok: true,
        value: providerModels(fakeConnection().id, [
          providerModel({ modelId: "fake/small", display: "Fake Small", meta: {} }),
          providerModel({ modelId: "fake/large", display: "Fake Large", meta: {} }),
        ]),
      },
      aliases: { ok: true, value: [] },
      now: NOW,
    });

    render(<ProviderCard mayAdminister model={model} />);

    return screen.getByRole("region", { name: fakeConnection().displayName });
  }

  it("renders a correct card for a kind no file in app/providers names", () => {
    // The whole ticket in one case: the fake's schema says *address first, optional key
    // second*, its capabilities say *no pull*, its models carry no tier, and it has no cap
    // — and every one of those is drawn right by the same component that drew the five.
    const card = fake();

    expect(card.querySelector(".providers-card__monogram")).toHaveTextContent("FA");
    expect(card.querySelector(".providers-card__monogram")).toHaveClass(
      "providers-card__monogram--neutral",
    );
    expect(within(card).getByLabelText("Base URL")).toHaveValue("https://fake.invalid/v1");
    expect(within(card).getByLabelText("API key")).toHaveValue("••••cret");
    expect(within(card).getByRole("button", { name: "Reveal" })).toBeInTheDocument();
    expect(within(card).getByText("unknown")).toHaveClass("ou-chip--warn");
    expect(card.querySelector(".ou-chip__dot--ring")).not.toBeNull();
    expect(card.querySelector(".providers-card__meta")).toHaveTextContent("last used —");
    expect(within(card).getByRole("list", { name: MODELS_LABEL })).toBeInTheDocument();
    expect(card.querySelectorAll(".ou-chip--model")).toHaveLength(2);
    expect(within(card).queryByText(/tier/)).toBeNull();
    expect(meterReads(card)).toBe("no spend recorded");
    expect(card.querySelector(".ou-meter")).toBeNull();
    expect(within(card).getByLabelText(CAP_LABEL)).toHaveValue("—");
  });

  it("draws its region select nowhere — a card is not a form, and only the address and the key are rows", () => {
    // The fake declares a `select` the dialog draws; the card draws the two rows the mockup
    // has and nothing for the third, because a card is not the add-form.
    const card = fake();

    expect(within(card).queryByLabelText("Region")).toBeNull();
    expect(card.querySelector("select")).toBeNull();
  });

  it("names no provider kind in the card's own source", () => {
    // The structural half of the proof, the way the service's `catalog.spec.ts` holds it:
    // comments stripped, no V015 spelling in the component or its decisions.
    const dir = join(import.meta.dirname, "..", "..", "app", "providers");

    for (const file of ["provider-card.tsx", "provider-switch.tsx"]) {
      const source = readFileSync(join(dir, file), "utf8");
      const code = source.replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, "");

      for (const kind of ["anthropic", "openai_compatible", "ollama", "copilot", "cursor", "custom"]) {
        expect(code, `${file} names ${kind}`).not.toContain(kind);
      }
    }
  });
});

describe("a switched-off card", () => {
  it("dims, keeps its head, and says under the switch that routing skips it", () => {
    const model = cardModel({
      connection: connection({ enabled: false }),
      entry: anthropicEntry(),
      health: null,
      spend: spendRow(),
      models: { ok: true, value: providerModels(SEEDED_ANTHROPIC_ID, anthropicModels()) },
      aliases: { ok: true, value: [] },
      now: NOW,
    });

    render(<ProviderCard mayAdminister model={model} />);

    const card = screen.getByRole("region", { name: "Anthropic Claude" });
    expect(card).toHaveClass("providers-card--off");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch")).toHaveAccessibleDescription(/routing skips this provider/);
  });
});

describe("what a region says when it has nothing to draw", () => {
  it("says no models were discovered, rather than drawing an empty list", () => {
    const model = cardModel({
      connection: connection(),
      entry: cursorEntry(),
      health: null,
      spend: null,
      models: { ok: true, value: providerModels("c", []) },
      aliases: { ok: true, value: [] },
      now: NOW,
    });

    render(<ProviderCard mayAdminister model={model} />);

    expect(screen.getByText(NO_MODELS)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: MODELS_LABEL })).toBeNull();
  });

  it("says the models could not be read, as a status", () => {
    const model = cardModel({
      connection: connection(),
      entry: anthropicEntry(),
      health: null,
      spend: null,
      models: { ok: false, reason: "the registry is away" },
      aliases: { ok: true, value: [] },
      now: NOW,
    });

    render(<ProviderCard mayAdminister model={model} />);

    expect(screen.getByRole("status")).toHaveTextContent("the registry is away");
  });

  it("draws the entitlements card's seats only when the check reported them", () => {
    const model = cardModel({
      connection: connection({ kind: "copilot", monthlyCapCents: 9_500 }),
      entry: copilotEntry(),
      health: provider({ detail: "200 · 4 seats" }),
      spend: spendRow({ kind: "copilot", spendCents: 7_600 }),
      models: { ok: true, value: providerModels("c", []) },
      aliases: { ok: true, value: [] },
      now: NOW,
    });

    render(<ProviderCard mayAdminister model={model} />);

    expect(meterReads(document.body)).toBe("$76.00 of $95 cap · 4 seats");
  });
});

describe("a member's card", () => {
  it("draws the switch read-only, with the reason, in its real position", () => {
    const card = seeded("anthropic", false);
    const toggle = within(card).getByRole("switch");

    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription(/owners and admins/);
  });

  it("sees none of the key-management affordances — no Reveal, Rotate, or overflow menu", () => {
    // The criterion in one case: a member's card is the same card with the write islands
    // drawn read-only or absent, never a different card. The masked value is still there —
    // reading a masked suffix is not revealing a key.
    const card = seeded("anthropic", false);

    expect(within(card).getByLabelText("API key")).toHaveValue("••••Xq4A");
    expect(within(card).queryByRole("button", { name: REVEAL })).toBeNull();
    expect(within(card).queryByRole("button", { name: ROTATE })).toBeNull();
    expect(within(card).queryByRole("button", { name: menuLabel("Anthropic Claude") })).toBeNull();
  });

  it("draws an editable provider's address read-only, with no Save", () => {
    const card = seeded("openai_compatible", false);

    const address = within(card).getByLabelText("Base URL");
    expect(address).toHaveValue("http://10.0.4.20:8000/v1");
    expect(address).toHaveAttribute("readonly");
    expect(within(card).queryByRole("button", { name: "Save Base URL" })).toBeNull();
  });
});

describe("both palettes", () => {
  const model = () =>
    cardModel({
      connection: seededCards()[0],
      entry: anthropicEntry(),
      health: seededProviders()[0],
      spend: seededSpend().providers[0],
      models: { ok: true, value: providerModels(SEEDED_ANTHROPIC_ID, anthropicModels()) },
      aliases: { ok: true, value: [] },
      now: NOW,
    });

  it.each(PALETTES)("renders the card in the %s palette", (palette) => {
    renderInPalette(palette, <ProviderCard mayAdminister model={model()} />);

    expect(document.documentElement).toHaveAttribute("data-theme", palette);
    expect(screen.getByRole("region", { name: "Anthropic Claude" })).toBeInTheDocument();
  });

  it("draws the same markup in both, because the palette is CSS's business", () => {
    const [light, dark] = renderInBothPalettes(<ProviderCard mayAdminister model={model()} />);

    expect(light).toBe(dark);
  });
});

describe("what the card is built from", () => {
  it("draws every shape out of the primitives — no card, chip, meter, switch, field or button of its own", () => {
    const card = seeded("anthropic");

    expect(card.querySelectorAll(".ou-chip").length).toBeGreaterThan(0);
    expect(card.querySelectorAll(".ou-meter")).toHaveLength(1);
    expect(card.querySelectorAll(".ou-switch")).toHaveLength(1);
    expect(card.querySelectorAll(".ou-input")).toHaveLength(2);
    // The overflow menu, Reveal, Rotate, Refresh models and Test connection — every acting
    // control is the primitive, and the card draws none of its own.
    expect(card.querySelectorAll(".ou-btn")).toHaveLength(5);
    // The one figure the card computes is passed as the meter's datum, never as a width.
    expect(card.innerHTML).not.toMatch(/style="width/);
  });

  it("lays the card out from the entry, not from the kind — the same entry twice draws the same rows", () => {
    // Two connections of one kind at two addresses are two cards with the same anatomy.
    const first = cardModel({
      connection: connection({ kind: "ollama", displayName: "A", baseUrl: "http://a", mask: null }),
      entry: ollamaEntry(),
      health: null,
      spend: null,
      models: { ok: true, value: providerModels("c", []) },
      aliases: { ok: true, value: [] },
      now: NOW,
    });
    const second = { ...first, id: "x", name: "B", address: { label: "Host", value: "http://b" } };

    const { container } = render(
      <>
        <ProviderCard mayAdminister model={first} />
        <ProviderCard mayAdminister model={second} />
      </>,
    );

    expect(container.querySelectorAll(".providers-card__pull-list, .providers-card__models-state")).toHaveLength(2);
    expect(screen.getAllByLabelText("Host")).toHaveLength(2);
  });
});
