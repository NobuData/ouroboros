/**
 * The one-liner mockup 08's ENROLL A RUNNER card prints, rendered.
 *
 * AH.6 ([#254](https://github.com/NobuData/ouroboros/issues/254)), for AI.3
 * ([#258](https://github.com/NobuData/ouroboros/issues/258)).
 *
 * ```
 * curl -fsSL 'https://ouroboros.acme.dev/install.sh?version=0.7.0' | sh -s -- \
 *   --tenant 'acme-robotics' \
 *   --pool 'pool-a' \
 *   --token 'orb_enroll_…'
 * ```
 *
 * ---------------------------------------------------------------------------
 * **Three things about it are real, and each one is a criterion.**
 *
 *   * **The origin is this deployment's.** The mockup reads `get.ouroboros.dev`, which is
 *     design shorthand. A self-hosted deployment behind a firewall installs its runners from
 *     itself and trusts no public host with a binary that will run on its build machines —
 *     `installer/installer.paths.ts` is where that is argued at length.
 *   * **The version is pinned.** `?version=` picks the release whose `install.sh` is served,
 *     and a release's installer carries its own `DEFAULT_VERSION`, so the script and the
 *     binary it installs are one release (AG.6,
 *     [#248](https://github.com/NobuData/ouroboros/issues/248)). Two machines enrolled a month
 *     apart run the same build unless somebody chose otherwise.
 *   * **The token is freshly minted and it works.** A masked one would make this a screenshot.
 *
 * ---------------------------------------------------------------------------
 * **Every value is single-quoted, including the ones that do not need it.**
 *
 * This string's destination is a shell. The URL alone settles it — `?` is a glob character
 * and `&` backgrounds a command, so an unquoted `install.sh?version=0.7.0` is a URL the shell
 * rewrites or a job it detaches. The flag values are validated slugs and a base64url token
 * today, and quoting them anyway costs one character each and removes the whole question:
 * the workspace slug comes out of the database, and nothing about a rendering function should
 * depend on what a column is constrained to somewhere else.
 *
 * ---------------------------------------------------------------------------
 * **This file is the second place a live enrollment token can reach a response**, after
 * `mintedTokenResource`. That was the one place, and `farm.resources.ts`' header says so; it
 * has been amended to name both, because a greppable claim that is quietly no longer true is
 * worse than no claim. {@link renderEnrollCommand} takes the token as its own named parameter
 * for the same reason that mapper does — so `grep renderEnrollCommand` finds every caller.
 */

import { shellQuote } from "./installer/installer.release";
import { INSTALL_SCRIPT_PATH } from "./installer/installer.paths";

/** The line continuation the card wraps on — a backslash and a newline, then two spaces. */
const CONTINUE = " \\\n  ";

/** What an enroll command is rendered from. */
export interface EnrollCommandInput {
  /** The https origin runner machines reach this deployment at. */
  readonly origin: string;
  /** The agent release to pin, as `?version=` and as the script's own `DEFAULT_VERSION`. */
  readonly version: string;
  /** The workspace, as the agent names it — `organization.slug`. */
  readonly tenant: string;
  /** The pool the machine joins. */
  readonly pool: string;
  /**
   * The enrollment token, in full.
   *
   * The whole `orb_enroll_…` value. **The only parameter in this module that is a live
   * secret**, which is what makes this function the thing to grep for.
   */
  readonly token: string;
}

/**
 * The URL the command curls.
 *
 * @param origin - This deployment's https origin.
 * @param version - The release to install.
 * @returns `https://<origin>/install.sh?version=<v>`.
 */
export function installerUrl(origin: string, version: string): string {
  // `URL` rather than string concatenation, so an origin with or without a trailing slash
  // gives one path, and the version is percent-encoded rather than pasted. It has already
  // been matched against SemVer by `isReleaseVersion`, so the encoding never changes it —
  // which is the property worth having: a value that would need encoding is a value this
  // deployment does not serve.
  const url = new URL(INSTALL_SCRIPT_PATH, origin);
  url.searchParams.set("version", version);

  return url.toString();
}

/**
 * The command, as the card prints it and a person pastes it.
 *
 * @param input - The origin, the pinned version, the workspace, the pool and the token.
 * @returns The one-liner, wrapped across four lines exactly as mockup 08 wraps it.
 */
export function renderEnrollCommand(input: EnrollCommandInput): string {
  return [
    `curl -fsSL ${shellQuote(installerUrl(input.origin, input.version))} | sh -s --`,
    `--tenant ${shellQuote(input.tenant)}`,
    `--pool ${shellQuote(input.pool)}`,
    `--token ${shellQuote(input.token)}`,
  ].join(CONTINUE);
}
