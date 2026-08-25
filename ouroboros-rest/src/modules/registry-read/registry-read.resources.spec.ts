import { PROVIDER_CONNECTION_KINDS, type ProviderConnectionKind } from "../db/schema";
import type { ModelPriceResource } from "../pricing/resources";
import type { ModelAliasResource } from "../registry/aliases.resources";
import { REGISTRY_ROWS } from "../registry/registry.rows.fixture";
import { ALIAS_HEALTH_STATES, type AliasHealth } from "./alias.health";
import {
  PROVIDER_MONOGRAMS,
  monogramFor,
  toAliasHealthResource,
  toRegistryAliasResource,
} from "./registry-read.resources";

/**
 * Composition → resource ([#588](https://github.com/NobuData/ouroboros/issues/588)).
 *
 * Three claims the file header makes, asserted here rather than left as prose:
 *
 *   * **`usedBy` is `references.length`, always** — the count and the chips come out of one
 *     array in one expression, which is what makes serving both safe where decision **R5** said
 *     serving only the list was necessary;
 *   * **the monogram vocabulary is mockup 07's**, and it is total over V015's kinds;
 *   * **the chips are CH.2's derivation**, run over the eight rows mockup 21 draws — the same
 *     fixture `params.chips.spec.ts` compares against, so this file cannot pass by agreeing with
 *     itself.
 */

const PRICE: ModelPriceResource = {
  connectionKind: "anthropic",
  modelId: "claude-fable-5",
  price: null,
  display: "—",
};

const OK: AliasHealth = {
  state: ALIAS_HEALTH_STATES.ok,
  note: null,
  fix: null,
  checkedAt: new Date("2026-08-25T09:00:00.000Z"),
};

/**
 * CH.1's alias resource, defaulted to `coder-max` as the seed stores it.
 *
 * @param overrides - What this case is about.
 * @returns The alias resource this module composes onto.
 */
function alias(overrides: Partial<ModelAliasResource> = {}): ModelAliasResource {
  return {
    id: "5eed000f-0000-4000-8000-000000000001",
    alias: "coder-max",
    enabled: true,
    connection: {
      id: "5eed000c-0000-4000-8000-000000000001",
      kind: "anthropic",
      displayName: "Anthropic Claude",
    },
    modelId: "claude-fable-5",
    params: { thinking: "max", token_budget: 400_000 },
    restrictions: {},
    notes: null,
    references: [
      { kind: "route", refId: "route-1", label: "implement-primary", blocking: true },
      { kind: "escalation", refId: "rule-1", label: "escalation:effort≥L", blocking: true },
    ],
    updatedBy: null,
    createdAt: "2026-06-12T16:20:00.000Z",
    updatedAt: "2026-08-23T09:59:41.882Z",
    ...overrides,
  };
}

describe("the provider monogram", () => {
  it("is mockup 07's own letters for the five kinds it draws", () => {
    expect(PROVIDER_MONOGRAMS).toMatchObject({
      anthropic: "AN",
      copilot: "GH",
      cursor: "CU",
      ollama: "OL",
      openai_compatible: "VL",
    });
  });

  it("covers every kind V015 declares", () => {
    // Total by `satisfies` at compile time; this is the same claim at run time, so a kind
    // added to the type without a letter cannot slip through a cast either.
    expect(Object.keys(PROVIDER_MONOGRAMS).sort()).toEqual([...PROVIDER_CONNECTION_KINDS].sort());
  });

  it.each(REGISTRY_ROWS.filter((row) => row.kind !== null))(
    "draws $alias's provider with two letters",
    ({ kind }) => {
      expect(monogramFor(kind as ProviderConnectionKind, "unused").length).toBe(2);
    },
  );

  it("derives the letters from the name for a kind the mockup does not draw", () => {
    // Two custom connections should be tellable apart rather than both reading the same square
    // — the same fallback AE.2's card takes, stated once so the two surfaces agree.
    expect(monogramFor("custom", "Bedrock Gateway")).toBe("BG");
    expect(monogramFor("custom", "Vertex")).toBe("VE");
  });
});

describe("the health cell as the contract publishes it", () => {
  it("renders the instant as ISO 8601 and keeps null as null", () => {
    expect(toAliasHealthResource(OK)).toEqual({
      state: "ok",
      note: null,
      fix: null,
      checkedAt: "2026-08-25T09:00:00.000Z",
    });
    expect(toAliasHealthResource({ ...OK, checkedAt: null }).checkedAt).toBeNull();
  });
});

