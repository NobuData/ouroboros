import "server-only";

/**
 * Everything the provider cards read ([#228](https://github.com/NobuData/ouroboros/issues/228)).
 *
 * Four calls and then one per card, composed here for the reason `app/models/data.ts` exists:
 * the route stays three lines, the composition is a function that can be tested against a
 * stub, and the screen is handed one object rather than issuing calls of its own. The property
 * every reader in this module keeps — **one failed read is one degraded region, never a blank
 * page** — is kept per card here: a catalog that could not be read leaves every key row under
 * its fallback label, a spend that could not be read leaves every meter reading *no spend
 * recorded*, and one card's models failing says so on that card and nowhere else.
 *
 * ### Two rounds, and the second fans out
 *
 * The listing, the catalog, the health strip and the month are independent and read at once.
 * The models are per connection — `GET /api/v1/registry/aliases/model-options` takes one —
 * so they cannot start until the listing has answered, and then they all start together. A
 * grid of five cards costs nine requests in two round trips rather than five sequential ones,
 * and a workspace with no connections costs four and asks for no models at all.
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
  type ModelOption,
  type ProviderCatalogEntry,
  type ProviderConnection,
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
  /**
   * Each connection's models, by connection id. Absent for a connection when the listing
   * itself could not be read, because there was nothing to ask for.
   */
  readonly models: ReadonlyMap<string, Reading<readonly ModelOption[]>>;
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

  const [connections, catalog, health, spend] = await Promise.all([
    attempt(async () => (await providers.list()).items),
    attempt(async () => (await providers.catalog()).kinds),
    attempt(async () => (await routing.providers()).providers),
    attempt(async () => providers.spend()),
  ]);

  const models = new Map<string, Reading<readonly ModelOption[]>>();

  if (connections.ok) {
    const read = await Promise.all(
      connections.value.map(
        async (connection) =>
          [connection.id, await attempt(async () => providers.models(connection.id))] as const,
      ),
    );

    for (const [id, reading] of read) models.set(id, reading);
  }

  return { connections, catalog, health, spend, models, now: now.toISOString() };
}
