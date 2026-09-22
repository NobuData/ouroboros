/**
 * Every number the Run Console's reads run on, once.
 *
 * AP.2 ([#304](https://github.com/NobuData/ouroboros/issues/304)). Constants rather than settings,
 * for `farm/logs/log.policy.ts`'s reason: they are behaviour, not deployment facts. The one
 * deployment fact these reads honour — how often an idle client should ask — is
 * `OURO_DASHBOARD_POLL_SECONDS`, the shared cadence (#87), and is read from configuration.
 *
 * ```
 * GET …/events?after=&limit=  ── at most RUN_EVENTS_PAGE_MAX entries ── pollAfter: 5 s while live, the shared cadence after
 * GET …/transcript.jsonl      ── RUN_EXPORT_BATCH lines per read ── "# simulated run" first when the run is flagged
 * ```
 */

/** How many transcript entries one `?after=` read returns when the caller names no `limit`. */
export const RUN_EVENTS_PAGE_DEFAULT = 200;

/**
 * The most transcript entries one `?after=` read returns.
 *
 * Bounded so a client that fell far behind — a tab left open overnight — catches up in pages
 * rather than in one response the size of the run's byte cap. `hasMore` tells it to ask again at
 * once rather than waiting out `pollAfter`.
 */
export const RUN_EVENTS_PAGE_MAX = 500;

/**
 * How soon a reader of a **live** run's transcript should ask again — the issue's `pollAfter: 5`.
 *
 * Faster than the dashboard's fifteen because the transcript is the thing a person is watching,
 * and slower than the build log's two because an entry is a sentence rather than a line of
 * compiler output. When the run has finished the shared cadence applies instead, exactly as a
 * finished build log falls back to it.
 */
export const RUN_EVENTS_POLL_LIVE_SECONDS = 5;

/**
 * How many JSONL lines the export reads per statement.
 *
 * The export streams: it reads this many lines, writes them, and only then reads the next batch,
 * so the memory it holds is one batch whatever the transcript's length — which is what *"memory
 * stays flat for a capped-size transcript"* means in practice.
 */
export const RUN_EXPORT_BATCH = 500;

/**
 * The export's first line on a simulated run — decision **R4**'s watermark, in the file.
 *
 * A `#` line rather than a JSON object so it cannot be mistaken for an entry: every entry line
 * already carries `"simulated": true`, and this says the same thing about the file as a whole to
 * a person who opens it and a tool that skips comment lines.
 */
export const RUN_EXPORT_WATERMARK = "# simulated run";

/** The export's media type — one JSON document per line. */
export const RUN_EXPORT_MEDIA_TYPE = "application/x-ndjson; charset=utf-8";
