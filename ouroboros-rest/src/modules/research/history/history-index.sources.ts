/**
 * History-index entries as citations (CL.5, [#618](https://github.com/NobuData/ouroboros/issues/618)).
 *
 * Every entry the tool hands the loop becomes a `ticket`-kind source record with its
 * `issue-index://` locator, so a claim about support volume points at the tickets behind it:
 *
 * ```
 * [19]  Support churn interviews Q2      issue-index://support/churn-2026-q2
 * ```
 *
 * The content hash covers everything read of the entry — locator, title, body, state, labels and
 * date — so the archived citation is provably the entry as it stood.
 */

import { createHash } from "node:crypto";

import type { SourceRecord } from "../tools/research-tool.adapter";
import { SOURCE_LIMITS, jsonbTextBytes } from "../tools/research-tool.citations";
import type { IndexEntry } from "./history-index.repository";

/** V108's bounds on a source record. */
const TITLE_MAX_CHARS = SOURCE_LIMITS.titleChars;
const EXCERPT_MAX_BYTES = SOURCE_LIMITS.excerptBytes;

/** How many of an entry's labels a citation's meta carries. */
const META_LABELS = 20;

/**
 * Text cut to a byte bound, on a character boundary, with an ellipsis when cut.
 *
 * @param text - The text.
 * @param maxBytes - The bound, in UTF-8 bytes.
 * @returns The text, or its beginning and `…`.
 */
export function clipBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

  // A character is at most four bytes, so this many characters may still be too many.
  let cut = [...text].slice(0, maxBytes);
  while (Buffer.byteLength(`${cut.join("")}…`, "utf8") > maxBytes) {
    cut = cut.slice(0, Math.max(0, cut.length - Math.ceil(cut.length / 16)));
  }

  return `${cut.join("")}…`;
}

/**
 * The title a citation of an entry carries.
 *
 * @param entry - The entry.
 * @returns `#482 — Fix flaky CAN-bus telemetry test`, `PR #514 — …`, or an imported set's or
 *   document's own title. At most 300 characters.
 */
export function sourceTitle(entry: IndexEntry): string {
  const title =
    entry.kind === "ticket"
      ? `${entry.ref} — ${entry.title}`
      : entry.kind === "pr"
        ? `PR ${entry.ref} — ${entry.title}`
        : entry.title;

  return title.length <= TITLE_MAX_CHARS ? title : `${title.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/**
 * `sha256:<hex>` of everything read of an entry.
 *
 * @param entry - The entry.
 * @returns The hash.
 */
export function entryContentHash(entry: IndexEntry): string {
  const read = JSON.stringify([
    entry.locator,
    entry.title,
    entry.body,
    entry.state,
    entry.labels,
    entry.occurredAt.toISOString(),
  ]);

  return `sha256:${createHash("sha256").update(read, "utf8").digest("hex")}`;
}

/**
 * An entry as a source record.
 *
 * @param entry - The entry read.
 * @param retrievedAt - When it was read.
 * @param excerpt - The passage to archive — a search's matching passage; null for the entry's
 *   own opening (its body, or its title when it has none).
 * @param how - What makes the citation reproducible — the query, the filters, the bucket.
 * @returns The record.
 */
export function entrySource(
  entry: IndexEntry,
  retrievedAt: Date,
  excerpt: string | null,
  how: Readonly<Record<string, unknown>>,
): SourceRecord {
  const passage = [excerpt, entry.body, entry.title].find(
    (text): text is string => typeof text === "string" && text.trim() !== "",
  );

  const identity = {
    entry: entry.kind,
    set: entry.setKey,
    ref: entry.ref,
    occurredAt: entry.occurredAt.toISOString(),
  };
  const meta = {
    ...identity,
    ...(entry.state === null ? {} : { state: entry.state }),
    ...(entry.labels.length === 0
      ? {}
      : { labels: entry.labels.slice(0, META_LABELS).map((label) => label.slice(0, 80)) }),
    ...(entry.repo === null ? {} : { repo: entry.repo.slice(0, 200) }),
    ...(entry.url === null ? {} : { url: entry.url }),
    ...how,
  };

  return {
    kind: "ticket",
    title: sourceTitle(entry),
    locator: entry.locator,
    retrievedAt: retrievedAt.toISOString(),
    contentHash: entryContentHash(entry),
    excerpt: clipBytes((passage ?? entry.title).trim(), EXCERPT_MAX_BYTES),
    // V108 bounds meta at 8 KiB; an entry whose detail would pass it is cited by identity alone.
    meta: jsonbTextBytes(meta) <= SOURCE_LIMITS.metaBytes ? meta : identity,
  };
}
