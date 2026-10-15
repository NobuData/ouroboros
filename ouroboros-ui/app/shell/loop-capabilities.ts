/**
 * The loop capability report's poll — `app/poll.ts`'s loop over `GET /api/loop/capabilities`
 * (DG.3, [#1301](https://github.com/NobuData/ouroboros/issues/1301)).
 *
 * ```
 * useLoopCapabilities() ─┐
 * useLoopCapabilities() ─┼─▶ one shared poll ─▶ /api/loop/capabilities ─▶ GET /api/v1/loop/capabilities
 * useLoopCapabilities() ─┘     started by the first reader, stopped after the last
 * ```
 *
 * One poll for the page however many surfaces ask, on the shell's own cadence (the service's
 * `X-Ouro-Poll-After`, else the default), so the run console, the dashboard and the Models page
 * read the same answer at the same moment.
 */

import type { LoopCapabilities } from "@/app/api/loop";
import { type Poll, type PollOptions, type PollReader, createPoll, requestPayload } from "@/app/poll";

/** The route the poll reads. */
export const LOOP_CAPABILITIES_ENDPOINT = "/api/loop/capabilities";

/** What a reader says when the report could not be read. */
export const UNREADABLE_CAPABILITIES = "What this deployment can run for real could not be read.";

/** What a reader says when the report could not be reached. */
export const UNREACHABLE_CAPABILITIES = "What this deployment can run for real could not be reached.";

/** The five stages, in the order the report lists them. */
const STAGES = ["invocation", "execution", "guardrailEnforcement", "buildIntegration", "prPublishing"];

/**
 * Whether a value is a capability report.
 *
 * @param value Anything.
 * @returns True for a report with all five stages.
 */
export function isLoopCapabilities(value: unknown): value is LoopCapabilities {
  if (typeof value !== "object" || value === null) return false;

  const { deploymentEnabled, stages } = value as Partial<Record<keyof LoopCapabilities, unknown>>;

  if (typeof deploymentEnabled !== "boolean" || typeof stages !== "object" || stages === null) {
    return false;
  }

  return STAGES.every((stage) => {
    const answer = (stages as Record<string, unknown>)[stage];

    return (
      typeof answer === "object" &&
      answer !== null &&
      typeof (answer as { available?: unknown }).available === "boolean"
    );
  });
}

/**
 * One read of the report.
 *
 * @param etag The last answer's entity tag, or null.
 * @returns The poll's answer.
 */
export function requestLoopCapabilities(etag: string | null) {
  return requestPayload(LOOP_CAPABILITIES_ENDPOINT, etag, isLoopCapabilities, {
    unreachable: UNREACHABLE_CAPABILITIES,
    unreadable: UNREADABLE_CAPABILITIES,
  });
}

/** How the poll is built — the reader is a seam for tests. */
export interface LoopCapabilitiesPollOptions extends PollOptions {
  read?: PollReader<LoopCapabilities>;
}

/**
 * A capability poll.
 *
 * @param options The reader and the poll's own options.
 * @returns The poll, not yet started.
 */
export function createLoopCapabilitiesPoll(
  options: LoopCapabilitiesPollOptions = {},
): Poll<LoopCapabilities> {
  const { read = requestLoopCapabilities, ...pollOptions } = options;

  return createPoll(read, pollOptions);
}

/** The page's shared poll, its readers, and how to stop it. */
let shared: { poll: Poll<LoopCapabilities>; readers: number; stop: (() => void) | null } | null =
  null;

/**
 * The page's one poll, built on first use.
 *
 * @returns It.
 */
export function sharedLoopCapabilitiesPoll(): Poll<LoopCapabilities> {
  shared ??= { poll: createLoopCapabilitiesPoll(), readers: 0, stop: null };

  return shared.poll;
}

/**
 * Count a reader in, starting the poll for the first.
 *
 * @returns How to count it out again — the poll stops after the last.
 */
export function retainLoopCapabilities(): () => void {
  const entry = (shared ??= { poll: createLoopCapabilitiesPoll(), readers: 0, stop: null });

  entry.readers += 1;
  entry.stop ??= entry.poll.start();

  return () => {
    entry.readers -= 1;

    if (entry.readers === 0) {
      entry.stop?.();
      entry.stop = null;
    }
  };
}

/** Forget the shared poll — tests only, so each starts from nothing. */
export function resetLoopCapabilitiesPoll(): void {
  shared?.stop?.();
  shared = null;
}
