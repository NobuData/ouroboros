import { describe, expect, it } from "vitest";

import {
  ADDRESS_LABEL,
  CREDENTIAL_LABEL,
  LOCAL_METER,
  MODELS_UNAVAILABLE,
  NEVER_USED,
  NO_METERED_SPEND,
  NO_SPEND,
  UNPRICED,
  WARN_AT,
  addressRow,
  capFigure,
  capValue,
  cardModel,
  meterLine,
  meterTone,
  metaRow,
  modelsRegion,
  monogramFor,
  pillDetail,
  relativeAgo,
  seatsIn,
  secretRow,
  statusPill,
  tierLabel,
  tiersOf,
  utcDate,
} from "@/app/providers/cards";
import { NOBODY } from "@/app/providers/view";

import { provider, seededProviders } from "../helpers/models";
import {
  ADDER,
  READ_AT,
  anthropicEntry,
  anthropicModels,
  connection,
  copilotEntry,
  fakeConnection,
  fakeEntry,
  modelOption,
  ollamaEntry,
  openaiCompatibleEntry,
  seededCards,
  seededSpend,
  spendRow,
} from "../helpers/providers";

/**
 * Every decision the provider card makes (#228), held as a value.
 *
 * The ticket's criteria are mostly judgements — what a key row is for a kind, what a meter
 * reads, when a pill may exist — and each one is a case here on a small object, so a
 * rendering test can be about composition rather than about arithmetic in a `div`. The
 * ordering is the card's own: monogram, pill, key row, meta row, models, meter, foot.
 */

/** The instant the seeded page is read at. */
const NOW = new Date(READ_AT);

describe("the monogram", () => {
  it.each([
    ["anthropic", "AN", "model"],
    ["cursor", "CU", "accent"],
    ["copilot", "GH", "warn"],
    ["openai_compatible", "VL", "ok"],
    ["ollama", "OL", "neutral"],
  ])("draws the %s card's letters and tint from the token map", (kind, letters, tint) => {
    expect(monogramFor(kind, "whatever")).toEqual({ letters, tint });
  });

  it("derives a kind the mockup does not draw from its own name, in the neutral tint", () => {
    // The sixth adapter's monogram, which nobody wrote: the name rather than the kind, so
    // two unknown kinds are tellable apart and `custom` does not read as Cursor's `CU`.
    expect(monogramFor("custom", "Fake provider · conformance kit")).toEqual({
      letters: "FA",
      tint: "neutral",
    });
    expect(monogramFor("bedrock", "AWS Bedrock")).toEqual({ letters: "AW", tint: "neutral" });
  });
});

describe("the status pill", () => {
  it("says `connected` in the ok hue for an active connection — the taxonomy's own word", () => {
    expect(statusPill("active")).toEqual({ label: "connected", tone: "ok", dot: "filled" });
  });

  it("never draws `unknown` as healthy: a ring in the warn hue, and the word", () => {
    expect(statusPill("unknown")).toEqual({ label: "unknown", tone: "warn", dot: "ring" });
  });

  it("uses the health strip's words for the other two, so 06 and 07 agree", () => {
    expect(statusPill("error")).toMatchObject({ label: "error", tone: "err" });
    expect(statusPill("paused")).toMatchObject({ label: "paused", tone: "neutral" });
  });

  it("hovers the last check's own phrase, and nothing when the strip has none", () => {
    expect(pillDetail(provider({ detail: "elevated latency" }))).toBe("elevated latency");
    expect(pillDetail(provider())).toBeNull();
    expect(pillDetail(null)).toBeNull();
  });
});

