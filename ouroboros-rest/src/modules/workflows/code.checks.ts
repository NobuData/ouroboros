/**
 * Mockup 05's **Loop Checks** panel, derived from the diagnostics stream — W.2
 * ([#178](https://github.com/NobuData/ouroboros/issues/178)).
 *
 * ```
 * ✓ Graph acyclic except declared gate loop
 * ✓ All task routes resolve   models configured for analyze · plan · split · implement · review
 * ```
 *
 * | Row | `ok` | `warn` | `err` |
 * |---|---|---|---|
 * | `graph` | no error and no undeclared cycle; titled by the loop edges | an undeclared cycle | the validator found errors |
 * | `references` | the task routes were checked and every reference resolves | an unknown skill, model or task route | — (the row is left out) |
 *
 * ---------------------------------------------------------------------------
 * ## Rows say only what was checked
 *
 * * **No infra row in MVP (decision C7).** The mockup's third row, *pool-a has 1 runner offline*,
 *   reports build-farm state no subsystem here observes, so it is omitted rather than faked.
 *   {@link LoopCheckId} is a closed union, so such a row cannot be built by accident. When the
 *   Build Farm's pool status lands (#254), adding it is a deliberate change to this union and to
 *   the test that holds C7.
 * * **The `references` row needs a reference stage that ran.** The validator reports decision
 *   **P7**'s warnings only for a document with no error, and only against the names the workspace
 *   supplied. A document with errors therefore gets no `references` row. Neither does a workspace
 *   whose routing matrix has no task kinds, unless a reference already failed:
 *   *all task routes resolve* would then be a claim nothing verified.
 * * **The note lists the model stages**, the mockup's `analyze · plan · implement · review`. The
 *   seeded `standard-fix` also has a `split` stage the listing leaves out
 *   (`docs/WORKFLOW_CODE_DSL.md` §10), so its note names five.
 */

import { CODE_UNDECLARED_CYCLE, type CodeDiagnostic } from "./code.diagnostics";
import { calleeFor } from "./code.printer";
import { DslWarningCode } from "./dsl.errors";
import type { WorkflowDocument } from "./dsl.schema";

/** Every row the panel can have, in the order it lists them. No infra row (C7). */
export const LOOP_CHECK_IDS = ["graph", "references"] as const;

/** One of {@link LOOP_CHECK_IDS}. */
export type LoopCheckId = (typeof LOOP_CHECK_IDS)[number];

/** The row's glyph: `✓`, the warn dot, or the error mark. */
export type LoopCheckStatus = "ok" | "warn" | "err";

/** One row of the panel. */
export interface LoopCheckRow {
  /** Which check. */
  readonly id: LoopCheckId;
  /** How it came out. */
  readonly status: LoopCheckStatus;
  /** The row's sentence. */
  readonly title: string;
  /** The small text after it, when there is one. */
  readonly note?: string;
}

/** What {@link loopCheckRows} derives the rows from. */
export interface LoopCheckInput {
  /** The file's diagnostics, from `diagnoseDocument`. */
  readonly diagnostics: readonly CodeDiagnostic[];
  /** The typed document, which `diagnoseDocument` returns exactly when there is no error. */
  readonly document?: WorkflowDocument;
  /** Whether the catalogue named the workspace's task kinds, so task routes were checked. */
  readonly tasksChecked: boolean;
}

/** The codes of decision **P7**'s reference warnings. */
const REFERENCE_CODES: ReadonlySet<string> = new Set<string>(Object.values(DslWarningCode));

/**
 * The panel's rows.
 *
 * @param input - The diagnostics, the document and whether task routes were checked.
 * @returns The rows, in {@link LOOP_CHECK_IDS}' order, leaving out a row whose check did not run.
 */
export function loopCheckRows(input: LoopCheckInput): LoopCheckRow[] {
  const errors = input.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

  if (errors.length > 0 || input.document === undefined) return [invalidGraph(errors)];

  const references = referencesRow(input.document, input.diagnostics, input.tasksChecked);

  return references === undefined
    ? [graphRow(input.document, input.diagnostics)]
    : [graphRow(input.document, input.diagnostics), references];
}

