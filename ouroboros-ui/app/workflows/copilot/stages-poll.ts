/**
 * The stage list's poll (CE.3, [#567](https://github.com/NobuData/ouroboros/issues/567)) — the
 * I.8 poll family (`app/poll.ts`) over `GET /api/workflows/:id/copilot/draft`.
 *
 * The loop is the family's: every fifteen seconds while the tab is visible, not at all while it
 * is hidden, at once when it comes back. The card adds the two things that are its own — it asks
 * again when the window regains focus, and it does not ask while a reply is streaming, because
 * the stream is then the newer account of the draft.
 */

import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

import { type StageDraft, UNREACHABLE_DRAFT, UNREADABLE_DRAFT } from "./stages";

/** How the draft is read — this origin's route by default. */
export type StagesReader = PollReader<StageDraft>;

/** The poll's options, with a seam for the reader. */
export interface StagesPollOptions extends PollOptions {
  /** How to make one read of an endpoint. Defaults to {@link requestStageDraft}. */
  read?: (endpoint: string, etag: string | null) => ReturnType<typeof requestStageDraft>;
}

/**
 * Where the browser asks — **this origin**, not `ouroboros-rest`.
 *
 * @param workflowId The workflow.
 * @returns `/api/workflows/{id}/copilot/draft`.
 */
export function stagesEndpoint(workflowId: string): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/copilot/draft`;
}

/**
 * Whether a payload is shaped like a draft — enough to compose rows from.
 *
 * @param value What arrived.
 * @returns True for a draft.
 */
export function isStageDraft(value: unknown): value is StageDraft {
  if (typeof value !== "object" || value === null) return false;

  const { etag, label, definition, warnings, nodeProvenance } = value as Partial<Record<keyof StageDraft, unknown>>;

  return (
    typeof etag === "string" &&
    typeof label === "string" &&
    (definition === null || (typeof definition === "object" && !Array.isArray(definition))) &&
    Array.isArray(warnings) &&
    warnings.every(
      (warning) =>
        typeof warning === "object" &&
        warning !== null &&
        typeof (warning as { node?: unknown }).node === "string" &&
        typeof (warning as { name?: unknown }).name === "string" &&
        typeof (warning as { code?: unknown }).code === "string",
    ) &&
    (nodeProvenance === undefined ||
      (Array.isArray(nodeProvenance) &&
        nodeProvenance.every(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { nodeId?: unknown }).nodeId === "string" &&
            typeof (entry as { provenance?: unknown }).provenance === "string",
        )))
  );
}

/**
 * One read of a workflow's draft on this origin.
 *
 * @param endpoint The endpoint, with its workflow.
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestStageDraft(endpoint: string, etag: string | null) {
  return requestPayload(endpoint, etag, isStageDraft, {
    unreachable: UNREACHABLE_DRAFT,
    unreadable: UNREADABLE_DRAFT,
  });
}

/**
 * Build the poll for one workflow's stage list.
 *
 * @param workflowId The workflow.
 * @param options A stubbed reader, a fake clock — the test seams.
 * @returns The poll, not yet started.
 */
export function createStagesPoll(workflowId: string, options: StagesPollOptions = {}): Poll<StageDraft> {
  const read = options.read ?? requestStageDraft;
  const endpoint = stagesEndpoint(workflowId);

  return createPoll((etag) => read(endpoint, etag), options);
}
