/**
 * The competitor tracker — mockup 22's second tool row (CL.3,
 * [#616](https://github.com/NobuData/ouroboros/issues/616); decision V9).
 *
 * ```
 * ⌖ Competitor tracker    4 rivals watched · release notes, changelogs, filings    ●
 * ```
 *
 * The tool **keeps a watch schedule of its own** (`competitor.scheduler.ts`), so its operations do
 * not fetch anything: they read what the schedule archived. That is the point of decision V9 — a
 * live competitor page can change tomorrow, an archived diff with a date cannot — so the loop cites
 * the snapshot that carries a change, as a `competitor_diff` source:
 *
 * ```
 * query {op: "changes", rival: "Skylink", windowDays: 90}            ─▶ every change in the window
 * query {op: "latest",  rival: "Skylink", sourceKind: "release_notes"} ─▶ the most recent change
 * ```
 *
 * The sub-line is the registry's (V112's `competitor_tracker_summary`), never a constant: the rival
 * count and the kinds watched, so removing a rival changes the card. Health ages each readable
 * watch's last successful read against its cadence.
 */

import { ResearchToolError } from "../../research-tool.errors";
import type {
  QueryCapableTool,
  SourceRecord,
  SubLineValue,
  ToolCallContext,
  ToolCapabilities,
  ToolDisplayMeta,
  ToolResult,
} from "../../research-tool.adapter";
import type { ResearchToolConfig, ResearchToolConfigSchema } from "../../research-tool.config";
import { NOT_CONFIGURED_HEALTH, type ToolHealth } from "../../research-tool.health";
import type { CompetitorSourceKind } from "../../../../db/schema";
import {
  CADENCE_MS,
  COMPETITOR_SOURCE_KINDS,
  SOURCE_KIND_LABELS,
} from "../../../competitors/competitor.kinds";
import type { ChangeRow, CompetitorsRepository } from "../../../competitors/competitors.repository";

/** The registry slug. */
export const COMPETITOR_TOOL_SLUG = "competitor";

/** The longest window `changes()` looks back, in days. */
export const MAX_WINDOW_DAYS = 365;

/** The window `changes()` looks back when none is named — the diagram's `90d`. */
export const DEFAULT_WINDOW_DAYS = 90;

/** The look-backs a workspace may choose as its default, in days. */
export const WINDOW_CHOICES = ["30", "90", "180", "365"] as const;

/** The most changes one `changes()` answers — newest first. */
export const MAX_CHANGES = 25;

/** V108's excerpt bound. */
const EXCERPT_MAX_BYTES = 4096;

/** A watch is stale when its last read is older than this many cadences. */
const STALE_CADENCES = 2;

/** What the tool reads through. */
export type TrackerStore = Pick<
  CompetitorsRepository,
  "summary" | "resolveCompetitor" | "changes" | "listWatches"
>;

/** One change, as the loop's payload carries it. */
export interface CitedChange {
  readonly snapshotId: string;
  readonly sourceKind: CompetitorSourceKind;
  readonly url: string;
  readonly takenAt: string;
  readonly diff: string;
}

/** What `changes()` and `latest()` answer. */
export interface ChangesPayload {
  readonly op: "changes" | "latest";
  readonly rival: { readonly id: string; readonly name: string };
  /** The window looked at — `changes()` only. */
  readonly window: { readonly since: string; readonly until: string } | null;
  readonly changes: readonly CitedChange[];
}

export class CompetitorResearchTool implements QueryCapableTool {
  readonly slug = COMPETITOR_TOOL_SLUG;

