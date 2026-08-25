import "server-only";

/**
 * Everything the provider cards read ([#228](https://github.com/NobuData/ouroboros/issues/228)).
 *
 * Five calls and then one or two per card, composed here for the reason `app/models/data.ts` exists:
 * the route stays three lines, the composition is a function that can be tested against a
 * stub, and the screen is handed one object rather than issuing calls of its own. The property
 * every reader in this module keeps — **one failed read is one degraded region, never a blank
 * page** — is kept per card here: a catalog that could not be read leaves every key row under
 * its fallback label, a spend that could not be read leaves every meter reading *no spend
 * recorded*, and one card's models failing says so on that card and nowhere else.
 *
 * ### Two rounds, and the second fans out
 *
 * The listing, the catalog, the health strip, the month and the registry's aliases are
 * independent and read at once. The models are per connection —
 * `GET /api/v1/providers/{id}/models` takes one — so they cannot start until the listing has
 * answered, and then they all start together, each pulling kind's pulls beside its models
 * (AE.4, [#230](https://github.com/NobuData/ouroboros/issues/230)). A grid of five cards
 * costs eleven requests in two round trips rather than five sequential ones, and a workspace
 * with no connections costs five and asks for no models at all.
 *
 * The aliases are one read for the whole grid rather than one per card, because the listing
 * that names an alias's connection is the registry's and takes no filter; each card picks
 * its own dependents out of it (`cards.ts`'s `dependentsOf`). They exist for AE.3's
 * ([#229](https://github.com/NobuData/ouroboros/issues/229)) two guards — the switch that
 * asks before it takes routes down, and the delete the service will refuse — and a read that
 * failed degrades to *the routes could not be checked*, which the switch says before it
 * asks anyway.
 *
 * `attempt` is `app/api/reading.ts`'s: it catches an `ApiError` and nothing else, so a `401`
 * still reaches the login screen as Next.js's redirect signal rather than as a card captioned
 * with the framework's internal message.
 *
 * ### The instant is read once
 *
 * `now` is taken here and handed down as a string, because every *last used 3m ago* on the
 * grid should be measured from one clock — and because a Server Component that read the
 * clock itself would draw a figure a test cannot hold still.
 */

import type { Workspace } from "@/app/api/access";
import {
  type ModelAlias,
  type ModelPull,
  type ProviderCatalogEntry,
  type ProviderConnection,
  type ProviderModels,
  type ProviderMonthlySpend,
  providers,
} from "@/app/api/providers";
import { type Reading, attempt } from "@/app/api/reading";
import { type ProviderHealth, routing } from "@/app/api/routing";

/** Everything the screen draws, each part either read or explained. */
export interface ProvidersReadings {
  /** The workspace's connections, in the service's order — the grid. */
  readonly connections: Reading<readonly ProviderConnection[]>;
  /** The kinds this build can connect — each card's schema and capabilities, by kind. */
  readonly catalog: Reading<readonly ProviderCatalogEntry[]>;
  /** The health strip — each card's last check, by connection id. */
  readonly health: Reading<readonly ProviderHealth[]>;
  /** The month's spend — each card's meter, by kind. */
  readonly spend: Reading<ProviderMonthlySpend>;
  /** The registry's aliases — each card's dependents, by the connection each resolves on. */
  readonly aliases: Reading<readonly ModelAlias[]>;
  /**
   * Each connection's models, by connection id. Absent for a connection when the listing
   * itself could not be read, because there was nothing to ask for.
   */
  readonly models: ReadonlyMap<string, Reading<ProviderModels>>;
  /**
   * Each pulling connection's pulls, by connection id — what lets a reload land on a transfer
   * at its real percentage rather than on an idle button. Read only for a kind whose catalog
   * entry says it pulls, so the four cards that draw chips cost nothing here; absent when the
   * catalog could not be read, since nothing then knows which kinds pull.
   */
  readonly pulls: ReadonlyMap<string, Reading<readonly ModelPull[]>>;
  /** The instant the page was read, ISO 8601 — what every relative time is measured from. */
  readonly now: string;
}

/**
 * Read the providers page.
 *
 * @param access The workspace the gate returned. A precondition made visible in the type
 *   rather than a source of values, for the reason `app/models/data.ts` gives: none of its
 *   fields is read, because every call is scoped to the session's own active organization.
 * @param now The instant to measure relative times from. Defaults to the clock; a suite
 *   passes one.
 * @returns The readings.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readProviders(
  access: Workspace,
  now: Date = new Date(),
): Promise<ProvidersReadings> {
  void access;

  const [connections, catalog, health, spend, aliases] = await Promise.all([
    attempt(async () => (await providers.list()).items),
    attempt(async () => (await providers.catalog()).kinds),
    attempt(async () => (await routing.providers()).providers),
    attempt(async () => providers.spend()),
    attempt(async () => providers.aliases()),
  ]);

  const models = new Map<string, Reading<ProviderModels>>();
  const pulls = new Map<string, Reading<readonly ModelPull[]>>();

  if (connections.ok) {
    const pulling = new Set(
      (catalog.ok ? catalog.value : [])
        .filter((entry) => entry.capabilities.pull)
        .map((entry) => entry.kind),
    );

    const read = await Promise.all(
      connections.value.map(async (connection) => {
        const [catalogReading, pullsReading] = await Promise.all([
          attempt(async () => providers.models(connection.id)),
          pulling.has(connection.kind)
            ? attempt(async () => (await providers.pulls(connection.id)).pulls)
            : Promise.resolve(null),
        ]);

        return [connection.id, catalogReading, pullsReading] as const;
      }),
    );

    for (const [id, catalogReading, pullsReading] of read) {
      models.set(id, catalogReading);
      if (pullsReading !== null) pulls.set(id, pullsReading);
    }
  }

  return { connections, catalog, health, spend, aliases, models, pulls, now: now.toISOString() };
}
