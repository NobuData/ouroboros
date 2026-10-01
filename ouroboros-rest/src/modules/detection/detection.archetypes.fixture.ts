/**
 * The four repository archetypes, served the way GitHub serves a repository — BB.6
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
 *
 * `detection.fixture.ts` holds the archetypes as checked-in trees (Zephyr-like, Node, Python,
 * empty) and a prober that answers the detector directly. That proves the rule packs; it does not
 * prove the path a real scan takes to reach them:
 *
 * ```
 * POST /onboarding/detection/scan ─▶ DetectionService ─▶ TicketSourceRegistry ─▶ GitHub provider
 *      ─▶ GithubClient (rate guard) ─▶ Octokit ─▶ languages · git/trees/HEAD · contents/{path}
 * ```
 *
 * {@link ArchetypeHost} stands in for the last hop only. It answers GitHub's three probe routes
 * from an archetype tree, in GitHub's own shapes — a recursive tree of `blob`/`tree` items, a
 * base64 `contents` body, `404` for a missing file, `409` for a repository with no commits — so
 * everything above Octokit is the application's own. No request leaves the process.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import type { OctokitLike, OctokitResponseLike } from "../github/github.client";
import type { OctokitFactory } from "../github/github.client.factory";
import { budgetHeaders, httpError, response } from "../github/github.fixture";
import {
  CONTENTS_ROUTE,
  LANGUAGES_ROUTE,
  TREE_ROUTE,
} from "../ticket-sources/providers/github.probe";
import { EMPTY, NODE, PYTHON, ZEPHYR, treeOf, type FixtureRepo } from "./detection.fixture";

/** The four archetypes the golden rows are recorded for, by name. */
export const ARCHETYPES = {
  zephyr: ZEPHYR,
  node: NODE,
  python: PYTHON,
  empty: EMPTY,
} as const satisfies Record<string, FixtureRepo>;

/** An archetype's name. */
export type Archetype = keyof typeof ARCHETYPES;

/** Every archetype's name, in the order the goldens record them. */
export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES) as Archetype[];

/** The token a source of the archetype host is sealed with. */
export const ARCHETYPE_TOKEN = "ghp_archetypehost0000000000000000000000";

/** What GitHub answers a tree request on a repository with no commits. */
const EMPTY_REPOSITORY_STATUS = 409;

/** GitHub's "no such file", and its "no such repository". */
const NOT_FOUND_STATUS = 404;

/** One request the host answered. */
export interface ArchetypeRequest {
  /** Octokit's route — `GET /repos/{owner}/{repo}/languages`. */
  readonly route: string;
  /** `owner/name`, lower-case. */
  readonly repo: string;
  /** The file asked for, on a contents request. */
  readonly path?: string;
}

/** A stand-in GitHub holding archetype trees, behind K.3's injectable Octokit seam. */
export class ArchetypeHost {
  /** The repositories served, by `owner/name` lower-case. */
  private readonly repos = new Map<string, FixtureRepo>();

  /** Every request answered, in order — one entry per HTTP request a real scan would make. */
  readonly requests: ArchetypeRequest[] = [];

  /** Every token a client was built with — what the secrecy assertions look for elsewhere. */
  readonly tokens: string[] = [];

  /** When set, every request waits for it — how a case holds a scan "running". */
  private gate: Promise<void> | undefined;

  /**
   * What `OCTOKIT_FACTORY` is overridden with: every client the application builds reaches this
   * host.
   */
  readonly factory: OctokitFactory = (token: string): OctokitLike => {
    this.tokens.push(token);

    return {
      request: (route, params = {}) =>
        Promise.resolve(this.gate).then(() => this.answer(route, params)),
      paginate: {
        // No archetype has issues: a sync that reached this host would read one empty page.
        iterator: () => ({
          [Symbol.asyncIterator]: async function* (): AsyncGenerator<OctokitResponseLike<unknown>> {
            yield await Promise.resolve(response([], budgetHeaders({ remaining: 4999 })));
          },
        }),
      },
    };
  };

