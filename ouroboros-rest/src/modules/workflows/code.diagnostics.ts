/**
 * The code view's diagnostics — W.2 ([#178](https://github.com/NobuData/ouroboros/issues/178)).
 *
 * ```
 * parse errors (#166)       line-ranged already ──────────────────────┐
 * validation findings (P.2) node-anchored ─▶ the printer's span map ──┤
 * reference checks (P7)     node-anchored ─▶ the printer's span map ──┼─▶ [{severity, range, code, message, note?}]
 * undeclared cycles         node-anchored ─▶ the printer's span map ──┘      errors first, then by position
 * ```
 *
 * Two error sources reach one editor, and they speak different languages. The parser knows where
 * it choked, as lines and columns. The validator reasons about graph nodes and has no idea which
 * line a node came from. **The bridge is the printer's span map** (`PrintedWorkflowCode.spans`):
 * the printer put each stage call where it is, so it is the one thing that can say where a node's
 * lines are.
 *
 * ---------------------------------------------------------------------------
 * ## Why the printer's lines are the editor's lines
 *
 * Every file the code view hands out is printed: `GET /code` prints the stored document, and a
 * successful `PUT /code` answers with the canonical print of what it stored. So the span map is
 * computed over exactly the text the editor holds. A file an author reformatted is either refused
 * (`422`, whose parse errors carry their own ranges) or saved, and then answered in canonical form
 * with its diagnostics beside it.
 *
 * ## Where a finding lands
 *
 * A finding's JSON Pointer says which node or edge it is about, and that decides the stage:
 *
 *   1. `/nodes/N…` — the N-th span. By index rather than by id, so two stages that share an id
 *      (`node.duplicate_id`, which still prints and reads back) each get their own lines.
 *   2. `/edges/N…` — the stage the edge leaves. The printer writes an edge inside the call of the
 *      stage it leaves (`next`, `branches`, `onFail`), so that is where it is read.
 *   3. The finding's `node`, or its edge's `from` — the first stage with that id.
 *   4. Otherwise the `export default defineLoop(` line: a finding about the document as a whole
 *      (`document.no_terminal`) is about the file's one call.
 *
 * A stage's range starts at its first non-blank character and ends at the end of its closing
 * `}),` line, so an underline covers the call and not the indentation before it.
 *
 * ## Severity is two-valued, and it is the validator's own split
 *
 * `error` is what the parser refuses and what `validateWorkflowDocument` lists as `errors`, and so
 * what the publish gate refuses. `warning` is its `warnings` (decision **P7**: an unknown skill or
 * task route never blocks a save) and the undeclared-cycle check below. The panel and the editor
 * therefore never call something blocking that publishing would let through.
 *
 * ## Undeclared cycles are checked here, and only advise
 *
 * Mockup 05's first Loop Checks row claims *graph acyclic except declared gate loop*, and no rule
 * anywhere checked it: `edge.loop_not_upstream` holds each loop edge to pointing back up the graph,
 * but nothing looked for a cycle made of `next` and `branches` edges alone. A row that claimed it
 * unchecked would be invented, so {@link checkUndeclaredCycles} checks it. It lives here rather
 * than in `dsl.structure.ts` because that file's rules are held in parity with
 * `ouroboros-engine`'s by `schemas/workflow-dsl/fixtures/expected.json`, and a new structural
 * error would change which documents may be published. As a warning, it changes neither.
 */

import { type CodeRange, LineMap } from "./code.errors";
import { DEFINE_LOOP, EDGE_OPTIONS } from "./code.grammar";
import type { NodeSpan } from "./code.printer";
import { type DslDiagnostic, pointer } from "./dsl.errors";
import { valueAtPath } from "./dsl.issues";
import type { DslCatalogue } from "./dsl.references";
import type { WorkflowDocument } from "./dsl.schema";
import { validateWorkflowDocument } from "./dsl.validator";

/** How much a diagnostic stops: `error` stops a save or a publish, `warning` stops nothing. */
export type CodeDiagnosticSeverity = "error" | "warning";

/** The code of a cycle made of `next` and `branches` edges, which no loop edge declares. */
export const CODE_UNDECLARED_CYCLE = "graph.undeclared_cycle";

/** The order severities are listed in: what blocks first. */
const SEVERITY_RANK: Readonly<Record<CodeDiagnosticSeverity, number>> = { error: 0, warning: 1 };

/** Matches a pointer into one node or one edge, capturing the collection and the index. */
const ELEMENT_POINTER = /^\/(nodes|edges)\/(\d+)(?=\/|$)/;

