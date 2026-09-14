/**
 * The editor-intelligence fixtures — W.3 ([#179](https://github.com/NobuData/ouroboros/issues/179)).
 *
 * Mockup 05's editor underlines a finding on the lines of the stage it is about, lists the Loop
 * Checks rows, and completes what an author types. All three rest on line and scope arithmetic a
 * grammar change can move **without anything crashing**: a printer that writes one more line shifts
 * every span below it, and every diagnostic quietly lands one line off. This file is what
 * `code.intelligence.spec.ts` and `code.intelligence.integration-spec.ts` share so that such a change
 * fails loudly instead:
 *
 * ```
 * seeds (R__dev_seed_workflows.sql) ─▶ printed file ─┬─▶ spans         ─▶ fixtures/code-intelligence/spans.json
 *                                                    ├─▶ diagnostics   ─▶ …/diagnostics.json
 *                                                    ├─▶ Loop Checks   ─▶ …/checks.json
 *                                                    └─▶ contexts      ─▶ …/contexts.json
 * ```
 *
 * * **Two oracles that share none of the printer's arithmetic.** {@link stageCallsOf} reads each
 *   stage call's lines out of the text with the TypeScript compiler, and
 *   {@link completionContextsOf} walks the compiler's tree to say where each word of the grammar
 *   sits and which scope the editor completes it from — the scope names
 *   `ouroboros-ui/app/workflows/code/context.ts` computes. A span map that disagrees with its own
 *   text fails even after its golden is regenerated.
 * * **Goldens.** What the code view answers for every seed, in each workspace state, recorded as
 *   JSON under `schemas/workflow-dsl/fixtures/code-intelligence/`. A change that moves an answer
 *   fails naming the file, the case and {@link REGENERATE} (`src/testing/golden.fixture.ts`).
 * * **Edit-shift cases** ({@link shiftCases}). Content above a stage grows or shrinks by a known
 *   number of lines, and the expected spans and diagnostics are the recorded ones moved by that
 *   number ({@link shiftedSpans}, {@link shiftedDiagnostics}) — never a second print.
 *
 * Diagnostics are recorded without their `message`, as `code-invalid/expected.json` records the
 * parser's errors: a message is prose a person may reword, and the TypeScript compiler writes a
 * syntax error's. What drifts silently is the range, the order and the severity.
 *
 * `*.fixture.ts` is left out of the build, so none of this ships.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import ts from "typescript";

import { GoldenFile } from "../../testing/golden.fixture";
import { toDslCatalogue, type StageSuggestions } from "./catalog.resources";
import { LOOP_CHECK_IDS, loopCheckRows, type LoopCheckRow } from "./code.checks";
import {
  CODE_UNDECLARED_CYCLE,
  diagnoseDocument,
  fromParseIssues,
  sortCodeDiagnostics,
  type CodeDiagnostic,
} from "./code.diagnostics";
import { DEFINE_LOOP, EDGE_OPTIONS, ROUTE_METHODS } from "./code.grammar";
import { parseWorkflowCode } from "./code.parser";
import type { NodeSpan } from "./code.printer";
import { projectWorkflowCode } from "./code.projection";
import { parseSource } from "./code.recover.fixture";
import { SUGGESTION_SCOPES, type CodeSymbolTable } from "./code.symbols";
import { DslWarningCode } from "./dsl.errors";
import { FIXTURES_DIR } from "./dsl.golden.fixture";
import { SEED_DOCUMENT_TAGS, seededDocuments, seededTaskKinds } from "./dsl.seed.fixture";

/* ---------------------------------------------------------------------------
 * The goldens
 * ------------------------------------------------------------------------- */

/** Where the goldens live. */
export const GOLDEN_DIR = join(FIXTURES_DIR, "code-intelligence");

/** The command that regenerates every golden: the unit suite, run whole, rewriting. */
export const REGENERATE =
  "OURO_UPDATE_GOLDENS=1 yarn jest src/modules/workflows/code.intelligence.spec.ts";

/** Each golden, and the sentence it opens with. */
const GOLDEN_ABOUT = {
  spans:
    "W.3 (#179): the printer's node→span map for every document R__dev_seed_workflows.sql writes, " +
    "keyed by its dollar-quoted tag. Each span is also held to the lines the TypeScript compiler " +
    `finds its stage call on. Regenerate with: ${REGENERATE}`,
  diagnostics:
    "W.3 (#179): the code view's diagnostics, in the order the editor lists them and without their " +
    "messages — for every seeded document in each workspace state (seeded: R__dev_seed_routing.sql's " +
    "task kinds and .env.example's skill suggestions; unconfigured: neither), for sabotaged " +
    "standard-fix files, for a file the parser refuses, and for those three sources merged. " +
    `Regenerate with: ${REGENERATE}`,
  checks:
    "W.3 (#179): the Loop Checks rows derived from each diagnostics case that has a document. No " +
    `row is an infra row (decision C7). Regenerate with: ${REGENERATE}`,
  contexts:
    "W.3 (#179): every word a seeded file writes where the code symbol table offers something, as " +
    "`line:column scope label` in the scope names ouroboros-ui's context.ts computes. Regenerate " +
    `with: ${REGENERATE}`,
} as const;

/** One of the four goldens. */
export type GoldenName = keyof typeof GOLDEN_ABOUT;

