/**
 * `ouroboros-engine`'s `/v0/code/*` contract, mirrored — the code & git mining tool's engine half
 * (CL.4, [#617](https://github.com/NobuData/ouroboros/issues/617)).
 *
 * The same three rules as `engine.contract.ts`: parsed rather than asserted, unknown fields
 * stripped, and `snake_case` translated to `camelCase` here and nowhere else. Read beside
 * `ouroboros-engine/openapi.yaml` § `/v0/code/*` and `ouroboros_engine/code/contract.py`.
 *
 * Unlike the other engine routes, a refusal here is an **answer** the caller acts on — a ref that
 * names nothing, a path that is not in the tree, a good commit that is not an ancestor — so the
 * client returns the engine's `code_*` code and sentence instead of collapsing them into
 * `engine_unavailable` ({@link EngineCodeRefusal}). The sentences are built from the caller's own
 * input; the token a request carries is never in one.
 */

import { z } from "zod";

import { ENGINE_API_VERSION } from "./engine.contract";

/** The five operations, by route segment. */
export const CODE_OPERATIONS = [
  "blame",
  "history",
  "changed-between",
  "dep-graph",
  "bisect-commits",
] as const;

/** One of {@link CODE_OPERATIONS}. */
export type CodeOperation = (typeof CODE_OPERATIONS)[number];

/**
 * The route of a code operation.
 *
 * @param operation - The operation.
 * @returns `v0/code/<operation>`, relative to `OURO_ENGINE_URL`.
 */
export function engineCodeRoute(operation: CodeOperation): string {
  return `${ENGINE_API_VERSION}/code/${operation}`;
}

/** The stacks `dep-graph` parses. */
export const DEP_STACKS = ["c", "python", "javascript"] as const;

/** One of {@link DEP_STACKS}. */
export type DepStack = (typeof DEP_STACKS)[number];

/** Which repository, for which workspace, from where, with what — every request's first field. */
export interface CodeRepositoryRef {
  /** The workspace; its clones are kept apart from every other's. */
  readonly workspace: string;
  /** `owner/name`. */
  readonly slug: string;
  /** `https://github.com/owner/name.git`. */
  readonly remote: string;
  /** The workspace's GitHub token, for this call's fetch only — never stored by the engine. */
  readonly token: string | null;
}

/** The clone an answer was read from. */
export interface CloneInfo {
  readonly repository: string;
  readonly fetchedAt: string;
  /** A refresh was due and failed, so the clone was read as it was. */
  readonly stale: boolean;
}

/** The citable facts of one commit. */
export interface CommitInfo {
  readonly sha: string;
  readonly committedAt: string;
  readonly author: string;
  readonly summary: string;
}

const cloneSchema = z
  .object({ repository: z.string(), fetched_at: z.string(), stale: z.boolean() })
  .transform((body): CloneInfo => ({
    repository: body.repository,
    fetchedAt: body.fetched_at,
    stale: body.stale,
  }));

const sha = z.string().regex(/^[0-9a-f]{40}$/);

const commitSchema = z
  .object({ sha, committed_at: z.string(), author: z.string(), summary: z.string() })
  .transform((body): CommitInfo => ({
    sha: body.sha,
    committedAt: body.committed_at,
    author: body.author,
    summary: body.summary,
  }));

const changedCommitSchema = z
  .object({
    commit: commitSchema,
    added: z.number().int(),
    deleted: z.number().int(),
    files: z.array(z.string()),
  })
  .transform((body) => body);

/** One commit and the lines it moved in scope. */
export type ChangedCommit = z.output<typeof changedCommitSchema>;

/** `POST /v0/code/blame`, as it arrives. */
export const blameSchema = z
  .object({
    clone: cloneSchema,
    ref: z.string(),
    sha,
    path: z.string(),
    start: z.number().int(),
    end: z.number().int(),
    lines: z.array(z.string()),
    hunks: z.array(
      z.object({ start: z.number().int(), end: z.number().int(), commit: commitSchema }),
    ),
    last_change: commitSchema,
    as_of: z.string(),
    unchanged: z.object({ months: z.number().int(), days: z.number().int(), phrase: z.string() }),
  })
  .transform((body) => ({
    clone: body.clone,
    ref: body.ref,
    sha: body.sha,
    path: body.path,
    start: body.start,
    end: body.end,
    lines: body.lines,
    hunks: body.hunks,
    lastChange: body.last_change,
    asOf: body.as_of,
    unchanged: body.unchanged,
  }));

/** Who last changed a line range, and how long ago. */
export type Blame = z.output<typeof blameSchema>;

