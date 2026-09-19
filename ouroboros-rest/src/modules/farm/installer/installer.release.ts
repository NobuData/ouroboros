/**
 * What a runner release is, and the one change this service makes to it — as pure functions,
 * so each rule is tested without a file system.
 *
 * AG.6 ([#248](https://github.com/NobuData/ouroboros/issues/248)). A release is what
 * `ouroboros-runner`'s `make release` writes into `dist/<version>/` and `ci/runner` publishes
 * as the GitHub release `ouroboros-runner-v<version>`: three binaries, the installer, and a
 * `SHA256SUMS` over the four. A deployment serves a copy of one, from its own origin.
 */

import { compareVersions, parseVersion, type Version } from "../gateway/semver";

/**
 * Every file a release holds, and the media type each is served as.
 *
 * **An allow-list, and the only way a file is named.** `GET /runner/<version>/<file>` serves
 * one of these or nothing, so a request cannot name a path — `..`, a slash, anything the
 * operator happened to leave in the directory — because nothing it sends is ever joined into
 * one. The binaries are named as `make release` names them: Go's `amd64` spelling, which is
 * the protocol's `x86_64`.
 */
export const RELEASE_FILES: Readonly<Record<string, string>> = Object.freeze({
  "ouroboros-runner-linux-amd64": "application/octet-stream",
  "ouroboros-runner-linux-arm64": "application/octet-stream",
  "ouroboros-runner-darwin-arm64": "application/octet-stream",
  "install.sh": "text/x-shellscript; charset=utf-8",
  SHA256SUMS: "text/plain; charset=utf-8",
});

/** The installer's file name inside a release. */
export const INSTALL_SCRIPT_FILE = "install.sh";

/** The media type the filled-in installer is served as. */
export const SHELL_SCRIPT_MEDIA_TYPE = RELEASE_FILES[INSTALL_SCRIPT_FILE];

/**
 * The installer's line this service fills in, exactly as the repository and every release
 * carry it: `install.sh`'s own header says a publisher replaces the whole line and refuses
 * one it cannot find, and `ouroboros-runner/tests/install.test.sh` asserts it is there once.
 */
export const SERVER_LINE = /^DEFAULT_SERVER=''$/mu;

/**
 * Is this the name of a file a release holds?
 *
 * @param name - The last segment of a request's path.
 * @returns `true` for the five names in {@link RELEASE_FILES}, and nothing else.
 */
export function isReleaseFile(name: string): boolean {
  return Object.hasOwn(RELEASE_FILES, name);
}

/**
 * Is this a version a release directory could be named for?
 *
 * SemVer 2.0.0 exactly, through the same parser the gateway's version floor uses — so the
 * answer to "is `0.5.0` newer than `0.4.9`" is the one the floor would give. A name that does
 * not parse is never a directory this service reads, which is also what keeps a request's
 * version from naming anything but a child of the releases directory: SemVer has no `/`.
 *
 * @param text - A request's version, or a directory's name.
 * @returns `true` when it is one.
 */
export function isReleaseVersion(text: string): boolean {
  return parseVersion(text) !== undefined;
}

/**
 * The release `/install.sh` serves when no version is asked for.
 *
 * The newest by SemVer precedence — `0.10.0` after `0.9.0`, which a string sort gets wrong —
 * **among the stable releases**. A pre-release is served when it is asked for by version, and
 * becomes the default only when it is all there is: an operator who copied in `0.6.0-rc.1` to
 * try it on one machine has not asked for every new machine to get it.
 *
 * @param names - The releases directory's entries; those that are not versions are ignored.
 * @returns The version, or `undefined` when there is none.
 */
export function newestRelease(names: readonly string[]): string | undefined {
  const versions = names
    .map((name) => ({ name, version: parseVersion(name) }))
    .filter((entry): entry is { name: string; version: Version } => entry.version !== undefined);
  const stable = versions.filter((entry) => entry.version.prerelease.length === 0);
  const candidates = stable.length > 0 ? stable : versions;

  return candidates.sort((a, b) => compareVersions(b.version, a.version))[0]?.name;
}

/**
 * Quote a value for a POSIX shell: single quotes, with any single quote inside closed, escaped
 * and reopened. Nothing inside single quotes is expanded, so the value is inert whatever it is.
 *
 * @param value - The value.
 * @returns It, as one shell word.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Fill the installer's `DEFAULT_SERVER` in with this deployment's origin.
 *
 * The one change this service makes to a release. It is what lets the one-liner carry no
 * `--server`: the script names the deployment that served it, which is both where it
 * downloads the agent from and where the agent enrols. Everything else in the file is the
 * release's own, byte for byte.
 *
 * @param script - The release's `install.sh`.
 * @param origin - The https origin runner machines reach this deployment at.
 * @returns The script with the line filled in, or `undefined` when the line is not there —
 *   an installer this service does not know how to publish, which is refused rather than
 *   served as a script that asks every machine for a `--server`.
 */
export function fillServer(script: string, origin: string): string | undefined {
  if (!SERVER_LINE.test(script)) return undefined;

  return script.replace(SERVER_LINE, `DEFAULT_SERVER=${shellQuote(origin)}`);
}

/**
 * The origin the installer names, and whether it can name it.
 *
 * `OURO_FARM_PUBLIC_URL` when it is set — validated at boot as an https origin — and this
 * service's own `OURO_REST_URL` otherwise, which is the same address in a deployment that
 * serves browsers and runners from one host. That fallback is only usable when it is https:
 * the agent speaks to its control plane over TLS and nothing else, so an http origin would be
 * an installer that fails on every machine at the last step.
 *
 * @param farmPublicUrl - `OURO_FARM_PUBLIC_URL`, or `undefined`.
 * @param restUrl - `OURO_REST_URL`.
 * @returns The origin, or `undefined` when neither is an https origin.
 */
export function installerOrigin(
  farmPublicUrl: string | undefined,
  restUrl: string,
): string | undefined {
  const origin = farmPublicUrl ?? restUrl;

  return origin.startsWith("https://") ? origin : undefined;
}