/**
 * Open the four goldens.
 *
 * @param updating - Whether to rewrite them. Omit it to follow `OURO_UPDATE_GOLDENS`; the
 *   integration suite passes `false`, since only the unit suite writes them.
 * @returns Each golden by name.
 */
export function openGoldens(updating?: boolean): Record<GoldenName, GoldenFile> {
  const open = (name: GoldenName) =>
    new GoldenFile(join(GOLDEN_DIR, `${name}.json`), GOLDEN_ABOUT[name], REGENERATE, updating);

  return {
    spans: open("spans"),
    diagnostics: open("diagnostics"),
    checks: open("checks"),
    contexts: open("contexts"),
  };
}

/* ---------------------------------------------------------------------------
 * Workspaces and seeds
 * ------------------------------------------------------------------------- */

/**
 * The two workspaces a seeded file is diagnosed in.
 *
 * `seeded` is a development workspace: the routing seed's task kinds, and the skill suggestions
 * `.env.example` documents. `unconfigured` has neither, so no reference is checked (decision P7).
 */
export const WORKSPACE_STATES = ["seeded", "unconfigured"] as const;

/** One of {@link WORKSPACE_STATES}. */
export type WorkspaceState = (typeof WORKSPACE_STATES)[number];

/** `.env.example`, whose documented skill suggestions a development workspace is given. */
export const ENV_EXAMPLE_PATH = resolve(__dirname, "../../../../.env.example");

/**
 * The skill suggestions `.env.example` documents.
 *
 * @returns The names on its `#   OURO_WORKFLOW_SKILL_SUGGESTIONS=…` line, in order.
 * @throws {Error} When the line is gone.
 */
export function documentedSkillSuggestions(): string[] {
  const line = /^#\s+OURO_WORKFLOW_SKILL_SUGGESTIONS=(\S+)$/m.exec(
    readFileSync(ENV_EXAMPLE_PATH, "utf8"),
  );
  if (line === null) {
    throw new Error(`${ENV_EXAMPLE_PATH} no longer documents OURO_WORKFLOW_SKILL_SUGGESTIONS.`);
  }

  return line[1].split(",");
}

/**
 * What a workspace suggests.
 *
 * @param state - The workspace.
 * @returns Its skills and task routes, as `WorkflowCatalogService` reads them.
 */
export function suggestionsFor(state: WorkspaceState): StageSuggestions {
  return state === "seeded"
    ? { skills: documentedSkillSuggestions(), taskRoutes: seededTaskKinds() }
    : { skills: [], taskRoutes: [] };
}

/** A printed file the code view serves, with what it was printed from. */
export interface CodeFile {
  /** The file. */
  readonly text: string;
  /** The printer's span map for it. */
  readonly spans: readonly NodeSpan[];
  /** The document it was printed from. */
  readonly document: unknown;
}

/** One seeded document, as the code view opens it. */
export interface SeedFile extends CodeFile {
  /** Its dollar-quoted tag in the seed, which names its golden cases. */
  readonly tag: string;
  /** The workflow it belongs to. */
  readonly slug: string;
}

/**
 * Every seeded document, printed.
 *
 * @returns One file per `SEED_DOCUMENT_TAGS` entry, in that order.
 * @throws {Error} When a seeded document has no projection, which the code view would refuse.
 */
export function seedFiles(): SeedFile[] {
  return SEED_DOCUMENT_TAGS.map(([tag, , slug]) => {
    const document = seededDocuments(tag)[0];
    const printed = projectWorkflowCode(slug, document);

    if (printed === undefined) {
      throw new Error(`The seeded ${tag} has no projection, so the code view cannot open it.`);
    }

    return { tag, slug, document, text: printed.text, spans: printed.spans };
  });
}

/**
 * Read a file as the code view would store it, and require it to be what the code view serves.
 *
 * @param slug - The workflow the file is for.
 * @param text - The file.
 * @returns The file, its span map and its document.
 * @throws {Error} When the file does not parse, or its canonical print is different text — so a
 *   range in the expected answer is a range in the file that was sent.
 */
export function readCanonical(slug: string, text: string): CodeFile {
  const parsed = parseWorkflowCode(text);
  if (parsed.errors.length > 0) {
    throw new Error(`The edited file does not parse: ${JSON.stringify(parsed.errors)}`);
  }

  const printed = projectWorkflowCode(slug, parsed.document);
  if (printed?.text !== text) {
    throw new Error("The edited file is not canonical: the code view would answer other text.");
  }

  return { text, spans: printed.spans, document: parsed.document };
}

/* ---------------------------------------------------------------------------
 * Diagnostics and Loop Checks
 * ------------------------------------------------------------------------- */

/** A file's diagnostics and the Loop Checks rows derived from them. */
export interface Diagnosed {
  /** In the editor's order. */
  readonly diagnostics: readonly CodeDiagnostic[];
  /** In the panel's order. */
  readonly rows: readonly LoopCheckRow[];
}

/**
 * Diagnose a file as `CodeService` does.
 *
 * @param file - The file.
 * @param state - The workspace it is diagnosed in.
 * @returns Its diagnostics and rows.
 */
