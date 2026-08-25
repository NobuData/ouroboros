import { FREE, UNPRICED, type ResolvedPrice } from "../pricing/price";
import { PROVIDERS_FIX_PATH } from "./aliases.errors";
import type { ModelOptionRow } from "./aliases.rows";
import {
  NO_MODELS_DISCOVERED,
  noModelsDiscovered,
  toCandidateAliasResource,
  toCandidateResource,
  type ImportCapabilitiesResource,
} from "./import.resources";

/**
 * Row → resource for the import wizard
 * ([#587](https://github.com/NobuData/ouroboros/issues/587)) — the two facts the *server*
 * decides, and the one it must never invent.
 *
 * The mapping itself is dull; what is asserted here is the reasoning. `selected` is the
 * server's answer to *should this row arrive ticked*, and a client deriving it would be a
 * second place for the wizard's default to live. `$0` against `—` is CH.3's distinction
 * carried through unchanged, and it is the one thing on this surface that could quietly cost
 * somebody money.
 */

const DISCOVERED_AT = new Date("2026-08-24T09:56:00.000Z");

const MODEL: ModelOptionRow = {
  model_id: "claude-opus-5",
  display: "claude-opus-5",
  discovered_at: DISCOVERED_AT,
  meta: { context_tokens: 1000000, tier: "priority" },
};

const CAPABILITIES: ImportCapabilitiesResource = {
  params: ["thinking", "token_budget"],
  thinking: true,
  contextTokens: 1000000,
  maxOutputTokens: 64000,
  reason: null,
};

const FREE_PRICE: ResolvedPrice = {
  billingMode: "free",
  inputCentsPer1m: null,
  outputCentsPer1m: null,
  provenance: {
    source: "bundled",
    catalogVersion: "2026-08-15+litellm.70d51a1",
    effectiveAt: new Date("2026-08-15T00:00:00.000Z"),
  },
};

describe("a candidate row", () => {
  it("carries the discovered model exactly as the inspector's select does", () => {
    const row = toCandidateResource(MODEL, null, "opus-5", undefined, "anthropic", CAPABILITIES);

    // The same four fields `ModelOption` publishes, from the same mapper: a wizard whose model
    // list disagreed with the inspector's would be two answers to *what has this connection*.
    expect(row).toMatchObject({
      modelId: "claude-opus-5",
      display: "claude-opus-5",
      discoveredAt: DISCOVERED_AT.toISOString(),
      meta: { context_tokens: 1000000, tier: "priority" },
    });
  });

  it("arrives ticked when nothing names the model and a name could be suggested", () => {
    const row = toCandidateResource(MODEL, null, "opus-5", undefined, "anthropic", CAPABILITIES);

    expect(row.alias).toBeNull();
    expect(row.suggestedName).toBe("opus-5");
    expect(row.selected).toBe(true);
  });

  it("arrives unticked, and marked, when an alias already names the model", () => {
    // *The curation is the feature* — re-importing what is already named is the one thing an
    // operator did not ask for. The alias is carried whole so the row can link to it.
    const existing = toCandidateAliasResource({
      id: "5eed000f-0000-4000-8000-000000000001",
      alias: "coder-max",
      model_id: "claude-opus-5",
    });
    const row = toCandidateResource(
      MODEL,
      existing,
      "opus-5",
      undefined,
      "anthropic",
      CAPABILITIES,
    );

    expect(row.alias).toEqual({ id: "5eed000f-0000-4000-8000-000000000001", alias: "coder-max" });
    expect(row.selected).toBe(false);
  });

  it("arrives unticked when no name could be suggested", () => {
    // A ticked row with an empty name is one the wizard cannot submit.
    const row = toCandidateResource(MODEL, null, null, undefined, "anthropic", CAPABILITIES);

    expect(row.suggestedName).toBeNull();
    expect(row.selected).toBe(false);
  });

  it("renders an uncovered model as an em dash and never as a zero", () => {
    // CH.3's whole argument, and the reason this asserts the two together: on a page somebody
    // sizes a budget from, "unknown" quietly becoming "free" is the failure that costs money.
    const row = toCandidateResource(MODEL, null, "opus-5", undefined, "anthropic", CAPABILITIES);

    expect(row.price.price).toBeNull();
    expect(row.price.display).toBe(UNPRICED);
    expect(row.price.display).not.toBe(FREE);
  });

  it("renders a free model as $0, with its provenance", () => {
    // An Ollama or vLLM connection — the ticket's *local connections import with free pricing
    // shown in the preview*.
    const row = toCandidateResource(
      { ...MODEL, model_id: "qwen3-coder:32b" },
      null,
      "qwen3-coder-32b",
      FREE_PRICE,
      "ollama",
      CAPABILITIES,
    );

    expect(row.price.display).toBe(FREE);
    expect(row.price.price?.billingMode).toBe("free");
    expect(row.price.price?.provenance.source).toBe("bundled");
  });

  it("publishes the pair the price was resolved for, beside the answer", () => {
    // Carried so a batch response can be read without counting positions against the request.
    // The kind is `provider_connections.kind` and V015's domain is already folded, so nothing
    // here re-cases it — what was looked up is what is published.
    const row = toCandidateResource(MODEL, null, "opus-5", undefined, "anthropic", CAPABILITIES);

    expect(row.price.connectionKind).toBe("anthropic");
    expect(row.price.modelId).toBe("claude-opus-5");
  });

  it("carries CH.2's headline unchanged", () => {
    // The type is that module's, so this asserts the value is passed through rather than
    // re-derived — the drift this surface is structurally protected from.
    const row = toCandidateResource(MODEL, null, "opus-5", undefined, "anthropic", CAPABILITIES);

    expect(row.capabilities).toBe(CAPABILITIES);
  });
});

describe("a connection with nothing discovered", () => {
  it("answers a code, a sentence and somewhere to go", () => {
    // *Never an empty wizard with no explanation.* A client that had to compose this sentence
    // would compose it differently on every page that ever asks.
    const empty = noModelsDiscovered("Ollama · workstation");

    expect(empty.code).toBe(NO_MODELS_DISCOVERED);
    expect(empty.message).toContain("Ollama · workstation");
    expect(empty.message).toContain("Providers & keys");
    expect(empty.fix).toBe(PROVIDERS_FIX_PATH);
  });
});