  /**
   * Serve a tree as a repository.
   *
   * @param repo - `owner/name`; compared lower-case, as GitHub compares it.
   * @param tree - The archetype.
   */
  serve(repo: string, tree: FixtureRepo): void {
    this.repos.set(repo.toLowerCase(), tree);
  }

  /**
   * Hold every request from now on, so a scan stays running until released.
   *
   * @returns The release: call it to let the held requests, and every later one, through.
   */
  hold(): () => void {
    let release: () => void = () => undefined;

    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    return () => {
      this.gate = undefined;
      release();
    };
  }

  /** Forget every repository and every request — a fresh host for the next case. */
  clear(): void {
    this.repos.clear();
    this.requests.length = 0;
    this.tokens.length = 0;
    this.gate = undefined;
  }

  /**
   * The requests one repository was asked.
   *
   * @param repo - `owner/name`.
   * @returns Its requests, in order.
   */
  requestsFor(repo: string): ArchetypeRequest[] {
    return this.requests.filter((request) => request.repo === repo.toLowerCase());
  }

  /**
   * Answer one request the way GitHub would.
   *
   * @param route - Octokit's route.
   * @param params - Its parameters.
   * @returns The response.
   * @throws {Error} An Octokit-shaped HTTP error for a `404` or `409`; a plain error for a route
   *   no probe uses, so a scan that started asking for something else fails naming it.
   */
  private answer(
    route: string,
    params: Readonly<Record<string, unknown>>,
  ): OctokitResponseLike<unknown> {
    const repo = `${String(params.owner)}/${String(params.repo)}`.toLowerCase();
    const path = typeof params.path === "string" ? params.path : undefined;
    const tree = this.repos.get(repo);
    const headers = budgetHeaders({ remaining: 4999 });

    this.requests.push(path === undefined ? { route, repo } : { route, repo, path });

    if (tree === undefined) {
      throw httpError(NOT_FOUND_STATUS, headers);
    }

    switch (route) {
      case LANGUAGES_ROUTE:
        return response({ ...tree.languages }, headers);
      case TREE_ROUTE:
        return response(treeBody(tree, headers), headers);
      case CONTENTS_ROUTE:
        return response(contentsBody(tree, path ?? "", headers), headers);
      default:
        throw new Error(`detection.archetypes.fixture: no archetype answers "${route}"`);
    }
  }
}

/**
 * A recursive trees response for an archetype.
 *
 * @param tree - The archetype.
 * @param headers - The headers an error carries.
 * @returns GitHub's body: every directory as a `tree` item and every file as a `blob`.
 * @throws {Error} `409` for an archetype with no files — a repository with no commits has no
 *   `HEAD` to list.
 */
function treeBody(tree: FixtureRepo, headers: Record<string, string>): Record<string, unknown> {
  const { entries } = treeOf(tree);

  if (entries.length === 0) {
    throw httpError(EMPTY_REPOSITORY_STATUS, headers);
  }

  return {
    sha: "HEAD",
    truncated: false,
    tree: entries.map((entry) => ({
      path: entry.path,
      type: entry.type === "dir" ? "tree" : "blob",
    })),
  };
}

/**
 * A contents response for one path of an archetype.
 *
 * @param tree - The archetype.
 * @param path - The path asked for.
 * @param headers - The headers an error carries.
 * @returns GitHub's body: a base64 file, or a listing when the path is a directory.
 * @throws {Error} `404` when the archetype has nothing at the path.
 */
function contentsBody(tree: FixtureRepo, path: string, headers: Record<string, string>): unknown {
  const content = tree.files[path];

  if (content !== undefined) {
    return {
      type: "file",
      path,
      size: Buffer.byteLength(content),
      encoding: "base64",
      content: Buffer.from(content, "utf8").toString("base64"),
    };
  }

  const children = Object.keys(tree.files).filter((file) => file.startsWith(`${path}/`));

  if (children.length === 0) {
    throw httpError(NOT_FOUND_STATUS, headers);
  }

  // GitHub answers a directory with an array of its entries, which is not a file.
  return children.map((file) => ({ type: "file", path: file }));
}
