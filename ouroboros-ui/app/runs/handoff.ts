/**
 * The take-over hand-off, as data ([#310](https://github.com/NobuData/ouroboros/issues/310),
 * decision **R7**) — what *Take over in IDE* gives a person instead of IDE magic: the branch,
 * the commands to check it out, and where the ticket and the transcript are.
 *
 * Deep editor integration is AR.2's ([#316](https://github.com/NobuData/ouroboros/issues/316)).
 * This is the honest MVP, and it says so in {@link HANDOFF_LIMITATION}.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

/** Where the browser downloads a run's transcript — this origin's proxy of AP.2's export. */
export const TRANSCRIPT_ENDPOINT = "/api/runs";

/** The dialog's title. */
export const HANDOFF_TITLE = "Take over in your editor";

/** What the hand-off does, in one sentence. */
export const HANDOFF_NOTE =
  "The loop is paused so it stops touching the branch. Check it out, carry on by hand, and " +
  "press Resume on this page when you want the loop back.";

/** The limitation, stated plainly — AR.2 is not here yet. */
export const HANDOFF_LIMITATION =
  "Deep IDE integration is arriving (#316). Today this pauses the loop and hands you the " +
  "branch — nothing opens in your editor on its own.";

/** The commands block's label. */
export const COMMANDS_LABEL = "Check out the branch";

/** What the commands' copy control is called. */
export const COPY_COMMANDS_LABEL = "Copy commands";

/** What it announces once the commands are on the clipboard. */
export const COPIED_COMMANDS = "Commands copied";

/** What it announces when the browser refused the clipboard. */
export const COPY_COMMANDS_FAILED = "Could not copy the commands";

/** What stands in for the commands while the loop has no branch yet. */
export const NO_BRANCH_HANDOFF =
  "This loop has not pushed a branch yet, so there is nothing to check out. The loop is " +
  "still paused.";

/** The dialog's close button. The loop stays paused; *Resume* on the page brings it back. */
export const HANDOFF_CLOSE = "Close";

/** The ticket link. */
export const TICKET_LINK = "Open the ticket ↗";

/** The transcript link. */
export const TRANSCRIPT_LINK = "Download the transcript (JSONL) ↗";

/** The remote the commands fetch from — a clone's default. */
export const REMOTE = "origin";

/** A branch name that needs no quoting in a POSIX shell. */
const SHELL_SAFE = /^[A-Za-z0-9._/@+=:,-]+$/;

/**
 * Quote a value for a POSIX shell.
 *
 * Git allows a branch name characters a shell reads as syntax — `$`, `;`, `&`, a backtick —
 * and a command a person pastes has to do what it says. A name made only of safe characters
 * is left bare, so the common case reads the way it is typed.
 *
 * @param value The value.
 * @returns The value, bare or single-quoted with every `'` escaped.
 */
export function shellQuote(value: string): string {
  if (SHELL_SAFE.test(value)) return value;

  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The commands that put a person on the loop's branch.
 *
 * `git switch` alone creates the local branch tracking the remote one once it has been
 * fetched, so the pair works in any clone of the repository.
 *
 * @param branch The loop's branch.
 * @returns The two commands, one per line.
 */
export function checkoutCommands(branch: string): string {
  const quoted = shellQuote(branch);

  return `git fetch ${REMOTE} ${quoted}\ngit switch ${quoted}`;
}

/**
 * Where the browser downloads a run's transcript.
 *
 * @param id The run's id.
 * @returns `/api/runs/{id}/transcript.jsonl`, the id encoded.
 */
export function transcriptUrl(id: string): string {
  return `${TRANSCRIPT_ENDPOINT}/${encodeURIComponent(id)}/transcript.jsonl`;
}
