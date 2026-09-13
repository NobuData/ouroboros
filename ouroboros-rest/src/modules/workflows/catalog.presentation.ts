/**
 * How each node type looks in the Add-stage menu, and what a freshly dropped one contains — R.3
 * ([#145](https://github.com/NobuData/ouroboros/issues/145)).
 *
 * The config schemas are the DSL's (`catalog.schema.ts`); what is here is what the DSL does
 * not say and should not: the glyph and treatment class mockup 04 draws a node with, the
 * menu's label, and the defaults a new node is dropped with. JSON Schema has no keyword for a
 * glyph, and ajv's strict mode — the conformance suite's — refuses unknown keywords, so the
 * presentation cannot live in `v1.json` without a vocabulary two validators would have to
 * learn.
 *
 * ---------------------------------------------------------------------------
 * ## The treatments are mockup 04's, letter for letter
 *
 * `docs/mockups/04-workflow-builder.html` draws `.node.trigger ▸`, `.node.llm ◆`,
 * `.node.infra ▣`, `.node.flow ◇` and `.node.term ●`. The issue's diagram abbreviates two of
 * the classes (`trig`, `model`) and draws the terminal as `■`; the ticket's own text says
 * *"matching the mockup's five node styles"*, and `catalog.presentation.spec.ts` reads the
 * mockup to hold these to it.
 *
 * ## A type with no entry here still works
 *
 * {@link presentationFor} answers a neutral presentation for a type this table does not list —
 * its name as its label and class, {@link FALLBACK_GLYPH}, and an empty config — so a type
 * added to the schema surfaces in the menu with a working form before anybody draws it a
 * glyph. That is the ticket's *zero UI changes*. It is a floor, not a destination: the spec
 * fails for any type in the **committed** schema that has no entry, so a shipping type is
 * never served the placeholder.
 *
 * ## Defaults decide only what has an obvious answer
 *
 * A new model stage is dropped with the mockup's inspector values — *Direct prompt*, two
 * retries, a 400k token budget — and **without** `prompt_template`, `routing` or
 * `permissions`. The first two are the author's to write; the third is decision **P9**'s
 * *"a permission nobody decided is a permission nobody can be held to"*, which a default would
 * be deciding for them. So a fresh model stage is a draft the validator flags until those three
 * are filled in, which is what they are. Every other type's defaults validate as they stand.
 */

import type { JsonSchema } from "./catalog.schema";

/** What a node of one type contains when it is dropped onto the canvas. */
export interface StageDefaults {
  /** The node's `title` — what the canvas prints until the author renames it. */
  readonly title: string;
  /** The node's `config`. The canvas supplies `id` and `position`; nothing else is defaulted. */
  readonly config: JsonSchema;
}

/** How one node type is drawn and dropped. */
export interface StagePresentation {
  /** What the Add-stage menu calls it. */
  readonly label: string;
  /** The glyph mockup 04 prints in the node's `.ntype` line. */
  readonly glyph: string;
  /** The node's treatment class — mockup 04's `.node.<class>`. */
  readonly class: string;
  /** What a freshly dropped node contains. */
  readonly defaults: StageDefaults;
}

/** The glyph a type with no entry is drawn with — a plain square, deliberately unremarkable. */
export const FALLBACK_GLYPH = "□";

/**
 * Freeze a value and everything below it.
 *
 * The catalog is built once and served to every request, so a caller that mutated one answer
 * would be editing the next workspace's.
 *
 * @param value - A JSON value.
 * @returns The same value, frozen throughout.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }

  return value;
}

/**
 * The five node types mockup 04 draws.
 *
 * Keyed by the DSL's `type` value. The spec holds the keys to the committed schema's enum in
 * both directions: no shipping type without an entry, and no entry for a type that is gone.
 */
export const STAGE_PRESENTATIONS: Readonly<Record<string, StagePresentation>> = deepFreeze({
  trigger: {
    label: "Trigger",
    glyph: "▸",
    class: "trigger",
    // The trigger's predicate is the document's root `trigger`, and its config is closed and
    // empty (P.2) — so there is nothing to default but the mockup's title.
    defaults: { title: "Issue queued", config: {} },
  },
  llm: {
    label: "Model stage",
    glyph: "◆",
    class: "llm",
    defaults: {
      title: "Model stage",
      // No `prompt_template`, `routing` or `permissions` — see this file's header.
      config: { mode: "prompt", limits: { max_retries: 2, token_budget: 400000 } },
    },
  },
  infra: {
    label: "Build or test",
    glyph: "▣",
    class: "infra",
    // Both fields are optional in the DSL: a stage with neither runs the repository's default
    // command on the default pool.
    defaults: { title: "Build", config: {} },
  },
  flow: {
    label: "Decision or gate",
    glyph: "◇",
    class: "flow",
    defaults: {
      title: "Decision",
      config: { kind: "decision", predicate: { kind: "always" } },
    },
  },
  term: {
    label: "Terminal",
    glyph: "●",
    class: "term",
    // `needs_review` rather than `open_pr_automerge`: a terminal nobody configured should hand
    // the work to a person, never merge it.
    defaults: { title: "Needs review", config: { action: "needs_review", options: {} } },
  },
});

/**
 * How a node type is drawn and dropped.
 *
 * @param type - The DSL `type` value.
 * @returns Its entry in {@link STAGE_PRESENTATIONS}, or — for a type the table does not list —
 *   a neutral presentation named for the type. `Object.hasOwn` rather than `in`, so a type
 *   named `constructor` is a type and not `Object.prototype`'s.
 */
export function presentationFor(type: string): StagePresentation {
  if (Object.hasOwn(STAGE_PRESENTATIONS, type)) return STAGE_PRESENTATIONS[type];

  return deepFreeze({
    label: type,
    glyph: FALLBACK_GLYPH,
    class: type,
    defaults: { title: type, config: {} },
  });
}