/** One diagnostic, as the editor underlines it and the checks panel counts it. */
export interface CodeDiagnostic {
  /** Whether it blocks. */
  readonly severity: CodeDiagnosticSeverity;
  /** Where it is underlined: 1-based, `endColumn` just past the last character. */
  readonly range: CodeRange;
  /**
   * Which rule: one of the parser's `code_*` codes or `code_slug_mismatch`, one of the DSL's
   * dotted codes (`node.unreachable`, `reference.unknown_task`), or {@link CODE_UNDECLARED_CYCLE}.
   */
  readonly code: string;
  /** What a person should read. */
  readonly message: string;
  /** Where support would come from — the parser's `hint`, on `code_out_of_grammar`. */
  readonly note?: string;
  /** The id of the stage the range is, when it is a stage's. */
  readonly node?: string;
}

/**
 * A refusal that is ranged already: the parser's `WorkflowCodeError`, or the save's
 * `WorkflowCodeIssue`.
 *
 * Declared here by shape rather than imported from `code.resources.ts`, which imports this file's
 * `CodeDiagnostic` for the wire, so importing back would close a cycle.
 */
export interface RangedIssue extends CodeRange {
  /** Which rule refused the file. */
  readonly code: string;
  /** What a person should read. */
  readonly message: string;
  /** Where support for the construct would come from. */
  readonly hint?: string;
}

/** A finding before it is placed on lines: the validator's shape, with any code. */
export interface AnchoredFinding extends Omit<DslDiagnostic, "code"> {
  /** Which rule broke. */
  code: string;
}

/** What {@link diagnoseDocument} is given. */
export interface DiagnosisInput {
  /** The printed file. */
  readonly text: string;
  /** The span map the printer produced with `text`, one span per node in document order. */
  readonly spans: readonly NodeSpan[];
  /** The document `text` was printed from, as stored — not trusted to be valid. */
  readonly document: unknown;
  /** The workspace's names, for decision **P7**'s warnings. Omit it and none are reported. */
  readonly catalogue?: DslCatalogue;
}

/** What {@link diagnoseDocument} answers. */
export interface DocumentDiagnosis {
  /** Every diagnostic, in {@link sortCodeDiagnostics}' order. */
  readonly diagnostics: readonly CodeDiagnostic[];
  /** The typed document, present exactly when the validator found no error. */
  readonly document?: WorkflowDocument;
}

/** What placing a finding on lines needs. */
interface Placement {
  /** The printed file. */
  readonly text: string;
  /** Its line map. */
  readonly lines: LineMap;
  /** The printer's span map for it. */
  readonly spans: readonly NodeSpan[];
  /** The document it was printed from. */
  readonly document: unknown;
}

/**
 * Diagnose a printed document: the validator's errors and warnings, and undeclared cycles, each on
 * its stage's lines.
 *
 * @param input - The file, its span map, the document and the workspace's catalogue.
 * @returns The diagnostics in order, and the typed document when it validated.
 * @throws {RangeError} When a span names a line `text` does not have — a span map from another
 *   print, which is the caller's defect.
 */
export function diagnoseDocument(input: DiagnosisInput): DocumentDiagnosis {
  const verdict = validateWorkflowDocument(
    input.document,
    input.catalogue === undefined ? {} : { catalogue: input.catalogue },
  );
  const placement: Placement = {
    text: input.text,
    lines: new LineMap(input.text),
    spans: input.spans,
    document: input.document,
  };
  const cycles = verdict.document === undefined ? [] : checkUndeclaredCycles(verdict.document);

  const diagnostics = sortCodeDiagnostics([
    ...verdict.errors.map((finding) => placeFinding(finding, "error", placement)),
    ...verdict.warnings.map((finding) => placeFinding(finding, "warning", placement)),
    ...cycles.map((finding) => placeFinding(finding, "warning", placement)),
  ]);

  return verdict.document === undefined
    ? { diagnostics }
    : { diagnostics, document: verdict.document };
}

/**
 * The parser's refusals as diagnostics.
 *
 * @param issues - What a `422 workflow_code_invalid` carries: the parser's errors, or the slug
 *   mismatch. Each is ranged already.
 * @returns One `error` per issue, its `hint` as the `note`, in {@link sortCodeDiagnostics}' order.
 */
export function fromParseIssues(issues: readonly RangedIssue[]): CodeDiagnostic[] {
  return sortCodeDiagnostics(
    issues.map(({ code, message, hint, line, column, endLine, endColumn }) => ({
      severity: "error" as const,
      range: { line, column, endLine, endColumn },
      code,
      message,
      ...(hint === undefined ? {} : { note: hint }),
    })),
  );
}

/**
 * A finding from outside the file's own diagnosis — the publish gate's registry or engine stage —
 * in the shape `publish.gate.ts`' `PublishFinding` has, where `path` may be absent.
 */
