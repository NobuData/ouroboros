/**
 * Template rendering — a card's question, why and tags, composed from facts (decision **X2**).
 *
 * BN.1 ([#461](https://github.com/NobuData/ouroboros/issues/461)). The TypeScript twin of V093's
 * `decision_template_render`, so a card can be rendered where the database is not asked — a fixture
 * kind in a unit suite, an email or GitHub mirror (BN.3) composing from an item it already read —
 * and render **identically**:
 *
 * ```
 * "Approve merge for a {pr_kind} PR?"  +  {pr_kind: "refactor"}  →  "Approve merge for a refactor PR?"
 * ```
 *
 * - **Typed slots.** `{slot}` names a fact; braces mean nothing else. A slot's fact must be a
 *   string, number or boolean — an object, an array, null or a missing fact is refused rather than
 *   printed as `[object Object]` or `undefined`.
 * - **One pass.** A fact whose text looks like a slot (`"{files}"`) is printed, never expanded, so
 *   a fact can never pull another fact (or itself) into the prose.
 * - **Safe escaping per destination.** The prose is plain text. A destination that interprets
 *   markup escapes the whole rendered string — {@link renderTemplate}'s `format` — so a fact cannot
 *   inject HTML into a mail or Markdown into a PR comment.
 *
 * Pure.
 */

import type { DecisionKindDeclaration, RenderedDecision } from "./decision.types";

/** V093's slot grammar: a snake_case fact name, at most 63 characters. */
const SLOT = /\{([a-z][a-z0-9_]{0,62})\}/g;

/** A well-formed template: literal text and slots, no stray brace. V093's `decision_template_well_formed`. */
const WELL_FORMED = /^(?:[^{}]|\{[a-z][a-z0-9_]{0,62}\})*$/;

/** Where rendered prose is going, and so how it must be escaped. */
export type DecisionTextFormat = "plain" | "html" | "markdown";

/** A template that cannot be rendered against a payload — the X2 contract broken. */
export class DecisionTemplateError extends Error {
  /**
   * @param message - What is wrong, naming the slot.
   */
  constructor(message: string) {
    super(message);
    this.name = "DecisionTemplateError";
  }
}

/**
 * Whether a template is well formed.
 *
 * @param template - The template.
 * @returns `true` when every brace is part of a `{slot}`.
 */
export function templateWellFormed(template: string): boolean {
  return WELL_FORMED.test(template);
}

/**
 * The fact names a template's slots ask for, in order, repeats kept.
 *
 * @param template - The template.
 * @returns The slot names — `["pr_kind"]`. Empty for a template with no slot.
 */
export function templateSlots(template: string): string[] {
  return [...template.matchAll(SLOT)].map((match) => match[1]);
}

/**
 * A fact as a slot prints it — the same text PostgreSQL's `->>` gives.
 *
 * @param slot - The slot, for the error.
 * @param value - The fact.
 * @returns Its text.
 * @throws {DecisionTemplateError} When the fact is missing or not a scalar.
 */
function slotText(slot: string, value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  throw new DecisionTemplateError(`decision template slot {${slot}} has no fact in the payload`);
}

/**
 * Escape text for an HTML element or attribute.
 *
 * @param text - Plain text.
 * @returns It, with `& < > " '` as entities.
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escape text for CommonMark/GitHub-flavoured Markdown, so it renders as itself.
 *
 * @param text - Plain text.
 * @returns It, with every ASCII punctuation character Markdown could read as syntax backslashed,
 *   and `<`/`>` as entities so no raw HTML survives.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_{}[\]()#+\-.!|~]/g, (character) => `\\${character}`)
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Render one template against a payload, in one pass.
 *
 * @param template - The template — `Approve merge for a {pr_kind} PR?`.
 * @param payload - The facts.
 * @param format - Where the prose is going. `plain` (the default) returns the text as the card
 *   shows it; `html` and `markdown` escape the whole result for that destination.
 * @returns The prose.
 * @throws {DecisionTemplateError} When the template is malformed or a slot has no scalar fact.
 */
export function renderTemplate(
  template: string,
  payload: Readonly<Record<string, unknown>>,
  format: DecisionTextFormat = "plain",
): string {
  if (!templateWellFormed(template)) {
    throw new DecisionTemplateError(`decision template is malformed: ${template}`);
  }

  const text = template.replace(SLOT, (_match, slot: string) => slotText(slot, payload[slot]));

  switch (format) {
    case "html":
      return escapeHtml(text);
    case "markdown":
      return escapeMarkdown(text);
    default:
      return text;
  }
}

/**
 * A card's question, why and tags, as its kind's templates compose them from its facts.
 *
 * @param kind - The declaration — the version the item pinned.
 * @param payload - The item's facts.
 * @param format - Where the prose is going; see {@link renderTemplate}.
 * @returns The rendered card prose.
 * @throws {DecisionTemplateError} When a template cannot render against the payload.
 */
export function renderDecision(
  kind: Pick<DecisionKindDeclaration, "questionTemplate" | "whyTemplate" | "refShape">,
  payload: Readonly<Record<string, unknown>>,
  format: DecisionTextFormat = "plain",
): RenderedDecision {
  return {
    question: renderTemplate(kind.questionTemplate, payload, format),
    why: renderTemplate(kind.whyTemplate, payload, format),
    tags: kind.refShape.tags.map((tag) => renderTemplate(tag, payload, format)),
  };
}
