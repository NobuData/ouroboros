/**
 * Plan import — the acceptance criteria a ticket's plan already states, read out of its draft body
 * (AX.3, [#359](https://github.com/NobuData/ouroboros/issues/359); the drafts are AL.1's,
 * [#277](https://github.com/NobuData/ouroboros/issues/277)).
 *
 * ```
 * ## Acceptance Criteria                 ← the section, as a heading, a bold line or "…:"
 * - [ ] Telemetry frames must arrive in ISR order under load     → a claim
 * - [x] No regression in e-stop response envelope                → a claim (the box is dropped)
 *   - measured on helios-rig-02                                  → detail of the item above, skipped
 * 1. Zero heap allocation in ISR fast path                       → a claim
 * ## Notes                                                       ← the section ends
 * ```
 *
 * **Only a stated section is imported.** A plan body is otherwise task detail — outline-v0 puts
 * everything indented under a bullet there — and reading every bullet as a claim would be a guess
 * that looks like a plan. So a body with no *Acceptance criteria* section yields nothing, and the
 * service says so rather than inventing claims. Extraction from free text is AZ.2's
 * ([#372](https://github.com/NobuData/ouroboros/issues/372)), under its own `extracted` provenance.
 *
 * Pure: the service reads the body and hands it in.
 */

/** `pr_criteria_claim_present` — at most 1024 characters. */
export const MAX_CLAIM_LENGTH = 1024;

/** What a body's section yielded. */
export interface PlanCriteria {
  /** Whether the body states an acceptance-criteria section at all. */
  readonly found: boolean;
  /** The section's items, in order, each once, checkboxes removed. */
  readonly claims: readonly string[];
  /** Items longer than {@link MAX_CLAIM_LENGTH} — reported, never cut into a different claim. */
  readonly tooLong: readonly string[];
}

/** `## Acceptance criteria`, `**Acceptance Criteria**`, `Acceptance criteria:` — one line alone. */
const SECTION =
  /^ {0,3}(?:#{1,6}\s+)?(?:\*\*|__)?acceptance criteria(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/i;

/** Any markdown heading — the end of the section. */
const HEADING = /^ {0,3}#{1,6}\s/;

/** A list item: `-`, `*`, `+`, `1.` or `1)`, then its text. Group 1 is the indent, 2 the text. */
const ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;

/** A task-list box at the start of an item's text. */
const CHECKBOX = /^\[[ xX]\]\s+/;

/**
 * The acceptance criteria a plan body states.
 *
 * @param body - `ticket_drafts.body`, or null.
 * @returns The claims, in the order written. `found` is false when the body has no section.
 */
export function planCriteria(body: string | null): PlanCriteria {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => SECTION.test(line));

  if (start === -1) {
    return { found: false, claims: [], tooLong: [] };
  }

  const claims: string[] = [];
  const tooLong: string[] = [];
  let itemIndent: number | null = null;

  for (const line of lines.slice(start + 1)) {
    if (HEADING.test(line) || SECTION.test(line)) {
      break;
    }

    const item = ITEM.exec(line);

    if (item === null) {
      // A blank line or an indented continuation stays inside the section; flush prose ends it.
      if (line.trim() === "" || /^\s/.test(line)) {
        continue;
      }

      break;
    }

    const indent = item[1].length;

    // The first item sets the level; deeper items are detail of the one above.
    itemIndent ??= indent;

    if (indent > itemIndent) {
      continue;
    }

    const claim = item[2].replace(CHECKBOX, "").trim();

    if (claim === "" || claims.includes(claim)) {
      continue;
    }

    if (claim.length > MAX_CLAIM_LENGTH) {
      tooLong.push(claim);
    } else {
      claims.push(claim);
    }
  }

  return { found: true, claims, tooLong };
}
