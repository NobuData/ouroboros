import { ALIAS_NAME_PATTERN, MAX_ALIAS_LENGTH } from "./aliases.dto";
import {
  MAX_NAME_ORDINAL,
  foldModelId,
  sharedModelPrefix,
  shortModelName,
  suggestAliasName,
} from "./import.naming";

/**
 * The naming template ([#587](https://github.com/NobuData/ouroboros/issues/587)) — four pure
 * functions, and the one property that matters about all of them together.
 *
 * **The property is that a suggestion is a name the create would accept.** A wizard that
 * pre-fills a cell with something `POST /registry/aliases` refuses is a wizard whose rows fail
 * on submission, so every suggestion produced anywhere in this suite is held to V015's own
 * pattern and ceiling — the same two constants `aliases.dto.ts` validates against.
 *
 * Everything here is deterministic and reads no database, which is the point of the split: the
 * service's suite asserts that the connection's models are what these are asked about, and this
 * one asserts what the answer is.
 */

/** The seeded Anthropic connection's four models — the ticket's own worked example. */
const ANTHROPIC = ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];

/**
 * A suggestion is a name V015 would store.
 *
 * @param name - What was suggested.
 */
function isStorable(name: string): void {
  expect(name).toMatch(ALIAS_NAME_PATTERN);
  expect(name.length).toBeLessThanOrEqual(MAX_ALIAS_LENGTH);
}

describe("folding a model id", () => {
  it.each([
    ["claude-fable-5", "claude-fable-5"],
    // Ollama's tag separator, and the one shape that would otherwise reach V015 as a colon.
    ["qwen3-coder:32b", "qwen3-coder-32b"],
    ["llama4:scout", "llama4-scout"],
    // A namespace is the provider's routing, not part of the model's name.
    ["local/llama-4-maverick", "llama-4-maverick"],
    ["openai/gpt-4.1-mini", "gpt-4-1-mini"],
    // A version's dot is a separator like any other.
    ["deepseek-v3.2", "deepseek-v3-2"],
    // Capitals: V015 stores names folded, so a suggestion that kept one would be refused.
    ["Claude-Opus-5", "claude-opus-5"],
    // Runs collapse and edges are trimmed, so no `--` and no leading or trailing hyphen.
    ["gpt__5..codex", "gpt-5-codex"],
    ["_leading-and-trailing_", "leading-and-trailing"],
  ])("folds %s to %s", (modelId, expected) => {
    expect(foldModelId(modelId)).toBe(expected);
    isStorable(foldModelId(modelId));
  });

  it("answers the empty string for an id with nothing storable in it", () => {
    // No provider publishes one; answered honestly rather than thrown, because the caller has
    // a null suggestion to fall back to and a thrown error would take the whole wizard down
    // over one unrenderable row.
    expect(foldModelId("///")).toBe("");
    expect(foldModelId("...")).toBe("");
  });
});

describe("the shared prefix", () => {
  it("finds the vendor word every model of a connection carries", () => {
    expect(sharedModelPrefix(ANTHROPIC)).toBe("claude");
  });

  it("finds none when the models do not agree", () => {
    // An Ollama workstation: three unrelated families, and nothing to strip.
    expect(sharedModelPrefix(["qwen3-coder-32b", "llama4-scout", "phi4-14b"])).toBeNull();
  });

  it("finds none for a single model", () => {
    // A "shared" prefix over one model is that model's first word, and stripping it would
    // turn the Copilot connection's only model into `5-codex`.
    expect(sharedModelPrefix(["gpt-5-codex"])).toBeNull();
  });

  it("finds none when stripping would leave a model with no name", () => {
    // `claude` alongside `claude-opus-5`: the prefix is real and dropping it empties the first
    // row. Called off for the whole list rather than for that row, so the wizard's names are
    // derived one way rather than two.
    expect(sharedModelPrefix(["claude", "claude-opus-5"])).toBeNull();
  });

  it("finds none in an empty list", () => {
    expect(sharedModelPrefix([])).toBeNull();
  });

  it("does not mistake a common substring for a common segment", () => {
    // `claude` and `claudia` share six characters and no segment. A prefix rule written on
    // characters would suggest `-opus-5` here, which is not a name.
    expect(sharedModelPrefix(["claude-opus-5", "claudia-mini-1"])).toBeNull();
  });
});

