/**
 * The codebase & git mining tool — mockup 22's third tool row (CL.4,
 * [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * ```
 * ⌥ Codebase & git mining    blame, bisect, dependency graph over helios-firmware    ●
 * ```
 *
 * Deterministic code archaeology over the workspace's **enabled** repositories, read from the
 * clones the engine keeps (`/v0/code/*`) and handed the workspace's GitHub token per call. One
 * capability, `query`, with these operations:
 *
 * ```
 * {op: "blame", repo, path, range: "200-230", ref?}           who last changed it — "unchanged in 14 months"
 * {op: "history", repo, path? | symbol?, windowDays?, ref?}    change frequency and churn
 * {op: "changed_between", repo, refA, refB, scope?}            what moved between a baseline and a nightly
 * {op: "dep_graph", repo, module?, ref?}                       module edges — or `unsupported`, never empty
 * {op: "bisect", repo, good, bad, testRef, pool, command?}     start (or re-read) the bisect primitive
 * {op: "bisect_status", bisectId} · {op: "bisect_cancel", bisectId}
 * ```
 *
 * Every answer is cited (`code.sources.ts`): `git://owner/name@<sha>/path#Lnn` at the exact commit
 * read, and a converged bisect as `bisect://owner/name@<culprit>?jobs=…` naming the farm jobs that
 * proved it. Nothing writes to a repository — the engine's clones are read-only to every operation.
 */

import {
  blameSchema,
  changedBetweenSchema,
  depGraphSchema,
  historySchema,
} from "../../../../engine/engine.code.contract";
import type { BisectView, CodeBisectService, StartBisect } from "../../../code/code-bisect.service";
import { CodeRefusal, type CodeReader } from "../../../code/code.reader";
import {
  bisectSource,
  blameSource,
  changedBetweenSource,
  depGraphSource,
  historySource,
} from "../../../code/code.sources";
import type { CodeWorkspace, EnabledRepository } from "../../../code/code.workspace";
import type {
  QueryCapableTool,
  SubLineValue,
  ToolCallContext,
  ToolCapabilities,
  ToolDisplayMeta,
  ToolResult,
} from "../../research-tool.adapter";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "../../research-tool.config";
import { ResearchToolError } from "../../research-tool.errors";
import { NOT_CONFIGURED_HEALTH, type ToolHealth } from "../../research-tool.health";

/** The registry slug — V106's seeded `code` row. */
export const CODE_TOOL_SLUG = "code";

/** The operations `query` answers. */
export const CODE_OPERATIONS = [
  "blame",
  "history",
  "changed_between",
  "dep_graph",
  "bisect",
  "bisect_status",
  "bisect_cancel",
] as const;

/** The look-backs a workspace may choose for `history`, in days. */
export const WINDOW_CHOICES = ["30", "90", "180", "365"] as const;

/** `history`'s window when neither the call nor the workspace names one. */
export const DEFAULT_WINDOW_DAYS = 90;

/** The longest `history` window, in days — ten years. */
export const MAX_WINDOW_DAYS = 3650;

/** How many repository names the sub-line lists before it counts them instead. */
const NAMED_REPOSITORIES = 3;

/** What the tool reads through. */
export interface CodeToolDependencies {
  readonly reader: Pick<CodeReader, "repository" | "read">;
  readonly bisects: Pick<CodeBisectService, "start" | "get" | "cancel">;
  readonly workspace: Pick<CodeWorkspace, "enabled" | "stack">;
  /** Whether the engine that keeps the clones answers. Never rejects. */
  readonly engineUp: () => Promise<boolean>;
}

export class CodeResearchTool implements QueryCapableTool {
  readonly slug = CODE_TOOL_SLUG;

  /** @param deps - The reader, the bisect primitive, the workspace's repositories, the engine. */
  constructor(private readonly deps: CodeToolDependencies) {}

  displayMeta(): ToolDisplayMeta {
    return {
      name: "Codebase & git mining",
      glyph: "⌥",
      subLine: "blame, bisect, dependency graph over {repos}",
    };
  }

