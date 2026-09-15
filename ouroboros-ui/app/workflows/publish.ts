/**
 * The publish dialog, decided — S.6 ([#152](https://github.com/NobuData/ouroboros/issues/152)).
 *
 * **Publish v15** freezes the draft as the next version behind two validators. What the reader needs
 * from a refusal is not *invalid workflow* but *which stage, and why* — so every finding the service
 * returns is anchored to a stage where it can be, and the dialog lists it as a control that selects
 * that stage on the canvas.
 *
 * **Framework-free and pure**, like `view.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { WorkflowDefinition, WorkflowFinding } from "@/app/api/workflows";

import { WORKFLOW_DRAFT_CONFLICT } from "./autosave";

/**
 * The code a `422` answers when a validator refused the definition; `details.findings` carries why.
 * Named here for `autosave.ts`' `WORKFLOW_DRAFT_CONFLICT`'s reason: a Client Component cannot import a
 * value from the server-only `app/api/workflows.ts`.
 */
export const WORKFLOW_DEFINITION_INVALID = "workflow_definition_invalid";

/** The longest change note the service keeps — `workflow_versions_change_note_present`. */
export const CHANGE_NOTE_MAX = 500;

/** The dialog's change-note label. */
export const CHANGE_NOTE_LABEL = "Change note";

/** …and its hint. */
export const CHANGE_NOTE_HINT = "Optional — what changed, in your words. It is kept with the version.";

/** What the dialog says it does, under its title. */
export const PUBLISH_NOTE =
  "The draft is checked by both validators and, when both are green, frozen as the next version. " +
  "Runs queued from now on use it; the draft stays open for the next edit.";

/** The dialog's cancel. */
export const PUBLISH_CANCEL = "Cancel";

/** What the dialog says while the publish is in flight. */
export const PUBLISHING = "Checking and publishing…";

/** The findings list's accessible name. */
export const FINDINGS_LABEL = "Validation findings";

/** How each validator is named beside a finding. */
export const FINDING_SOURCE_WORDS: Readonly<Record<WorkflowFinding["source"], string>> = {
  dsl: "DSL",
  registry: "Registry",
  engine: "Engine",
};

/**
 * The note as the service takes it.
 *
 * @param note What is in the box.
 * @returns The note without surrounding whitespace, or `undefined` for an empty box — the contract
 *   refuses a blank note, and a publish with nothing to say sends none.
 */
export function changeNoteBody(note: string): string | undefined {
  const trimmed = note.trim();

  return trimmed === "" ? undefined : trimmed;
}

/**
 * Why the note cannot be sent, or `undefined` when it can.
 *
 * @param note What is in the box.
 * @returns The reason, for a note past {@link CHANGE_NOTE_MAX}.
 */
export function changeNoteProblem(note: string): string | undefined {
  return note.trim().length > CHANGE_NOTE_MAX
    ? `A change note is at most ${CHANGE_NOTE_MAX} characters.`
    : undefined;
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
 * The findings a refusal carries, read defensively.
 *
 * @param details The refusal's `details`.
 * @returns Every finding with a message, in the service's order; a malformed entry is dropped rather
 *   than printed as a blank line.
 */
export function readFindings(details: unknown): readonly WorkflowFinding[] {
  if (!isRecord(details) || !Array.isArray(details.findings)) return [];

  return details.findings.flatMap((finding: unknown): WorkflowFinding[] => {
    if (!isRecord(finding) || typeof finding.message !== "string" || typeof finding.code !== "string") {
      return [];
    }

    const source = finding.source === "registry" || finding.source === "engine" ? finding.source : "dsl";
    const edge =
      isRecord(finding.edge) && typeof finding.edge.from === "string" && typeof finding.edge.to === "string"
        ? { from: finding.edge.from, to: finding.edge.to }
        : undefined;

    return [
      {
        source,
        code: finding.code,
        message: finding.message,
        ...(typeof finding.path === "string" ? { path: finding.path } : {}),
        ...(typeof finding.node === "string" ? { node: finding.node } : {}),
        ...(edge === undefined ? {} : { edge }),
      },
    ];
  });
}

/** A JSON Pointer into the document's node list — `/nodes/3`, `/nodes/3/config/routing`. */
const NODE_POINTER = /^\/nodes\/(\d+)(?:\/|$)/;

/**
 * The stage a finding is about, when it is about one the canvas holds.
 *
 * In the order a finding says it most precisely: its `node`; the stage an `edge` leaves, because an
 * edge is configured from the stage it leaves; or the node a `path` points into.
 *
 * @param finding The finding.
 * @param definition The draft the finding was produced for.
 * @returns The stage's id, or `null` for a finding about the document as a whole — which is listed
 *   but has nothing to select.
 */
export function findingAnchor(finding: WorkflowFinding, definition: WorkflowDefinition): string | null {
  const nodes = Array.isArray(definition.nodes) ? (definition.nodes as unknown[]) : [];
  const known = (id: string) => nodes.some((node) => isRecord(node) && node.id === id);

  if (finding.node !== undefined && known(finding.node)) return finding.node;
  if (finding.edge !== undefined && known(finding.edge.from)) return finding.edge.from;

  const pointed = finding.path === undefined ? null : NODE_POINTER.exec(finding.path);
  if (pointed !== null) {
    const node = nodes[Number(pointed[1])];
    if (isRecord(node) && typeof node.id === "string") return node.id;
  }

  return null;
}

/** What a refused publish shows: a sentence, and the findings when there are any. */
export interface PublishFailure {
  readonly message: string;
  readonly findings: readonly WorkflowFinding[];
}

/** The lead sentence over a list of findings. */
export const FINDINGS_MESSAGE =
  "This definition cannot be published yet. Select a finding to go to the stage it is about — nothing was published.";

/** What a publish refused for a draft that moved says. */
export const PUBLISH_CONFLICT_MESSAGE =
  "The draft changed while it was being published, so nothing was published. Reload it and publish again.";

/** What a publish refused because the engine could not answer says. */
export const ENGINE_UNAVAILABLE_MESSAGE =
  "The engine could not check this definition, so nothing was published. Try again in a moment.";

/** What a publish that could not start — the draft's own save refused — says. */
export const UNSAVED_MESSAGE =
  "The latest edit could not be saved, so publishing it would publish an older draft. Nothing was published.";

/**
 * What a refused publish tells the reader.
 *
 * @param refusal The service's envelope.
 * @returns The sentence and, for a definition a validator refused, the findings.
 */
export function publishFailure(refusal: ErrorEnvelope): PublishFailure {
  switch (refusal.code) {
    case WORKFLOW_DEFINITION_INVALID:
      return { message: FINDINGS_MESSAGE, findings: readFindings(refusal.details) };
    case WORKFLOW_DRAFT_CONFLICT:
      return { message: PUBLISH_CONFLICT_MESSAGE, findings: [] };
    case "engine_unavailable":
      return { message: ENGINE_UNAVAILABLE_MESSAGE, findings: [] };
    default:
      return { message: refusal.message, findings: [] };
  }
}

/**
 * What an anchored finding's control says it does.
 *
 * @param stageTitle The stage's title, or its id when it has none.
 * @returns *Select Code the change*.
 */
export function findingTarget(stageTitle: string): string {
  return `Select ${stageTitle}`;
}

/** The toast's dismissal, for a reader who cannot see the ×. */
export const DISMISS_TOAST_LABEL = "Dismiss";

/**
 * The toast a publish that took leaves.
 *
 * @param version The number now in force.
 * @returns The sentence.
 */
export function publishedToast(version: number): string {
  return `Published v${version}. Runs queued from now on use it.`;
}