  /**
   * @param store - The registry and its archive.
   * @param now - The clock, for windows and health.
   */
  constructor(
    private readonly store: TrackerStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  displayMeta(): ToolDisplayMeta {
    return { name: "Competitor tracker", glyph: "⌖", subLine: "{watched} · {kinds}" };
  }

  /**
   * The registry's sub-line.
   *
   * @param organizationId - The workspace.
   * @returns `watched` (`4 rivals watched`) and `kinds` (`release notes, changelogs, filings`);
   *   nulls when the registry cannot be read. Never rejects.
   */
  async counts(organizationId: string): Promise<Readonly<Record<string, SubLineValue>>> {
    try {
      const summary = await this.store.summary(organizationId);
      const kinds = COMPETITOR_SOURCE_KINDS.filter((kind) => summary.sourceKinds.includes(kind));

      return {
        watched: `${String(summary.rivalsWatched)} ${summary.rivalsWatched === 1 ? "rival" : "rivals"} watched`,
        kinds:
          kinds.length === 0
            ? "no sources yet"
            : kinds.map((kind) => SOURCE_KIND_LABELS[kind]).join(", "),
      };
    } catch {
      return { watched: null, kinds: null };
    }
  }

  /**
   * One setting — the default look-back. Rivals and watches are the registry's, managed on their
   * own routes, and GitHub releases use the workspace's GitHub token.
   *
   * @returns The form.
   */
  configSchema(): ResearchToolConfigSchema {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title: "Competitor tracker",
      properties: {
        windowDays: {
          type: "string",
          title: "Default look-back",
          description:
            "How many days of changes an investigation reads when it names no window. Rivals and their watches are managed in the competitor registry.",
          enum: [...WINDOW_CHOICES],
          default: String(DEFAULT_WINDOW_DAYS),
        },
      },
      required: [],
      additionalProperties: false,
    };
  }

  capabilities(): ToolCapabilities & { readonly query: true } {
    return { search: false, fetch: false, query: true, watch: true };
  }

  /**
   * How fresh the workspace's watches are.
   *
   * @param config - The configuration, or null when the workspace has not enabled the tool.
   * @param _secret - Unused: the tracker needs no credential of its own.
   * @param organizationId - The workspace whose watches are aged.
   * @returns `healthy` when every readable watch was read within two cadences, `degraded` when
   *   some were not, `down` when none was; `not_configured` with nothing to watch. Never rejects.
   */
  async healthCheck(
    config: ResearchToolConfig | null,
    _secret: string | null,
    organizationId?: string,
  ): Promise<ToolHealth> {
    if (config === null) return NOT_CONFIGURED_HEALTH;
    if (organizationId === undefined) {
      return { state: "degraded", detail: "no workspace named — watch ages unknown" };
    }

    try {
      const now = this.now().getTime();
      const watches = (await this.store.listWatches(organizationId)).filter(
        (watch) => watch.enabled && !watch.renderRequired && watch.sourceKind !== "filings",
      );

      if (watches.length === 0) return { state: "not_configured", detail: "no rivals watched yet" };

      const stale = watches.filter((watch) => {
        const limit = STALE_CADENCES * CADENCE_MS[watch.cadence];
        const since = (watch.lastSuccessAt ?? watch.createdAt).getTime();
        return now - since > limit;
      });
      const newest = Math.max(...watches.map((watch) => watch.lastSuccessAt?.getTime() ?? 0));
      const freshest = newest === 0 ? "none read yet" : `newest read ${ago(now - newest)} ago`;

      if (stale.length === 0) {
        return {
          state: "healthy",
          detail: `${String(watches.length)} watches fresh · ${freshest}`,
        };
      }
      return {
        state: stale.length === watches.length ? "down" : "degraded",
        detail: `${String(stale.length)} of ${String(watches.length)} watches stale · ${freshest}`,
      };
    } catch {
      return { state: "down", detail: "the watch registry could not be read" };
    }
  }

