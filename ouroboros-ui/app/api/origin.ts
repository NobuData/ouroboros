/**
 * Which data origin the UI asks the aggregate reads for (DJ.2,
 * [#1315](https://github.com/NobuData/ouroboros/issues/1315)).
 *
 * `ouroboros-rest` now computes every dashboard and Insights figure from **live** rows unless a
 * request names another origin, and answers no data — a null — where it has none. The seeded
 * development stack holds no live rows at all, so until the UI can label demo data and draw an
 * honest empty state (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)) it asks for
 * `all`: every origin summed, which on a deployment without the seed is exactly its live rows.
 * DJ.3 replaces this constant with a live-default filter the reader can change.
 */

import type { components } from "@/app/api/schema";

/** What an aggregate read's `origin` query parameter takes. */
export type OriginFilter = components["schemas"]["OriginFilter"];

/** The origin every aggregate read asks for until DJ.3 adds the reader's own filter. */
export const AGGREGATE_ORIGIN: OriginFilter = "all";
