import type { ResolvedPrice } from "./price";
import { PRICE_CACHE_MAX_ENTRIES, PRICE_CACHE_TTL_MS, PricingCache } from "./pricing.cache";

/**
 * The cache's three properties, and the two ways it could be quietly wrong.
 *
 * *Quietly*, because a cache that never hits still answers correctly — every assertion about
 * *what* a price is would pass with this class replaced by a stub returning `undefined`. What
 * has to be asserted here is the part only this class can get wrong: that a remembered miss is
 * not the same as nothing remembered, that a save drops what a family row could have changed,
 * and that two workspaces asking about one model are two questions.
 *
 * Time is faked rather than waited on. The TTL is a shipped constant and this suite asserts
 * against that constant rather than against a shortened copy — a cache configured down for a
 * test is not the cache the deployment runs.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const ELSEWHERE = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

/** A resolved price, at the shape's simplest — the contents are not this suite's subject. */
const PRICE: ResolvedPrice = {
  billingMode: "token",
  inputCentsPer1m: "1000.0000",
  outputCentsPer1m: "5000.0000",
  provenance: {
    source: "bundled",
    catalogVersion: "2026-08-15+litellm.70d51a1",
    effectiveAt: new Date("2026-08-15T01:16:59.000Z"),
  },
};

describe("the price cache", () => {
  let cache: PricingCache;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-22T09:00:00.000Z"));
    cache = new PricingCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("remembering", () => {
    it("answers nothing for a key it was never told about", () => {
      expect(cache.get(WORKSPACE, "anthropic", "claude-fable-5")).toBeUndefined();
    });

    it("answers with what it was told", () => {
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);

      expect(cache.get(WORKSPACE, "anthropic", "claude-fable-5")).toEqual({ price: PRICE });
    });

    it("remembers a miss, distinctly from remembering nothing", () => {
      // The whole reason `get` answers a wrapper. Mockup 21's `gpt5-experiments` is a real row
      // on a real page; a cache that stored only hits would re-query for it on every render,
      // which would make the uncovered model the slowest cell in the table.
      cache.set(WORKSPACE, null, "gpt-5.2-preview", undefined);

      expect(cache.get(WORKSPACE, null, "gpt-5.2-preview")).toEqual({ price: undefined });
      expect(cache.get(WORKSPACE, null, "never-asked")).toBeUndefined();
    });

    it("tells an unbound alias apart from a model of some kind", () => {
      // A null kind is mockup 21's alias with no provider, and it resolves to nothing. If it
      // shared a key with a real kind, one row of that table would show another row's price.
      cache.set(WORKSPACE, null, "gpt-5.2-preview", undefined);
      cache.set(WORKSPACE, "openai_compatible", "gpt-5.2-preview", PRICE);

      expect(cache.get(WORKSPACE, null, "gpt-5.2-preview")).toEqual({ price: undefined });
      expect(cache.get(WORKSPACE, "openai_compatible", "gpt-5.2-preview")).toEqual({
        price: PRICE,
      });
    });

    it("keeps two workspaces' answers apart", () => {
      // An override makes one model cost two different things in two workspaces, which is the
      // entire point of overrides — so the workspace has to be part of the key rather than
      // part of the query only.
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);

      expect(cache.get(ELSEWHERE, "anthropic", "claude-fable-5")).toBeUndefined();
    });

    it("replaces what it was told before, rather than keeping both", () => {
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", undefined);

      expect(cache.get(WORKSPACE, "anthropic", "claude-fable-5")).toEqual({ price: undefined });
      expect(cache.size).toBe(1);
    });
  });

  describe("expiring", () => {
    it("still answers just before the TTL is up", () => {
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);
      jest.advanceTimersByTime(PRICE_CACHE_TTL_MS - 1);

      expect(cache.get(WORKSPACE, "anthropic", "claude-fable-5")).toEqual({ price: PRICE });
    });

    it("forgets once the TTL is up", () => {
      // The bound on how long a deployment can keep serving the previous catalog snapshot's
      // numbers after a migration imported a new one. Nothing tells this process about that
      // import, so this is the whole of the guarantee.
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);
      jest.advanceTimersByTime(PRICE_CACHE_TTL_MS);

      expect(cache.get(WORKSPACE, "anthropic", "claude-fable-5")).toBeUndefined();
    });

    it("drops the expired entry rather than leaving it to be evicted", () => {
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);
      jest.advanceTimersByTime(PRICE_CACHE_TTL_MS);
      cache.get(WORKSPACE, "anthropic", "claude-fable-5");

      expect(cache.size).toBe(0);
    });

    it("expires a remembered miss too", () => {
      // Otherwise a model that was uncovered when the catalog was last imported would read `—`
      // for the life of the process, whatever the catalog later said.
      cache.set(WORKSPACE, "anthropic", "claude-opus-6", undefined);
      jest.advanceTimersByTime(PRICE_CACHE_TTL_MS);

      expect(cache.get(WORKSPACE, "anthropic", "claude-opus-6")).toBeUndefined();
    });
  });

  describe("invalidating one workspace", () => {
    it("drops every one of its entries, not only the key that was written", () => {
      // The decision this class exists to get right. An override may be a family row —
      // `('openai_compatible', '*') → free` — which changes the answer for models whose names
      // it never mentions, so a per-key drop would leave exactly those stale.
      cache.set(WORKSPACE, "openai_compatible", "llama-4-maverick", PRICE);
      cache.set(WORKSPACE, "openai_compatible", "mistral-large", PRICE);
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);

      expect(cache.invalidate(WORKSPACE)).toBe(3);
      expect(cache.get(WORKSPACE, "openai_compatible", "llama-4-maverick")).toBeUndefined();
      expect(cache.get(WORKSPACE, "anthropic", "claude-fable-5")).toBeUndefined();
    });

    it("leaves every other workspace's entries alone", () => {
      // An override is one workspace's statement about its own invoice and cannot change what
      // another one pays, so dropping their entries would be work with no correctness in it.
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);
      cache.set(ELSEWHERE, "anthropic", "claude-fable-5", PRICE);

      cache.invalidate(WORKSPACE);

      expect(cache.get(ELSEWHERE, "anthropic", "claude-fable-5")).toEqual({ price: PRICE });
    });

    it("drops nothing, and says so, for a workspace with nothing remembered", () => {
      expect(cache.invalidate(WORKSPACE)).toBe(0);
    });

    it("is not fooled by a workspace id that another one starts with", () => {
      // The keys are prefix-matched, so an id that is a prefix of another id would take the
      // longer one's entries with it — a workspace losing its cache because of somebody else's
      // save. The separator is what prevents it, and this is the assertion that would notice
      // if it were ever dropped.
      cache.set("org", "anthropic", "claude-fable-5", PRICE);
      cache.set("org-two", "anthropic", "claude-fable-5", PRICE);

      expect(cache.invalidate("org")).toBe(1);
      expect(cache.get("org-two", "anthropic", "claude-fable-5")).toEqual({ price: PRICE });
    });
  });

  describe("invalidating the catalog", () => {
    it("drops every workspace's entries", () => {
      // A bundled snapshot applies to everybody, so nothing narrower would be correct. Nothing
      // calls this today — the import is a Flyway migration in another container — and it is
      // the binding #598's in-process refresh replaces a comment with.
      cache.set(WORKSPACE, "anthropic", "claude-fable-5", PRICE);
      cache.set(ELSEWHERE, "anthropic", "claude-fable-5", PRICE);

      expect(cache.clear()).toBe(2);
      expect(cache.size).toBe(0);
    });
  });

  describe("staying bounded", () => {
    it("does not grow past the bound, however many keys it is asked about", () => {
      // The model half of a key is whatever a caller asked about, so a workspace with a typo
      // in a route could otherwise mint a fresh key per request for the life of the process.
      for (let index = 0; index <= PRICE_CACHE_MAX_ENTRIES; index += 1) {
        cache.set(WORKSPACE, "anthropic", `model-${index}`, PRICE);
      }

      expect(cache.size).toBe(PRICE_CACHE_MAX_ENTRIES);
    });

    it("evicts the oldest first, and keeps what was just written", () => {
      for (let index = 0; index <= PRICE_CACHE_MAX_ENTRIES; index += 1) {
        cache.set(WORKSPACE, "anthropic", `model-${index}`, PRICE);
      }

      expect(cache.get(WORKSPACE, "anthropic", "model-0")).toBeUndefined();
      expect(cache.get(WORKSPACE, "anthropic", `model-${PRICE_CACHE_MAX_ENTRIES}`)).toEqual({
        price: PRICE,
      });
    });

    it("re-writing a key moves it to the back of the eviction order", () => {
      // Without the delete-then-set in `set`, refreshing a hot key would leave it at its
      // original position and evict it ahead of entries written long afterwards.
      cache.set(WORKSPACE, "anthropic", "hot", PRICE);
      for (let index = 0; index < PRICE_CACHE_MAX_ENTRIES - 1; index += 1) {
        cache.set(WORKSPACE, "anthropic", `model-${index}`, PRICE);
      }
      cache.set(WORKSPACE, "anthropic", "hot", PRICE);
      cache.set(WORKSPACE, "anthropic", "one-too-many", PRICE);

      expect(cache.get(WORKSPACE, "anthropic", "hot")).toEqual({ price: PRICE });
      expect(cache.get(WORKSPACE, "anthropic", "model-0")).toBeUndefined();
    });

    it("sacrifices expired entries before live ones", () => {
      // Dropping an expired entry costs nothing, so it happens first. Only if that is not
      // enough does anything still reusable go.
      for (let index = 0; index < PRICE_CACHE_MAX_ENTRIES; index += 1) {
        cache.set(WORKSPACE, "anthropic", `stale-${index}`, PRICE);
      }
      jest.advanceTimersByTime(PRICE_CACHE_TTL_MS);
      cache.set(WORKSPACE, "anthropic", "fresh", PRICE);

      expect(cache.size).toBe(1);
      expect(cache.get(WORKSPACE, "anthropic", "fresh")).toEqual({ price: PRICE });
    });
  });
});