describe("one row of the allowed-models table", () => {
  it("composes the binding, the chips, the health, the price and the references", () => {
    const row = toRegistryAliasResource(alias(), "••••Xq4A", OK, PRICE);

    expect(row).toEqual({
      id: "5eed000f-0000-4000-8000-000000000001",
      alias: "coder-max",
      enabled: true,
      binding: {
        id: "5eed000c-0000-4000-8000-000000000001",
        kind: "anthropic",
        displayName: "Anthropic Claude",
        monogram: "AN",
        mask: "••••Xq4A",
      },
      modelId: "claude-fable-5",
      params: { thinking: "max", token_budget: 400_000 },
      restrictions: {},
      chips: ["max thinking", "400k budget"],
      notes: null,
      health: { state: "ok", note: null, fix: null, checkedAt: "2026-08-25T09:00:00.000Z" },
      price: PRICE,
      usedBy: 2,
      references: alias().references,
    });
  });

  it("has no binding, and therefore no monogram and no mask, for the unbound row", () => {
    // Mockup 21's `gpt5-experiments`: the provider cell reads *no provider*, and there is
    // nowhere in the shape for letters or a key to appear.
    const row = toRegistryAliasResource(
      alias({ alias: "gpt5-experiments", connection: null, enabled: false, references: [] }),
      "••••Xq4A",
      OK,
      PRICE,
    );

    expect(row.binding).toBeNull();
    expect(row.enabled).toBe(false);
    expect(row.usedBy).toBe(0);
  });

  it("publishes a null mask for a provider that stores no credential", () => {
    expect(toRegistryAliasResource(alias(), null, OK, PRICE).binding?.mask).toBeNull();
  });

  it("counts exactly the references it carries, whatever they are", () => {
    // The half decision R5 is about: the column and the chips are one array, so the number
    // beside them cannot be a second, staler derivation.
    for (const count of [0, 1, 4]) {
      const references = Array.from({ length: count }, (_unused, index) => ({
        kind: "route" as const,
        refId: `route-${index.toString()}`,
        label: `route-${index.toString()}`,
        blocking: true,
      }));
      const row = toRegistryAliasResource(alias({ references }), null, OK, PRICE);

      expect(row.usedBy).toBe(count);
      expect(row.references).toHaveLength(count);
    }
  });

  it("carries CH.3's rendering rather than re-deriving one", () => {
    const seatBased: ModelPriceResource = {
      connectionKind: "copilot",
      modelId: "gpt-5-codex",
      price: null,
      display: "seat-based",
    };

    expect(toRegistryAliasResource(alias(), null, OK, seatBased).price).toBe(seatBased);
  });

  describe("mockup 21's eight rows", () => {
    it.each(REGISTRY_ROWS)("draws $alias's params cell exactly as the table does", (row) => {
      // The chips are read off the mockup in `registry.rows.fixture.ts` and the params beside
      // them are what `model_aliases` holds — so this is the derivation reproducing the drawing
      // rather than recording its own output back at itself.
      const composed = toRegistryAliasResource(
        alias({
          alias: row.alias,
          modelId: row.modelId,
          params: row.params,
          restrictions: row.restrictions,
          connection:
            row.kind === null
              ? null
              : { id: "connection", kind: row.kind, displayName: "Anything" },
        }),
        null,
        OK,
        PRICE,
      );

      expect(composed.chips).toEqual(row.chips);
    });

    it("leaves the two dashed cells as empty lists rather than as a sentinel string", () => {
      // `coder-fallback` and `gpt5-experiments` — a fixed-catalog model with nothing to tune,
      // and a name with no provider to tune it for. The mockup draws faint text there, which is
      // its own markup, so the payload says *nothing here* structurally.
      const dashed = REGISTRY_ROWS.filter((row) => row.chips.length === 0).map((row) =>
        toRegistryAliasResource(
          alias({ params: row.params, restrictions: row.restrictions }),
          null,
          OK,
          PRICE,
        ),
      );

      expect(dashed).toHaveLength(2);
      expect(dashed.every((row) => row.chips.length === 0)).toBe(true);
    });
  });
});
