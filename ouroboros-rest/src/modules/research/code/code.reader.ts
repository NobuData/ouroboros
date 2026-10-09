/**
 * One read of a workspace repository through the engine's clones — the code & git mining tool's
 * only way to git (CL.4, [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * It resolves the repository the caller named among the workspace's **enabled** ones, hands the
 * engine the workspace's GitHub token for that one call, and turns every way the read can fail
 * into a {@link CodeRefusal} whose class is the research tool SPI's: a name that means nothing, a
 * ref or path not in the repository and a good commit that is not an ancestor are `unsupported`
 * (asking again will not help); GitHub refusing the token is `auth`; an engine or remote that
 * could not be reached is `network`. The sentence is safe to show — it never carries the token.
 */

import { Injectable } from "@nestjs/common";
import type { ZodType } from "zod";

import { AppConfigService } from "../../config/config.service";
import {
  type CodeOperation,
  codeRepositoryBody,
  type EngineCodeRefusal,
} from "../../engine/engine.code.contract";
import { EngineClient } from "../../engine/engine.client";
import { UpstreamError } from "../../errors/error.envelope";
import { CodeWorkspace, type EnabledRepository } from "./code.workspace";

/** How a code read failed — the research tool SPI's classes the tool can produce. */
export type CodeRefusalClass = "auth" | "network" | "unsupported" | "upstream";

/** A classified failure of a code read or a bisect. */
export class CodeRefusal extends Error {
  /**
   * @param refusalClass - Which class.
   * @param detail - The sentence — never the token.
   */
  constructor(
    readonly refusalClass: CodeRefusalClass,
    readonly detail: string,
  ) {
    super(`${refusalClass}: ${detail}`);
    this.name = "CodeRefusal";
  }
}

/** A read's answer, and the repository it was read from. */
export interface CodeRead<T> {
  readonly repository: EnabledRepository;
  readonly data: T;
}

@Injectable()
export class CodeReader {
  /**
   * @param workspace - The workspace's repositories and token.
   * @param engine - The engine, which keeps the clones.
   * @param config - `OURO_RESEARCH_CODE_TIMEOUT_MS`.
   */
  constructor(
    private readonly workspace: CodeWorkspace,
    private readonly engine: EngineClient,
    private readonly config: AppConfigService,
  ) {}

  /**
   * The enabled repository a name means.
   *
   * @param organizationId - The workspace.
   * @param name - `owner/name`, or a bare name only one enabled repository has.
   * @returns The repository.
   * @throws {CodeRefusal} `unsupported` for a name that matches none, or several.
   */
  async repository(organizationId: string, name: string): Promise<EnabledRepository> {
    const resolved = await this.workspace.resolve(organizationId, name);
    if ("id" in resolved) return resolved;
    if (resolved.reason === "ambiguous") {
      throw new CodeRefusal(
        "unsupported",
        `${name} names ${String(resolved.candidates.length)} enabled repositories — say which: ${resolved.candidates.join(", ")}`,
      );
    }
    throw new CodeRefusal(
      "unsupported",
      `${name} is not a repository this workspace has enabled for Ouroboros`,
    );
  }

  /**
   * Run one engine operation over a repository.
   *
   * @param organizationId - The workspace.
   * @param repository - The repository, already resolved.
   * @param operation - The engine route.
   * @param body - The operation's fields, beside `repository` — in the engine's `snake_case`.
   * @param schema - What the answer must be.
   * @returns The answer.
   * @throws {CodeRefusal} Classified, as this file's header says.
   */
  async read<T>(
    organizationId: string,
    repository: EnabledRepository,
    operation: CodeOperation,
    body: Record<string, unknown>,
    schema: ZodType<T>,
  ): Promise<T> {
    const ref = await this.workspace.repositoryRef(organizationId, repository);
    let answer;
    try {
      answer = await this.engine.code(
        operation,
        { repository: codeRepositoryBody(ref), ...body },
        schema,
        this.config.researchCodeTimeoutMs,
      );
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw new CodeRefusal(
          "network",
          "the engine that keeps the repository clones could not be reached",
        );
      }
      throw error;
    }
    if (answer.ok) return answer.data;
    throw refusalOf(answer.refusal, repository.slug);
  }
}

/**
 * The engine's refusal, classified.
 *
 * @param refusal - What it answered.
 * @param slug - The repository, for the sentence.
 * @returns The refusal to throw.
 */
export function refusalOf(refusal: EngineCodeRefusal, slug: string): CodeRefusal {
  switch (refusal.code) {
    case "code_remote_auth":
      return new CodeRefusal(
        "auth",
        `GitHub refused the workspace's token for ${slug} — check the token can read it`,
      );
    case "code_remote_unreachable":
      return new CodeRefusal("network", `${slug} could not be fetched from GitHub`);
    case "code_remote_refused":
      return new CodeRefusal("upstream", `${slug} has no clone URL the engine accepts`);
    default:
      return new CodeRefusal("unsupported", refusal.message);
  }
}
