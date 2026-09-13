/**
 * The layout block: what the canvas draws and the code does not say — U.1
 * ([#165](https://github.com/NobuData/ouroboros/issues/165)).
 *
 * A node's position and an edge's label are **presentation** — docs/WORKFLOW_DSL.md §6 says of
 * the label *"Presentation; never evaluated"*, and a position is the same kind of fact. They
 * still have to survive the trip, because the canvas *is* an authored artifact and two people
 * opening one workflow must see one picture. So they ride at the foot of the file as
 * structured trivia, one line per fact:
 *
 * ```ts
 * // @ouroboros/layout v1 — generated; the canvas owns these lines
 * // node issue-queued 24 40
 * // node analyze 306 40
 * // edge issue-queued analyze
 * // edge effort-recheck plan "≤ M ↓"
 * ```
 *
 * * **One line per node, in node order**, so moving a node on the canvas is a one-line diff.
 * * **One line per edge, in the document's edge order.** The stage calls say what the edges
 *   *are*; this says in which order the document lists them — which the diagnostics order
 *   depends on, and which grouping edges under their source stage cannot preserve on its own
 *   (`standard-fix` lists `split → back-to-queue` before `plan → implement`).
 * * **A label is a JSON string**, so it stays on its line whatever it contains.
 *
 * A comment rather than a sidecar because a `.loop.ts` file is then self-contained: #167's
 * `PUT` carries one body, and a file copied out of the editor keeps its canvas.
 */

import { LAYOUT_EDGE_PREFIX, LAYOUT_MARKER, LAYOUT_NODE_PREFIX } from "./code.grammar";
import { coordinate, quoteString } from "./code.literals";
import { NodeIdSchema, type WorkflowDocument } from "./dsl.schema";

/** One node's recorded position. */
export interface LayoutNode {
  /** The node id. */
  id: string;
  /** Its canvas x. */
  x: number;
  /** Its canvas y. */
  y: number;
}

/** One edge's recorded place in the order, and its label. */
export interface LayoutEdge {
  /** The id of the node the edge leaves. */
  from: string;
  /** The id of the node it arrives at. */
  to: string;
  /** Its label, when it has one. */
  label?: string;
}

/** A layout line the reader could not read. */
export interface MalformedLayoutLine {
  /** Its 1-based line number in the file. */
  line: number;
  /** The line, verbatim. */
  text: string;
}

/** What {@link readLayout} found. */
export interface ReadLayout {
  /** Whether the file has a layout block at all. */
  found: boolean;
  /** Every `// node` line, in file order. */
  nodes: LayoutNode[];
  /** Every `// edge` line, in file order. */
  edges: LayoutEdge[];
  /** Every non-blank line after the marker that is neither, in file order. */
  malformed: MalformedLayoutLine[];
}

/**
 * Render the layout block for a document.
 *
 * @param document - A document the validator accepted.
 * @returns The block's lines, marker first, without line terminators.
 */
export function printLayout(document: WorkflowDocument): string[] {
  const lines: string[] = [LAYOUT_MARKER];

  for (const node of document.nodes) {
    lines.push(
      `${LAYOUT_NODE_PREFIX}${node.id} ${coordinate(node.position.x)} ${coordinate(node.position.y)}`,
    );
  }

  for (const edge of document.edges) {
    const label = edge.label === undefined ? "" : ` ${quoteString(edge.label)}`;
    lines.push(`${LAYOUT_EDGE_PREFIX}${edge.from} ${edge.to}${label}`);
  }

  return lines;
}

/**
 * Read the layout block back out of a file.
 *
 * The block starts at the marker line and runs to the end of the file. The reader is strict
 * about each line and lenient about the block: a line it cannot read is *reported*, with its
 * number, rather than thrown — what an out-of-date or hand-edited layout line means for the
 * document (a node the code no longer has, an edge the code does not declare) is the parser's
 * question (#166), and it can only answer it about every line at once.
 *
 * @param text - The whole file.
 * @returns What the block records. `found` is `false`, and the lists empty, when the file has
 *   no marker line.
 */
export function readLayout(text: string): ReadLayout {
  const lines = text.split("\n");
  const start = lines.indexOf(LAYOUT_MARKER);
  const result: ReadLayout = { found: start !== -1, nodes: [], edges: [], malformed: [] };

  if (start === -1) return result;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;

    const node = readNodeLine(line);
    const edge = node === undefined ? readEdgeLine(line) : undefined;

    if (node !== undefined) result.nodes.push(node);
    else if (edge !== undefined) result.edges.push(edge);
    else result.malformed.push({ line: index + 1, text: line });
  }

  return result;
}

/**
 * Read one `// node <id> <x> <y>` line.
 *
 * @param line - The line.
 * @returns The position, or `undefined` when the line is not a well-formed node line.
 */
function readNodeLine(line: string): LayoutNode | undefined {
  if (!line.startsWith(LAYOUT_NODE_PREFIX)) return undefined;

  const parts = line.slice(LAYOUT_NODE_PREFIX.length).split(" ");
  if (parts.length !== 3) return undefined;

  const [id, xText, yText] = parts;
  const x = readCoordinate(xText);
  const y = readCoordinate(yText);

  if (!isNodeId(id) || x === undefined || y === undefined) return undefined;

  return { id, x, y };
}

/**
 * Read one `// edge <from> <to> ["label"]` line.
 *
 * @param line - The line.
 * @returns The edge, or `undefined` when the line is not a well-formed edge line.
 */
function readEdgeLine(line: string): LayoutEdge | undefined {
  if (!line.startsWith(LAYOUT_EDGE_PREFIX)) return undefined;

  const rest = line.slice(LAYOUT_EDGE_PREFIX.length);
  const firstSpace = rest.indexOf(" ");
  const secondSpace = rest.indexOf(" ", firstSpace + 1);
  const from = rest.slice(0, firstSpace);
  const to =
    secondSpace === -1 ? rest.slice(firstSpace + 1) : rest.slice(firstSpace + 1, secondSpace);

  if (firstSpace === -1 || !isNodeId(from) || !isNodeId(to)) return undefined;
  if (secondSpace === -1) return { from, to };

  const label = readJsonString(rest.slice(secondSpace + 1));
  return label === undefined ? undefined : { from, to, label };
}

/**
 * Read a coordinate the way {@link coordinate} writes one.
 *
 * @param text - The token.
 * @returns The number, or `undefined` for anything `Number()` would read as `NaN`, an infinity,
 *   or a zero from an empty or whitespace token.
 */
function readCoordinate(text: string): number | undefined {
  if (text.trim() === "") return undefined;

  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Read a JSON string literal.
 *
 * @param text - The token, quotes included.
 * @returns The string, or `undefined` when the token is not exactly one JSON string.
 */
function readJsonString(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a token is a node id.
 *
 * @param text - The token.
 * @returns `true` when the DSL's own node-id schema accepts it.
 */
function isNodeId(text: string): boolean {
  return NodeIdSchema.safeParse(text).success;
}