describe("the key row, by auth mode", () => {
  it("draws a masked key row and no address for a key-only kind", () => {
    // The Anthropic card: the entry's one field is the secret, so that is the one row.
    expect(addressRow(anthropicEntry(), connection())).toBeNull();
    expect(secretRow(anthropicEntry(), connection())).toEqual({
      label: "API key",
      mask: "••••Xq4A",
      placeholder: "sk-ant-api03-…",
    });
  });

  it("draws the address under the adapter's own label — *Base URL* for one kind, *Host* for another", () => {
    const vllm = connection({ baseUrl: "http://10.0.4.20:8000/v1", mask: null });
    const ollama = connection({ baseUrl: "http://ken-station.local:11434", mask: null });

    expect(addressRow(openaiCompatibleEntry(), vllm)).toEqual({
      label: "Base URL",
      value: "http://10.0.4.20:8000/v1",
    });
    expect(addressRow(ollamaEntry(), ollama)).toEqual({
      label: "Host",
      value: "http://ken-station.local:11434",
    });
  });

  it("draws the optional key row empty, with the adapter's prose, when no key is stored", () => {
    // The vLLM card ships with that row empty — *API key — optional, no auth configured*.
    expect(secretRow(openaiCompatibleEntry(), connection({ mask: null }))).toEqual({
      label: "API key",
      mask: null,
      placeholder: "API key — optional, no auth configured",
    });
  });

  it("draws no key row at all for a kind that takes no credential", () => {
    // The Ollama card has no key row anywhere on it.
    expect(secretRow(ollamaEntry(), connection({ mask: null }))).toBeNull();
  });

  it("still draws what the connection holds when the entry could not be read", () => {
    // A second read failing must not lose the first read's data: the address and the mask
    // are facts about the connection, drawn under fallback labels.
    const vllm = connection({ baseUrl: "http://10.0.4.20:8000/v1", mask: "••••abcd" });

    expect(addressRow(null, vllm)).toEqual({ label: ADDRESS_LABEL, value: vllm.baseUrl });
    expect(secretRow(null, vllm)).toEqual({
      label: CREDENTIAL_LABEL,
      mask: "••••abcd",
      placeholder: null,
    });
    expect(secretRow(null, connection({ mask: null }))).toBeNull();
  });
});

describe("the meta row", () => {
  it("spells the mockup's own relative times", () => {
    expect(relativeAgo("2026-08-23T09:59:31.004Z", NOW)).toBe("41s ago");
    expect(relativeAgo("2026-08-23T09:57:12.004Z", NOW)).toBe("3m ago");
    expect(relativeAgo("2026-08-23T09:34:12.004Z", NOW)).toBe("26m ago");
    expect(relativeAgo("2026-08-23T08:48:12.004Z", NOW)).toBe("1h 12m ago");
    expect(relativeAgo("2026-08-23T08:00:12.004Z", NOW)).toBe("2h ago");
    expect(relativeAgo("2026-08-20T10:00:12.004Z", NOW)).toBe("3d ago");
  });

  it("draws a future instant as now rather than as a negative, and a bad one as itself", () => {
    expect(relativeAgo("2026-08-23T10:05:00.000Z", NOW)).toBe("0s ago");
    expect(relativeAgo("not a date", NOW)).toBe("not a date");
  });

  it("prints the added date in UTC, so two readers see one card", () => {
    expect(utcDate("2026-06-12T16:20:00.000Z")).toBe("2026-06-12");
    expect(utcDate("2026-06-12T23:30:00-05:00")).toBe("2026-06-13");
    expect(utcDate("garbage")).toBe("garbage");
  });

  it("composes the mockup's line for the seeded Anthropic card", () => {
    expect(metaRow(connection({ lastUsedAt: "2026-08-23T09:57:12.004Z" }), NOW)).toEqual({
      addedBy: ADDER,
      addedOn: "2026-06-12",
      lastUsed: "3m ago",
    });
  });

  it("shows an em-dash for a connection never used, and for an adder nobody can name", () => {
    // The ticket's criterion, and the trail's rule: never an id, never a borrowed stamp.
    const row = metaRow(connection({ lastUsedAt: null, addedByName: null }), NOW);

    expect(row.lastUsed).toBe(NEVER_USED);
    expect(row.addedBy).toBe(NOBODY);
    expect(row.addedBy).not.toMatch(/5eed/);
  });
});

