/**
 * Every decision the code route makes, as functions with inputs and outputs (V.1,
 * [#169](https://github.com/NobuData/ouroboros/issues/169)) — mockup 05's page head, and the
 * states the code view can be in.
 *
 * `docs/mockups/05-workflow-code.html` heads the page with the file's name, one fixed promise and
 * two actions: *Workflow Studio* · `standard-fix.loop.ts` · *The same loop as the visual canvas —
 * every graph compiles to this typed DSL and back, losslessly.* · **Validate** · **Publish v15**.
 * What varies is which workflow is open and whether its file could be read, and those are
 * judgements about two reads, so they live here beside the visual editor's own
 * (`app/workflows/states.ts`), whose sentences they reuse where the fact is the same one.
 *
 * **Framework-free and pure**, like `app/workflows/view.ts`: nothing here imports React,
 * `next/*` or the server-only client. The read is `code-data.ts`'s and the drawing is
 * `code-screen.tsx`'s.
 *
 * ### The states
 *
 * | State | What is true |
 * |---|---|
 * | `failed` | the rail read was refused |
 * | `empty` | read fine, no workflows |
 * | `missing` | read fine, the URL names a slug the rail does not hold |
 * | `unread` | the rail has it; the file was refused for a reason other than the one below |
 * | `unprojectable` | the rail has it; its draft has no faithful spelling as code yet (`409`) |
 * | `populated` | both reads answered |
 *
 * `unprojectable` is the code view's own. U.3 shows a draft as code only when the file would
 * read back as that same draft, so a half-built draft — the blank canvas **+ New workflow**
 * leaves — is refused with the validator's findings. That is not a failure to explain with a
 * retry: nothing about the request is wrong, and the way forward is to finish the draft on the
 * canvas.
 */

import type { Reading } from "@/app/api/reading";
import type {
  CodeSymbolTable,
  WorkflowCode,
  WorkflowCodeChecks,
  WorkflowCodeConfig,
  WorkflowCodeTree,
  WorkflowRailEntry,
} from "@/app/api/workflows";

import {
  EMPTY_TITLE,
  FAILED_SUBLINE,
  FAILED_TITLE,
  MISSING_TITLE,
  SEAT_FAILED_NOTE,
  type SeatCopy,
  type StudioHead,
} from "../states";
import { versionWord } from "../view";

/* ------------------------------------------------------------------ what the route reads */

/**
 * One thing the validator reports about a draft that cannot be shown as code — an entry of the
 * `409`'s `details.findings`.
 */
export interface CodeFinding {
  /** What a person should read. */
  readonly message: string;
  /** The id of the stage it is about, or `null` when it is about no one stage. */
  readonly node: string | null;
  /** The JSON Pointer to the offending value; `""` is the document itself. */
  readonly path: string;
}

/** The file read, or why it could not be read. */
export type FileReading =
  /** The file, with the draft's etag. */
  | { readonly kind: "file"; readonly file: WorkflowCode }
  /** The draft has no faithful spelling as code yet — `reason` is the service's sentence. */
  | {
      readonly kind: "unprojectable";
      readonly reason: string;
      readonly findings: readonly CodeFinding[];
    }
  /** Any other refusal, with the service's sentence. */
  | { readonly kind: "failed"; readonly reason: string };

/** The workflow the code view is open on: its rail entry and its file. */
export interface SelectedFile {
  readonly entry: WorkflowRailEntry;
  readonly file: FileReading;
}

/**
 * Everything the code route was able to read.
 *
 * The rail is read first, for `app/workflows/data.ts`'s reason: a slug the workspace does not
 * have is answered from the listing and costs no second request — and the rail carries the
 * version in force, which **Publish vN+1** counts from even when the file could not be read.
 */
export interface CodeReadings {
  /** The rail, or why it could not be read. */
  readonly rail: Reading<readonly WorkflowRailEntry[]>;
  /** The slug the URL named. The code route always names one. */
  readonly requested: string;
  /** The workflow and its file, or `null` when the rail was refused, empty, or lacks the slug. */
  readonly selected: SelectedFile | null;
  /**
   * The explorer's two reads (V.3, [#171](https://github.com/NobuData/ouroboros/issues/171)), or
   * `null` when the rail was refused or is empty — the two states that draw no explorer, so
   * nothing is asked for.
   */
  readonly explorer: ExplorerReadings | null;
  /**
   * The right panel's two reads (V.5, [#173](https://github.com/NobuData/ouroboros/issues/173)), or
   * `null` when there is no workflow to check — a refused or empty rail, or a slug it lacks.
   */
  readonly panel: PanelReadings | null;
}

/**
 * The right panel's reads: the workflow's Loop Checks and the code symbol table. Each is its own
 * reading, so a refused one degrades its own section and nothing else.
 */