export function diagnoseFile(file: CodeFile, state: WorkspaceState): Diagnosed {
  const catalogue = toDslCatalogue(suggestionsFor(state));
  const diagnosis = diagnoseDocument({
    text: file.text,
    spans: file.spans,
    document: file.document,
    catalogue,
  });

  return {
    diagnostics: diagnosis.diagnostics,
    rows: loopCheckRows({
      diagnostics: diagnosis.diagnostics,
      tasksChecked: catalogue.tasks !== undefined,
      ...(diagnosis.document === undefined ? {} : { document: diagnosis.document }),
    }),
  };
}

/** A diagnostic as the goldens record it. */
export type RecordedDiagnostic = Omit<CodeDiagnostic, "message">;

/**
 * Diagnostics as the goldens record them.
 *
 * @param diagnostics - The diagnostics.
 * @returns Each without its message, in the same order.
 */
export function recorded(diagnostics: readonly CodeDiagnostic[]): RecordedDiagnostic[] {
  return diagnostics.map(({ message: _message, ...rest }) => rest);
}

/**
 * The golden case name of a seeded document in a workspace.
 *
 * @param tag - The seed's tag.
 * @param state - The workspace.
 * @returns `standard_fix_v14 · seeded`.
 */
export function seedCaseName(tag: string, state: WorkspaceState): string {
  return `${tag} · ${state}`;
}

/** A `standard-fix` file broken on purpose, diagnosed in the seeded workspace. */
export interface SabotagedFile {
  /** Its golden case name. */
  readonly name: string;
  /** What it breaks. */
  readonly about: string;
  /** The file. */
  readonly text: string;
}

/**
 * The sabotaged `standard-fix` files.
 *
 * * **References and an undeclared cycle.** Two sources of warnings interleaved by position, and a
 *   tie between them on one stage's lines: `effort-recheck` branches back to `analyze`, whose skill
 *   is misspelled, as is `implement`'s — and the seeded matrix does not route `split`.
 * * **Validation errors.** Three errors of two rules at three positions: `analyze` names itself as a
 *   second `next`, and removing the branch to `split` leaves it and `back-to-queue` unreachable, one
 *   line higher than they were. A schema error would not do: it stops the validator before the graph
 *   rules run, so it would stand alone.
 *
 * @param canvas - The seeded `standard-fix` v14, as printed.
 * @returns The files, each canonical.
 * @throws {Error} When an edit no longer applies to the print, naming the case.
 */
export function sabotagedFiles(canvas: SeedFile): SabotagedFile[] {
  const splitBranch = '        { to: "split", when: (i) => i.effort.gt(effort.M) },\n';
  const splitEdge = '// edge effort-recheck split "> M ↘"\n';

  const references = "sabotage · references and an undeclared cycle";
  const errors = "sabotage · validation errors";

  return [
    {
      name: references,
      about: "misspelled skills on analyze and implement, and a branch back to analyze",
      text: replaceAll(references, canvas.text, [
        [
          splitBranch,
          `${splitBranch}        { to: "analyze", when: (i) => i.effort.gt(effort.XL) },\n`,
        ],
        [splitEdge, `${splitEdge}// edge effort-recheck analyze\n`],
        ['skill: "repo-map"', 'skill: "repo-mop"'],
        ['skill: "zephyr-conventions"', 'skill: "zephyr-conventionz"'],
      ]),
    },
    {
      name: errors,
      about: "analyze joined to itself, and split and back-to-queue unreachable",
      text: replaceAll(errors, canvas.text, [
        ['      next: "effort-recheck",', '      next: ["effort-recheck", "analyze"],'],
        [
          "// edge analyze effort-recheck\n",
          "// edge analyze effort-recheck\n// edge analyze analyze\n",
        ],
        [splitBranch, ""],
        [splitEdge, ""],
      ]),
    },
  ];
}

/** The file the parser refuses, and its golden case name. */
export const PARSE_REFUSAL = {
  name: "parse · three-mistakes",
  file: "code-invalid/three-mistakes.loop.ts",
} as const;

/**
 * The file the parser refuses, and its refusal as diagnostics.
 *
 * @returns The text, and `fromParseIssues` of its parse errors — what a `422` carries.
 */
export function parseRefusal(): { readonly text: string; readonly diagnostics: CodeDiagnostic[] } {
  const text = readFileSync(join(FIXTURES_DIR, PARSE_REFUSAL.file), "utf8");
  return { text, diagnostics: fromParseIssues(parseWorkflowCode(text).errors) };
}

/** The golden case name of the three sources merged. */
export const MERGED_CASE = "merged · parse errors, validation findings and reference checks";

/**
 * Hold a diagnostics stream to the editor's order: sorted, and every error before every warning.
 *
 * @param diagnostics - The stream.
 */
export function expectEditorOrder(diagnostics: readonly CodeDiagnostic[]): void {
  expect(diagnostics).toEqual(sortCodeDiagnostics(diagnostics));

  const severities = diagnostics.map((diagnostic) => diagnostic.severity);
  const firstWarning = severities.indexOf("warning");
  if (firstWarning !== -1) expect(severities.slice(firstWarning)).not.toContain("error");
}

/** The codes of decision P7's reference warnings. */
const REFERENCE_CODES: ReadonlySet<string> = new Set<string>(Object.values(DslWarningCode));