describe("the models region", () => {
  it("is chips for a kind that does not pull, with a tier pill only where discovery reported one", () => {
    const region = modelsRegion(anthropicEntry(), { ok: true, value: anthropicModels() });

    expect(region).toMatchObject({ kind: "chips", tiers: ["priority"] });
    expect(region.kind === "chips" && region.models).toHaveLength(4);
  });

  it("is the pull-list slot for a kind that pulls — decided by the capability, not the kind", () => {
    const models = [modelOption({ modelId: "qwen3-coder:32b", display: "qwen3-coder:32b" })];

    expect(modelsRegion(ollamaEntry(), { ok: true, value: models })).toEqual({
      kind: "pull-list",
      models,
    });
    // The same kind with the flag off is chips: nothing here knows what `ollama` is.
    const chips = modelsRegion(
      { ...ollamaEntry(), capabilities: { ...ollamaEntry().capabilities, pull: false } },
      { ok: true, value: models },
    );
    expect(chips.kind).toBe("chips");
  });

  it("earns no tier pill from a model that reported none — decision P8", () => {
    expect(tiersOf([modelOption(), modelOption({ meta: { tier: "" } })])).toEqual([]);
    expect(tiersOf([modelOption({ meta: { tier: 42 } })])).toEqual([]);
  });

  it("lists each reported tier once, in the provider's own word", () => {
    expect(
      tiersOf([
        modelOption({ meta: { tier: "priority" } }),
        modelOption({ modelId: "b", meta: { tier: "priority" } }),
        modelOption({ modelId: "c", meta: { tier: "batch" } }),
      ]),
    ).toEqual(["priority", "batch"]);
    expect(tierLabel("priority")).toBe("priority tier");
  });

  it("says the models could not be read, rather than drawing none as if there were none", () => {
    expect(modelsRegion(anthropicEntry(), { ok: false, reason: "upstream refused" })).toEqual({
      kind: "unavailable",
      reason: "upstream refused",
    });
    expect(modelsRegion(anthropicEntry(), null)).toEqual({
      kind: "unavailable",
      reason: MODELS_UNAVAILABLE,
    });
  });

  it("falls back to chips when the entry could not be read", () => {
    expect(modelsRegion(null, { ok: true, value: [] })).toEqual({
      kind: "chips",
      models: [],
      tiers: [],
    });
  });
});

