/**
 * Semantic-version precedence, for the one comparison the gateway makes on an agent's version.
 *
 * AH.3 ([#251](https://github.com/NobuData/ouroboros/issues/251)). `OURO_FARM_MIN_AGENT_VERSION`
 * is the GitHub-runner floor: an agent older than it is refused at `hello`. That needs *older*
 * to mean what [SemVer 2.0.0 § 11](https://semver.org/#spec-item-11) says it means — `0.10.0` is
 * newer than `0.9.0`, and `1.0.0-rc.1` is older than `1.0.0` — and a string comparison gets both
 * wrong. It is written out rather than imported because it is thirty lines and the service's
 * dependency list is a surface of its own.
 */

/** A parsed version: three numbers, and the pre-release identifiers if there are any. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

/** SemVer's own grammar, less the build metadata's content, which precedence ignores. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Parse a version.
 *
 * @param text - `1.4.0`, `0.2.0-rc.1`, `1.0.0+build.7`. A leading `v` is not SemVer and is
 *   refused, as the agent's own `version` output never carries one.
 * @returns The version, or `undefined` when it is not one.
 */
export function parseVersion(text: string): Version | undefined {
  const match = SEMVER.exec(text);
  if (!match) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/**
 * Compare two versions by precedence.
 *
 * @param a - One version.
 * @param b - The other.
 * @returns Negative when `a` precedes `b`, positive when it follows, zero when they are equal
 *   in precedence (which build metadata never breaks).
 */
export function compareVersions(a: Version, b: Version): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }

  // A version with a pre-release precedes the same version without one.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }

  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;

    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);

    // Numeric identifiers compare as numbers and precede alphanumeric ones.
    if (xNumeric && yNumeric) return Number(x) - Number(y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;

    return x < y ? -1 : 1;
  }

  return a.prerelease.length - b.prerelease.length;
}