/**
 * Hold Loop Checks rows to what their diagnostics say, and to decision C7.
 *
 * * Only the panel's known rows, each once, in its order — no infra row can appear.
 * * No row speaks of pools, runners or the build farm.
 * * `graph` is `err` exactly when there is an error, else `warn` exactly when a cycle is undeclared.
 * * `references` is absent under an error, `warn` exactly when a reference does not resolve, and
 *   `ok` otherwise when present.
 *
 * @param rows - The rows.
 * @param diagnostics - The diagnostics they were derived from.
 */
export function expectHonestRows(
  rows: readonly LoopCheckRow[],
  diagnostics: readonly CodeDiagnostic[],
): void {
  const ids = rows.map((row) => row.id);
  expect(ids).toEqual(LOOP_CHECK_IDS.filter((id) => ids.includes(id)));

  for (const row of rows) {
    expect(`${row.title} ${row.note ?? ""}`).not.toMatch(/pool|runner|offline|farm|infra/i);
  }

  const errors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const cycles = diagnostics.some((diagnostic) => diagnostic.code === CODE_UNDECLARED_CYCLE);
  const unresolved = diagnostics.some((diagnostic) => REFERENCE_CODES.has(diagnostic.code));
  const graph = rows.find((row) => row.id === "graph");
  const references = rows.find((row) => row.id === "references");

  expect(graph?.status).toBe(errors ? "err" : cycles ? "warn" : "ok");
  if (errors) expect(references).toBeUndefined();
  else if (unresolved) expect(references?.status).toBe("warn");
  else if (references !== undefined) expect(references.status).toBe("ok");
}

/* ---------------------------------------------------------------------------
 * The span oracle, and edit-shift cases
 * ------------------------------------------------------------------------- */

/** One stage call, as the compiler reads its lines. */
export interface StageCall extends NodeSpan {
  /** Its callee — `llm`, `gate`, `openPr`. */
  readonly callee: string;
}

/**
 * Every stage call's lines, read by the TypeScript compiler rather than by the printer.
 *
 * @param text - A workflow file.
 * @returns One call per element of `stages`, in order: the line its callee is on, and the line
 *   its closing `)` is on.
 * @throws {Error} When the file has no `defineLoop` with a `stages` array of stage calls.
 */
export function stageCallsOf(text: string): StageCall[] {
  const source = parseSource(text);
  const stages = loopOptions(source).properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === "stages",
  )?.initializer;

  if (stages === undefined || !ts.isArrayLiteralExpression(stages)) {
    throw new Error("The file's defineLoop has no `stages` array.");
  }

  return stages.elements.map((element) => {
    const [id] = ts.isCallExpression(element) ? element.arguments : [];
    if (!ts.isCallExpression(element) || !ts.isIdentifier(element.expression)) {
      throw new Error(`Line ${lineOf(source, element.getStart(source))} is not a stage call.`);
    }
    if (id === undefined || !ts.isStringLiteral(id)) {
      throw new Error(
        `The stage call on line ${lineOf(source, element.getStart(source))} has no id.`,
      );
    }

    return {
      node: id.text,
      callee: element.expression.text,
      startLine: lineOf(source, element.getStart(source)),
      endLine: lineOf(source, element.getEnd() - 1),
    };
  });
}

/**
 * A stage call as a span, for comparing with the printer's.
 *
 * @param call - The call.
 * @returns Its node and lines.
 */
export function spanOf(call: NodeSpan): NodeSpan {
  return { node: call.node, startLine: call.startLine, endLine: call.endLine };
}

/** An edit that moves every line below one stage by a known number. */
export interface ShiftCase {
  /** What it does, as a test title reads it: `adds a description to analyze`. */
  readonly name: string;
  /** The stage whose lines it changes. */
  readonly index: number;
  /** How many lines that stage gains — negative when it shrinks. */
  readonly delta: number;
  /** The edited file. */
  readonly text: string;
}

/** The description {@link shiftCases} adds to a stage that has none. */
const ADDED_DESCRIPTION = "Added above every stage after this one.";

/** The lines {@link shiftCases} adds at the start of a model stage's prompt. */
const ADDED_PROMPT_LINES = ["Added line one.", "Added line two.", "Added line three."];

/**
 * The edit-shift cases for one file: content above a stage grows or shrinks.
 *
 * For every stage, its description is dropped (one line fewer) or, when it has none, added (one
 * line more). For every model stage, its prompt grows by three lines and, when it spans three lines
 * or more, loses an inner one. Each edit is made to the text where an author would type it, and
 * is spelled canonically, so the code view answers the same text back.
 *
 * Where each stage sits comes from {@link stageCallsOf}, not from a span map. The edits land where
 * the text says the stages are even when the printer's arithmetic has drifted, so that drift is
 * reported by the assertions comparing span maps rather than hidden behind a failure to build the
 * cases.
 *
 * @param text - The printed file.
 * @returns The cases, stage by stage.
 * @throws {Error} When a stage call no longer opens with its title on the next line, so the edits
 *   would land somewhere else.
 */
