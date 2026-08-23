/**
 * The short-TTL price cache — the ticket's *cache keyed `(org, kind, model)`, invalidated on
 * override writes and catalog import* ([#586](https://github.com/NobuData/ouroboros/issues/586)).
 *
 * A registry table is eight aliases on one page, a route resolution asks for one model per
 * hop, and DASH-J.4's accounting will ask for the same handful of models on every ledger row.
 * All of those questions have the same answer for as long as nobody edits a price, and the
 * answer costs a round trip. That is what this collapses.
 *
 * ---------------------------------------------------------------------------
 * **Three decisions, each of which is a way this could have been wrong.**
 *
 * **1. Misses are cached, not only hits.** The uncovered model is a real cell on that page —
 * mockup 21's `gpt5-experiments` — and a cache that stored only hits would re-query for it on
 * every render, which is the row that would end up slowest. A cached miss is stored as an
 * entry holding `undefined`, distinct from having no entry at all; see {@link CachedPrice}.
 *
 * **2. Invalidation is per *workspace*, never per key.** An override may be a family row —
 * `('openai_compatible', '*') → free` is the row that makes mockup 21's `llama-4-maverick`
 * read `$0` — and a family row changes the answer for models whose names it never mentions.
 * Dropping only the key that was written would leave every one of those stale, which is
 * precisely the *a stale price cannot survive a save* criterion, failed in the way that is
 * hardest to see. Dropping the workspace is coarse, correct, and costs one page's worth of
 * re-reads.
 *
 * **3. The TTL is what covers the bundled catalog, because nothing in this process imports
 * it.** A snapshot bump is a repeatable Flyway migration applied by `ouroboros-db` — out of
 * band, in another container, with no way to call a method here. {@link PricingCache.clear}
 * is the seam for the in-process refresh #598 will add; until then
 * {@link PRICE_CACHE_TTL_MS} is the honest bound on how long a deployment can keep serving
 * the previous snapshot's numbers, and it is short for that reason rather than tuned for a
 * hit rate.
 */

import { Injectable } from "@nestjs/common";

import type { ResolvedPrice } from "./price";

/**
 * How long a resolved price is reused — thirty seconds.
 *
 * Short enough that a catalog imported by a migration is picked up within half a minute
 * without anything telling this process about it (decision 3 above), and long enough that a
 * page render, a poll and the route resolutions behind them share one answer. An override
 * write does not wait for it: that path invalidates explicitly, which is what makes the
 * ticket's *immediate* criterion true rather than *within thirty seconds*.
 */
export const PRICE_CACHE_TTL_MS = 30_000;

/**
 * How many entries are kept before the oldest are dropped.
 *
 * A bound rather than a target. The keys are `(workspace, kind, model)`, and the model half is
 * whatever a caller asked about — a workspace with a typo in a route could otherwise mint a
 * fresh key per request and grow this map for as long as the process lives. Eviction is
 * insertion-ordered, which `Map` gives for free and which is the right order here: a cache
 * this small is a burst absorber, not a working set to be reasoned about with an LRU.
 */
export const PRICE_CACHE_MAX_ENTRIES = 4_096;

/**
 * The separator between the three parts of a key.
 *
 * `NUL`, because it is the one character none of the three parts can contain: a provider kind
 * is `[a-z0-9._-]` or `*`, a model identifier is bounded text from a vendor, and a workspace
 * id is a `gen_random_uuid()::text`. A separator any part could hold would let two different
 * triples share a key, which is a price shown for the wrong model.
 */
const KEY_SEPARATOR = "\u0000";

/** One remembered answer, and when it stops being reusable. */
interface CacheEntry {
  /** The resolved price, or `undefined` for a remembered miss — see decision 1 above. */
  readonly price: ResolvedPrice | undefined;
  /** `Date.now()` after which this entry is no longer served. */
  readonly expiresAt: number;
}

/**
 * What {@link PricingCache.get} answers with.
 *
 * A wrapper rather than `ResolvedPrice | undefined`, because those two are three states here
 * and the difference between two of them decides whether a query is issued: *nothing
 * remembered* (query), *remembered that there is no price* (do not query, render `—`), and
 * *remembered a price*. Collapsing the first two is how a cached miss turns into a query
 * anyway.
 */
export interface CachedPrice {
  /** The remembered answer — `undefined` when the catalog covers nothing for this key. */
  readonly price: ResolvedPrice | undefined;
}

