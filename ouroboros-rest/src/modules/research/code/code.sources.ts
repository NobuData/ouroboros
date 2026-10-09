/**
 * The code & git mining tool's citations — `git://` for a read, `bisect://` for a culprit (CL.4,
 * [#617](https://github.com/NobuData/ouroboros/issues/617), decision **V3**).
 *
 * Every locator names the **40-hex commit** the answer was read at, so it re-runs to the same
 * answer however the branch has moved since:
 *
 * ```
 * blame            git://acme-robotics/helios-firmware@<sha>/src/dock/dock_ctrl.c#L200-L230
 * history          git://acme-robotics/helios-firmware@<sha>/src/motor/pid.c
 * changed_between  git://acme-robotics/helios-firmware@<head sha>/src/motor   meta.range base..head
 * dep_graph        git://acme-robotics/helios-firmware@<sha>/src/dock
 * bisect           bisect://acme-robotics/helios-firmware@<culprit>?jobs=<uuid>,<uuid>,…
 * ```
 *
 * A bisect still running is cited by the range it is searching (`git://…@<bad sha>`, with the
 * range and the steps so far in `meta`) — a payload is never without a source — and becomes a
 * `bisect://` source naming the farm jobs that proved its culprit once it converges. Shared by the
 * research adapter and the regression watch (#623), so both cite a bisect the same way.
 */

import { createHash } from "node:crypto";

import type {
  Blame,
  ChangedBetween,
  ChangedCommit,
  DepGraph,
  History,
} from "../../engine/engine.code.contract";
import type { SourceRecord } from "../tools/research-tool.adapter";
import type { BisectView } from "./code-bisect.service";

/** V108's excerpt bound, in bytes. */
const EXCERPT_MAX_BYTES = 4096;

/** V108's title bound. */
const TITLE_MAX_CHARS = 300;

/** The most commits an excerpt lists. */
const EXCERPT_COMMITS = 20;

/**
 * Cite a blame.
 *
 * @param blame - The engine's answer.
 * @returns A `code` source at `path#Lstart-Lend`, at the commit read.
 */
export function blameSource(blame: Blame): SourceRecord {
  const span =
    blame.start === blame.end
      ? `L${String(blame.start)}`
      : `L${String(blame.start)}-L${String(blame.end)}`;
  const last = blame.lastChange;
  const where = `${blame.path}:${String(blame.start)}${blame.end === blame.start ? "" : `-${String(blame.end)}`}`;
  return {
    kind: "code",
    title: title(`${blame.clone.repository} · ${where} · ${blame.unchanged.phrase}`),
    locator: `git://${blame.clone.repository}@${blame.sha}/${blame.path}#${span}`,
    retrievedAt: blame.clone.fetchedAt,
    contentHash: hashOf({ ...blame, clone: undefined }),
    excerpt: bounded(
      [
        `${where} · ${blame.unchanged.phrase} (as of ${short(blame.sha)}, ${day(blame.asOf)})`,
        `last changed ${day(last.committedAt)} @${short(last.sha)} by ${last.author}: ${last.summary}`,
        "",
        ...blame.lines.map((line, index) => `${String(blame.start + index)}  ${line}`),
      ].join("\n"),
    ),
    meta: {
      op: "blame",
      repo: blame.clone.repository,
      sha: blame.sha,
      path: blame.path,
      lines: [blame.start, blame.end],
      lastChange: last.sha,
      asOf: blame.asOf,
      unchanged: blame.unchanged.phrase,
    },
  };
}

/**
 * Cite a history.
 *
 * @param history - The engine's answer.
 * @returns A `code` source at the path (or the repository, for a symbol), at the commit read.
 */