  /**
   * The archived changes of one rival.
   *
   * @param context - The call.
   * @param structured - `{op: "changes", rival, windowDays?, sourceKind?}` or
   *   `{op: "latest", rival, sourceKind}`.
   * @returns The changes, each cited as a `competitor_diff` source; a null payload when there are
   *   none.
   * @throws {ResearchToolError} `unsupported` for an unknown op, a malformed input, or a rival this
   *   workspace does not watch.
   */
  async query(
    context: ToolCallContext,
    structured: Readonly<Record<string, unknown>>,
  ): Promise<ToolResult> {
    const op = structured.op;

    if (op !== "changes" && op !== "latest") {
      throw new ResearchToolError(
        "unsupported",
        'the competitor tracker answers {op: "changes"} and {op: "latest"}',
      );
    }

    const rivalName = typeof structured.rival === "string" ? structured.rival.trim() : "";
    if (rivalName === "")
      throw new ResearchToolError("unsupported", 'name the rival — {rival: "Skylink"}');

    const sourceKind = kindOf(structured.sourceKind);
    if (structured.sourceKind !== undefined && sourceKind === null) {
      throw new ResearchToolError(
        "unsupported",
        `sourceKind must be one of ${COMPETITOR_SOURCE_KINDS.join(", ")}`,
      );
    }
    if (op === "latest" && sourceKind === null) {
      throw new ResearchToolError("unsupported", "latest() needs a sourceKind");
    }

    const windowDays = op === "changes" ? windowOf(structured.windowDays, context.config) : null;
    const rival = await archived(() =>
      this.store.resolveCompetitor(context.organizationId, rivalName),
    );
    if (rival === undefined) {
      throw new ResearchToolError(
        "unsupported",
        `this workspace watches no rival named ${rivalName}`,
      );
    }

    const until = this.now();
    const since =
      windowDays === null ? undefined : new Date(until.getTime() - windowDays * 86_400_000);
    const rows = await archived(() =>
      this.store.changes(context.organizationId, {
        competitorId: rival.id,
        ...(sourceKind === null ? {} : { sourceKind }),
        ...(since === undefined ? {} : { since }),
        limit: op === "latest" ? 1 : MAX_CHANGES,
      }),
    );

    if (rows.length === 0) return { payload: null, sources: [], usage: { tokens: 0 } };

    const payload: ChangesPayload = {
      op,
      rival: { id: rival.id, name: rival.name },
      window:
        since === undefined ? null : { since: since.toISOString(), until: until.toISOString() },
      changes: rows.map((row) => ({
        snapshotId: row.snapshotId,
        sourceKind: row.sourceKind,
        url: row.url,
        takenAt: row.takenAt.toISOString(),
        diff: row.diff,
      })),
    };

    return { payload, sources: rows.map(sourceOf), usage: { tokens: 0 } };
  }
}

/**
 * One change, as the ledger cites it.
 *
 * @param row - The change.
 * @returns A `competitor_diff` source naming the snapshot that carries the diff.
 */
export function sourceOf(row: ChangeRow): SourceRecord {
  const date = row.takenAt.toISOString().slice(0, 10);

  return {
    kind: "competitor_diff",
    title: `${row.competitorName} · ${SOURCE_KIND_LABELS[row.sourceKind]} · changed ${date}`.slice(
      0,
      300,
    ),
    locator: row.url,
    retrievedAt: row.takenAt.toISOString(),
    contentHash: row.contentHash,
    excerpt: diffExcerpt(row.diff),
    meta: {
      competitor: row.competitorName,
      sourceKind: row.sourceKind,
      watchId: row.watchId,
      selector: row.selector,
      previousSnapshotId: row.previousSnapshotId,
    },
    snapshotId: row.snapshotId,
  };
}

/**
 * A diff, bounded for an excerpt — whole lines, the newline kept.
 *
 * @param diff - The diff.
 * @returns At most 4 KiB of it.
 */
export function diffExcerpt(diff: string): string {
  const text = diff.trim() === "" ? "(empty diff)" : diff.trim();
  if (Buffer.byteLength(text, "utf8") <= EXCERPT_MAX_BYTES) return text;

  const kept: string[] = [];
  let bytes = 0;
  for (const line of text.split("\n")) {
    const size = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + size + 4 > EXCERPT_MAX_BYTES) break;
    kept.push(line);
    bytes += size;
  }
  if (kept.length === 0) {
    let cut = text.slice(0, EXCERPT_MAX_BYTES);
    while (Buffer.byteLength(`${cut}…`, "utf8") > EXCERPT_MAX_BYTES) cut = cut.slice(0, -1);
    return `${cut}…`;
  }
  return `${kept.join("\n")}\n…`;
}

/** The socket-level failures that mean the database could not be reached at all. */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01",
]);

/**
 * Read the archive, with a failure classified as the SPI requires.
 *
 * @param read - The read.
 * @returns What it answered.
 * @throws {ResearchToolError} `network` when the database could not be reached, `upstream` for any
 *   other failure — never an unclassified error.
 */
async function archived<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    if (typeof code === "string" && UNREACHABLE.has(code)) {
      throw new ResearchToolError("network", "the competitor archive could not be reached");
    }
    throw new ResearchToolError("upstream", "the competitor archive could not be read");
  }
}

function kindOf(value: unknown): CompetitorSourceKind | null {
  return typeof value === "string" && (COMPETITOR_SOURCE_KINDS as readonly string[]).includes(value)
    ? (value as CompetitorSourceKind)
    : null;
}

/**
 * The window a `changes()` call looks back.
 *
 * @param value - What the call named.
 * @param config - The workspace's configuration — its default look-back.
 * @returns Days.
 * @throws {ResearchToolError} `unsupported` for a window outside 1–365 days.
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

function ago(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.round(hours / 24))}d`;
}
