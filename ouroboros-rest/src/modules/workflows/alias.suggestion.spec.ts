import {
  editDistance,
  rawModelMessage,
  suggestAlias,
  unknownAliasMessage,
  type RegistryAlias,
} from "./alias.suggestion";

/**
 * *Did you mean coder-max?* — CH.6's ([#589](https://github.com/NobuData/ouroboros/issues/589))
 * suggestion, asserted as the answers it gives over mockup 21's registry.
 *
 * Two orders of evidence, and the order is the point: the registry's own binding is asked
 * first, because a raw model id and the alias that means it share no spelling worth measuring;
 * a misspelling is only measured once that has no answer, and only within a third of the
 * alias's length, because a wrong suggestion teaches an author a name they did not mean.
 */

/** Mockup 21's eight aliases, in the name order the repository reads them. */
const REGISTRY: readonly RegistryAlias[] = [
  { alias: "coder-fallback", modelId: "gpt-5-codex" },
  { alias: "coder-max", modelId: "claude-fable-5" },
  { alias: "coder-std", modelId: "claude-sonnet-5" },
  { alias: "gpt5-experiments", modelId: "gpt-5.2-preview" },
  { alias: "local-docs", modelId: "qwen3-coder:32b" },
  { alias: "local-free", modelId: "llama-4-maverick" },
  { alias: "second-opinion", modelId: "composer-2" },
  { alias: "sizer", modelId: "claude-haiku-4-5" },
];

describe("editDistance", () => {
  it.each([
    ["coder-max", "coder-max", 0],
    ["coder-maxx", "coder-max", 1],
    ["codr-max", "coder-max", 1],
    ["coder-mix", "coder-max", 1],
    ["", "sizer", 5],
    ["sizer", "", 5],
  ])("measures %s against %s as %i", (from, to, expected) => {
    expect(editDistance(from, to)).toBe(expected);
  });
});

describe("suggestAlias", () => {
  it("answers a raw model id with the alias the registry binds to it", () => {
    // The issue's own example: `claude-fable-5` is `coder-max`.
    expect(suggestAlias("claude-fable-5", REGISTRY)).toBe("coder-max");
    expect(suggestAlias("claude-sonnet-5", REGISTRY)).toBe("coder-std");
  });

  it("finds the binding even for an alias that is not bound to a connection", () => {
    // `gpt5-experiments` is unbound, and still the registry's name for the model.
    expect(suggestAlias("gpt-5.2-preview", REGISTRY)).toBe("gpt5-experiments");
  });

  it("prefers the binding over a nearer spelling", () => {
    const registry = [
      { alias: "sizer", modelId: "sizes" },
      { alias: "sizes", modelId: "claude-haiku-4-5" },
    ];

    expect(suggestAlias("sizes", registry)).toBe("sizer");
  });

  it("answers a misspelt alias with the nearest name", () => {
    expect(suggestAlias("coder-maxx", REGISTRY)).toBe("coder-max");
    expect(suggestAlias("local-doc", REGISTRY)).toBe("local-docs");
  });

  it("gives a tie to the alias that sorts first", () => {
    // `coder-mad` is one edit from both `coder-max` and — no — only `coder-max`; `local-fre` is
    // one from `local-free` alone. A real tie: `local-dxxx` against two equal-length names.
    const registry = [
      { alias: "abc-one", modelId: "m1" },
      { alias: "abc-two", modelId: "m2" },
    ];

    expect(suggestAlias("abc-onw", registry)).toBe("abc-one");
    expect(suggestAlias("abc-tne", registry)).toBe("abc-one");
  });

  it("suggests nothing for a name too far from every alias", () => {
    expect(suggestAlias("gpt-4o", REGISTRY)).toBeNull();
    expect(suggestAlias("coder-maximum", REGISTRY)).toBeNull();
  });

  it("suggests nothing from an empty registry", () => {
    expect(suggestAlias("claude-fable-5", [])).toBeNull();
  });

  it("allows at least one edit even to a short name", () => {
    expect(suggestAlias("sizr", REGISTRY)).toBe("sizer");
  });
});

describe("the refusal sentences", () => {
  it("names the stage and the raw model id, and offers the alias", () => {
    expect(rawModelMessage("plan", "claude-fable-5", "coder-max")).toBe(
      "Stage `plan` pins the raw model id `claude-fable-5` — raw model ids are not allowed; " +
        "reference a registry alias (did you mean coder-max?).",
    );
  });

  it("names the stage and the unknown alias, and offers the nearest", () => {
    expect(unknownAliasMessage("plan", "coder-maxx", "coder-max")).toBe(
      "Stage `plan` pins `coder-maxx`, which is not in this workspace's model registry — " +
        "reference a registry alias (did you mean coder-max?).",
    );
  });

  it("closes without a question when there is nothing to offer", () => {
    expect(rawModelMessage("plan", "gpt-4o", null)).toBe(
      "Stage `plan` pins the raw model id `gpt-4o` — raw model ids are not allowed; " +
        "reference a registry alias.",
    );
    expect(unknownAliasMessage("plan", "nothing", null)).toBe(
      "Stage `plan` pins `nothing`, which is not in this workspace's model registry — " +
        "reference a registry alias.",
    );
  });
});
