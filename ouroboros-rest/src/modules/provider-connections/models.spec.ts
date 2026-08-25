import type { ProviderModelRow } from "./provider-models.repository";
import {
  discoveryDiff,
  providerModelResource,
  providerModelsResource,
  unlistedModels,
  type AliasOnConnection,
} from "./models";

/**
 * The discovered catalog as the card reads it, and the flag on a stranded alias
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)).
 *
 * Pure functions over rows, so the two decisions `models.ts` argues in its header are held
 * here without a database: a removed model's alias is flagged rather than the model kept, and
 * a connection nothing has discovered on flags nothing at all.
 */

const CONNECTION = "5eed000c-0000-4000-8000-000000000004";
const AT = new Date("2026-08-25T10:00:00.000Z");
const EARLIER = new Date("2026-08-24T10:00:00.000Z");

function row(overrides: Partial<ProviderModelRow> = {}): ProviderModelRow {
  return {
    model_id: "llama-4-maverick",
    display: "local/llama-4-maverick",
    size_bytes: null,
    meta: { context_tokens: 1_000_000 },
    discovered_at: AT,
    ...overrides,
  };
}

function alias(id: string, name: string, modelId: string): AliasOnConnection {
  return { id, alias: name, model_id: modelId };
}

describe("one row as a resource", () => {
  it("carries the four V017 columns under the contract's names, stamped in ISO 8601", () => {
    expect(providerModelResource(row())).toEqual({
      modelId: "llama-4-maverick",
      display: "local/llama-4-maverick",
      sizeBytes: null,
      meta: { context_tokens: 1_000_000 },
      discoveredAt: "2026-08-25T10:00:00.000Z",
    });
  });

  it("turns the bigint string back into the number it was — a 63 GB model is 6.3e10", () => {
    expect(providerModelResource(row({ size_bytes: "67645734912" })).sizeBytes).toBe(
      67_645_734_912,
    );
  });

  it("keeps null as null: a cloud model has no size, and 0 would be a claim", () => {
    expect(providerModelResource(row({ size_bytes: null })).sizeBytes).toBeNull();
  });
});

describe("the flag on a model an alias still names", () => {
  const listed = [row({ model_id: "llama-4-maverick" }), row({ model_id: "qwen3-coder:32b" })];

  it("flags an alias whose model the catalog does not list, naming the alias", () => {
    expect(
      unlistedModels(listed, [
        alias("a1", "local-free", "llama-4-maverick"),
        alias("a2", "local-ds", "deepseek-v3.2"),
      ]),
    ).toEqual([{ modelId: "deepseek-v3.2", aliases: [{ id: "a2", alias: "local-ds" }] }]);
  });

  it("groups every alias that names one unlisted model, in name order", () => {
    expect(
      unlistedModels(listed, [
        alias("a3", "zeta", "deepseek-v3.2"),
        alias("a2", "local-ds", "deepseek-v3.2"),
      ]),
    ).toEqual([
      {
        modelId: "deepseek-v3.2",
        aliases: [
          { id: "a2", alias: "local-ds" },
          { id: "a3", alias: "zeta" },
        ],
      },
    ]);
  });

  it("orders the unlisted models by id, so two flags do not swap places between renders", () => {
    const flags = unlistedModels(listed, [
      alias("a1", "b-alias", "zz-gone"),
      alias("a2", "a-alias", "aa-gone"),
    ]);

    expect(flags.map((flag) => flag.modelId)).toEqual(["aa-gone", "zz-gone"]);
  });

  it("flags nothing on a connection nothing has discovered on — a gap is not a mismatch", () => {
    // V017's own distinction: *nothing has been discovered here yet* is the ordinary state of
    // a connection somebody just added, and every alias on it would otherwise read as broken.
    expect(unlistedModels([], [alias("a2", "local-ds", "deepseek-v3.2")])).toEqual([]);
  });

  it("flags nothing when every alias names a listed model", () => {
    expect(unlistedModels(listed, [alias("a1", "local-free", "llama-4-maverick")])).toEqual([]);
  });
});

describe("the catalog as one payload", () => {
  it("carries the rows in the repository's order and the flags beside them", () => {
    const resource = providerModelsResource(
      CONNECTION,
      [row({ model_id: "a" }), row({ model_id: "b" })],
      [alias("x", "gone", "c")],
    );

    expect(resource.connectionId).toBe(CONNECTION);
    expect(resource.models.map((model) => model.modelId)).toEqual(["a", "b"]);
    expect(resource.unlisted).toEqual([{ modelId: "c", aliases: [{ id: "x", alias: "gone" }] }]);
  });

  it("stamps the catalog with its newest row, which is when discovery last reported anything", () => {
    const resource = providerModelsResource(
      CONNECTION,
      [row({ discovered_at: EARLIER }), row({ model_id: "b", discovered_at: AT })],
      [],
    );

    expect(resource.discoveredAt).toBe("2026-08-25T10:00:00.000Z");
  });

  it("says a never-discovered connection was discovered at no time, rather than now", () => {
    expect(providerModelsResource(CONNECTION, [], []).discoveredAt).toBeNull();
  });
});

describe("what one discovery pass changed", () => {
  it("names what appeared and what vanished, each ordered", () => {
    expect(discoveryDiff(["b", "a", "gone"], ["c", "a", "b"])).toEqual({
      added: ["c"],
      removed: ["gone"],
    });
  });

  it("reports nothing for a pass that found exactly what was held", () => {
    expect(discoveryDiff(["a", "b"], ["b", "a"])).toEqual({ added: [], removed: [] });
  });

  it("counts a model reported twice once, as the upsert does", () => {
    expect(discoveryDiff([], ["a", "a"])).toEqual({ added: ["a"], removed: [] });
  });

  it("reports every held model removed when the provider listed nothing", () => {
    expect(discoveryDiff(["a", "b"], [])).toEqual({ added: [], removed: ["a", "b"] });
  });
});
