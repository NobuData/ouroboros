import {
  CLOUD_PROVIDER_KINDS,
  LOCAL_PROVIDER_KINDS,
  PROVIDER_KINDS,
  isCloudProvider,
  isLeasable,
} from "./providers";

/**
 * The policy, as data.
 *
 * Five kinds and one line between them, and both halves of that line are worth an assertion
 * rather than a reading: that every cloud kind is refused, and that the two lists are
 * disjoint and cover everything. A kind that appeared in neither would be a lease request
 * that reached the policy and fell through it, which is the shape of a security bug that a
 * "does the happy path work" suite never sees.
 *
 * The spellings are asserted too. They are AC.1's registry keys and `ouroboros-db` already
 * writes them into `model_prices.match_provider_kind` (V012), so `openai_compatible` with an
 * underscore is not a style choice here — a different spelling would be a lease for a
 * provider the price catalog has never heard of.
 */

describe("the vocabulary", () => {
  it("is the five MVP kinds, spelled as ouroboros-db spells them", () => {
    expect([...PROVIDER_KINDS].toSorted()).toEqual([
      "anthropic",
      "copilot",
      "cursor",
      "ollama",
      "openai_compatible",
    ]);
  });

  it.each([...PROVIDER_KINDS])("classifies %s as exactly one of the two", (kind) => {
    // The property that matters: no kind is both, and none is neither. A kind in neither
    // list would reach the policy and be treated as leasable by a `!isCloudProvider` written
    // somewhere later.
    expect(isLeasable(kind) !== isCloudProvider(kind)).toBe(true);
  });

  it("covers the request vocabulary with the two lists and nothing else", () => {
    expect([...PROVIDER_KINDS].toSorted()).toEqual(
      [...LOCAL_PROVIDER_KINDS, ...CLOUD_PROVIDER_KINDS].toSorted(),
    );
  });
});

describe("what may be leased", () => {
  it.each([...LOCAL_PROVIDER_KINDS])(
    "permits %s, which is reached without a credential",
    (kind) => {
      expect(isLeasable(kind)).toBe(true);
    },
  );

  it.each([...CLOUD_PROVIDER_KINDS])("refuses %s, whose connection details are a key", (kind) => {
    expect(isLeasable(kind)).toBe(false);
  });

  it("keeps ollama leasable, because that adapter only ever talks to a local daemon", () => {
    // V012's narrowing 3 states the same fact from the pricing side: every model reached
    // through Ollama is local by construction, which is why `('ollama', '*') → free` is a
    // statement about the kind. Here it is why an address is safe to hand over.
    expect(isLeasable("ollama")).toBe(true);
  });

  it("keeps openai_compatible leasable, and leaves locality to the deployment", () => {
    // The same adapter fronts a vLLM on somebody's own GPU and `api.openai.com`, so this
    // `true` is permission to look rather than a grant: `local.providers.ts` still has to
    // find an address the operator declared, and `lease.spec.ts` asserts the `404` when
    // nobody has.
    expect(isLeasable("openai_compatible")).toBe(true);
  });
});

describe("recognising a cloud kind in a string that is not yet a kind", () => {
  it.each([...CLOUD_PROVIDER_KINDS])("recognises %s", (kind) => {
    expect(isCloudProvider(kind)).toBe(true);
  });

  it.each(["ollama", "openai_compatible", "", "anthropic-eu", "ANTHROPIC"])(
    "does not recognise %s",
    (candidate) => {
      // `configuration.ts` asks this of a raw environment value, so the answer has to be
      // `false` for everything that is not exactly one of the three — including a near miss,
      // which is refused a line later as *not a provider kind* rather than being waved
      // through as leasable.
      expect(isCloudProvider(candidate)).toBe(false);
    },
  );
});