export function historySource(history: History): SourceRecord {
  const subject = history.path ?? history.symbol ?? "the repository";
  return {
    kind: "code",
    title: title(
      `${history.clone.repository} · history of ${subject} · ${String(history.totalCommits)} changes in ${String(history.windowDays)}d`,
    ),
    locator: gitLocator(history.clone.repository, history.sha, history.path),
    retrievedAt: history.clone.fetchedAt,
    contentHash: hashOf({ ...history, clone: undefined }),
    excerpt: bounded(
      [
        `${subject}: ${String(history.totalCommits)} changes, +${String(history.added)} -${String(history.deleted)}, ${String(history.authors)} authors, ${String(history.perMonth)}/month over ${day(history.since)}..${day(history.until)}`,
        ...commitLines(history.commits),
      ].join("\n"),
    ),
    meta: {
      op: "history",
      repo: history.clone.repository,
      sha: history.sha,
      path: history.path,
      symbol: history.symbol,
      windowDays: history.windowDays,
      since: history.since,
      until: history.until,
    },
  };
}

/**
 * Cite what changed between two commits.
 *
 * @param changed - The engine's answer.
 * @returns A `code` source at the later commit's scope, the range in `meta`.
 */
export function changedBetweenSource(changed: ChangedBetween): SourceRecord {
  const scope = changed.scope === null ? "" : ` in ${changed.scope}`;
  return {
    kind: "code",
    title: title(
      `${changed.clone.repository} · ${changed.base}..${changed.head}${scope} · ${String(changed.totalCommits)} commits`,
    ),
    locator: gitLocator(changed.clone.repository, changed.headSha, changed.scope),
    retrievedAt: changed.clone.fetchedAt,
    contentHash: hashOf({ ...changed, clone: undefined }),
    excerpt: bounded(
      [
        `${changed.base}..${changed.head}${scope}: ${String(changed.totalCommits)} commits, ${String(changed.totalFiles)} files, +${String(changed.added)} -${String(changed.deleted)}`,
        ...changed.files
          .slice(0, EXCERPT_COMMITS)
          .map(
            (file) =>
              `  ${file.path} · ${String(file.commits)} commits +${String(file.added)} -${String(file.deleted)}`,
          ),
        ...commitLines(changed.commits),
      ].join("\n"),
    ),
    meta: {
      op: "changed_between",
      repo: changed.clone.repository,
      sha: changed.headSha,
      range: `${changed.baseSha}..${changed.headSha}`,
      refs: { base: changed.base, head: changed.head },
      scope: changed.scope,
    },
  };
}

/**
 * Cite a dependency graph.
 *
 * @param graph - The engine's answer, `status: ok`.
 * @returns A `code` source at the module, at the commit read.
 */
export function depGraphSource(graph: DepGraph): SourceRecord {
  const module = graph.module ?? "the repository";
  return {
    kind: "code",
    title: title(
      `${graph.clone.repository} · dependency graph of ${module} · ${String(graph.edges.length)} edges`,
    ),
    locator: gitLocator(graph.clone.repository, graph.sha, graph.module),
    retrievedAt: graph.clone.fetchedAt,
    contentHash: hashOf({ ...graph, clone: undefined }),
    excerpt: bounded(
      [
        `${module} (${graph.stack ?? "unknown stack"}): ${String(graph.nodes.length)} files, ${String(graph.edges.length)} edges, ${String(graph.external.length)} external`,
        ...graph.moduleEdges.map(
          (edge) => `  ${edge.source} → ${edge.target} (${String(edge.weight)})`,
        ),
        graph.external.length === 0 ? "" : `external: ${graph.external.join(", ")}`,
      ].join("\n"),
    ),
    meta: {
      op: "dep_graph",
      repo: graph.clone.repository,
      sha: graph.sha,
      module: graph.module,
      stack: graph.stack,
      truncated: graph.truncated,
    },
  };
}

/**
 * Cite a bisect.
 *
 * @param view - The bisect and its steps.
 * @returns A `bisect://` source naming the culprit and the jobs that proved it, once converged; the
 *   range being searched (a `git://` source at the bad commit) otherwise.
 */
