/**
 * The host PR annotation a criterion waiver posts — AX.3
 * ([#359](https://github.com/NobuData/ouroboros/issues/359)), decision **V9**: *waivers have to
 * leave the building*.
 *
 * ```
 * **Acceptance criterion waived** — not verified on this PR
 *
 * > Flake must not reappear across temperature range
 *
 * **Reason:** rig runs at 22°C only — thermal chamber not in bench
 * **Waived by:** Ken S
 *
 * <!-- ouroboros:pr-comment criterion.<id> -->      ← added by the SPI; the dedupe key
 * ```
 *
 * The comment carries the three things a reviewer on the host needs — the criterion, the reason
 * and the author — and is keyed by the criterion, so waiving it again **edits** this comment
 * rather than posting a second (AX.1's marker discipline, #357).
 *
 * **No line of it can be a marker.** The claim is quoted line by line and the reason and name are
 * folded onto one line, so nothing a person typed can end up as a whole line equal to another
 * key's marker and hijack that key's comment.
 *
 * Pure.
 */

/** What an annotation says. */
export interface WaiverAnnotation {
  /** The criterion's quoted claim. */
  readonly claim: string;
  /** Why it was waived. */
  readonly reason: string;
  /** Who waived it — the person's display name. */
  readonly author: string;
}

/**
 * The comment key of a criterion's annotation — one per criterion, so a re-waive edits it.
 *
 * @param criterionId - `pr_criteria.id`, a uuid.
 * @returns `criterion.<uuid>`, inside AX.1's `PR_COMMENT_KEY` grammar.
 */
export function waiverAnnotationKey(criterionId: string): string {
  return `criterion.${criterionId}`;
}

/**
 * The Markdown a criterion's waiver posts to the host PR.
 *
 * @param annotation - The claim, the reason and the author.
 * @returns The body, without the marker — the SPI appends it.
 */
export function waiverAnnotationBody(annotation: WaiverAnnotation): string {
  const quoted = annotation.claim
    .split(/\r\n?|\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");

  return [
    "**Acceptance criterion waived** — not verified on this PR",
    "",
    quoted,
    "",
    `**Reason:** ${oneLine(annotation.reason)}`,
    `**Waived by:** ${oneLine(annotation.author)}`,
  ].join("\n");
}

/**
 * Text folded onto one line.
 *
 * @param text - What a person typed.
 * @returns The text with every run of whitespace, line breaks included, as one space.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