  /**
   * The sub-line's repositories — the workspace's enabled ones.
   *
   * @param organizationId - The workspace.
   * @returns `repos`: `helios-firmware`, `a, b and c`, `12 repositories` or `no repositories
   *   enabled`; null when they cannot be read. Never rejects.
   */
  async counts(organizationId: string): Promise<Readonly<Record<string, SubLineValue>>> {
    try {
      return { repos: repositoriesPhrase(await this.deps.workspace.enabled(organizationId)) };
    } catch {
      return { repos: null };
    }
  }

  /**
   * One setting — `history`'s default look-back. The repositories are the workspace's enabled
   * ones and the credential is its GitHub token; neither is configured here.
   *
   * @returns The form.
   */
  configSchema(): ResearchToolConfigSchema {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title: "Codebase & git mining",
      properties: {
        windowDays: {
          type: "string",
          title: "Default history window",
          description:
            "How many days of history an investigation reads when it names no window. The tool reads the repositories enabled for this workspace, with its GitHub token.",
          enum: [...WINDOW_CHOICES],
          default: String(DEFAULT_WINDOW_DAYS),
        },
      },
      required: [],
      additionalProperties: false,
    };
  }

  capabilities(): ToolCapabilities & { readonly query: true } {
    return { search: false, fetch: false, query: true, watch: false };
  }

  /**
   * Whether the tool can read anything.
   *
   * @param config - The configuration, or null when the workspace has not enabled the tool.
   * @param _secret - Unused: the tool uses the workspace's GitHub token.
   * @param organizationId - The workspace whose repositories are counted.
   * @returns `healthy` with repositories and an engine that answers; `down` when the engine does
   *   not; `not_configured` with no repository enabled. Never rejects.
   */
  async healthCheck(
    config: ResearchToolConfig | null,
    _secret: string | null,
    organizationId?: string,
  ): Promise<ToolHealth> {
    if (config === null) return NOT_CONFIGURED_HEALTH;
    try {
      const repositories =
        organizationId === undefined ? null : await this.deps.workspace.enabled(organizationId);
      if (repositories !== null && repositories.length === 0) {
        return { state: "not_configured", detail: "no repositories enabled for this workspace" };
      }
      if (!(await this.deps.engineUp())) {
        return {
          state: "down",
          detail: "the engine that keeps the repository clones is unreachable",
        };
      }
      return repositories === null
        ? { state: "degraded", detail: "no workspace named — repositories unknown" }
        : {
            state: "healthy",
            detail: `${repositoriesPhrase(repositories)} · clones on the engine`,
          };
    } catch {
      return { state: "down", detail: "the workspace's repositories could not be read" };
    }
  }

  /**
   * One operation — see this file's header.
   *
   * @param context - The call.
   * @param structured - `{op, …}`.
   * @returns The answer and its citations.
   * @throws {ResearchToolError} `unsupported` for an unknown op, a malformed input, a repository
   *   the workspace has not enabled, a ref or path not in it, or a stack `dep_graph` does not
   *   parse; `auth` when GitHub refused the token; `network` when the engine or GitHub could not
   *   be reached; `upstream` for anything else.
   */
  async query(
    context: ToolCallContext,
    structured: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const op = structured.op;
    if (typeof op !== "string" || !(CODE_OPERATIONS as readonly string[]).includes(op)) {
      throw new ResearchToolError(
        "unsupported",
        `the code tool answers {op: ${CODE_OPERATIONS.map((name) => `"${name}"`).join(" | ")}}`,
      );
    }
    try {
      return await this.run(op as (typeof CODE_OPERATIONS)[number], context, structured);
    } catch (error) {
      if (error instanceof ResearchToolError) throw error;
      if (error instanceof CodeRefusal)
        throw new ResearchToolError(error.refusalClass, error.detail);
      throw new ResearchToolError("upstream", "the code tool could not answer");
    }
  }

  private async run(
    op: (typeof CODE_OPERATIONS)[number],
    context: ToolCallContext,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const org = context.organizationId;

    switch (op) {
      case "bisect_status":
      case "bisect_cancel": {
        const id = text(input, "bisectId");
        const view =
          op === "bisect_status"
            ? await this.deps.bisects.get(org, id)
            : await this.deps.bisects.cancel(org, id);
        if (view === undefined) {
          throw new ResearchToolError("unsupported", `this workspace has no bisect ${id}`);
        }
        return bisectResult(view);
      }
      case "bisect": {
        const request: StartBisect = {
          organizationId: org,
          repository: text(input, "repo"),
          good: text(input, "good"),
          bad: text(input, "bad"),
          testRef: text(input, "testRef"),
          pool: text(input, "pool"),
          command: argv(input.command),
          investigationId: context.investigationId,
          createdBy: null,
        };
        return bisectResult(await this.deps.bisects.start(request));
      }
      default:
        break;
    }

    const repository = await this.deps.reader.repository(org, text(input, "repo"));
    const ref = optionalText(input, "ref") ?? repository.defaultBranch ?? "HEAD";

    switch (op) {
      case "blame": {
        const [start, end] = range(input.range);
        const blame = await this.deps.reader.read(
          org,
          repository,
          "blame",
          { ref, path: text(input, "path"), start, end },
          blameSchema,
        );
        return { payload: blame, sources: [blameSource(blame)], usage: { tokens: 0 } };
      }
      case "history": {
        const path = optionalText(input, "path");
        const symbol = optionalText(input, "symbol");
        if (path === null && symbol === null) {
          throw new ResearchToolError(
            "unsupported",
            'history() traces a path or a symbol — {path: "src/motor"}',
          );
        }
        const history = await this.deps.reader.read(
          org,
          repository,
          "history",
          { ref, path, symbol, window_days: windowOf(input.windowDays, context.config) },
          historySchema,
        );
        return { payload: history, sources: [historySource(history)], usage: { tokens: 0 } };
      }
      case "changed_between": {
        const changed = await this.deps.reader.read(
          org,
          repository,
          "changed-between",
          {
            base: text(input, "refA"),
            head: text(input, "refB"),
            scope: optionalText(input, "scope"),
          },
          changedBetweenSchema,
        );
        return { payload: changed, sources: [changedBetweenSource(changed)], usage: { tokens: 0 } };
      }
      case "dep_graph": {
        return this.depGraph(org, repository, ref, optionalText(input, "module"));
      }
      default:
        throw new ResearchToolError("unsupported", `unknown op ${String(op)}`);
    }
  }

  /**
   * A module's dependency graph — refused as `unsupported` with the reason, never answered empty.
   *
   * @param org - The workspace.
   * @param repository - The repository.
   * @param ref - The ref.
   * @param module - The directory, or null for the whole tree.
   * @returns The graph and its citation.
   * @throws {ResearchToolError} `unsupported` when detection knows no supported stack, or the
   *   module holds no source of it.
   */
  private async depGraph(
    org: string,
    repository: EnabledRepository,
    ref: string,
    module: string | null,
  ): Promise<ToolResult> {
    const detected = await this.deps.workspace.stack(org, repository.slug);
    if (detected.stack === null) {
      throw new ResearchToolError(
        "unsupported",
        detected.language === null
          ? `repository detection has not scanned ${repository.slug}, so its stack is unknown — dependency graphs are read for C/C++, Python and JS/TS`
          : `dependency graphs are read for C/C++, Python and JS/TS; ${repository.slug} is detected as ${detected.language}`,
      );
    }
    const graph = await this.deps.reader.read(
      org,
      repository,
      "dep-graph",
      { ref, module, stack: detected.stack },
      depGraphSchema,
    );
    if (graph.status === "unsupported") {
      throw new ResearchToolError("unsupported", graph.reason ?? "unsupported");
    }
    return { payload: graph, sources: [depGraphSource(graph)], usage: { tokens: 0 } };
  }
}

