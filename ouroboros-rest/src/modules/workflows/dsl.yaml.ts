/**
 * The YAML projection — mockup 05's code view, proved to be a *view*
 * ([#133](https://github.com/NobuData/ouroboros/issues/133)).
 *
 * Decision **P3** makes the canonical JSON document the one artifact every consumer reads.
 * A text view of a workflow is then a rendering of that document and not a second authoring
 * format, and the difference between those two things is whether editing in the text view
 * can lose something the canvas held. `dsl.yaml.spec.ts` asserts it cannot: every golden
 * fixture, rendered and re-parsed, is the document it started as, value for value.
 *
 * **Keys are emitted in a canonical order** — the document's own reading order rather than
 * whatever order the object happened to carry. Two workflows that differ only in the order
 * their properties were written then render identically, which is what makes a diff of the
 * code view a diff of the workflow. Losslessness is about values; JSON object key order is
 * not one.
 *
 * The projection deliberately renders the document rather than the *verdict*: a code view
 * that showed diagnostics inline would be a second renderer of {@link DslDiagnostic} to keep
 * in step with the inspector's.
 */

import { parse, stringify } from "yaml";

import type { WorkflowDocument } from "./dsl.schema";

/** The document's own properties, in the order a reader meets them. */
const DOCUMENT_KEYS = ["dsl_version", "trigger", "nodes", "edges"] as const;
/** A node's properties: what it is, then what it says, then where it sits, then how it runs. */
const NODE_KEYS = ["id", "type", "title", "description", "position", "config"] as const;
/** An edge's properties: the two ends, the kind, then the two optional members. */
const EDGE_KEYS = ["from", "to", "kind", "label", "condition"] as const;

/**
 * Re-key one object into a fixed order, dropping nothing and inventing nothing.
 *
 * Keys named in `order` come first, in that order, and only when the object actually has
 * them; anything else follows in its original order, so a property a later DSL minor adds
 * still renders rather than vanishing in a build that predates it.
 *
 * @param value - The object to re-key.
 * @param order - The preferred key order.
 * @returns A new object with the same entries in the canonical order.
 */
function ordered(
  value: Record<string, unknown>,
  order: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of order) {
    if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
      result[key] = value[key];
    }
  }
  for (const key of Object.keys(value)) {
    if (order.includes(key)) continue;
    if (value[key] === undefined) continue;
    result[key] = value[key];
  }
  return result;
}

/**
 * Render a workflow definition as YAML.
 *
 * @param document - A document the validator accepted.
 * @returns The YAML text, ending in a newline — a file, not a fragment.
 */
export function toWorkflowYaml(document: WorkflowDocument): string {
  const projection = ordered(
    {
      ...document,
      nodes: document.nodes.map((node) => ordered({ ...node }, NODE_KEYS)),
      edges: document.edges.map((edge) => ordered({ ...edge }, EDGE_KEYS)),
    },
    DOCUMENT_KEYS,
  );

  // `lineWidth: 0` turns off the folding that would otherwise break a long prompt template
  // across lines: folded scalars round-trip through this library correctly, but a reader
  // comparing the code view with the inspector's prompt box has to be able to see the same
  // text in both. `blockQuote` keeps a multi-line template as a literal block rather than a
  // quoted string full of `\n`, which is the same argument.
  return stringify(projection, { lineWidth: 0, blockQuote: "literal" });
}

/**
 * Parse YAML back into a document-shaped value.
 *
 * The result is `unknown` on purpose. YAML can express anything, so text that parses is not
 * yet a workflow — it goes to `validateWorkflowDocument` exactly as a JSON body from the
 * canvas does, and there is no path into the system that skips that.
 *
 * @param text - The YAML source.
 * @returns Whatever the document parsed to.
 * @throws When the text is not well-formed YAML.
 */
export function fromWorkflowYaml(text: string): unknown {
  return parse(text) as unknown;
}