export interface PanelReadings {
  /** The Loop Checks rows, or why they could not be read. */
  readonly checks: Reading<WorkflowCodeChecks>;
  /** The symbol table the Types card is drawn from, or why it could not be read. */
  readonly symbols: Reading<CodeSymbolTable>;
}

/**
 * The explorer's reads: the file list and `ouroboros.config.ts`. Each is its own reading, so a
 * refused one degrades its own region — the tree, or the configuration's pane — and nothing else.
 */
export interface ExplorerReadings {
  /** The explorer's files, or why they could not be read. */
  readonly tree: Reading<WorkflowCodeTree>;
  /** The configuration projection, or why it could not be read. */
  readonly config: Reading<WorkflowCodeConfig>;
}

/**
 * Whether a value is a plain object.
 *
 * @param value Anything.
 * @returns `true` for a non-null object that is not an array.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the findings out of a `409 workflow_code_unprojectable`'s `details`.
 *
 * **Defensive on purpose**: `details` is typed by the contract as an open object, so each entry
 * is read for the three fields drawn and an entry without a message is skipped rather than
 * printed as a blank line.
 *
 * @param details The refusal's `details`.
 * @returns The findings, in the order the service gave them.
 */
export function readFindings(details: unknown): readonly CodeFinding[] {
  if (!isRecord(details) || !Array.isArray(details.findings)) return [];

  return details.findings.flatMap((finding: unknown) =>
    isRecord(finding) && typeof finding.message === "string"
      ? [
          {
            message: finding.message,
            node: typeof finding.node === "string" ? finding.node : null,
            path: typeof finding.path === "string" ? finding.path : "",
          },
        ]
      : [],
  );
}

/* ------------------------------------------------------------------ the page's state */

/** Which of the code view's states the two reads put it in. */
export type CodeState =
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "empty" }
  | { readonly kind: "missing"; readonly slug: string }
  | { readonly kind: "unread"; readonly entry: WorkflowRailEntry; readonly reason: string }
  | {
      readonly kind: "unprojectable";
      readonly entry: WorkflowRailEntry;
      readonly reason: string;
      readonly findings: readonly CodeFinding[];
    }
  | { readonly kind: "populated"; readonly entry: WorkflowRailEntry; readonly file: WorkflowCode };

/**
 * Decide the code view's state from its reads — in `studioState`'s order, for its reasons.
 *
 * @param readings What the route read.
 * @returns The state.
 */
export function codeState(readings: CodeReadings): CodeState {
  if (!readings.rail.ok) return { kind: "failed", reason: readings.rail.reason };
  if (readings.rail.value.length === 0) return { kind: "empty" };

  const { selected } = readings;
  if (selected === null) return { kind: "missing", slug: readings.requested };

  const { entry, file } = selected;
  switch (file.kind) {
    case "file":
      return { kind: "populated", entry, file: file.file };
    case "unprojectable":
      return { kind: "unprojectable", entry, reason: file.reason, findings: file.findings };
    case "failed":
      return { kind: "unread", entry, reason: file.reason };
  }
}

/**
 * The workflow the page is about, in the three states that have one.
 *
 * @param state The page's state.
 * @returns Its rail entry, or `null` when nothing is selected.
 */
export function codeEntry(state: CodeState): WorkflowRailEntry | null {
  return state.kind === "populated" || state.kind === "unread" || state.kind === "unprojectable"
    ? state.entry
    : null;
}

/* ------------------------------------------------------------------ the page head */

/** Mockup 05's subline, verbatim — the page's central promise. */
export const CODE_SUBLINE =
  "The same loop as the visual canvas — every graph compiles to this typed DSL and back, losslessly.";

/** What every workflow's file name ends with. */
export const WORKFLOW_FILE_SUFFIX = ".loop.ts";

/**
 * A workflow's file name, as the `<h1>` prints it — mockup 05's `standard-fix.loop.ts`.
 *
 * From the slug rather than from the file's `path`, because the head is drawn in the states in
 * which no file was read too; U.3 names every file `workflows/<slug>.loop.ts`, so the two agree.
 *
 * @param slug The workflow's slug.
 * @returns `<slug>.loop.ts`.
 */
export function fileName(slug: string): string {
  return `${slug}${WORKFLOW_FILE_SUFFIX}`;
}

/** The subline for a workspace with no workflows — the code route has no rail, so it points at Visual's. */
export const CODE_EMPTY_SUBLINE =
  "This workspace has no workflows, so there is no code to read. The Visual tab's rail is " +
  "where one begins.";

/**
 * The subline for a URL naming a workflow the rail does not hold.
 *
 * @param slug What the URL named — printed as text, never interpreted.
 * @returns The sentence.
 */
