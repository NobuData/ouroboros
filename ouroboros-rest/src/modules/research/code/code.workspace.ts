/**
 * What the code & git mining tool knows about a workspace's repositories — which it may read, how
 * the engine fetches one, and what stack repository detection found (CL.4,
 * [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * * **Enabled repositories only.** A repository is readable when it and its GitHub organisation
 *   are enabled for the workspace (V003) — the boundary of where Ouroboros may operate. A name is
 *   matched as `owner/name` or, when unambiguous, as the bare `name` the mockup prints
 *   (`helios-firmware`); two enabled repositories with that name make the bare name ambiguous.
 * * **The token is per call.** {@link CodeWorkspace.repositoryRef} opens the workspace's GitHub
 *   token for the engine's fetch and nothing keeps it; a workspace with none reads public
 *   repositories anonymously.
 * * **The stack is detection's.** `dep_graph` parses the stack BB.1's language row reports for the
 *   repository's latest scan (`repo_detections`, V067) — C/C++, Python or JS/TS — and nothing else.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { CodeRepositoryRef, DepStack } from "../../engine/engine.code.contract";
import { cloneUrl } from "../../farm/dispatch/offer";
import { GithubCredentialsService } from "../../github/github.credentials.service";
import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";

/** A repository the workspace has enabled. */
export interface EnabledRepository {
  /** `github_repos.id`. */
  readonly id: string;
  /** `owner/name`, as stored (lower-cased). */
  readonly slug: string;
  /** The bare name. */
  readonly name: string;
  /** The default branch, when known. */
  readonly defaultBranch: string | null;
}

/** Why a repository name resolved to nothing. */
export type RepositoryMiss =
  | { readonly reason: "unknown" }
  | { readonly reason: "ambiguous"; readonly candidates: readonly string[] };

/** What detection says about a repository's stack. */
export type DetectedStack =
  | { readonly stack: DepStack; readonly language: string }
  | { readonly stack: null; readonly language: string | null };

/** GitHub's language names, as the detection pack stores them, → the stack `dep_graph` parses. */
const STACK_OF_LANGUAGE: Readonly<Record<string, DepStack>> = {
  c: "c",
  "c++": "c",
  python: "python",
  javascript: "javascript",
  typescript: "javascript",
};

@Injectable()
export class CodeWorkspace {
  /**
   * @param database - The tenancy database.
   * @param credentials - The workspace's GitHub token, opened per call.
   */
  constructor(
    private readonly database: DatabaseService,
    private readonly credentials: GithubCredentialsService,
  ) {}

  /**
   * Every repository the workspace has enabled.
   *
   * @param organizationId - The workspace.
   * @returns The repositories, by slug.
   */
  async enabled(organizationId: string): Promise<EnabledRepository[]> {
    const rows = await this.database.db
      .selectFrom("github_repos as r")
      .innerJoin("github_orgs as o", "o.id", "r.org_id")
      .select(["r.id", "o.login", "r.name", "r.default_branch"])
      .where("o.organization_id", "=", organizationId)
      .where("o.enabled", "=", true)
      .where("r.enabled", "=", true)
      .orderBy("o.login")
      .orderBy("r.name")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      slug: `${row.login}/${row.name}`,
      name: row.name,
      defaultBranch: row.default_branch,
    }));
  }

  /**
   * The enabled repository a name means.
   *
   * @param organizationId - The workspace.
   * @param wanted - `owner/name`, or a bare `name` that only one enabled repository has.
   * @returns The repository, or why there is none.
   */
  async resolve(
    organizationId: string,
    wanted: string,
  ): Promise<EnabledRepository | RepositoryMiss> {
    const key = wanted.trim().toLowerCase();
    const repositories = await this.enabled(organizationId);
    const exact = repositories.find((repository) => repository.slug.toLowerCase() === key);
    if (exact !== undefined) return exact;
    if (key.includes("/")) return { reason: "unknown" };

    const named = repositories.filter((repository) => repository.name.toLowerCase() === key);
    if (named.length === 1) return named[0];
    if (named.length > 1) {
      return { reason: "ambiguous", candidates: named.map((repository) => repository.slug) };
    }
    return { reason: "unknown" };
  }

  /**
   * How the engine fetches a repository, for one call.
   *
   * @param organizationId - The workspace — the engine keeps its clones apart.
   * @param repository - The repository.
   * @returns The ref, carrying the workspace's GitHub token (or none, for a workspace without one).
   */
  async repositoryRef(
    organizationId: string,
    repository: EnabledRepository,
  ): Promise<CodeRepositoryRef> {
    const [owner, name] = repository.slug.split("/") as [string, string];
    return {
      workspace: organizationId,
      slug: repository.slug,
      remote: cloneUrl(owner, name),
      token: await this.token(organizationId),
    };
  }

  /**
   * The workspace's GitHub token, or none.
   *
   * @param organizationId - The workspace.
   * @returns The token; `null` when the workspace has not set one.
   */
  private async token(organizationId: string): Promise<string | null> {
    try {
      return await this.credentials.tokenFor(organizationId);
    } catch (error) {
      if (error instanceof GithubApiError && error.failure === GITHUB_FAILURES.notConfigured) {
        return null;
      }
      throw error;
    }
  }

  /**
   * The stack the repository's latest detection scan reports.
   *
   * @param organizationId - The workspace.
   * @param slug - `owner/name`.
   * @returns The stack `dep_graph` parses, or `null` with the language detection saw (`null` when
   *   the repository was never scanned).
   */
  async stack(organizationId: string, slug: string): Promise<DetectedStack> {
    const repoRef = slug.toLowerCase();
    const row = await this.database.db
      .selectFrom("repo_detections")
      .select("evidence")
      .where("organization_id", "=", organizationId)
      .where("repo_ref", "=", repoRef)
      .where("row_key", "=", "language")
      .where(
        "scan_seq",
        "=",
        sql<number>`(select max(s.scan_seq) from ouroboros.repo_detection_scans s
                      where s.organization_id = ${organizationId} and s.repo_ref = ${repoRef})`,
      )
      .executeTakeFirst();

    const language = languageOf(row?.evidence);
    if (language === null) return { stack: null, language: null };
    const stack = STACK_OF_LANGUAGE[language.toLowerCase()];
    return stack === undefined ? { stack: null, language } : { stack, language };
  }
}

/**
 * The top language a detection row's evidence names.
 *
 * @param evidence - `repo_detections.evidence` for the `language` row.
 * @returns `evidence.top.language`, or `null`.
 */
export function languageOf(evidence: unknown): string | null {
  if (typeof evidence !== "object" || evidence === null) return null;
  const top = (evidence as { top?: unknown }).top;
  if (typeof top !== "object" || top === null) return null;
  const language = (top as { language?: unknown }).language;
  return typeof language === "string" && language.trim() !== "" ? language : null;
}
