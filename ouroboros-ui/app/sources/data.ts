import "server-only";

/**
 * Everything the ticket-sources page reads
 * ([#141](https://github.com/NobuData/ouroboros/issues/141)).
 *
 * Two reads and then one per source, composed here for the reason `app/providers/data.ts`
 * exists: the route stays three lines, the composition is a function that can be tested
 * against a stub, and the screen is handed one object rather than issuing calls of its own.
 * The property every reader in this module keeps — **one failed read is one degraded
 * region, never a blank page** — is kept per row here: a catalog that could not be read leaves
 * every summary on the stored config's own keys, and one source's status failing leaves that
 * row on the listing's columns and nowhere else.
 *
 * ### Two rounds, and the second fans out
 *
 * The listing and the catalog are independent and read at once. The statuses are per source
 * — `GET /api/v1/sources/{id}/status` takes one — so they cannot start until the listing has
 * answered, and then they all start together. A workspace with three sources costs five
 * requests in two round trips.
 *
 * `attempt` is `app/api/reading.ts`'s: it catches an `ApiError` and nothing else, so a `401`
 * still reaches the login screen as Next.js's redirect signal.
 *
 * ### The instant is read once
 *
 * `now` is taken here and handed down as a string, because every *synced 40s ago* on the page
 * should be measured from one clock — and because a Server Component that read the clock
 * itself would draw a figure a test cannot hold still.
 */

import type { Workspace } from "@/app/api/access";
import { type Reading, attempt } from "@/app/api/reading";
import {
  type TicketSource,
  type TicketSourceCatalogEntry,
  type TicketSourceStatusReport,
  sources,
} from "@/app/api/sources";

/** Everything the screen draws, each part either read or explained. */
export interface SourcesReadings {
  /** The workspace's sources, by display name — the rows. */
  readonly sources: Reading<readonly TicketSource[]>;
  /** The kinds this build can connect — each row's field labels, and the add dialog's forms. */
  readonly catalog: Reading<readonly TicketSourceCatalogEntry[]>;
  /**
   * Each source's status report, by source id. Absent for every source when the listing
   * itself could not be read, because there was nothing to ask for.
   */
  readonly statuses: ReadonlyMap<string, Reading<TicketSourceStatusReport>>;
  /** The instant the page was read, ISO 8601 — what every relative time is measured from. */
  readonly now: string;
}

/**
 * Read the ticket-sources page.
 *
 * @param access The workspace the gate returned. A precondition made visible in the type
 *   rather than a source of values: none of its fields is read, because every call is scoped
 *   to the session's own active organization.
 * @param now The instant to measure relative times from. Defaults to the clock; a suite
 *   passes one.
 * @returns The readings.
 * @throws Whatever is not an `ApiError` — Next.js's redirect signal above all.
 */
export async function readSources(access: Workspace, now: Date = new Date()): Promise<SourcesReadings> {
  void access;

  const [listing, catalog] = await Promise.all([
    attempt(async () => (await sources.list()).items),
    attempt(async () => (await sources.catalog()).kinds),
  ]);

  const statuses = new Map<string, Reading<TicketSourceStatusReport>>();

  if (listing.ok) {
    const read = await Promise.all(
      listing.value.map(
        async (source) => [source.id, await attempt(async () => sources.status(source.id))] as const,
      ),
    );

    for (const [id, status] of read) statuses.set(id, status);
  }

  return { sources: listing, catalog, statuses, now: now.toISOString() };
}