/**
 * The cache itself.
 *
 * **No constructor, and therefore nothing to configure per instance.** The TTL and the bound
 * are module constants that the application and its suites share, which is deliberate: a
 * suite that could shorten the TTL would be asserting against a cache the deployment never
 * runs, and the two properties worth asserting — that an entry expires, and that the map stays
 * bounded — are both reachable without it, through fake timers and through inserting past the
 * bound. It also keeps Nest's injector out of an argument list it would try to resolve.
 */
@Injectable()
export class PricingCache {
  /** Key → entry, in insertion order, which is also the eviction order. */
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * What was remembered for this key, if anything still is.
   *
   * @param organizationId - The workspace asking. Part of the key because an override makes
   *   the same model cost different things in two workspaces.
   * @param connectionKind - The provider kind, or null for an unbound alias.
   * @param modelId - The model identifier.
   * @returns The remembered answer — which may be a remembered *miss* — or `undefined` when
   *   nothing is remembered or what was remembered has expired.
   */
  get(
    organizationId: string,
    connectionKind: string | null,
    modelId: string,
  ): CachedPrice | undefined {
    const key = cacheKey(organizationId, connectionKind, modelId);
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      // Dropped rather than left to the eviction bound: an expired entry that stays in the map
      // holds a key that a later `set` would then re-insert at the *old* position, which would
      // make it evictable before entries written long after it.
      this.entries.delete(key);
      return undefined;
    }

    return { price: entry.price };
  }

  /**
   * Remember an answer, miss included.
   *
   * @param organizationId - The workspace.
   * @param connectionKind - The provider kind, or null.
   * @param modelId - The model identifier.
   * @param price - What was resolved, or `undefined` when nothing was.
   */
  set(
    organizationId: string,
    connectionKind: string | null,
    modelId: string,
    price: ResolvedPrice | undefined,
  ): void {
    const key = cacheKey(organizationId, connectionKind, modelId);

    // Deleted first so a re-write moves the key to the back of the insertion order. Without
    // this, refreshing a hot key would leave it at its original position and evict it ahead of
    // colder ones.
    this.entries.delete(key);
    this.entries.set(key, { price, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });

    this.evict();
  }

  /**
   * Forget everything this workspace was told — the override-write path.
   *
   * The whole workspace rather than the key that was written, for the family-row reason in
   * decision 2 above. Entries for *other* workspaces are untouched, because an override is one
   * workspace's statement and cannot change what another one pays.
   *
   * @param organizationId - The workspace whose prices just changed.
   * @returns How many entries were dropped. Returned so a suite can assert that a save really
   *   reached the cache rather than that a later read happened to miss.
   */
  invalidate(organizationId: string): number {
    const prefix = `${organizationId}${KEY_SEPARATOR}`;
    let dropped = 0;

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        dropped += 1;
      }
    }

    return dropped;
  }

  /**
   * Forget everything — the catalog-import path.
   *
   * A bundled snapshot applies to every workspace, so nothing narrower would be correct. It is
   * the seam described in decision 3: nothing in this process calls it today, because the
   * import is a Flyway migration in another container, and #598's in-process refresh is what
   * will.
   *
   * @returns How many entries were dropped.
   */
  clear(): number {
    const dropped = this.entries.size;
    this.entries.clear();

    return dropped;
  }

  /** How many entries are held, expired ones included. For the suite and for nothing else. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Bring the map back under {@link PRICE_CACHE_MAX_ENTRIES}.
   *
   * Expired entries go first — they are free to drop and dropping them is not a loss — and
   * only if that is not enough does anything still valid go, oldest first.
   */
  private evict(): void {
    if (this.entries.size <= PRICE_CACHE_MAX_ENTRIES) {
      return;
    }

    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    for (const key of this.entries.keys()) {
      if (this.entries.size <= PRICE_CACHE_MAX_ENTRIES) {
        break;
      }
      this.entries.delete(key);
    }
  }
}

/**
 * The three parts of a key, as one string.
 *
 * The workspace leads so {@link PricingCache.invalidate} can find a workspace's entries by
 * prefix — the one operation that has to enumerate a subset, and the reason the key is a
 * string rather than a nested map.
 *
 * A null provider kind is the empty string, which no real kind can be: V012's
 * `model_prices_match_provider_kind_format` requires at least one character, so *unbound* and
 * *some kind* cannot collide.
 *
 * @param organizationId - The workspace.
 * @param connectionKind - The provider kind, or null.
 * @param modelId - The model identifier.
 * @returns The key.
 */
function cacheKey(organizationId: string, connectionKind: string | null, modelId: string): string {
  return [organizationId, connectionKind ?? "", modelId].join(KEY_SEPARATOR);
}