export function shiftCases(text: string): ShiftCase[] {
  const lines = text.split("\n");
  const cases: ShiftCase[] = [];

  stageCallsOf(text).forEach((span, index) => {
    // 0-based, the line after the call's opening line.
    const title = span.startLine;
    if (!/^ {6}title: /.test(lines[title] ?? "")) {
      throw new Error(
        `Line ${title + 1} is not ${span.node}'s title: the stage call no longer opens with it, ` +
          "so the edit-shift cases need rewriting against the new print.",
      );
    }

    cases.push(
      /^ {6}description: /.test(lines[title + 1] ?? "")
        ? {
            name: `drops ${span.node}'s description`,
            index,
            delta: -1,
            text: spliced(lines, title + 1, 1),
          }
        : {
            name: `adds a description to ${span.node}`,
            index,
            delta: 1,
            text: spliced(lines, title + 1, 0, `      description: "${ADDED_DESCRIPTION}",`),
          },
    );

    const prompt = lines.findIndex(
      (line, at) =>
        at >= span.startLine - 1 && at <= span.endLine - 1 && line.startsWith("      prompt: `"),
    );
    if (prompt === -1) return;

    cases.push({
      name: `grows ${span.node}'s prompt by ${ADDED_PROMPT_LINES.length} lines`,
      index,
      delta: ADDED_PROMPT_LINES.length,
      text: spliced(
        lines,
        prompt,
        1,
        lines[prompt].replace("prompt: `", `prompt: \`${ADDED_PROMPT_LINES.join("\n")}\n`),
      ),
    });

    const closing = lines.findIndex((line, at) => at >= prompt && /(^|[^\\])`,$/.test(line));
    if (closing - prompt >= 2) {
      cases.push({
        name: `shrinks ${span.node}'s prompt by a line`,
        index,
        delta: -1,
        text: spliced(lines, prompt + 1, 1),
      });
    }
  });

  return cases;
}

/**
 * A span map after one stage gained or lost lines.
 *
 * @param spans - The map before the edit.
 * @param index - The edited stage.
 * @param delta - How many lines it gained.
 * @returns The stages above it unmoved, its own end moved, and every stage below it moved.
 */
export function shiftedSpans(spans: readonly NodeSpan[], index: number, delta: number): NodeSpan[] {
  return spans.map((span, at) => {
    if (at < index) return { ...span };
    if (at === index) return { ...span, endLine: span.endLine + delta };
    return { ...span, startLine: span.startLine + delta, endLine: span.endLine + delta };
  });
}

/**
 * Diagnostics after one stage gained or lost lines.
 *
 * @param diagnostics - The diagnostics before the edit.
 * @param spans - The span map before the edit.
 * @param index - The edited stage.
 * @param delta - How many lines it gained.
 * @returns Each diagnostic on a stage's lines moved as that stage moved; one above the stages —
 *   the `defineLoop` line — unmoved.
 * @throws {Error} When a diagnostic is neither on a stage's lines nor above the stages, so there is
 *   no saying where it should go.
 */
export function shiftedDiagnostics<D extends Pick<CodeDiagnostic, "range">>(
  diagnostics: readonly D[],
  spans: readonly NodeSpan[],
  index: number,
  delta: number,
): D[] {
  return diagnostics.map((diagnostic) => {
    const { range } = diagnostic;
    const at = spans.findIndex(
      (span) => span.startLine === range.line && span.endLine === range.endLine,
    );

    if (at === -1) {
      if (spans.length > 0 && range.endLine >= spans[0].startLine) {
        throw new Error(`A diagnostic on lines ${range.line}–${range.endLine} is on no stage's.`);
      }
      return diagnostic;
    }

    if (at < index) return diagnostic;
    if (at === index) return { ...diagnostic, range: { ...range, endLine: range.endLine + delta } };
    return {
      ...diagnostic,
      range: { ...range, line: range.line + delta, endLine: range.endLine + delta },
    };
  });
}

/* ---------------------------------------------------------------------------
 * The completion-context oracle
 * ------------------------------------------------------------------------- */

/** One word the grammar puts somewhere, and the scope the editor completes it from. */
export interface CompletionContext {
  /** 1-based. */
  readonly line: number;
  /** 1-based: the word's first character, or a string's first character inside its quotes. */
  readonly column: number;
  /** The scope — `stage.llm.options`, `route.task`, `predicate.effort`. */
  readonly scope: string;
  /** What is written there, as the table would offer it: a key, a value, `route.task("")`. */
  readonly label: string;
}

/** The scope the stage calls are values of. */
const STAGES_SCOPE = "loop.stages";

/** The scope the trigger's object is the value of. */
const TRIGGER_SCOPE = "loop.trigger";

/** The trigger's `when`, whose arrow spells conditions rather than predicates. */
const TRIGGER_WHEN_SCOPE = "trigger.when";

/** The stage option whose object holds the permission flags. */
const PERMISSIONS_KEY = "permissions";

/** The stage options whose arrays hold edge entries. */
const EDGE_LIST_KEYS: ReadonlySet<string> = new Set([EDGE_OPTIONS.branch, EDGE_OPTIONS.loop]);

/** The namespace `route.task` and `route.alias` are members of. */
const ROUTE_NAMESPACE = "route";

/** The call whose string argument names a task route. */
const ROUTE_TASK = `${ROUTE_NAMESPACE}.${ROUTE_METHODS.inherit_task}`;

/** The namespace `effort.M` is a member of. */
const EFFORT_NAMESPACE = "effort";

/** The predicate subject whose methods take tracker kinds. */
const SOURCE_SUBJECT = "source";

/** An arrow function whose body spells member chains. */
interface ArrowScope {
  /** Its one parameter's name, or `null` for `() => true`. */
  readonly param: string | null;
  /** Whether its chains are a flow predicate's or a trigger condition's. */
  readonly kind: "predicate" | "condition";
}

