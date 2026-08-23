import type { BillingMode, ModelPrice } from "../db/schema";
import {
  BILLING_MODES,
  FREE,
  RATE_SEPARATOR,
  SEAT_BASED,
  UNPRICED,
  USAGE_BASED,
  priceFromRow,
  renderPrice,
  type ResolvedPrice,
} from "./price";

/**
 * The five shapes of the `$ per 1M in·out` cell, and the one distinction the whole ticket
 * rests on.
 *
 * Everything here is pure — no database, no Nest — because the rules are: given a row, what
 * does the column say. Whether the right row was found is the repository's and the service's
 * question; whether the right *thing* is said about it is this one's.
 *
 * The rendering of the mockup's own eight aliases is asserted twice on purpose: here, against
 * hand-written rows, so a formatting change fails in a spec that runs on save; and in
 * `pricing.integration-spec.ts`, against the rows the shipped catalog really holds.
 */

/** A row of the bundled catalog, as `ouroboros.model_price()` would hand it back. */
function row(overrides: Partial<ModelPrice> = {}): ModelPrice {
  return {
    id: "6b1f0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    organization_id: null,
    match_provider_kind: "anthropic",
    match_model: "claude-fable-5",
    billing_mode: "token",
    input_cents_per_1m: "1000.0000",
    output_cents_per_1m: "5000.0000",
    source: "bundled",
    catalog_version: "2026-08-15+litellm.70d51a1",
    meta: {},
    effective_at: new Date("2026-08-15T01:16:59.000Z"),
    created_at: new Date("2026-08-15T01:16:59.000Z"),
    updated_at: new Date("2026-08-15T01:16:59.000Z"),
    ...overrides,
  };
}

/** The same row, resolved — the shape a consumer holds. */
function price(overrides: Partial<ModelPrice> = {}): ResolvedPrice {
  return priceFromRow(row(overrides));
}

describe("the vocabulary", () => {
  it("lists the four billing modes the schema's union names, and no fifth", () => {
    // `BILLING_MODES` is a value and `BillingMode` is a type, and the two restate one CHECK.
    // `satisfies` is what makes a word added to one and not the other a compile error rather
    // than a mode that renders as whichever branch the switch happened to fall through to.
    const modes = ["token", "seat", "usage", "free"] as const satisfies readonly BillingMode[];

    expect([...BILLING_MODES]).toEqual([...modes]);
  });

  it("keeps the unpriced cell and the free cell as different strings", () => {
    // The ticket in one assertion. Everything else in this module is machinery for keeping
    // these two apart, and if they were ever equal every other test here would still pass.
    expect(UNPRICED).not.toBe(FREE);
    expect(UNPRICED).toBe("—");
    expect(FREE).toBe("$0");
  });
});

describe("rendering a resolved price", () => {
  it("renders a per-token price as two dollar amounts", () => {
    expect(renderPrice(price())).toBe(`$10${RATE_SEPARATOR}$50`);
  });

  it.each([
    ["claude-fable-5", "1000.0000", "5000.0000", "$10 · $50"],
    ["claude-sonnet-5", "200.0000", "1000.0000", "$2 · $10"],
    ["claude-haiku-4-5", "100.0000", "500.0000", "$1 · $5"],
  ])("renders the mockup's %s row as %s", (_model, input, output, expected) => {
    // The three per-token rows of mockup 21's table, at the amounts the pinned snapshot
    // actually carries — the mockup's own figures are illustrative and V012's header records
    // the correction. The *shapes* are the mockup's exactly.
    expect(renderPrice(price({ input_cents_per_1m: input, output_cents_per_1m: output }))).toBe(
      expected,
    );
  });

  it.each([
    ["seat", SEAT_BASED],
    ["usage", USAGE_BASED],
  ] as const)("renders a %s price as the billing mode's own word", (mode, expected) => {
    expect(
      renderPrice(
        price({
          billing_mode: mode,
          input_cents_per_1m: null,
          output_cents_per_1m: null,
        }),
      ),
    ).toBe(expected);
  });

  it("renders a free price as $0", () => {
    expect(
      renderPrice(
        price({ billing_mode: "free", input_cents_per_1m: null, output_cents_per_1m: null }),
      ),
    ).toBe(FREE);
  });

  it("renders a free price the same whether the row spells zero or leaves it out", () => {
    // V012 accepts both spellings because both are true — a locally served model has no rate
    // at all, and a vendor publishing 0 is saying the same thing — so the cell must not depend
    // on which one the row happens to hold.
    const spelled = price({
      billing_mode: "free",
      input_cents_per_1m: "0.0000",
      output_cents_per_1m: "0.0000",
    });
    const absent = price({
      billing_mode: "free",
      input_cents_per_1m: null,
      output_cents_per_1m: null,
    });

    expect(renderPrice(spelled)).toBe(renderPrice(absent));
  });

  it("renders an uncovered model as the em dash, and never as $0", () => {
    // The criterion, stated as the assertion that would catch the easy default: a nullable
    // amount rendered through a `?? 0` fallback passes every other test in this file.
    expect(renderPrice(undefined)).toBe(UNPRICED);
    expect(renderPrice(undefined)).not.toBe(FREE);
  });
});

