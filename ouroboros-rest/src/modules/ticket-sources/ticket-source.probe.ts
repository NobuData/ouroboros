/**
 * Repository probes — the SPI's fourth capability family
 * ([#384](https://github.com/NobuData/ouroboros/issues/384), BB.1, decision **O2** option 1-A).
 *
 * ```
 * detection ──▶ registry.find(kind) ──▶ supportsRepoProbes ──▶ coversRepo(config, repo)
 *                                                  │
 *               repoLanguages · repoTree · repoFile ◀┘   (one host call each, never a clone)
 * ```
 *
 * The onboarding card has to finish while somebody is still looking at it, which rules out
 * cloning. What fits is **targeted probing through the connection the backlog sync already
 * uses**: the languages endpoint, one recursive tree listing (which answers every *does this
 * manifest exist* and every glob in a single request), and a handful of file fetches.
 *
 * Declared the way {@link TicketSourcePrCapabilities} was — a flag on the capabilities, a
 * sub-interface in `ticket-source.provider.ts`, a guard, and a registry assertion at boot — so a
 * GitLab provider joins by implementing three members rather than by a branch in the detector.
 *
 * **Every member spends one request against the source's host budget**, and a provider must
 * route it through the same rate guard its sync uses (#101): a scan is a burst of calls on the
 * connection the backlog poll depends on. A refused call throws `TicketSourceError`
 * `rate_limit`, and the detector stops probing on the first one rather than retrying into it.
 */

/** Whether a provider can probe the repositories it covers. */
export interface TicketSourceProbeCapabilities {
  /** Whether `ProbeCapableProvider`'s members exist. A ticket tracker answers `false`. */
  readonly repoProbes: boolean;
}

/** The declaration of a provider with no repository to probe — every ticket tracker. */
export const NO_PROBE_CAPABILITIES: TicketSourceProbeCapabilities = Object.freeze({
  repoProbes: false,
});

/** One path of a repository's default branch. */
export interface RepoTreeEntry {
  /** Relative to the repository root, forward slashes, no leading slash — `boards/nrf/board.c`. */
  readonly path: string;
  /** A file, or a directory. Submodules and symlinks are reported as files. */
  readonly type: "file" | "dir";
}

/** A repository's default branch, listed once. */
export interface RepoTree {
  /** Every path the host returned, in the host's order. Empty for an empty repository. */
  readonly entries: readonly RepoTreeEntry[];
  /**
   * Whether the host cut the listing short. A truncated tree still answers the paths it holds;
   * the detector says *some* in its evidence rather than claiming a count.
   */
  readonly truncated: boolean;
}

/** One file's contents. */
export interface RepoFile {
  /** The path asked for. */
  readonly path: string;
  /** The text, decoded as UTF-8. Cut at {@link MAX_PROBE_FILE_BYTES} when longer. */
  readonly content: string;
  /** The file's size on the host, in bytes — larger than `content` when it was cut. */
  readonly size: number;
}

/**
 * The most of one file a probe reads — 256 KiB. A manifest or a test file is far smaller; a file
 * that is not is not one a rule pack should be parsing in the scan's critical path.
 */
export const MAX_PROBE_FILE_BYTES = 256 * 1024;

/**
 * The repository reference grammar every probe member takes: V067's `ouroboros.repo_ref` —
 * `owner/name`, deeper for a nested namespace, no `.` or `..` segment.
 */
export const PROBE_REPO_REF = /^(?!(?:.*\/)?\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/;

/**
 * A file path a probe may ask for: relative, forward slashes, no `..` segment, no control
 * character — the grammar V067 holds a protected-path glob to, minus the wildcards.
 */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point.
const PROBE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\*?[\]\u0000-\u001f]{1,512}$/;

/**
 * Whether a path is one a probe may ask the host for.
 *
 * @param path - The path a rule pack asked for.
 * @returns True when it is relative, has no `..` segment, no wildcard and no control character.
 */
export function isProbePath(path: string): boolean {
  return PROBE_PATH.test(path);
}

/**
 * Everything wrong with a probe declaration's shape.
 *
 * @param probe - `capabilities().probe`, as the provider answered it.
 * @returns The violations; empty when the declaration is well-formed.
 */
export function probeCapabilityViolations(probe: unknown): string[] {
  if (typeof probe !== "object" || probe === null) {
    return ["probe must be an object"];
  }

  if (typeof (probe as { repoProbes?: unknown }).repoProbes !== "boolean") {
    return ["probe.repoProbes must be a boolean"];
  }

  return [];
}
