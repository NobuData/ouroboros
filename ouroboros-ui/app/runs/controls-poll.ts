/**
 * The run controls' poll — `app/poll.ts`'s loop over one run's control queue
 * ([#310](https://github.com/NobuData/ouroboros/issues/310)).
 *
 * `console-poll.ts` is the same file for the snapshot. This one's cadence is the route's to
 * choose (`app/api/run-controls.ts`): a couple of seconds while a chip is still moving, the
 * shared default once nothing is.
 *
 * **Framework-free**, so the reader is a unit test against a stubbed `fetch`; the controls
 * meet it through `app/issues/use-keyed-poll.ts`.
 */

import type { RunControlList } from "@/app/api/runs";
import {
  type Poll,
  type PollOptions,
  type PollReader,
  createPoll,
  requestPayload,
} from "@/app/poll";

import { RUN_ENDPOINT } from "./console-poll";

/** What is said when something answered and this client could not read it as controls. */
export const UNREADABLE_CONTROLS = "The run's controls could not be read.";

/** What is said when nothing answered at all. */
export const UNREACHABLE_CONTROLS = "The run's controls could not be reached.";

/** One read of the controls. Replaced wholesale in tests. */
export type ControlsReader = PollReader<RunControlList>;

/** How to build the controls' poll. Production supplies none of it. */
export interface ControlsPollOptions extends PollOptions {
  /** How to make one read. Defaults to {@link requestControls} over the poll's address. */
  read?: ControlsReader;
}

/**
 * The address the head polls for one run's controls.
 *
 * @param id The run's id.
 * @returns `/api/runs/{id}/controls`, the id encoded.
 */
export function controlsUrl(id: string): string {
  return `${RUN_ENDPOINT}/${encodeURIComponent(id)}/controls`;
}

/**
 * Whether a parsed body is a control list.
 *
 * @param value A parsed response body.
 * @returns `true` when it carries a `controls` array whose entries have a kind and a state.
 */
export function isRunControlList(value: unknown): value is RunControlList {
  if (typeof value !== "object" || value === null) return false;

  const { controls } = value as Partial<RunControlList>;

  return (
    Array.isArray(controls) &&
    controls.every(
      (control: unknown) =>
        typeof control === "object" &&
        control !== null &&
        typeof (control as { id?: unknown }).id === "string" &&
        typeof (control as { kind?: unknown }).kind === "string" &&
        typeof (control as { state?: unknown }).state === "string",
    )
  );
}

/**
 * A reader of one address, from the browser.
 *
 * @param url Where to ask — {@link controlsUrl}'s answer.
 * @returns The reader. It does not throw.
 */
export function requestControls(url: string): ControlsReader {
  return (etag) =>
    requestPayload(url, etag, isRunControlList, {
      unreachable: UNREACHABLE_CONTROLS,
      unreadable: UNREADABLE_CONTROLS,
    });
}

/**
 * Build the controls' loop over one address.
 *
 * @param url Where to ask. Ignored when `options.read` is given.
 * @param options Test seams; production passes none.
 * @returns The poll. It is inert until `start` is called.
 */
export function createControlsPoll(
  url: string,
  options: ControlsPollOptions = {},
): Poll<RunControlList> {
  return createPoll(options.read ?? requestControls(url), options);
}