/**
 * Every word the grammar puts in a file, with the scope the editor completes it from.
 *
 * A second implementation of `ouroboros-ui`'s `completionPlace`, on the compiler's tree rather
 * than a scanner: an option key is in `<base>.options` and its value in `<base>.<key>`, a stage
 * callee in `loop.stages`, a member after `route.`, `effort.` or an arrow's parameter in
 * `route.methods`, `effort.constants`, `<kind>.subjects` or `<kind>.<subject>`, and a string inside
 * `route.task(…)` or a source method in `route.task` or `source.values`. A predicate-valued key is
 * recorded at its arrow with the form offered there (`(i) => i.effort.`), and `model:` at its call
 * with the snippet offered there (`route.task("")`).
 *
 * @param text - A workflow file.
 * @returns The contexts, by position.
 * @throws {Error} When the file has no `defineLoop` options object.
 */
export function completionContextsOf(text: string): CompletionContext[] {
  const source = parseSource(text);
  const found: CompletionContext[] = [];

  /** Record a word, or — with `offset` 1 — a string literal's content. */
  const record = (node: ts.Node, scope: string, label: string, offset = 0): void => {
    const { line, character } = source.getLineAndCharacterOfPosition(
      node.getStart(source) + offset,
    );
    found.push({ line: line + 1, column: character + 1, scope, label });
  };

  /** A member chain's words after the first. */
  const readMembers = (access: ts.PropertyAccessExpression, arrow: ArrowScope | null): void => {
    const chain = chainOf(access);
    if (chain === undefined) {
      ts.forEachChild(access, (child) => readExpression(child, arrow));
      return;
    }

    for (let index = 1; index < chain.length; index += 1) {
      const scope = memberScope(
        chain.slice(0, index).map((part) => part.text),
        arrow,
      );
      if (scope !== null) record(chain[index], scope, chain[index].text);
    }
  };

  /** String literals, directly or as an array's elements, in one scope. */
  const readStrings = (node: ts.Expression, scope: string): void => {
    if (ts.isStringLiteral(node)) record(node, scope, node.text, 1);
    else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) readStrings(element, scope);
    }
  };

  /** An expression inside a value: calls, member chains, and what they contain. */
  const readExpression = (node: ts.Node, arrow: ArrowScope | null): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? chainOf(node.expression)
        : undefined;
      if (ts.isPropertyAccessExpression(node.expression)) readMembers(node.expression, arrow);

      const scope = callScope(callee?.map((part) => part.text) ?? [], arrow);
      for (const argument of node.arguments) {
        if (scope === null) readExpression(argument, arrow);
        else readStrings(argument, scope);
      }
      return;
    }

    if (ts.isPropertyAccessExpression(node)) {
      readMembers(node, arrow);
      return;
    }

    ts.forEachChild(node, (child) => readExpression(child, arrow));
  };

  /** An options object's keys, and each key's value. */
  const readOptions = (object: ts.ObjectLiteralExpression, base: string): void => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = propertyName(property.name);
      if (key === undefined) continue;

      record(property.name, `${base}.options`, key);
      readValue(property.initializer, `${base}.${key}`, base, key);
    }
  };

  /** One stage call in `stages`. */
  const readStage = (call: ts.CallExpression): void => {
    if (!ts.isIdentifier(call.expression)) return;

    record(call.expression, STAGES_SCOPE, call.expression.text);
    const options = call.arguments[1];
    if (options !== undefined && ts.isObjectLiteralExpression(options)) {
      readOptions(options, `stage.${call.expression.text}`);
    }
  };

  /** A key's value, in the scope `<base>.<key>`. */
  const readValue = (node: ts.Expression, scope: string, base: string, key: string): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      record(node, scope, node.text, 1);
    } else if (
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword ||
      ts.isNumericLiteral(node)
    ) {
      record(node, scope, node.getText(source));
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (scope === STAGES_SCOPE && ts.isCallExpression(element)) readStage(element);
        else if (ts.isObjectLiteralExpression(element)) {
          if (base.startsWith("stage.") && EDGE_LIST_KEYS.has(key)) readOptions(element, "edge");
        } else readValue(element, scope, base, key);
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      if (scope === TRIGGER_SCOPE) readOptions(node, "trigger");
      else if (base.startsWith("stage.") && key === PERMISSIONS_KEY) {
        readOptions(node, PERMISSIONS_KEY);
      }
    } else if (ts.isArrowFunction(node)) {
      const arrow = arrowScope(node, scope === TRIGGER_WHEN_SCOPE ? "condition" : "predicate");
      record(node, scope, arrowForm(node, arrow, source));
      readExpression(node.body, arrow);
    } else {
      const chain =
        ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          ? chainOf(node.expression)
          : undefined;
      if (chain?.[0].text === ROUTE_NAMESPACE) {
        record(node, scope, `${chain.map((part) => part.text).join(".")}("")`);
      }
      readExpression(node, null);
    }
  };

  readOptions(loopOptions(source), "loop");

  return found.sort(
    (a, b) => a.line - b.line || a.column - b.column || (a.scope < b.scope ? -1 : 1),
  );
}

