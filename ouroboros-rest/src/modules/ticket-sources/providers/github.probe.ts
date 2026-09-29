/**
 * GitHub's repository probes — BB.1 ([#384](https://github.com/NobuData/ouroboros/issues/384)),
 * the implementation behind `ProbeCapableProvider` for the `github` kind.
 *
 * ```
 * repoLanguages  GET /repos/{owner}/{repo}/languages                    one request
 * repoTree       GET /repos/{owner}/{repo}/git/trees/HEAD?recursive=1   one request, every path
 * repoFile       GET /repos/{owner}/{repo}/contents/{path}              one request, 404 → null
 * ```
 *
 * Every call goes through K.3's `GithubClient`, so the rate guard that protects the backlog sync
 * (#101) protects a scan too: a workspace whose remaining budget is at the floor gets a
 * `rate_limited` refusal *before* the request is sent, and the detector stops probing on it.
 *
 * **`HEAD` rather than the default branch's name.** The trees endpoint resolves a ref, and `HEAD`
 * is the default branch — which saves the `GET /repos/{owner}/{repo}` a name lookup would cost.
 * An empty repository has no `HEAD`; GitHub answers `409 Git Repository is empty`, which is an
 * answer (no paths) rather than a failure.
 */

import type { GithubClient } from "../../github/github.client";
import { GithubApiError } from "../../github/github.errors";
import { TicketSourceError } from "../ticket-source.errors";
import {
  MAX_PROBE_FILE_BYTES,
  isProbePath,
  type RepoFile,
  type RepoTree,
  type RepoTreeEntry,
  type TicketSourceProbeCapabilities,
} from "../ticket-source.probe";
import { readGithubConfig } from "./github.config";
import type { GithubTarget } from "./github.write";

/** What GitHub can probe, as the provider declares it: every covered repository. */
export const GITHUB_PROBE_CAPABILITIES = Object.freeze({
  repoProbes: true,
} as const) satisfies TicketSourceProbeCapabilities;

/** A repository's languages, in bytes. */
export const LANGUAGES_ROUTE = "GET /repos/{owner}/{repo}/languages";

/** The default branch's tree, listed recursively. */
export const TREE_ROUTE = "GET /repos/{owner}/{repo}/git/trees/{tree_sha}";

/** One file's contents. */
export const CONTENTS_ROUTE = "GET /repos/{owner}/{repo}/contents/{path}";

/** What GitHub answers a tree request on a repository with no commits. */
const EMPTY_REPOSITORY_STATUS = 409;

/** GitHub's "no such file". */
const NOT_FOUND_STATUS = 404;

/** One entry of a trees response, as far as this file reads it. */
interface GithubTreeItem {
  readonly path?: unknown;
  readonly type?: unknown;
}

/** A contents response for a file, as far as this file reads it. */
interface GithubContents {
  readonly type?: unknown;
  readonly size?: unknown;
  readonly encoding?: unknown;
  readonly content?: unknown;
}

export class GithubRepoProbes {
  /**
   * @param client - K.3's client for this source's token and budget.
   * @param target - The repository, already checked to be one the source covers.
   */
  constructor(
    private readonly client: GithubClient,
    private readonly target: GithubTarget,
  ) {}

  /**
   * The repository's languages.
   *
   * @returns Bytes per language; only non-negative finite counts are kept.
   */
  async languages(): Promise<Record<string, number>> {
    const result = await this.client.request<Record<string, unknown>>(LANGUAGES_ROUTE, {
      ...this.target,
    });
    const languages: Record<string, number> = {};

    for (const [language, bytes] of Object.entries(result.data ?? {})) {
      if (typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0) {
        languages[language] = bytes;
      }
    }

    return languages;
  }

  /**
   * Every path on the default branch.
   *
   * @returns The tree; empty (not a failure) for a repository with no commits.
   */
  async tree(): Promise<RepoTree> {
    try {
      const result = await this.client.request<{ tree?: unknown; truncated?: unknown }>(
        TREE_ROUTE,
        { ...this.target, tree_sha: "HEAD", recursive: "1" },
      );
      const items = Array.isArray(result.data?.tree) ? (result.data.tree as GithubTreeItem[]) : [];

      return {
        entries: items.flatMap(entryOf),
        truncated: result.data?.truncated === true,
      };
    } catch (error) {
      if (error instanceof GithubApiError && error.httpStatus === EMPTY_REPOSITORY_STATUS) {
        return { entries: [], truncated: false };
      }

      throw error;
    }
  }

  /**
   * One file.
   *
   * @param path - Relative to the root.
   * @returns The file, cut at {@link MAX_PROBE_FILE_BYTES}; `null` when there is no file there
   *   (a `404`, or a path that names a directory).
   * @throws {TicketSourceError} `validation` for a path `isProbePath` refuses — checked before
   *   any request, so a malformed path never reaches GitHub.
   */
  async file(path: string): Promise<RepoFile | null> {
    if (!isProbePath(path)) {
      throw new TicketSourceError("validation", "a probe path must be relative with no .. segment");
    }

    try {
      const result = await this.client.request<GithubContents>(CONTENTS_ROUTE, {
        ...this.target,
        path,
      });
      const data = result.data;

      if (data === undefined || Array.isArray(data) || data.type !== "file") {
        return null;
      }

      const size = typeof data.size === "number" ? data.size : 0;
      const content =
        data.encoding === "base64" && typeof data.content === "string"
          ? decodeBase64(data.content)
          : "";

      return { path, content, size };
    } catch (error) {
      if (error instanceof GithubApiError && error.httpStatus === NOT_FOUND_STATUS) {
        return null;
      }

      throw error;
    }
  }
}

/**
 * The repository a probe may address, when the source covers it.
 *
 * @param config - `ticket_sources.config`, as stored.
 * @param repoRef - `owner/name`.
 * @returns The target, spelled as the config spells it; `undefined` when the config does not
 *   parse, names another account, or does not list the repository.
 */
export function probeTargetOf(config: unknown, repoRef: string): GithubTarget | undefined {
  const [owner, name, ...rest] = repoRef.toLowerCase().split("/");

  if (owner === undefined || name === undefined || rest.length > 0) {
    return undefined;
  }

  let settings;

  try {
    settings = readGithubConfig(config);
  } catch {
    return undefined;
  }

  const repo = settings.repos.find((candidate) => candidate.toLowerCase() === name);

  return settings.login.toLowerCase() === owner && repo !== undefined
    ? { owner: settings.login, repo }
    : undefined;
}

/**
 * One trees item as a probe entry.
 *
 * @param item - The item GitHub returned.
 * @returns The entry, or nothing for an item without a string path.
 */
function entryOf(item: GithubTreeItem): RepoTreeEntry[] {
  if (typeof item.path !== "string" || item.path === "") {
    return [];
  }

  return [{ path: item.path, type: item.type === "tree" ? "dir" : "file" }];
}

/**
 * Decode GitHub's base64 (wrapped at 60 columns) as UTF-8, cut at {@link MAX_PROBE_FILE_BYTES}.
 *
 * @param encoded - The `content` field.
 * @returns The text.
 */
export function decodeBase64(encoded: string): string {
  const bytes = Buffer.from(encoded.replace(/\s+/g, ""), "base64");

  return bytes.subarray(0, MAX_PROBE_FILE_BYTES).toString("utf8");
}
