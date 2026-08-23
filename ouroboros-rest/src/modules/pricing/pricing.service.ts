/**
 * `PricingService` — the one answer to *what does this model cost?*, with its provenance
 * attached ([#586](https://github.com/NobuData/ouroboros/issues/586)).
 *
 * ## Why there is exactly one of these
 *
 * Three other tickets need this resolution and none of them may re-derive it. DASH-J.4
 * ([#92](https://github.com/NobuData/ouroboros/issues/92)) prices `token_usage.cost_cents`,
 * Z.5 ([#198](https://github.com/NobuData/ouroboros/issues/198)) totals route spend, AB.4
 * ([#210](https://github.com/NobuData/ouroboros/issues/210)) reports it, and CH.5
 * ([#588](https://github.com/NobuData/ouroboros/issues/588)) renders the registry column.
 * Four implementations of "override beats bundled, exact beats family" would be four sets of
 * numbers that disagree inside one report — and the number they disagree about is money. So
 * this is the internal contract those four consume: {@link PricingService.resolve} for one
 * model, {@link PricingService.resolveMany} for a list, and `price.ts`'s `renderPrice` for the
 * cell. `PricingModule` exports this provider and nothing else.
 *
 * ## The four rules it keeps
 *
 *   * **Never say a number you cannot source.** An uncovered model resolves to `undefined`,
 *     not to a zero — see `price.ts`, where the absence of an "unknown" member makes that
 *     structural rather than careful.
 *   * **The precedence is the database's.** `ouroboros.model_price()` decides it, in one
 *     indexed lookup; nothing here re-sorts or re-filters what it returned.
 *   * **The workspace is the session's.** Every method takes the organization id the tenant
 *     guard resolved, and it is the cache key's first part as well as the query's first
 *     argument — two workspaces asking about one model are two questions.
 *   * **A write invalidates before it answers.** The cache is dropped inside the same call
 *     that persisted the change, so no caller can observe the write and the stale price in
 *     that order.
 *
 * ## Where the argument order comes from
 *
 * `resolve(connectionKind, modelId, organizationId)` puts the workspace last, which is the
 * opposite of every repository in this service. That is deliberate and it is the ticket's:
 * the signature is published in #92's, #198's and #210's plans, and matching it exactly is
 * worth more than matching a house convention that exists to make an org predicate hard to
 * forget in a `where` clause. The repository below keeps the house order, and that is the
 * layer where forgetting it would matter.
 */

import { Injectable } from "@nestjs/common";

import { pageOf, windowOf, type Page, type PageQuery } from "../tenancy/pagination";
import { priceFromRow, type ModelKey, type ResolvedPrice } from "./price";
import { PricingCache } from "./pricing.cache";
import type { DeletePriceOverrideQuery, PutPriceOverrideDto } from "./pricing.dto";
import { overrideNotFound } from "./pricing.errors";
import { PricingRepository } from "./pricing.repository";
import {
  modelPriceResource,
  priceOverrideResource,
  type ModelPriceResource,
  type PriceOverrideResource,
} from "./resources";

@Injectable()
export class PricingService {
  /**
   * @param prices - The statements against `model_prices`.
   * @param cache - The short-TTL memory in front of them.
   */
  constructor(
    private readonly prices: PricingRepository,
    private readonly cache: PricingCache,
  ) {}

  /**
   * What one model costs this workspace.
   *
   * The published internal contract — see this file's header for the argument order.
   *
   * @param connectionKind - The provider kind, in any casing, or null for an unbound alias.
   *   Folded before it is looked up, because `Anthropic` and `anthropic` are one kind and a
   *   lookup that missed on a capital would render `—` for a priced model.
   * @param modelId - The model identifier, as the vendor spells it. Trimmed and never folded.
   * @param organizationId - The workspace, from the tenant context. Never from a request body.
   * @returns The price, with provenance, or `undefined` when the catalog covers nothing for
   *   the pair. `undefined` is the `—` cell and is **never** a free one.
   */
  async resolve(
    connectionKind: string | null,
    modelId: string,
    organizationId: string,
  ): Promise<ResolvedPrice | undefined> {
    const key = normalize({ connectionKind, modelId });

    const remembered = this.cache.get(organizationId, key.connectionKind, key.modelId);
    if (remembered !== undefined) {
      return remembered.price;
    }

    const row = await this.prices.resolve(organizationId, key.connectionKind, key.modelId);
    const price = row === undefined ? undefined : priceFromRow(row);

    this.cache.set(organizationId, key.connectionKind, key.modelId, price);

    return price;
  }