/**
 * A context as the contexts golden records it.
 *
 * @param context - The context.
 * @returns `line:column scope label`.
 * @throws {Error} When the label spans lines, which no offered completion does.
 */
export function formatContext(context: CompletionContext): string {
  if (context.label.includes("\n")) {
    throw new Error(`The context at ${context.line}:${context.column} has a multi-line label.`);
  }
  return `${context.line}:${context.column} ${context.scope} ${context.label}`;
}

/**
 * The contexts a table has something to say about: a scope it offers completions at, or a scope
 * the workspace's suggestions fill.
 *
 * @param table - The static table, or one workspace's.
 * @param text - A workflow file.
 * @returns The contexts, by position.
 */
export function contextsIn(table: CodeSymbolTable, text: string): CompletionContext[] {
  const scopes = new Set<string>([
    ...table.scopes.filter((scope) => scope.completions.length > 0).map((scope) => scope.scope),
    ...Object.values(SUGGESTION_SCOPES),
  ]);

  return completionContextsOf(text).filter((context) => scopes.has(context.scope));
}

/** The labels a table offers at each scope. */
function offeredLabels(table: CodeSymbolTable): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    table.scopes.map((scope) => [
      scope.scope,
      new Set(scope.completions.map((completion) => completion.label)),
    ]),
  );
}

/**
 * The contexts a table does not offer the written word at.
 *
 * @param table - A workspace's table.
 * @param contexts - Contexts in a file.
 * @returns Those whose label is not among the scope's completions.
 */
export function unoffered(
  table: CodeSymbolTable,
  contexts: readonly CompletionContext[],
): CompletionContext[] {
  const labels = offeredLabels(table);
  return contexts.filter((context) => labels.get(context.scope)?.has(context.label) !== true);
}

/** Which reference warning a suggestion scope's unoffered name must carry, and which list it is. */
const SUGGESTION_CHECKS: Readonly<
  Record<string, { readonly code: string; readonly list: keyof StageSuggestions }>
> = {
  [SUGGESTION_SCOPES.skills]: { code: DslWarningCode.REFERENCE_UNKNOWN_SKILL, list: "skills" },
  [SUGGESTION_SCOPES.taskRoutes]: {
    code: DslWarningCode.REFERENCE_UNKNOWN_TASK,
    list: "taskRoutes",
  },
};

/**
 * Where the symbol table and the diagnostics disagree about a file.
 *
 * Every word the grammar writes must be offered where it is written, with one exception decision
 * P7 makes: a skill or task-route name the workspace does not suggest. Such a name is still
 * written, and it is exactly what a reference warning on that stage's lines reports — when the
 * workspace has a list to check it against. Conversely, every such warning must be about a name the
 * table did not offer.
 *
 * @param table - The workspace's table.
 * @param text - The file.
 * @param diagnostics - Its diagnostics in that workspace.
 * @param suggestions - The workspace's suggestions.
 * @returns One sentence per disagreement; empty when they agree.
 */