export function codeMissingSubline(slug: string): string {
  return `This workspace has no workflow called "${slug}". The Visual tab lists every workflow it has.`;
}

/**
 * The head, for a state.
 *
 * Every state with a workflow prints its file name and mockup 05's promise, including the two
 * whose file could not be shown: the name is the rail's fact, and the promise is the page's, not
 * a claim about this read. Why the file is missing is the banner's or the seat's to say.
 *
 * @param state The page's state.
 * @returns The title and the subline.
 */
export function codeHead(state: CodeState): StudioHead {
  switch (state.kind) {
    case "failed":
      return { title: FAILED_TITLE, subline: FAILED_SUBLINE };
    case "empty":
      return { title: EMPTY_TITLE, subline: CODE_EMPTY_SUBLINE };
    case "missing":
      return { title: MISSING_TITLE, subline: codeMissingSubline(state.slug) };
    case "unread":
    case "unprojectable":
    case "populated":
      return { title: fileName(state.entry.slug), subline: CODE_SUBLINE };
  }
}

/* ------------------------------------------------------------------ the actions */

/**
 * Mockup 05's ghost action — V.6's **Validate** (#174). Its flow and its reasons are `code-flows.ts`'.
 */
export const VALIDATE_LABEL = "Validate";

/* ------------------------------------------------------------------ the failed banner */

/** The banner's headline for a file that could not be read. */
export const CODE_FAILED_HEADLINE = "This workflow's code could not be read.";

/* ------------------------------------------------------------------ the seat */

/** The states in which no file is drawn and the seat explains why. */
export type CodeSeatState = Extract<CodeState, { kind: "failed" | "empty" | "missing" | "unread" }>;

/** The seat's title when there is nothing to show. */
export const CODE_SEAT_NOTHING_TITLE = "No code to show";

/** The seat's title for an empty workspace. */
export const CODE_SEAT_EMPTY_TITLE = "No code yet";

/** …and its note. */
export const CODE_SEAT_EMPTY_NOTE =
  "A workflow's code is its definition, printed. Create a workflow from the Visual tab's " +
  "rail, and its file opens here.";

/** The seat's title for a slug the rail does not hold. */
export const CODE_SEAT_MISSING_TITLE = "No such file";

/** The seat's note for a file that could not be read. */
export const CODE_SEAT_UNREAD_NOTE =
  "The file could not be read, so there is nothing to show. The banner above says why.";

/**
 * What the seat says, for a state in which no file is drawn.
 *
 * @param state The page's state.
 * @returns The title and the note.
 */
export function codeSeatCopy(state: CodeSeatState): SeatCopy {
  switch (state.kind) {
    case "failed":
      return { title: CODE_SEAT_NOTHING_TITLE, note: SEAT_FAILED_NOTE };
    case "empty":
      return { title: CODE_SEAT_EMPTY_TITLE, note: CODE_SEAT_EMPTY_NOTE };
    case "missing":
      return {
        title: CODE_SEAT_MISSING_TITLE,
        note: `Nothing in this workspace is called ${fileName(state.slug)}.`,
      };
    case "unread":
      return { title: CODE_SEAT_NOTHING_TITLE, note: CODE_SEAT_UNREAD_NOTE };
  }
}

/** The title over a draft that has no faithful spelling as code yet. */
export const UNPROJECTABLE_TITLE = "Not readable as code yet";

/** The way forward from it — to the visual editor, where the draft can be finished. */
export const UNPROJECTABLE_ACTION = "Finish it in Visual";

/**
 * One finding, as a line of the list under the unprojectable seat.
 *
 * @param finding The finding.
 * @returns The message, led by the stage it is about when it is about one.
 */
export function findingLine(finding: CodeFinding): string {
  return finding.node === null ? finding.message : `${finding.node}: ${finding.message}`;
}

/* ------------------------------------------------------------------ the file */

/** The workbench's accessible name — the card holding the explorer, the tabs and the open file. */
export const FILE_LABEL = "Workflow code";

/**
 * What the file card says about a file this reader cannot change: a published version, or any
 * file for a role that may not publish. A file the reader can type into says where its save stands
 * instead — `code-save.ts`' `codeSaveNote` (V.4, [#172](https://github.com/NobuData/ouroboros/issues/172)).
 */
export const FILE_READ_ONLY_NOTE = "Read-only";

/**
 * Whether the editor lets this reader type into the file.
 *
 * @param file The file. `readOnly` is the service's word: a published version is never edited.
 * @param mayAdminister Whether the reader's role may publish, decided at the gate. A member reads
 *   the file and does not change it, as on the visual editor.
 * @returns `true` only when both allow it.
 */
export function fileEditable(file: WorkflowCode, mayAdminister: boolean): boolean {
  return mayAdminister && !file.readOnly;
}