export function bisectSource(view: BisectView): SourceRecord {
  const { bisect, steps } = view;
  const decided = steps.filter((step) => step.verdict !== null);
  const header = `bisect ${bisect.testRef} over ${bisect.repository} ${bisect.goodRef}..${bisect.badRef} (${String(bisect.commits.length)} candidates, at most ${String(bisect.maxSteps)} farm jobs)`;
  const lines = [
    header,
    ...steps.map(
      (step) =>
        `step ${String(step.step)} · job #${String(step.jobNumber)} built ${short(step.commitSha)} → ${step.verdict ?? step.jobStatus}`,
    ),
    bisect.status === "converged"
      ? `culprit ${short(bisect.culpritSha ?? "")} (${String(decided.length)} farm jobs)`
      : `${bisect.status}${bisect.note === null ? "" : ` — ${bisect.note}`}`,
  ];
  const meta = {
    op: "bisect",
    bisectId: bisect.id,
    repo: bisect.repository,
    testRef: bisect.testRef,
    range: `${bisect.goodSha}..${bisect.badSha}`,
    refs: { good: bisect.goodRef, bad: bisect.badRef },
    status: bisect.status,
    steps: steps.map((step) => ({
      job: step.buildJobId,
      number: step.jobNumber,
      commit: step.commitSha,
      verdict: step.verdict,
    })),
  };
  const proved = {
    culprit: bisect.culpritSha,
    status: bisect.status,
    steps: decided.map((step) => [step.buildJobId, step.commitSha, step.verdict]),
  };

  if (bisect.status === "converged" && bisect.culpritSha !== null && decided.length > 0) {
    return {
      kind: "code",
      title: title(
        `${bisect.repository} · bisected ${bisect.testRef} → ${short(bisect.culpritSha)} in ${String(decided.length)} farm jobs`,
      ),
      locator: `bisect://${bisect.repository}@${bisect.culpritSha}?jobs=${decided.map((step) => step.buildJobId).join(",")}`,
      retrievedAt: (bisect.finishedAt ?? bisect.createdAt).toISOString(),
      contentHash: hashOf(proved),
      excerpt: bounded(lines.join("\n")),
      meta: { ...meta, culprit: bisect.culpritSha },
    };
  }
  return {
    kind: "code",
    title: title(`${bisect.repository} · bisecting ${bisect.testRef} · ${bisect.status}`),
    locator: `git://${bisect.repository}@${bisect.badSha}`,
    retrievedAt: (bisect.finishedAt ?? new Date()).toISOString(),
    contentHash: hashOf(proved),
    excerpt: bounded(lines.join("\n")),
    meta,
  };
}

/**
 * A `git://` locator.
 *
 * @param repository - `owner/name`.
 * @param sha - The commit.
 * @param path - A path inside it, or `null` for the repository.
 * @returns The locator.
 */
export function gitLocator(repository: string, sha: string, path: string | null): string {
  return `git://${repository}@${sha}${path === null || path === "" ? "" : `/${path}`}`;
}

function commitLines(commits: readonly ChangedCommit[]): string[] {
  return commits
    .slice(0, EXCERPT_COMMITS)
    .map(
      ({ commit, added, deleted }) =>
        `  ${short(commit.sha)} ${day(commit.committedAt)} ${commit.author}: ${commit.summary} (+${String(added)} -${String(deleted)})`,
    );
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function title(text: string): string {
  return text.length <= TITLE_MAX_CHARS ? text : `${text.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/**
 * `sha256:` of a value's JSON — what the citation provably describes.
 *
 * @param value - The answer, without the clone's fetch time (which is not part of the fact).
 * @returns The hash.
 */
function hashOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/**
 * Text bounded to V108's excerpt size, on a line boundary.
 *
 * @param text - The excerpt.
 * @returns At most 4 KiB of it, never blank.
 */
export function bounded(text: string): string {
  const trimmed = text.trim() === "" ? "(empty)" : text.trimEnd();
  if (Buffer.byteLength(trimmed, "utf8") <= EXCERPT_MAX_BYTES) return trimmed;
  const kept: string[] = [];
  let bytes = 0;
  for (const line of trimmed.split("\n")) {
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + size + 4 > EXCERPT_MAX_BYTES) break;
    kept.push(line);
    bytes += size;
  }
  if (kept.length === 0) {
    let cut = trimmed.slice(0, EXCERPT_MAX_BYTES - 4);
    while (Buffer.byteLength(`${cut}…`, "utf8") > EXCERPT_MAX_BYTES) cut = cut.slice(0, -1);
    return `${cut}…`;
  }
  return `${kept.join("\n")}\n…`;
}