/** `POST /v0/code/history`, as it arrives. */
export const historySchema = z
  .object({
    clone: cloneSchema,
    ref: z.string(),
    sha,
    path: z.string().nullable(),
    symbol: z.string().nullable(),
    window_days: z.number().int(),
    since: z.string(),
    until: z.string(),
    commits: z.array(changedCommitSchema),
    total_commits: z.number().int(),
    truncated: z.boolean(),
    added: z.number().int(),
    deleted: z.number().int(),
    authors: z.number().int(),
    per_month: z.number(),
  })
  .transform((body) => ({
    clone: body.clone,
    ref: body.ref,
    sha: body.sha,
    path: body.path,
    symbol: body.symbol,
    windowDays: body.window_days,
    since: body.since,
    until: body.until,
    commits: body.commits,
    totalCommits: body.total_commits,
    truncated: body.truncated,
    added: body.added,
    deleted: body.deleted,
    authors: body.authors,
    perMonth: body.per_month,
  }));

/** Change frequency and churn over a window. */
export type History = z.output<typeof historySchema>;

/** `POST /v0/code/changed-between`, as it arrives. */
export const changedBetweenSchema = z
  .object({
    clone: cloneSchema,
    base: z.string(),
    head: z.string(),
    base_sha: sha,
    head_sha: sha,
    scope: z.string().nullable(),
    commits: z.array(changedCommitSchema),
    total_commits: z.number().int(),
    truncated: z.boolean(),
    files: z.array(
      z.object({
        path: z.string(),
        commits: z.number().int(),
        added: z.number().int(),
        deleted: z.number().int(),
      }),
    ),
    total_files: z.number().int(),
    added: z.number().int(),
    deleted: z.number().int(),
  })
  .transform((body) => ({
    clone: body.clone,
    base: body.base,
    head: body.head,
    baseSha: body.base_sha,
    headSha: body.head_sha,
    scope: body.scope,
    commits: body.commits,
    totalCommits: body.total_commits,
    truncated: body.truncated,
    files: body.files,
    totalFiles: body.total_files,
    added: body.added,
    deleted: body.deleted,
  }));

/** What moved between two commits. */
export type ChangedBetween = z.output<typeof changedBetweenSchema>;

const edgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  weight: z.number().int(),
});

/** `POST /v0/code/dep-graph`, as it arrives. */
export const depGraphSchema = z
  .object({
    clone: cloneSchema,
    ref: z.string(),
    sha,
    module: z.string().nullable(),
    stack: z.enum(DEP_STACKS).nullable(),
    status: z.enum(["ok", "unsupported"]),
    reason: z.string().nullable(),
    nodes: z.array(z.string()),
    edges: z.array(edgeSchema),
    module_edges: z.array(edgeSchema),
    external: z.array(z.string()),
    truncated: z.boolean(),
  })
  .transform((body) => ({
    clone: body.clone,
    ref: body.ref,
    sha: body.sha,
    module: body.module,
    stack: body.stack,
    status: body.status,
    reason: body.reason,
    nodes: body.nodes,
    edges: body.edges,
    moduleEdges: body.module_edges,
    external: body.external,
    truncated: body.truncated,
  }));

/** A module's dependency graph, or an honest `unsupported`. */
export type DepGraph = z.output<typeof depGraphSchema>;

/** `POST /v0/code/bisect-commits`, as it arrives. */
export const bisectCommitsSchema = z
  .object({
    clone: cloneSchema,
    good: z.string(),
    bad: z.string(),
    good_sha: sha,
    bad_sha: sha,
    bad_ref_name: z.string().nullable(),
    commits: z.array(sha).min(1),
    max_steps: z.number().int().min(1),
  })
  .transform((body) => ({
    clone: body.clone,
    good: body.good,
    bad: body.bad,
    goodSha: body.good_sha,
    badSha: body.bad_sha,
    badRefName: body.bad_ref_name,
    commits: body.commits,
    maxSteps: body.max_steps,
  }));

/** The first-parent line a bisect walks. */
export type BisectCommits = z.output<typeof bisectCommitsSchema>;

/** The `code_*` codes the engine answers a refusal with. */
export const CODE_REFUSALS = [
  "code_ref_not_found",
  "code_path_not_found",
  "code_not_ancestor",
  "code_remote_refused",
  "code_range_outside_file",
  "code_range_too_wide",
  "code_bisect_too_long",
  "code_remote_auth",
  "code_remote_unreachable",
] as const;

/** One of {@link CODE_REFUSALS}. */
export type CodeRefusalCode = (typeof CODE_REFUSALS)[number];

/** A refusal the engine answered, in its own words. */
export interface EngineCodeRefusal {
  readonly status: number;
  readonly code: CodeRefusalCode;
  readonly message: string;
}

/** The envelope a refusal arrives in — anything else is not one. */
export const codeRefusalSchema = z.object({
  code: z.enum(CODE_REFUSALS),
  message: z.string(),
});

/** What a code call answers: the operation's answer, or the engine's refusal. */
export type EngineCodeAnswer<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly refusal: EngineCodeRefusal };

/**
 * The repository part of a request, as the engine reads it.
 *
 * @param repository - The repository and this call's token.
 * @returns The body field.
 */
export function codeRepositoryBody(repository: CodeRepositoryRef): Record<string, unknown> {
  return {
    workspace: repository.workspace,
    slug: repository.slug,
    remote: repository.remote,
    token: repository.token,
  };
}