describe("formatting cents per 1M as dollars", () => {
  it.each([
    ["1500.0000", "7500.0000", "$15 · $75"],
    ["25.0000", "125.0000", "$0.25 · $1.25"],
    ["0.2500", "1.0000", "$0.0025 · $0.01"],
    ["1.0000", "0.0001", "$0.01 · $0.000001"],
    ["9999999999.9999", "1.0000", "$99999999.999999 · $0.01"],
  ])("renders %s / %s as %s", (input, output, expected) => {
    expect(renderPrice(price({ input_cents_per_1m: input, output_cents_per_1m: output }))).toBe(
      expected,
    );
  });

  it("keeps a rate too small for a whole cent rather than rounding it to zero", () => {
    // The failure the `numeric(14, 4)` column exists to prevent, seen from the render side: a
    // rate that formats as `$0` is indistinguishable from a free model, which is the lie this
    // surface is built to refuse. `0.0001` cents per 1M is a real number and must look like
    // one.
    const rendered = renderPrice(
      price({ input_cents_per_1m: "0.0001", output_cents_per_1m: "0.0001" }),
    );

    expect(rendered).toBe("$0.000001 · $0.000001");
    // Neither half collapsed to the free cell — checked per side rather than over the whole
    // string, which would match `$0` inside `$0.000001` and pass for the wrong reason.
    expect(rendered.split(RATE_SEPARATOR)).not.toContain(FREE);
  });

  it("reads an amount that arrives without a decimal point", () => {
    // `pg` renders a `numeric` with the column's scale, so `1200` is not what arrives today.
    // It is what arrives from a `numeric` with no scale, and a formatter that assumed a point
    // would silently shift every such amount by two places.
    expect(renderPrice(price({ input_cents_per_1m: "1200", output_cents_per_1m: "6000" }))).toBe(
      "$12 · $60",
    );
  });

  it("does not group thousands", () => {
    // Where the digits are grouped is the stylesheet's business. A separator inserted here
    // would travel into every consumer of the internal contract, including the ones summing a
    // ledger.
    expect(
      renderPrice(price({ input_cents_per_1m: "100000.0000", output_cents_per_1m: "1.0000" })),
    ).toBe("$1000 · $0.01");
  });
});

describe("reading a row", () => {
  it("carries the provenance of a bundled price", () => {
    expect(price().provenance).toEqual({
      source: "bundled",
      catalogVersion: "2026-08-15+litellm.70d51a1",
      effectiveAt: new Date("2026-08-15T01:16:59.000Z"),
    });
  });

  it("carries the provenance of an override, whose version is null", () => {
    // An override is not a version of anything, and the null is the fact rather than a missing
    // value: it is what lets #592's hover say *org override* instead of naming a snapshot.
    expect(
      price({
        organization_id: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
        source: "override",
        catalog_version: null,
      }).provenance,
    ).toEqual({
      source: "override",
      catalogVersion: null,
      effectiveAt: new Date("2026-08-15T01:16:59.000Z"),
    });
  });

  it.each(BILLING_MODES)("gives a %s price provenance", (mode) => {
    // The ticket's *a price with no provenance is a bug*, over the whole vocabulary rather
    // than over the one mode a spec would naturally reach for.
    const amounts =
      mode === "token"
        ? { input_cents_per_1m: "1000.0000", output_cents_per_1m: "5000.0000" }
        : { input_cents_per_1m: null, output_cents_per_1m: null };

    expect(price({ billing_mode: mode, ...amounts }).provenance.source).toBe("bundled");
  });

  it("keeps the amounts as the strings the column holds", () => {
    // Not narrowed to numbers here: `numeric(14, 4)` does not fit a double without a rounding
    // decision, and the one place that decision is made is `resources.ts`.
    const resolved = price();

    expect(resolved.inputCentsPer1m).toBe("1000.0000");
    expect(typeof resolved.inputCentsPer1m).toBe("string");
  });

  it("refuses a token row missing a rate, rather than rendering half a cell", () => {
    // V012's `model_prices_token_requires_amounts` makes this unreachable; what is asserted is
    // what happens if it ever becomes reachable. A thrown error is a 500 an operator sees; the
    // alternative is `—` for a model somebody is being invoiced for.
    expect(() => price({ output_cents_per_1m: null })).toThrow(/missing one of its two rates/);
  });

  it.each(["seat", "usage"] as const)("refuses a %s row carrying a per-token rate", (mode) => {
    expect(() => price({ billing_mode: mode })).toThrow(/carries a per-token rate/);
  });

  it("refuses a billing mode outside the four", () => {
    // A fifth mode in the database and not in the mirror. Named rather than defaulted, because
    // a mode silently rendering as another mode is a wrong cell nobody sees.
    expect(() => price({ billing_mode: "prepaid" as BillingMode })).toThrow(
      /unknown billing mode prepaid/,
    );
  });

  it("names the row and the migration in what it throws", () => {
    // The message is read by whoever has to fix the drift, so it says which row and which file
    // rather than reporting that something is wrong somewhere.
    expect(() => price({ match_model: "claude-opus-5", output_cents_per_1m: null })).toThrow(
      /anthropic\/claude-opus-5.*V012__model_prices\.sql/s,
    );
  });
});