/**
 * The `graph` row for a document the validator refused.
 *
 * @param errors - The error diagnostics.
 * @returns An `err` row counting them, with the first one's message as its note.
 */
function invalidGraph(errors: readonly CodeDiagnostic[]): LoopCheckRow {
  if (errors.length === 0) {
    return { id: "graph", status: "err", title: "Graph could not be checked" };
  }

  return {
    id: "graph",
    status: "err",
    title: counted(errors.length, "validation error", "validation errors"),
    note: errors[0].message,
  };
}

/**
 * The `graph` row for a valid document.
 *
 * @param document - The typed document.
 * @param diagnostics - Its diagnostics.
 * @returns `warn` naming where each undeclared cycle starts, or `ok` titled by the loop edges.
 */
function graphRow(
  document: WorkflowDocument,
  diagnostics: readonly CodeDiagnostic[],
): LoopCheckRow {
  const cycles = diagnostics.filter((diagnostic) => diagnostic.code === CODE_UNDECLARED_CYCLE);

  if (cycles.length > 0) {
    return {
      id: "graph",
      status: "warn",
      title:
        cycles.length === 1
          ? "Graph has an undeclared cycle"
          : `Graph has ${cycles.length} undeclared cycles`,
      note: `through ${stagesOf(cycles)}`,
    };
  }

  const loops = document.edges.filter((edge) => edge.kind === "loop");
  const source =
    loops.length === 1 ? document.nodes.find((node) => node.id === loops[0].from) : undefined;

  if (loops.length === 0) return { id: "graph", status: "ok", title: "Graph acyclic" };

  return {
    id: "graph",
    status: "ok",
    title:
      source === undefined
        ? `Graph acyclic except ${counted(loops.length, "declared loop", "declared loops")}`
        : `Graph acyclic except declared ${calleeFor(source)} loop`,
  };
}

/**
 * The `references` row for a valid document.
 *
 * @param document - The typed document.
 * @param diagnostics - Its diagnostics.
 * @param tasksChecked - Whether task routes were checked.
 * @returns `warn` when a reference does not resolve, `ok` when task routes were checked and all
 *   resolve, and `undefined` — no row — when nothing checked them.
 */
function referencesRow(
  document: WorkflowDocument,
  diagnostics: readonly CodeDiagnostic[],
  tasksChecked: boolean,
): LoopCheckRow | undefined {
  const unresolved = diagnostics.filter((diagnostic) => REFERENCE_CODES.has(diagnostic.code));

  if (unresolved.length > 0) {
    return {
      id: "references",
      status: "warn",
      title:
        unresolved.length === 1
          ? "1 reference does not resolve"
          : `${unresolved.length} references do not resolve`,
      note: `unresolved in ${stagesOf(unresolved)}`,
    };
  }

  if (!tasksChecked) return undefined;

  const models = document.nodes.filter((node) => node.type === "llm").map((node) => node.id);

  return models.length === 0
    ? { id: "references", status: "ok", title: "All task routes resolve" }
    : {
        id: "references",
        status: "ok",
        title: "All task routes resolve",
        note: `models configured for ${models.join(" · ")}`,
      };
}

/**
 * The stages some diagnostics are about, each once, in the order they are listed.
 *
 * @param diagnostics - Stage-anchored diagnostics.
 * @returns `analyze · plan`.
 */
function stagesOf(diagnostics: readonly CodeDiagnostic[]): string {
  const stages = diagnostics.flatMap((diagnostic) =>
    diagnostic.node === undefined ? [] : [diagnostic.node],
  );

  return [...new Set(stages)].join(" · ");
}

/**
 * A count and its noun.
 *
 * @param count - How many.
 * @param singular - The noun for one.
 * @param plural - The noun for any other number.
 * @returns `1 validation error`, `3 validation errors`.
 */
function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