describe("the meter", () => {
  it("prints a cap in whole dollars, and keeps cents that are really there", () => {
    expect(capFigure(60_000)).toBe("$600");
    expect(capFigure(9_500)).toBe("$95");
    expect(capFigure(125_050)).toBe("$1,250.50");
  });

  it("prints an em-dash for a null cap, and `$0` for a real cap of nothing", () => {
    // The ticket's criterion: null is *no cap*, which is not the same as *spend nothing*.
    expect(capValue(null)).toBe("—");
    expect(capValue(0)).toBe("$0");
  });

  it("turns to the warn hue at 80% and the error hue at the cap", () => {
    expect(meterTone(0.688)).toBe("accent");
    expect(meterTone(WARN_AT)).toBe("warn");
    expect(meterTone(0.999)).toBe("warn");
    expect(meterTone(1)).toBe("err");
  });

  it("matches the seeded figures: $412.80 of $600 at 69%", () => {
    const line = meterLine(connection({ monthlyCapCents: 60_000 }), spendRow(), null);

    expect(line).toEqual({
      figure: "$412.80",
      note: "of $600 cap",
      fraction: 41_280 / 60_000,
      tone: "accent",
    });
    expect(Math.round(line.fraction! * 100)).toBe(69);
  });

  it("matches the seeded Cursor figure: $64.10 of $120 at 53%", () => {
    const line = meterLine(
      connection({ monthlyCapCents: 12_000 }),
      spendRow({ kind: "cursor", spendCents: 6_410 }),
      null,
    );

    expect(line.figure).toBe("$64.10");
    expect(line.note).toBe("of $120 cap");
    expect(Math.round(line.fraction! * 100)).toBe(53);
  });

  it("matches the seeded Copilot figure: $76.00 of $95 at exactly 80%, on the warn meter", () => {
    const line = meterLine(
      connection({ monthlyCapCents: 9_500 }),
      spendRow({ kind: "copilot", spendCents: 7_600 }),
      null,
    );

    expect(line).toEqual({ figure: "$76.00", note: "of $95 cap", fraction: 0.8, tone: "warn" });
  });

  it("appends `· 4 seats` only when a check really reported a count", () => {
    const copilot = connection({ monthlyCapCents: 9_500 });
    const row = spendRow({ kind: "copilot", spendCents: 7_600 });

    expect(meterLine(copilot, row, 4).note).toBe("of $95 cap · 4 seats");
    expect(meterLine(copilot, row, 1).note).toBe("of $95 cap · 1 seat");
    expect(meterLine(copilot, row, null).note).toBe("of $95 cap");
  });

  it("reads a seat count only off the taxonomy's own spelling", () => {
    // The reader half of the service's `provider.entitlements.ts`: the count is the last
    // thing on the line, after the separator, and nothing else parses.
    expect(seatsIn("200 · 4 seats")).toBe(4);
    expect(seatsIn("1 seat")).toBe(1);
    expect(seatsIn("200")).toBeNull();
    expect(seatsIn("4 seats · 200")).toBeNull();
    expect(seatsIn("elevated latency")).toBeNull();
    expect(seatsIn(null)).toBeNull();
  });

  it("says `no metered spend` and the on-box tokens for a local kind nobody priced, never $0.00", () => {
    // The seeded Ollama card: null costs — calls nobody priced — and 2.1M tokens.
    const line = meterLine(
      connection({ monthlyCapCents: null }),
      spendRow({ kind: "ollama", local: true, spendCents: null, tokens: 2_100_000 }),
      null,
    );

    expect(line).toEqual({
      figure: NO_METERED_SPEND,
      note: "2.1M tokens on-box",
      fraction: LOCAL_METER,
      tone: "ok",
    });
    expect(line.figure).not.toMatch(/\$/);
  });

  it("says `no metered spend` for a local kind priced at nothing, too — a dollar figure that happens to be zero is not the fact", () => {
    // The seeded vLLM card: `cost_cents = 0`. Decision P8 — *we do not meter this* is the
    // true statement about a lane on hardware the workspace already owns.
    const line = meterLine(
      connection({ monthlyCapCents: null }),
      spendRow({ kind: "openai_compatible", local: true, spendCents: 0, tokens: 2_600_000 }),
      null,
    );

    expect(line.figure).toBe(NO_METERED_SPEND);
    expect(line.note).toBe("2.6M tokens on-box");
  });

  it("prints real money on a local kind that cost something — money is never hidden", () => {
    const line = meterLine(
      connection({ monthlyCapCents: null }),
      spendRow({ kind: "openai_compatible", local: true, spendCents: 1_250, tokens: 100 }),
      null,
    );

    expect(line.figure).toBe("$12.50");
    expect(line.note).toBe("100 tokens on-box");
  });

  it("says `unpriced` for a cloud kind nobody priced, and draws no bar against its cap", () => {
    const line = meterLine(
      connection({ monthlyCapCents: 60_000 }),
      spendRow({ spendCents: null, pricedCalls: 0, unpricedCalls: 3 }),
      null,
    );

    expect(line).toEqual({ figure: UNPRICED, note: "of $600 cap", fraction: null, tone: "accent" });
  });

  it("says `no spend recorded` for a kind with no row this month, and reads the cap beside it", () => {
    expect(meterLine(connection({ monthlyCapCents: 60_000 }), null, null)).toEqual({
      figure: NO_SPEND,
      note: "of $600 cap",
      fraction: 0,
      tone: "accent",
    });
    expect(meterLine(connection({ monthlyCapCents: null }), null, null)).toEqual({
      figure: NO_SPEND,
      note: null,
      fraction: null,
      tone: "accent",
    });
  });

  it("draws no bar for a cloud kind with spend and no cap — there is nothing to fill", () => {
    const line = meterLine(connection({ monthlyCapCents: null }), spendRow(), null);

    expect(line).toEqual({ figure: "$412.80", note: null, fraction: null, tone: "accent" });
  });

  it("treats a cap of zero as *spend nothing*: full and red the moment anything is priced", () => {
    // Null is *no cap* and zero is a real cap (the contract is explicit), so a division by it
    // must not answer Infinity — or NaN for a lane that has spent nothing against it.
    expect(meterLine(connection({ monthlyCapCents: 0 }), spendRow(), null)).toMatchObject({
      note: "of $0 cap",
      fraction: 1,
      tone: "err",
    });
    expect(
      meterLine(connection({ monthlyCapCents: 0 }), spendRow({ spendCents: 0 }), null),
    ).toMatchObject({ figure: "$0.00", fraction: 0, tone: "accent" });
  });

  it("clamps a meter over its cap to full, in the error hue", () => {
    const line = meterLine(connection({ monthlyCapCents: 10_000 }), spendRow(), null);

    expect(line.fraction).toBe(1);
    expect(line.tone).toBe("err");
  });
});