describe("the short model name", () => {
  it("drops the shared prefix — the ticket's own example", () => {
    const prefix = sharedModelPrefix(ANTHROPIC);

    expect(ANTHROPIC.map((model) => shortModelName(model, prefix))).toEqual([
      "fable-5",
      "opus-5",
      "sonnet-5",
      "haiku-4-5",
    ]);
  });

  it("keeps the whole name when there is no shared prefix", () => {
    expect(shortModelName("qwen3-coder:32b", null)).toBe("qwen3-coder-32b");
  });

  it("keeps the whole name when this model does not carry the prefix", () => {
    // Unreachable through the service — a prefix is only found when every model has it — and
    // asserted anyway, because the alternative to this branch is a `slice` that silently
    // removes the first seven characters of an unrelated name.
    expect(shortModelName("gpt-5-codex", "claude")).toBe("gpt-5-codex");
  });

  it("does not strip a prefix that is only the start of the first segment", () => {
    expect(shortModelName("claudia-mini-1", "claude")).toBe("claudia-mini-1");
  });
});

describe("suggesting a name", () => {
  it("suggests the short name when nothing has taken it", () => {
    const suggested = suggestAliasName("opus-5", new Set());

    expect(suggested).toBe("opus-5");
    isStorable(suggested as string);
  });

  it("suffixes past a name the workspace already has", () => {
    expect(suggestAliasName("opus-5", new Set(["opus-5"]))).toBe("opus-5-2");
    expect(suggestAliasName("opus-5", new Set(["opus-5", "opus-5-2"]))).toBe("opus-5-3");
  });

  it("starts at two, because the plain name is the first", () => {
    // The same argument `copyName` makes for `-copy-2`: a variant numbered 1 reads as though
    // it came before the unnumbered one.
    expect(suggestAliasName("opus-5", new Set(["opus-5"]))).not.toBe("opus-5-1");
  });

  it("answers null for a base that folded away to nothing", () => {
    expect(suggestAliasName("", new Set())).toBeNull();
  });

  it("shortens a base that would not fit, and keeps the suffix whole", () => {
    const long = "a".repeat(MAX_ALIAS_LENGTH + 20);
    const plain = suggestAliasName(long, new Set());

    expect(plain).toHaveLength(MAX_ALIAS_LENGTH);
    isStorable(plain as string);

    const suffixed = suggestAliasName(long, new Set([plain as string]));

    // The suffix is what makes the name unique, so the base gives way to it rather than the
    // other way round.
    expect(suffixed).toHaveLength(MAX_ALIAS_LENGTH);
    expect(suffixed?.endsWith("-2")).toBe(true);
    isStorable(suffixed as string);
  });

  it("does not leave a trailing hyphen when the cut lands on one", () => {
    const base = `${"a".repeat(MAX_ALIAS_LENGTH - 1)}-tail`;

    isStorable(suggestAliasName(base, new Set()) as string);
  });

  it("gives up rather than inventing an unbounded ordinal", () => {
    const taken = new Set(["opus-5"]);

    for (let ordinal = 2; ordinal <= MAX_NAME_ORDINAL; ordinal += 1) {
      taken.add(`opus-5-${ordinal.toString()}`);
    }

    // Null is the honest answer and the row arrives with an empty cell. A loop with no end
    // here would be one over a set somebody else controls.
    expect(suggestAliasName("opus-5", taken)).toBeNull();
  });

  it("suggests a distinct name for every model of a connection", () => {
    // The property the wizard rests on: ticking every row must produce a submittable request.
    const models = [...ANTHROPIC, "claude-opus-5-latest", "claude-opus-5-latest"];
    const prefix = sharedModelPrefix(models.map(foldModelId));
    const taken = new Set(["opus-5"]);
    const suggested: string[] = [];

    for (const model of models) {
      const name = suggestAliasName(shortModelName(model, prefix), taken);

      expect(name).not.toBeNull();
      isStorable(name as string);
      taken.add(name as string);
      suggested.push(name as string);
    }

    expect(new Set(suggested).size).toBe(suggested.length);
    // And it steered clear of the one the workspace already had.
    expect(suggested).not.toContain("opus-5");
    expect(suggested).toContain("opus-5-2");
  });
});