export function disagreements(
  table: CodeSymbolTable,
  text: string,
  diagnostics: readonly CodeDiagnostic[],
  suggestions: StageSuggestions,
): string[] {
  const missing = unoffered(table, contextsIn(table, text));
  const covers = (diagnostic: CodeDiagnostic, context: CompletionContext) =>
    diagnostic.range.line <= context.line && context.line <= diagnostic.range.endLine;
  const problems: string[] = [];

  for (const context of missing) {
    const check = SUGGESTION_CHECKS[context.scope];
    const where = formatContext(context);

    if (check === undefined) {
      problems.push(`${where}: the table does not offer what the grammar wrote`);
      continue;
    }

    const warned = diagnostics.some(
      (diagnostic) => diagnostic.code === check.code && covers(diagnostic, context),
    );
    const checked = suggestions[check.list].length > 0;
    if (warned !== checked) {
      problems.push(
        checked
          ? `${where}: not offered, and no ${check.code} warns of it`
          : `${where}: nothing was checked, yet ${check.code} warns of it`,
      );
    }
  }

  const codes = new Map(
    Object.entries(SUGGESTION_CHECKS).map(([scope, { code }]) => [code, scope]),
  );
  for (const diagnostic of diagnostics) {
    const scope = codes.get(diagnostic.code);
    if (scope === undefined) continue;

    if (!missing.some((context) => context.scope === scope && covers(diagnostic, context))) {
      problems.push(
        `${diagnostic.code} on lines ${diagnostic.range.line}–${diagnostic.range.endLine}: ` +
          "no name there is missing from the table",
      );
    }
  }

  return problems;
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/**
 * The options object of a file's `export default defineLoop(slug, {…})`.
 *
 * @param source - The parsed file.
 * @returns The object literal.
 * @throws {Error} When there is none.
 */
function loopOptions(source: ts.SourceFile): ts.ObjectLiteralExpression {
  for (const statement of source.statements) {
    const call = ts.isExportAssignment(statement) ? statement.expression : undefined;
    if (
      call !== undefined &&
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === DEFINE_LOOP
    ) {
      const options = call.arguments[1];
      if (options !== undefined && ts.isObjectLiteralExpression(options)) return options;
    }
  }

  throw new Error(`The file has no \`export default ${DEFINE_LOOP}(slug, {…})\`.`);
}

/**
 * A property's name, when it is a plain identifier or a string.
 *
 * @param name - The name node.
 * @returns Its text, or `undefined` for a computed name.
 */
function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * A member chain's words: `i.effort.lte` as `i`, `effort`, `lte`.
 *
 * @param access - The outermost property access.
 * @returns The root identifier and each member, or `undefined` when the root is not an identifier.
 */
function chainOf(access: ts.PropertyAccessExpression): ts.MemberName[] | undefined {
  const members: ts.MemberName[] = [];
  let current: ts.Expression = access;

  while (ts.isPropertyAccessExpression(current)) {
    members.unshift(current.name);
    current = current.expression;
  }

  return ts.isIdentifier(current) ? [current, ...members] : undefined;
}

/**
 * The scope a member chain's next word is completed from — `context.ts`' `memberScope`.
 *
 * @param chain - The words before it.
 * @param arrow - The arrow the chain is in, if any.
 * @returns `route.methods`, `effort.constants`, `<kind>.subjects`, `<kind>.<subject>`, or `null`.
 */
function memberScope(chain: readonly string[], arrow: ArrowScope | null): string | null {
  if (chain.length === 1 && chain[0] === ROUTE_NAMESPACE) return "route.methods";
  if (chain.length === 1 && chain[0] === EFFORT_NAMESPACE) return "effort.constants";
  if (arrow === null || arrow.param === null || chain[0] !== arrow.param) return null;
  if (chain.length === 1) return `${arrow.kind}.subjects`;
  return chain.length === 2 ? `${arrow.kind}.${chain[1]}` : null;
}

/**
 * The scope a call's string arguments are completed from — `context.ts`' `callScope`.
 *
 * @param callee - The callee's words.
 * @param arrow - The arrow the call is in, if any.
 * @returns `route.task`, `source.values` for `<param>.source.<method>`, or `null`.
 */
function callScope(callee: readonly string[], arrow: ArrowScope | null): string | null {
  if (callee.join(".") === ROUTE_TASK) return ROUTE_TASK;

  const isSource =
    arrow !== null &&
    arrow.param !== null &&
    callee.length === 3 &&
    callee[0] === arrow.param &&
    callee[1] === SOURCE_SUBJECT;
  return isSource ? "source.values" : null;
}

/**
 * An arrow function's parameter and kind.
 *
 * @param arrow - The arrow.
 * @param kind - Whether it is a predicate or a trigger condition.
 * @returns Its scope.
 */
function arrowScope(arrow: ts.ArrowFunction, kind: ArrowScope["kind"]): ArrowScope {
  const [parameter] = arrow.parameters;
  const param =
    arrow.parameters.length === 1 && ts.isIdentifier(parameter.name) ? parameter.name.text : null;

  return { param, kind };
}

/**
 * The form a predicate-valued key offers that an arrow was written from.
 *
 * @param arrow - The arrow.
 * @param scope - Its parameter and kind.
 * @param source - The parsed file.
 * @returns `() => true`, or `(i) => i.<subject>.` for the subject its first conjunct reads.
 */
function arrowForm(arrow: ts.ArrowFunction, scope: ArrowScope, source: ts.SourceFile): string {
  if (scope.param === null) return `() => ${arrow.body.getText(source)}`;

  let current: ts.Node = arrow.body;
  for (;;) {
    if (ts.isBinaryExpression(current)) current = current.left;
    else if (ts.isParenthesizedExpression(current) || ts.isCallExpression(current)) {
      current = current.expression;
    } else break;
  }

  const chain = ts.isPropertyAccessExpression(current) ? chainOf(current) : undefined;
  const subject = chain !== undefined && chain[0].text === scope.param ? chain[1]?.text : undefined;

  return subject === undefined
    ? `(${scope.param}) => ${arrow.body.getText(source)}`
    : `(${scope.param}) => ${scope.param}.${subject}.`;
}

/**
 * The 1-based line an offset is on.
 *
 * @param source - The parsed file.
 * @param offset - The offset.
 * @returns The line.
 */
function lineOf(source: ts.SourceFile, offset: number): number {
  return source.getLineAndCharacterOfPosition(offset).line + 1;
}

/**
 * Lines with some removed and some inserted, joined back into a file.
 *
 * @param lines - The file's lines.
 * @param start - Where to start, 0-based.
 * @param remove - How many to remove.
 * @param insert - What to insert there; an entry may itself hold line feeds.
 * @returns The file.
 */
function spliced(lines: readonly string[], start: number, remove: number, ...insert: string[]) {
  const copy = [...lines];
  copy.splice(start, remove, ...insert);
  return copy.join("\n");
}

/**
 * Apply edits, each to its first occurrence, failing loudly when one no longer applies.
 *
 * @param name - The case the edits make, for the error.
 * @param text - The file.
 * @param edits - `[from, to]` pairs, applied in order.
 * @returns The edited file.
 * @throws {Error} When a `from` is not in the text.
 */
function replaceAll(name: string, text: string, edits: readonly [string, string][]): string {
  return edits.reduce((edited, [from, to]) => {
    const at = edited.indexOf(from);
    if (at === -1) {
      throw new Error(
        `The "${name}" case no longer applies: the printed standard-fix has no ` +
          `${JSON.stringify(from)}. Rewrite the case against the new print.`,
      );
    }
    return edited.slice(0, at) + to + edited.slice(at + from.length);
  }, text);
}