export interface PlaceableFinding {
  /** Which rule broke, in the reporting validator's vocabulary. */
  readonly code: string;
  /** What a person should read. */
  readonly message: string;
  /** An RFC 6901 JSON Pointer to the offending value, when the validator gave one. */
  readonly path?: string;
  /** The node it anchors to, when it anchors to one. */
  readonly node?: string;
  /** The edge it anchors to, when it is about one. */
  readonly edge?: { readonly from: string; readonly to: string };
}

/**
 * Place findings the file's own diagnosis did not produce on the lines of the stage each is
 * about, by the rules in this file's header — V.6's **Validate**
 * ([#174](https://github.com/NobuData/ouroboros/issues/174)), whose engine findings reach the
 * editor this way.
 *
 * @param findings - The findings. A missing `path` is read as the document itself, so the stage
 *   comes from `node` or `edge.from`, else the `defineLoop(` line.
 * @param input - The printed file, its span map and the document it was printed from.
 * @param severity - How much they block. Defaults to `error`: a gate finding refuses a publish.
 * @returns One diagnostic per finding, in {@link sortCodeDiagnostics}' order.
 * @throws {RangeError} When a span names a line `text` does not have, as {@link diagnoseDocument}.
 */
export function placeFindings(
  findings: readonly PlaceableFinding[],
  input: Omit<DiagnosisInput, "catalogue">,
  severity: CodeDiagnosticSeverity = "error",
): CodeDiagnostic[] {
  const placement: Placement = {
    text: input.text,
    lines: new LineMap(input.text),
    spans: input.spans,
    document: input.document,
  };

  return sortCodeDiagnostics(
    findings.map((finding) =>
      placeFinding(
        {
          code: finding.code,
          message: finding.message,
          path: finding.path ?? "",
          ...(finding.node === undefined ? {} : { node: finding.node }),
          ...(finding.edge === undefined
            ? {}
            : { edge: { from: finding.edge.from, to: finding.edge.to } }),
        },
        severity,
        placement,
      ),
    ),
  );
}

/**
 * Merge diagnostic streams into one.
 *
 * @param streams - Each source's diagnostics, in any order.
 * @returns One stream in {@link sortCodeDiagnostics}' order.
 */
export function mergeCodeDiagnostics(
  ...streams: readonly (readonly CodeDiagnostic[])[]
): CodeDiagnostic[] {
  return sortCodeDiagnostics(streams.flat());
}

/**
 * Put diagnostics in the order the editor's strip lists them.
 *
 * Errors before warnings, then by where they start and end, then by code and message: a total
 * order, so the same file always reports the same list.
 *
 * @param diagnostics - The diagnostics.
 * @returns A sorted copy. The input is left alone.
 */
export function sortCodeDiagnostics(diagnostics: readonly CodeDiagnostic[]): CodeDiagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.range.line - b.range.line ||
      a.range.column - b.range.column ||
      a.range.endLine - b.range.endLine ||
      a.range.endColumn - b.range.endColumn ||
      compareText(a.code, b.code) ||
      compareText(a.message, b.message),
  );
}

/**
 * The range a stage call covers.
 *
 * @param text - The printed file.
 * @param lines - Its line map.
 * @param span - The stage's first and last line.
 * @returns From the first non-blank character of `startLine` to the end of `endLine`.
 * @throws {RangeError} When either line is not in the text.
 */
export function spanRange(
  text: string,
  lines: LineMap,
  span: Pick<NodeSpan, "startLine" | "endLine">,
): CodeRange {
  const first = lines.lineSpan(span.startLine);
  const last = lines.lineSpan(span.endLine);
  const indent = text.slice(first.start, first.end).search(/\S/);

  return {
    line: span.startLine,
    column: indent === -1 ? 1 : indent + 1,
    endLine: span.endLine,
    endColumn: last.end - last.start + 1,
  };
}

/**
 * Every cycle of `default` and `branch` edges — a cycle no loop edge declares.
 *
 * Tarjan's strongly connected components, walked with an explicit stack: `&&` chains and long
 * pipelines nest deep, and a recursive walk would run out of call stack long before a document
 * reaches the DSL's 200-node ceiling in a test that builds a bigger one. A component of two or more
 * stages is a cycle; a stage joined to itself is `edge.self_reference`, which validation refuses
 * before this runs.
 *
 * @param document - A document the validator accepted, so every edge's endpoints are nodes and
 *   every id is unique.
 * @returns One warning per cycle, anchored at its first stage in document order and naming every
 *   stage in it, in document order.
 */
