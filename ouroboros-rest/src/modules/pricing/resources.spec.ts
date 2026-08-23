import type { ModelPrice } from "../db/schema";
import { FREE, UNPRICED, priceFromRow, type ResolvedPrice } from "./price";
import { modelPriceResource, priceOverrideResource, resolvedPriceResource } from "./resources";

/**
 * The row-to-contract seam, and the two things it must not blur.
 *
 * The mapping itself is mechanical; what is asserted here is the pair of decisions that make
 * the contract honest. **An uncovered model has nowhere for a rate to be** — `price` is null
 * rather than an object with null fields — so a client cannot read a number off one. And
 * **provenance is on every price**, which the type already guarantees and which is asserted
 * anyway, because a change that made it optional would compile.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** A row, as `ouroboros.model_price()` would hand it back. */
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

/** An override row, as an upsert would return it. */
function override(overrides: Partial<ModelPrice> = {}): ModelPrice {
  return row({
    organization_id: WORKSPACE,
    source: "override",
    catalog_version: null,
    input_cents_per_1m: "1200.0000",
    output_cents_per_1m: "6000.0000",
    effective_at: new Date("2026-08-22T09:00:00.000Z"),
    updated_at: new Date("2026-08-22T09:00:00.000Z"),
    ...overrides,
  });
}

/** A resolved price for one of the rows above. */
function price(source: ModelPrice): ResolvedPrice {
  return priceFromRow(source);
}

describe("a resolved price as a resource", () => {
  it("converts the amounts to numbers exactly once", () => {
    // `numeric(14, 4)` crosses this service as a string, and the contract publishes a number,
    // exactly as the dashboard's `costCents` does. This is the one place the conversion
    // happens, so it is the one place it can be wrong.
    const resource = resolvedPriceResource(price(row()));

    expect(resource.inputCentsPer1m).toBe(1000);
    expect(resource.outputCentsPer1m).toBe(5000);
  });

  it("keeps an absent rate absent rather than zeroing it", () => {
    // The same distinction the whole surface is built on, one field down: a `seat` price has
    // no input rate, and `0` would be a claim that input tokens are free.
    const resource = resolvedPriceResource(
      price(row({ billing_mode: "seat", input_cents_per_1m: null, output_cents_per_1m: null })),
    );

    expect(resource.inputCentsPer1m).toBeNull();
    expect(resource.outputCentsPer1m).toBeNull();
  });

  it("carries provenance, with the snapshot version, for a bundled price", () => {
    expect(resolvedPriceResource(price(row())).provenance).toEqual({
      source: "bundled",
      catalogVersion: "2026-08-15+litellm.70d51a1",
      effectiveAt: "2026-08-15T01:16:59.000Z",
    });
  });

  it("carries provenance, with no version, for an override", () => {
    // The null is what #592's hover renders as *org override* rather than as a snapshot name.
    expect(resolvedPriceResource(price(override())).provenance).toEqual({
      source: "override",
      catalogVersion: null,
      effectiveAt: "2026-08-22T09:00:00.000Z",
    });
  });
});

describe("one model's price as a resource", () => {
  it("echoes the pair it answers for", () => {
    // So a batch answer can be read without counting positions against the request, and so a
    // caller who sent `Anthropic` can see which spelling was looked up.
    const resource = modelPriceResource(
      { connectionKind: "anthropic", modelId: "claude-fable-5" },
      price(row()),
    );

    expect(resource.connectionKind).toBe("anthropic");
    expect(resource.modelId).toBe("claude-fable-5");
  });

  it("carries the rendered cell beside the price", () => {
    expect(
      modelPriceResource({ connectionKind: "anthropic", modelId: "claude-fable-5" }, price(row()))
        .display,
    ).toBe("$10 · $50");
  });

  it("gives an uncovered model a null price and the em dash", () => {
    // The acceptance criterion, as a shape rather than as a value: there is nowhere in this
    // resource for a rate to be, so no client can read one.
    const resource = modelPriceResource(
      { connectionKind: null, modelId: "gpt-5.2-preview" },
      undefined,
    );

    expect(resource.price).toBeNull();
    expect(resource.display).toBe(UNPRICED);
  });

  it("gives a free model a price and the $0 cell — the other side of the same line", () => {
    const resource = modelPriceResource(
      { connectionKind: "ollama", modelId: "qwen3-coder:32b" },
      price(row({ billing_mode: "free", input_cents_per_1m: null, output_cents_per_1m: null })),
    );

    expect(resource.price).not.toBeNull();
    expect(resource.price?.billingMode).toBe("free");
    expect(resource.display).toBe(FREE);
  });
});

describe("an override as a resource", () => {
  it("publishes the pair, the mode, the rates, the cell and the stamps", () => {
    expect(priceOverrideResource(override(), price(override()))).toEqual({
      connectionKind: "anthropic",
      modelId: "claude-fable-5",
      billingMode: "token",
      inputCentsPer1m: 1200,
      outputCentsPer1m: 6000,
      display: "$12 · $60",
      effectiveAt: "2026-08-22T09:00:00.000Z",
      updatedAt: "2026-08-22T09:00:00.000Z",
    });
  });

  it("says nothing about its source, because every row here has the same one", () => {
    // A `source: "override"` field would be a constant dressed as data. What a reader wants
    // from this listing is *what have we changed*, and every entry answering "we did" adds
    // nothing.
    expect(priceOverrideResource(override(), price(override()))).not.toHaveProperty("source");
  });

  it("renders a family override the way the registry column will", () => {
    // `('openai_compatible', '*') → free` is the row that makes mockup 21's `llama-4-maverick`
    // read `$0`, and a settings table showing this correction should show the same cell.
    const row = override({
      match_provider_kind: "openai_compatible",
      match_model: "*",
      billing_mode: "free",
      input_cents_per_1m: null,
      output_cents_per_1m: null,
    });

    expect(priceOverrideResource(row, price(row))).toMatchObject({
      connectionKind: "openai_compatible",
      modelId: "*",
      display: FREE,
      inputCentsPer1m: null,
    });
  });
});