  /**
   * The same question for a whole alias list — **one query at most**, and none when the cache
   * already holds every answer.
   *
   * The registry table's eight rows are eight lookups, and the ticket's criterion is that they
   * cost one query rather than eight. Cached pairs are answered from memory and the remainder
   * — deduplicated, because a list may name one model twice — go to the database in a single
   * statement.
   *
   * @param models - The pairs to price, in the order the answers are wanted. Casing and
   *   spacing are normalised exactly as {@link resolve} normalises them.
   * @param organizationId - The workspace, from the tenant context.
   * @returns One entry per requested pair, in the requested order; `undefined` where the
   *   catalog covers nothing.
   */
  async resolveMany(
    models: readonly ModelKey[],
    organizationId: string,
  ): Promise<(ResolvedPrice | undefined)[]> {
    const keys = models.map(normalize);

    // The answers, by lookup key. Assembled here rather than read back out of the cache at the
    // end: an entry that expired between being written and being re-read would come back as
    // "no price", which is the `—` cell shown for a model that has one. What this method
    // returns is what it resolved, and the cache is only ever a shortcut on the way.
    const answers = new Map<string, ResolvedPrice | undefined>();

    // What is not already known, each distinct pair once: a list naming one model eight times
    // must not become eight lateral lookups inside the one query either.
    const outstanding = new Map<string, ModelKey>();
    for (const key of keys) {
      const identity = lookupKey(key);
      if (answers.has(identity) || outstanding.has(identity)) {
        continue;
      }

      const remembered = this.cache.get(organizationId, key.connectionKind, key.modelId);
      if (remembered === undefined) {
        outstanding.set(identity, key);
      } else {
        answers.set(identity, remembered.price);
      }
    }

    if (outstanding.size > 0) {
      const asked = [...outstanding.values()];
      const rows = await this.prices.resolveMany(organizationId, asked);

      asked.forEach((key, index) => {
        const row = rows[index];
        const price = row === undefined ? undefined : priceFromRow(row);

        answers.set(lookupKey(key), price);
        this.cache.set(organizationId, key.connectionKind, key.modelId, price);
      });
    }

    return keys.map((key) => answers.get(lookupKey(key)));
  }

  /**
   * The same question, as the contract publishes it — pair, price, provenance and rendered
   * cell.
   *
   * The mapping is here rather than in a controller because nothing serves it over HTTP yet:
   * CH.5 ([#588](https://github.com/NobuData/ouroboros/issues/588)) owns the registry table's
   * payload, and this is the shape it will embed. Exposing the resource form now is what stops
   * that ticket from writing a second mapper — the same reason this service exists at all.
   *
   * @param models - The pairs to price.
   * @param organizationId - The workspace, from the tenant context.
   * @returns One resource per requested pair, in the requested order.
   */
  async priceModels(
    models: readonly ModelKey[],
    organizationId: string,
  ): Promise<ModelPriceResource[]> {
    const keys = models.map(normalize);
    const prices = await this.resolveMany(keys, organizationId);

    return keys.map((key, index) => modelPriceResource(key, prices[index]));
  }

  /**
   * The corrections this workspace has recorded, one page at a time.
   *
   * The bundled catalog is not in this listing and is not meant to be: it is the same hundred
   * and twenty-nine rows for everybody, and *what have we changed* is a question about a
   * workspace's own list.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param query - The window. Defaults per the #31 convention.
   * @returns The page, ordered by the lookup key.
   */
  async listOverrides(
    organizationId: string,
    query: PageQuery,
  ): Promise<Page<PriceOverrideResource>> {
    const window = windowOf(query);
    const { rows, total } = await this.prices.listOverrides(organizationId, window);

    return pageOf(
      rows.map((row) => priceOverrideResource(row, priceFromRow(row))),
      total,
      window,
    );
  }