export function checkUndeclaredCycles(document: WorkflowDocument): AnchoredFinding[] {
  const order = new Map(document.nodes.map((node, index) => [node.id, index]));
  const successors = new Map<string, string[]>();

  for (const edge of document.edges) {
    if (edge.kind === "loop") continue;
    const targets = successors.get(edge.from);
    if (targets === undefined) successors.set(edge.from, [edge.to]);
    else targets.push(edge.to);
  }

  return stronglyConnected(
    document.nodes.map((node) => node.id),
    successors,
  )
    .filter((component) => component.length > 1)
    .map((component) => [...component].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)))
    .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map((members) => ({
      code: CODE_UNDECLARED_CYCLE,
      path: pointer("nodes", order.get(members[0]) ?? 0),
      node: members[0],
      message:
        `The stages ${listNames(members)} form a cycle that no loop edge declares, so a run could ` +
        `go round it without end. Declare the edge back with \`${EDGE_OPTIONS.loop}\`.`,
    }));
}

/**
 * Tarjan's strongly connected components, iteratively.
 *
 * @param ids - Every vertex, in the order walks start from.
 * @param successors - Each vertex's out-neighbours.
 * @returns Every component, each listed in the order its members left the stack.
 */
function stronglyConnected(
  ids: readonly string[],
  successors: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  /** Give a vertex its index and push it. */
  const visit = (id: string): void => {
    index.set(id, index.size);
    low.set(id, index.size - 1);
    stack.push(id);
    onStack.add(id);
  };

  for (const root of ids) {
    if (index.has(root)) continue;

    visit(root);
    const frames: { id: string; next: number }[] = [{ id: root, next: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = successors.get(frame.id) ?? [];

      if (frame.next < targets.length) {
        const target = targets[frame.next];
        frame.next += 1;

        if (!index.has(target)) {
          visit(target);
          frames.push({ id: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.id, Math.min(low.get(frame.id) ?? 0, index.get(target) ?? 0));
        }
        continue;
      }

      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1];
        low.set(parent.id, Math.min(low.get(parent.id) ?? 0, low.get(frame.id) ?? 0));
      }

      if (low.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        let member: string | undefined;
        do {
          member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.id);
        components.push(component);
      }
    }
  }

  return components;
}

/**
 * Place one finding on its stage's lines.
 *
 * @param finding - A validator finding, or an undeclared cycle.
 * @param severity - Which list it came from.
 * @param placement - The file, its span map and its document.
 * @returns The diagnostic.
 */
function placeFinding(
  finding: AnchoredFinding,
  severity: CodeDiagnosticSeverity,
  placement: Placement,
): CodeDiagnostic {
  const span = spanOf(finding, placement);
  const node = span?.node ?? finding.node;

  return {
    severity,
    range:
      span === undefined ? loopRange(placement) : spanRange(placement.text, placement.lines, span),
    code: finding.code,
    message: finding.message,
    ...(node === undefined ? {} : { node }),
  };
}

/**
 * The stage a finding is about, by the rules in this file's header.
 *
 * @param finding - The finding.
 * @param placement - The file, its span map and its document.
 * @returns The stage's span, or `undefined` for a finding about the document as a whole.
 */
function spanOf(finding: AnchoredFinding, placement: Placement): NodeSpan | undefined {
  const element = ELEMENT_POINTER.exec(finding.path);

  if (element !== null) {
    const position = Number(element[2]);
    const span =
      element[1] === "nodes"
        ? (placement.spans[position] as NodeSpan | undefined)
        : firstSpan(placement.spans, valueAtPath(placement.document, ["edges", position, "from"]));

    if (span !== undefined) return span;
  }

  return firstSpan(placement.spans, finding.node ?? finding.edge?.from);
}

/**
 * The first span of a stage.
 *
 * @param spans - The span map.
 * @param id - A node id, or anything else read from the document.
 * @returns The span, or `undefined` when `id` is not a string naming a printed stage.
 */
function firstSpan(spans: readonly NodeSpan[], id: unknown): NodeSpan | undefined {
  return typeof id === "string" ? spans.find((span) => span.node === id) : undefined;
}

/**
 * The range of the file's `export default defineLoop(` line.
 *
 * @param placement - The file.
 * @returns That line, from its first character to its end — line 1 in a text with no such line,
 *   which no print produces.
 */
function loopRange(placement: Placement): CodeRange {
  const offset = placement.text.indexOf(`export default ${DEFINE_LOOP}(`);
  const line = offset === -1 ? 1 : placement.lines.position(offset).line;

  return spanRange(placement.text, placement.lines, { startLine: line, endLine: line });
}

/**
 * Stage ids as a sentence: `` `a` ``, `` `a` and `b` ``, `` `a`, `b` and `c` ``.
 *
 * @param ids - At least one id.
 * @returns The list.
 */
function listNames(ids: readonly string[]): string {
  const quoted = ids.map((id) => `\`${id}\``);
  return quoted.length === 1
    ? quoted[0]
    : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * Compare two strings by code unit, as `Array.prototype.sort` wants.
 *
 * @param a - The first string.
 * @param b - The second string.
 * @returns A negative number, zero, or a positive number.
 */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