describe("the whole card", () => {
  it("composes the seeded Anthropic card, element for element", () => {
    const [anthropic] = seededCards();
    const [health] = seededProviders();
    const model = cardModel({
      connection: anthropic,
      entry: anthropicEntry(),
      health,
      spend: seededSpend().providers[0],
      models: { ok: true, value: anthropicModels() },
      now: NOW,
    });

    expect(model).toEqual({
      id: anthropic.id,
      name: "Anthropic Claude",
      capabilityNote: "api.anthropic.com · primary coding lane",
      monogram: { letters: "AN", tint: "model" },
      pill: { label: "connected", tone: "ok", dot: "filled" },
      pillDetail: null,
      enabled: true,
      address: null,
      secret: { label: "API key", mask: "••••Xq4A", placeholder: "sk-ant-api03-…" },
      meta: { addedBy: ADDER, addedOn: "2026-06-12", lastUsed: "3m ago" },
      models: { kind: "chips", models: anthropicModels(), tiers: ["priority"] },
      meter: { figure: "$412.80", note: "of $600 cap", fraction: 41_280 / 60_000, tone: "accent" },
      cap: "$600",
    });
  });

  it("composes a card for a kind no file names, from its entry alone", () => {
    // The schema-driven proof at the decision layer: the fake adapter's entry says *address
    // first, optional key second*, and that is the card — nothing here learnt its name.
    const model = cardModel({
      connection: fakeConnection(),
      entry: fakeEntry(),
      health: null,
      spend: null,
      models: { ok: true, value: [modelOption({ modelId: "fake/small", display: "Fake Small" })] },
      now: NOW,
    });

    expect(model.monogram).toEqual({ letters: "FA", tint: "neutral" });
    expect(model.address).toEqual({ label: "Base URL", value: "https://fake.invalid/v1" });
    expect(model.secret).toEqual({
      label: "API key",
      mask: "••••cret",
      placeholder: "API key — optional, no auth configured",
    });
    expect(model.pill).toEqual({ label: "unknown", tone: "warn", dot: "ring" });
    expect(model.meta.lastUsed).toBe(NEVER_USED);
    expect(model.models).toMatchObject({ kind: "chips", tiers: [] });
    expect(model.meter).toEqual({ figure: NO_SPEND, note: null, fraction: null, tone: "accent" });
    expect(model.cap).toBe("—");
  });

  it("is total over every null: no entry, no health, no spend, no models", () => {
    const model = cardModel({
      connection: connection({ baseUrl: "http://x", mask: null, monthlyCapCents: null }),
      entry: null,
      health: null,
      spend: null,
      models: null,
      now: NOW,
    });

    expect(model.address).toEqual({ label: ADDRESS_LABEL, value: "http://x" });
    expect(model.secret).toBeNull();
    expect(model.models.kind).toBe("unavailable");
    expect(model.meter.figure).toBe(NO_SPEND);
    expect(model.cap).toBe("—");
  });

  it("reads the seat count off the strip's detail and into the meter line", () => {
    const model = cardModel({
      connection: connection({ kind: "copilot", monthlyCapCents: 9_500 }),
      entry: copilotEntry(),
      health: provider({ detail: "200 · 4 seats" }),
      spend: spendRow({ kind: "copilot", spendCents: 7_600 }),
      models: { ok: true, value: [] },
      now: NOW,
    });

    expect(model.meter.note).toBe("of $95 cap · 4 seats");
    expect(model.pillDetail).toBe("200 · 4 seats");
  });
});
