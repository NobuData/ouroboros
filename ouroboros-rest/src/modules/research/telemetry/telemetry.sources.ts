/**
 * A telemetry result as a source record (CL.6,
 * [#619](https://github.com/NobuData/ouroboros/issues/619)) — the citation ledger's shape (V108).
 *
 * One result, one source. Its **locator is the query** (`telemetry.locator.ts`), its **content
 * hash is the result** — the payload's digest, with no clock in it — and its excerpt is the result
 * in a sentence. So a reader can re-run the locator, hash what comes back, and see at a glance
 * whether the number the brief quoted is still the number.
 *
 * A no-data result is a source too. "Nothing was measured in this window" is a finding, it is
 * citable, and its record names the window that was searched.
 */

import { createHash } from "node:crypto";

import type { SourceRecord } from "../tools/research-tool.adapter";
import { SOURCE_LIMITS, jsonbTextBytes } from "../tools/research-tool.citations";
import { locatorOf, type TelemetryQuery } from "./telemetry.locator";

/**
 * The digest of a result.
 *
 * @param payload - The result, as the tool returns it.
 * @returns `sha256:<hex>` of its JSON — the same for the same numbers, whenever it is asked.
 */
export function payloadHash(payload: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex")}`;
}

/**
 * Cut a text to a number of characters.
 *
 * @param text - The text.
 * @param max - The most characters to keep.
 * @returns It, ending in an ellipsis when it was cut.
 */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The source record of a result.
 *
 * @param query - The canonical query the result answers; its locator is derived from it.
 * @param payload - The result.
 * @param title - What the source is called in the ledger.
 * @param sentence - The result in words, for the excerpt.
 * @param retrievedAt - When it was read.
 * @returns The record: kind `telemetry`, the re-runnable locator, the result's digest, and the
 *   query in `meta` for a reader who would rather not parse the locator.
 */
export function telemetrySource(
  query: TelemetryQuery,
  payload: Readonly<Record<string, unknown>>,
  title: string,
  sentence: string,
  retrievedAt: Date,
): SourceRecord {
  const asked = {
    query: {
      ...query,
      ...("metric" in query ? { metric: query.metric.key } : {}),
    },
    status: payload.status,
  };

  return {
    kind: "telemetry",
    title: clip(title, SOURCE_LIMITS.titleChars),
    locator: locatorOf(query),
    retrievedAt: retrievedAt.toISOString(),
    contentHash: payloadHash(payload),
    // Sentences here are short; the bound is the ledger's, held in characters to stay under it.
    excerpt: clip(sentence, Math.floor(SOURCE_LIMITS.excerptBytes / 4)),
    meta: jsonbTextBytes(asked) <= SOURCE_LIMITS.metaBytes ? asked : { status: payload.status },
  };
}