/**
 * A bisect as the loop reads it.
 *
 * @param view - The bisect and its steps.
 * @returns The payload — status, culprit, steps with their jobs — and its citation.
 */
function bisectResult(view: BisectView): ToolResult {
  const { bisect, steps } = view;
  return {
    payload: {
      bisectId: bisect.id,
      repository: bisect.repository,
      testRef: bisect.testRef,
      good: { ref: bisect.goodRef, sha: bisect.goodSha },
      bad: { ref: bisect.badRef, sha: bisect.badSha },
      candidates: bisect.commits.length,
      maxSteps: bisect.maxSteps,
      window: { lo: bisect.commits[bisect.lo], hi: bisect.commits[bisect.hi] },
      status: bisect.status,
      culprit: bisect.culpritSha,
      note: bisect.note,
      steps: steps.map((step) => ({
        step: step.step,
        commit: step.commitSha,
        job: { id: step.buildJobId, number: step.jobNumber, status: step.jobStatus },
        verdict: step.verdict,
      })),
    },
    sources: [bisectSource(view)],
    usage: { tokens: 0 },
  };
}

/**
 * The sub-line's phrase for a workspace's repositories.
 *
 * @param repositories - The enabled repositories.
 * @returns Their names, or their count.
 */
export function repositoriesPhrase(repositories: readonly EnabledRepository[]): string {
  if (repositories.length === 0) return "no repositories enabled";
  if (repositories.length > NAMED_REPOSITORIES)
    return `${String(repositories.length)} repositories`;
  const names = repositories.map((repository) => repository.name);
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function text(input: Readonly<Record<string, unknown>>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ResearchToolError("unsupported", `${field} is required`);
  }
  return value.trim();
}