  /**
   * Record this workspace's own price for one model, and drop what the cache believed.
   *
   * The invalidation is *before the answer returns*, not after, and it drops the whole
   * workspace rather than the key that was written — `pricing.cache.ts`'s decision 2 explains
   * why a per-key drop would be the subtly wrong one. Together those are the ticket's *a stale
   * price cannot survive a save*: by the time a caller has this method's return value, no
   * subsequent read in this process can answer from the superseded number.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param body - The validated body. Its amount rules have already been checked against its
   *   billing mode by the pipe, so what reaches the column is a row V012 will accept.
   * @returns The correction as stored, trigger stamps and rendered cell included.
   */
  async saveOverride(
    organizationId: string,
    body: PutPriceOverrideDto,
  ): Promise<PriceOverrideResource> {
    const row = await this.prices.upsertOverride(
      organizationId,
      foldKind(body.connectionKind),
      body.modelId.trim(),
      body.billingMode,
      {
        inputCentsPer1m: body.inputCentsPer1m ?? null,
        outputCentsPer1m: body.outputCentsPer1m ?? null,
      },
    );

    this.cache.invalidate(organizationId);

    return priceOverrideResource(row, priceFromRow(row));
  }

  /**
   * Withdraw this workspace's correction, so the bundled catalog answers again.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @param query - Which correction, validated.
   * @returns Nothing — the operation answers `204`. What was removed is not echoed back,
   *   because a client that asked for it gone has no use for it and the next `GET` is the
   *   honest way to see what is left.
   * @throws {NotFoundError} `404 price_override_not_found` when this workspace had no
   *   correction for the pair. Deliberately not a silent success — see `pricing.errors.ts`.
   */
  async removeOverride(organizationId: string, query: DeletePriceOverrideQuery): Promise<void> {
    const connectionKind = foldKind(query.connectionKind);
    const modelId = query.modelId.trim();

    const removed = await this.prices.deleteOverride(organizationId, connectionKind, modelId);

    if (removed === undefined) {
      throw overrideNotFound(connectionKind, modelId);
    }

    this.cache.invalidate(organizationId);
  }

  /**
   * Forget every remembered price in the process — the catalog-import seam.
   *
   * Nothing calls it today: the bundled snapshot is applied by a repeatable Flyway migration in
   * another container, so the process that would need telling is not the process doing the
   * telling. CJ.1 ([#598](https://github.com/NobuData/ouroboros/issues/598)) is the ticket that
   * refreshes a catalog from inside this service, and this is the call it makes; until then
   * `PRICE_CACHE_TTL_MS` is what bounds the staleness, and `pricing.cache.ts` says so plainly
   * rather than implying an invalidation that does not happen.
   *
   * @returns How many entries were dropped.
   */
  invalidateCatalog(): number {
    return this.cache.clear();
  }
}

/**
 * A pair as this service looks it up: the kind folded, the identifier trimmed.
 *
 * Normalisation is here rather than in the DTO because {@link PricingService.resolve} is an
 * internal contract as much as an HTTP one — #92 and #198 will call it with values read out of
 * `token_usage.provider`, which is folded, and `runs.model`, which is not — and a rule that
 * lived in a validation decorator would apply to exactly the callers that do not use it.
 *
 * A kind that is blank after trimming becomes `null`, which resolves to nothing: V012 requires
 * at least one character, so an empty kind could not match a row, and calling it *unbound* says
 * what it is instead of leaving a query to discover it.
 *
 * @param key - The pair as a caller wrote it.
 * @returns The pair as the lookup and the cache key use it.
 */
function normalize(key: ModelKey): ModelKey {
  const connectionKind = key.connectionKind === null ? null : foldKind(key.connectionKind);

  return {
    connectionKind: connectionKind === "" ? null : connectionKind,
    modelId: key.modelId.trim(),
  };
}

/**
 * A provider kind as the column stores it.
 *
 * @param kind - The kind, in any casing.
 * @returns It, trimmed and folded to lower case.
 */
function foldKind(kind: string): string {
  return kind.trim().toLowerCase();
}

/**
 * A pair as a deduplication key.
 *
 * Only ever compared with itself, so the separator has one requirement — that neither part can
 * contain it. `NUL` satisfies it for the reason `pricing.cache.ts` gives.
 *
 * @param key - A normalised pair.
 * @returns The key.
 */
function lookupKey(key: ModelKey): string {
  return `${key.connectionKind ?? ""} ${key.modelId}`;
}
