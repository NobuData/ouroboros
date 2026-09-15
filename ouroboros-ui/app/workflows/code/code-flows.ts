/**
 * The code view's **Validate** and **Publish**, decided — V.6
 * ([#174](https://github.com/NobuData/ouroboros/issues/174)).
 *
 * Both run the pipelines the visual editor runs, and neither acts on a file the draft does not hold:
 *
 * - **Validate** writes what is waiting first, then asks the publish gate — zod, the registry, then the
 *   engine — about the stored draft, and **publishes nothing**. Its findings fill Loop Checks and are drawn
 *   in the editor. This is *check my work*, the affordance publishing must not be.
 * - **Publish** opens S.6's shared dialog ([#152](https://github.com/NobuData/ouroboros/issues/152)), which
 *   writes what is waiting, then publishes through the same `publishWorkflow` the canvas calls. A refusal's
 *   findings are anchored in the file (`code-findings.ts`); a success moves the version, which is the
 *   visual editor's head's version too, because it is the same workflow.
 *
 * A file that does not parse, a conflict and a failed write each stop both before the service is asked:
 * validating or publishing then would be about an older draft than the text on the screen.
 *
 * **Framework-free and pure**, like `publish.ts`.
 */

import type { ErrorEnvelope } from "@/app/api/errors";
import type { WorkflowCodeValidation } from "@/app/api/workflows";

import { PUBLISH_CONFLICT_MESSAGE, UNSAVED_MESSAGE } from "../publish";
import type { CodeSaveState } from "./code-save";

/** A sentence the head leaves after a flow, and whether it reports a success or a stop. */
export interface FlowNotice {
  readonly tone: "ok" | "err";
  readonly text: string;
}

/** Why **Validate** cannot act while a validation is already in flight. */
export const VALIDATING = "Validating…";

/** Why **Validate** cannot act on a page with no file. */
export const VALIDATE_NEEDS_FILE = "Validating checks this workflow's file, and this page has none it could read.";

/** Why **Publish** cannot act from a code view with no file. */
export const PUBLISH_NEEDS_FILE =
  "Publishing from the code view saves this workflow's file first, and this page has none it could read.";

/** What a green validation says. */
export const VALIDATED_MESSAGE = "Validated — every check is green. Nothing was published.";

/** Added when an earlier stage refused, so the engine's opinion is not part of the verdict. */
export const ENGINE_NOT_ASKED_NOTE = "The engine was not asked, because an earlier check refused first.";

/** What a validation stopped by a file that does not parse says. */
export const VALIDATE_UNPARSED_MESSAGE = "This file does not parse yet, so nothing was validated. Fix the marked lines first.";

/** What a validation stopped by a conflict says. */
export const VALIDATE_CONFLICT_MESSAGE =
  "The draft changed in another editor, so nothing was validated. Choose between your text and the draft first.";

/** What a validation stopped by a failed write says. */
export const VALIDATE_UNSAVED_MESSAGE =
  "The latest edit could not be saved, so validating would check an older draft. Nothing was validated.";

/** What a validation the engine could not answer says. */
export const VALIDATE_ENGINE_UNAVAILABLE_MESSAGE =
  "The engine could not check this file, so it was not validated. Try again in a moment.";

/** What a publish stopped by a file that does not parse says. */
export const PUBLISH_UNPARSED_MESSAGE =
  "This file does not parse yet, so publishing would publish an older draft. Nothing was published.";

/**
 * What a validation that answered says.
 *
 * @param validation The service's verdict.
 * @returns A success for no findings; otherwise how many, where they are drawn, that nothing was published,
 *   and — when an earlier stage refused — that the engine was not asked.
 */
export function validationNotice(validation: WorkflowCodeValidation): FlowNotice {
  const count = validation.findings.length;
  if (count === 0) return { tone: "ok", text: VALIDATED_MESSAGE };

  const found =
    `Validation found ${count} ${count === 1 ? "finding" : "findings"} — marked in the file and counted ` +
    "in Loop Checks. Nothing was published.";

  return { tone: "err", text: validation.engineConsulted ? found : `${found} ${ENGINE_NOT_ASKED_NOTE}` };
}

/**
 * What a refused validation says.
 *
 * @param refusal The service's envelope.
 * @returns The engine's outage in the page's words, else the service's own sentence.
 */
export function validateRefusal(refusal: ErrorEnvelope): string {
  return refusal.code === "engine_unavailable" ? VALIDATE_ENGINE_UNAVAILABLE_MESSAGE : refusal.message;
}

/**
 * Why the file cannot be validated after writing what was waiting, if it cannot.
 *
 * @param state Where the save stood once flushed.
 * @returns The sentence, or `null` when the draft holds the text on the screen.
 */
export function unvalidatable(state: CodeSaveState): string | null {
  switch (state) {
    case "invalid":
      return VALIDATE_UNPARSED_MESSAGE;
    case "conflict":
      return VALIDATE_CONFLICT_MESSAGE;
    case "failed":
      return VALIDATE_UNSAVED_MESSAGE;
    default:
      return null;
  }
}

/**
 * Why the file cannot be published after writing what was waiting, if it cannot.
 *
 * @param state Where the save stood once flushed.
 * @returns The sentence — the visual editor's own for a conflict and a failed write — or `null`.
 */
export function unpublishable(state: CodeSaveState): string | null {
  switch (state) {
    case "invalid":
      return PUBLISH_UNPARSED_MESSAGE;
    case "conflict":
      return PUBLISH_CONFLICT_MESSAGE;
    case "failed":
      return UNSAVED_MESSAGE;
    default:
      return null;
  }
}

/**
 * The version in force, as the page knows it.
 *
 * @param read What the route read — the rail's `currentVersion`, which a refresh moves.
 * @param published The version a publish from this page answered with, or `null` for none.
 * @returns The later of the two, so the head moves the moment a publish takes and never back when the
 *   refreshed read catches up.
 */
export function latestVersion(read: number | null, published: number | null): number | null {
  if (read === null) return published;
  if (published === null) return read;
  return Math.max(read, published);
}