function optionalText(input: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = input[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ResearchToolError("unsupported", `${field} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * A blame range — `"200-230"`, `"214"` or `[200, 230]`.
 *
 * @param value - What the call named.
 * @returns `[start, end]`.
 * @throws {ResearchToolError} `unsupported` for anything else.
 */
export function range(value: unknown): [number, number] {
  let bounds: unknown[] | null = null;
  if (typeof value === "string" && /^\d+(-\d+)?$/.test(value.trim())) {
    bounds = value.trim().split("-").map(Number);
  } else if (Array.isArray(value) && (value.length === 1 || value.length === 2)) {
    bounds = value;
  }
  const [start, end = start] = bounds ?? [];
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start
  ) {
    throw new ResearchToolError("unsupported", 'range is a line or a span — "214" or "200-230"');
  }
  return [start, end];
}

/**
 * A step command — argv, or absent for the pool's default.
 *
 * @param value - What the call named.
 * @returns The argv, or null.
 * @throws {ResearchToolError} `unsupported` for anything but 1–64 strings.
 */
function argv(value: unknown): readonly string[] | null {
  if (value === undefined || value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 64 ||
    !value.every((word) => typeof word === "string") ||
    value[0].trim() === ""
  ) {
    throw new ResearchToolError(
      "unsupported",
      'command is argv — ["west", "twister", "-T", "tests/hil"]',
    );
  }
  return value;
}

/**
 * `history`'s window.
 *
 * @param value - What the call named.
 * @param config - The workspace's configuration — its default.
 * @returns Days.
 * @throws {ResearchToolError} `unsupported` outside 1–3650.
 */
function windowOf(value: unknown, config: ResearchToolConfig): number {
  if (value === undefined) {
    const configured = config.windowDays;
    return typeof configured === "string" &&
      (WINDOW_CHOICES as readonly string[]).includes(configured)
      ? Number(configured)
      : DEFAULT_WINDOW_DAYS;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_WINDOW_DAYS
  ) {
    throw new ResearchToolError(
      "unsupported",
      `windowDays must be a whole number from 1 to ${String(MAX_WINDOW_DAYS)}`,
    );
  }
  return value;
}
