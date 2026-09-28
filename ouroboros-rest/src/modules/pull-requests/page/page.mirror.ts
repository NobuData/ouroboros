/**
 * The host PR comment a resolving reply is mirrored as
 * ([#368](https://github.com/NobuData/ouroboros/issues/368)).
 *
 * ```
 * **Review thread entry resolved** — cursor/composer-2 · second opinion · rev 1 · simulated
 *
 * > PID velocity sample now lags by one telemetry period — measurable overshoot risk on hard e-stop.
 *
 * **Reply:**
 *
 * > Addressed in attempt 4 — sampling decoupled from telemetry drain.
 *
 * **Resolved by:** Ken S
 *
 * <!-- ouroboros:pr-comment thread.<id> -->          ← added by the SPI; the dedupe key
 * ```
 *
 * The comment says what was objected to, what was answered and by whom — and **keeps the
 * watermark**: a seeded model entry is `simulated` on the host too, so the mirror cannot launder
 * an invented reviewer into a real-looking one.
 *
 * **No line of it can be a marker** — the waiver annotation's rule (#359): what was said is quoted
 * line by line and names are folded onto one line.
 *
 * Pure.
 */

/** What a mirror says. */
export interface ThreadMirror {
  /** The entry's author label — `cursor/composer-2`. */
  readonly authorName: string;
  /** The entry's tag — `second opinion`. */
  readonly tag: string;
  /** The revision the entry was about, or null for a PR-wide entry. */
  readonly revisionSeq: number | null;
  /** Whether the entry carries the simulated watermark. */
  readonly simulated: boolean;
  /** What the entry said. */
  readonly body: string;
  /** The resolving reply. */
  readonly reply: string;
  /** Who resolved it — the person's display name. */
  readonly resolvedBy: string;
}

/**
 * The comment key of an entry's mirror — one per entry.
 *
 * @param entryId - `pr_thread_entries.id`, a uuid.
 * @returns `thread.<uuid>`, inside AX.1's `PR_COMMENT_KEY` grammar.
 */
export function threadMirrorKey(entryId: string): string {
  return `thread.${entryId}`;
}

/**
 * The Markdown a resolving reply posts to the host PR.
 *
 * @param mirror - The entry, the reply and who resolved it.
 * @returns The body, without the marker — the SPI appends it.
 */
export function threadMirrorBody(mirror: ThreadMirror): string {
  const provenance = [
    oneLine(mirror.authorName),
    oneLine(mirror.tag),
    ...(mirror.revisionSeq === null ? [] : [`rev ${String(mirror.revisionSeq)}`]),
    ...(mirror.simulated ? ["simulated"] : []),
  ].join(" · ");

  return [
    `**Review thread entry resolved** — ${provenance}`,
    "",
    quoted(mirror.body),
    "",
    "**Reply:**",
    "",
    quoted(mirror.reply),
    "",
    `**Resolved by:** ${oneLine(mirror.resolvedBy)}`,
  ].join("\n");
}

/**
 * Text as a Markdown quote.
 *
 * @param text - What was said.
 * @returns Every line of it behind `> `.
 */
function quoted(text: string): string {
  return text
    .split(/\r\n?|\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

/**
 * Text folded onto one line.
 *
 * @param text - A label or a name.
 * @returns The text with every run of whitespace, line breaks included, as one space.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