/**
 * Where the file's text was printed from, in words.
 *
 * @param file The file.
 * @returns *Printed from the draft*, or — for a workflow with no draft open, whose file is the
 *   version in force — *Printed from v14 · no draft open*.
 */
export function fileSource(file: WorkflowCode): string {
  return file.version === null
    ? "Printed from the draft"
    : `Printed from ${versionWord(file.version)} · no draft open`;
}

/* ------------------------------------------------------------------ the virtual project (V.3) */

/** The directory U.3 serves every workflow's file from — `workflows/standard-fix.loop.ts`. */
export const WORKFLOW_FILE_DIRECTORY = "workflows";

/**
 * The configuration projection's path — typed as the contract's constant, so a renamed file is a
 * build error here rather than a tab that silently never matches.
 */
export const CONFIG_FILE_PATH: WorkflowCodeConfig["path"] = "ouroboros.config.ts";

/**
 * Where a workflow's file sits in the virtual project.
 *
 * @param slug The workflow's slug.
 * @returns `workflows/<slug>.loop.ts` — the `path` U.3 serves for it.
 */
export function workflowFilePath(slug: string): string {
  return `${WORKFLOW_FILE_DIRECTORY}/${fileName(slug)}`;
}

/**
 * The workflow a path names — {@link workflowFilePath} read backwards.
 *
 * @param path A path from the explorer or a tab. A tab may have come back from session storage,
 *   so the path is not trusted.
 * @returns The slug, or `null` for anything that is not exactly one workflow's file —
 *   `ouroboros.config.ts`, a nested path, an empty name.
 */
export function slugOfPath(path: string): string | null {
  const prefix = `${WORKFLOW_FILE_DIRECTORY}/`;
  if (!path.startsWith(prefix) || !path.endsWith(WORKFLOW_FILE_SUFFIX)) return null;

  const slug = path.slice(prefix.length, path.length - WORKFLOW_FILE_SUFFIX.length);
  return slug === "" || slug.includes("/") ? null : slug;
}

/**
 * A path's last segment — what a row and a tab print.
 *
 * @param path The path.
 * @returns `standard-fix.loop.ts` for `workflows/standard-fix.loop.ts`; the path itself when it
 *   has no directory.
 */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The explorer's accessible name — mockup 05's `aria-label`. */
export const EXPLORER_LABEL = "File explorer";

/**
 * The explorer's head — mockup 05's `Explorer · helios-firmware`.
 *
 * @param workspaceName The workspace's display name; empty when the screen was not told it.
 * @returns The head, without a separator when there is no name to follow it.
 */
export function explorerHead(workspaceName: string): string {
  return workspaceName === "" ? "Explorer" : `Explorer · ${workspaceName}`;
}

/** The tree's accessible name. */
export const TREE_LABEL = "Files";

/** The tab strip's accessible name. */
export const TABS_LABEL = "Open files";

/** The badge on a file no save can change — `ouroboros.config.ts`. */
export const READ_ONLY_BADGE = "read-only";

/** What a screen reader hears after a paused workflow's name, where the page draws the err-dot. */
export const PAUSED_NOTE = "paused";

/** What a screen reader hears after a tab's name, where the page draws the modified-dot. */
export const MODIFIED_NOTE = "unsaved changes";

/**
 * A tab's close button's tooltip.
 *
 * @param path The tab's file.
 * @returns `Close standard-fix.loop.ts`.
 */
export function closeTabLabel(path: string): string {
  return `Close ${baseName(path)}`;
}

/** The explorer's title when the file list could not be read. */
export const TREE_FAILED_TITLE = "The file list could not be read.";

/**
 * The reason standing in for an explorer that was never read. The route reads the explorer in
 * every state that draws one, so this completes a type rather than naming a state a reader meets.
 */
export const EXPLORER_UNREAD_REASON = "The file list was not read.";

/** Both explorer reads, unread — see {@link EXPLORER_UNREAD_REASON}. */
export const UNREAD_EXPLORER: ExplorerReadings = {
  tree: { ok: false, reason: EXPLORER_UNREAD_REASON },
  config: { ok: false, reason: EXPLORER_UNREAD_REASON },
};

/** Where `ouroboros.config.ts` came from, and that it cannot be typed into. */
export const CONFIG_SOURCE = "Printed from the registry · Read-only";

/** The pane's title when `ouroboros.config.ts` could not be read. */
export const CONFIG_FAILED_TITLE = "ouroboros.config.ts could not be read.";

/** The pane's title when every tab is closed. */
export const NOTHING_OPEN_TITLE = "No file open";

/** …and its note. */
export const NOTHING_OPEN_NOTE = "Every tab is closed. Open a file from the explorer.";
