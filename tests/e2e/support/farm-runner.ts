/**
 * The stack's build machine, as the farm leg drives it
 * ([#262](https://github.com/NobuData/ouroboros/issues/262), AI.7).
 *
 * Every other leg in this directory certifies services that share a compose network and a
 * language. This one's subject is a chain that crosses both boundaries: a **Go binary** enrols
 * itself with a token copied out of the browser, opens an outbound mTLS socket, and appears as
 * a row. The only way to test that is to have a machine and do to it what a person does — so
 * the compose stack has one (`runner`, `docker-compose.yml`'s `runner` profile), and this
 * module is the three things a person can do to it.
 *
 * ## The three verbs, and why there is no fourth
 *
 * - {@link resetBuildMachine} — *take a fresh machine out of the box*. The container is
 *   recreated, so nothing a previous run installed or enrolled survives. An agent refuses to
 *   enrol into a state directory that already holds a runner, and it is right to; without this a
 *   second run against a kept stack would *re-use the last run's identity* and the row would
 *   appear in the last run's workspace.
 * - {@link pasteIntoBuildMachine} — *paste a line into its shell*. The line is whatever the
 *   page's **Copy command** put on the clipboard, **verbatim**: `curl … | sh -s -- --tenant …
 *   --pool … --token …`. Nothing is parsed out of it and nothing is added to it, which is what
 *   makes a row appearing afterwards evidence about the token, the installer, the release, the
 *   gateway's certificate, the farm CA and the mTLS handshake at once.
 * - {@link killBuildMachine} — *pull the plug*. `SIGKILL` to the container: the agent gets no
 *   `SIGTERM`, says no `bye`, and closes no socket. That is the event the presence sweep exists
 *   to notice, and it is deliberately not `compose stop`, which would let the agent say goodbye
 *   and flip the row at once for a reason that is not the one under test.
 *
 * None of them takes a service name, for `support/compose.ts`'s reason: a parameter would be a
 * way to ask this to kill `db`.
 *
 * ## The token is a secret, and this handles it like one
 *
 * The pasted line carries a live enrollment token. It reaches `docker compose exec` as one
 * argument — the same exposure a person's paste has — and it is **masked in everything this
 * module returns or throws**, because a transcript ends up in a Playwright report, a report ends
 * up as a CI artefact, and an artefact is downloaded by people. The token is single-use and
 * spent by the time anything is printed; masking it anyway is the habit, not the risk.
 */

import { compose, composeOutcome } from "./compose";

/** The one service this module may touch — `docker-compose.yml`'s build machine. */
const MACHINE_SERVICE = "runner";

/**
 * The name the machine enrols under: its hostname, which the compose file pins
 * (`hostname: forge-compose`) so the row can be found in a table.
 */
export const BUILD_MACHINE_NAME = "forge-compose";

/** An enrollment token's shape, wherever one might be printed. */
const TOKEN_PATTERN = /orb_enroll_[A-Za-z0-9._~-]+/gu;

/** What a token is replaced with in a transcript. */
const TOKEN_MASK = "orb_enroll_<masked>";

/** What pasting a line into the machine did. */
export interface PasteOutcome {
  /** The shell's exit status — `0` when the installer finished. */
  readonly status: number;
  /** Everything the installer and the agent printed, with any token masked. */
  readonly transcript: string;
}

/**
 * Replace the build machine with a fresh one, and wait until it is ready to be pasted into.
 *
 * `--force-recreate` is what makes it fresh and `--no-deps` is what keeps this from touching
 * the gateway it depends on. `--wait` blocks on the machine's own healthcheck, which is *the
 * gateway's CA is in the trust store* — so the first paste after this cannot fail on a
 * certificate the machine had not finished trusting.
 *
 * It is also the leg's **teardown**. A killed machine would leave the stack with a service down
 * — which `run.sh --keep` would hand a developer, and `verify-failure-modes.sh`'s `up --wait`
 * would have to repair — and *starting* it again would bring nothing back, since the shim that
 * stands in for systemd starts an agent when one is installed, not at boot. A fresh machine is
 * the state the stack came up in.
 *
 * @returns When the new machine is healthy.
 * @throws {Error} If compose could not recreate it — see `support/compose.ts`.
 */
export async function resetBuildMachine(): Promise<void> {
  await compose("up", "-d", "--force-recreate", "--no-deps", "--wait", MACHINE_SERVICE);
}

/**
 * Paste one line into the build machine's shell, and report what happened.
 *
 * It does not throw on a non-zero status: a refused enrolment is an *answer*, and one test's
 * whole subject. `-T` because there is no terminal here to allocate — which the installer
 * handles by design (it reads confirmations from a terminal it may not have, and asks for none
 * on an install).
 *
 * @param line - The line to run, exactly as the clipboard held it.
 * @returns The status and the masked transcript.
 * @throws {Error} Only if the command could not be run at all — no `docker`, or no such
 *   container, which is a broken stack rather than an answer.
 */
export async function pasteIntoBuildMachine(line: string): Promise<PasteOutcome> {
  try {
    const outcome = await composeOutcome("exec", "-T", MACHINE_SERVICE, "sh", "-c", line);

    return { status: outcome.status, transcript: masked(outcome.output) };
  } catch (reason) {
    // `support/compose.ts` names the command it could not run, and this command *is* the token.
    throw new Error(masked(String(reason)));
  }
}

/**
 * Mask every enrollment token in a piece of text.
 *
 * @param text - A transcript, or a failure's message.
 * @returns The same text with each token replaced by {@link TOKEN_MASK}.
 */
function masked(text: string): string {
  return text.replace(TOKEN_PATTERN, TOKEN_MASK);
}

/**
 * Pull the plug on the build machine.
 *
 * @returns When the container has been killed. Nothing about the *row* is promised: that is
 *   the presence sweep's to notice, up to thirty-seven seconds later, and the leg's to assert.
 * @throws {Error} If compose could not kill it.
 */
export async function killBuildMachine(): Promise<void> {
  await compose("kill", MACHINE_SERVICE);
}
