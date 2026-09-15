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
import type { WorkflowCode, WorkflowRailEntry } from "@/app/api/workflows";

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
}

/**
 * Whether a value is a plain object.
 *
 * @param value Anything.
 * @returns `true` for a non-null object that is not an array.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
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
  return `${slug}.loop.ts`;
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

/** Mockup 05's ghost action. */
export const VALIDATE_LABEL = "Validate";

/** Why **Validate** cannot act yet — V.6 runs it, and fills Loop Checks with what it finds. */
export const VALIDATE_SOON =
  "Validating arrives with #174 — it runs the shared checks and fills Loop Checks without " +
  "publishing.";

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

/** The file card's accessible name. */
export const FILE_LABEL = "Workflow code";

/**
 * What the file card says about a file this reader cannot change: a published version, or any
 * file for a role that may not publish.
 */
export const FILE_READ_ONLY_NOTE = "Read-only";

/**
 * What the file card says about a file the editor lets this reader type into.
 *
 * The editor is V.2 ([#170](https://github.com/NobuData/ouroboros/issues/170)); the save loop is
 * V.4 ([#172](https://github.com/NobuData/ouroboros/issues/172)). Until it lands, a change stays
 * in the tab, and saying so is the difference between an honest editor and one that loses work
 * silently.
 */
export const FILE_UNSAVED_NOTE = "Edits are not saved yet — saving arrives with #172.";

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
 * The file card's note about editing.
 *
 * @param editable What {@link fileEditable} decided.
 * @returns {@link FILE_UNSAVED_NOTE} or {@link FILE_READ_ONLY_NOTE}.
 */
export function fileEditNote(editable: boolean): string {
  return editable ? FILE_UNSAVED_NOTE : FILE_READ_ONLY_NOTE;
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
