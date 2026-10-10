/**
 * What the gaps hand-off and the roadmap pipeline answer (CM.5,
 * [#624](https://github.com/NobuData/ouroboros/issues/624)) — mockup 22's pipeline card, as data:
 *
 * ```
 * 1 · ROADMAP.MD   docs/ROADMAP.md · committed 8c1b2e4 · generated from the RS-124 brief
 *     SUGGESTED CHANGES — 2 OPEN                                  [Apply ⟳] [Dismiss]
 * 2 · CREATE-ISSUES → GITHUB         6 issues · 2 milestones
 *     ◆ M1 · Docking parity · due Oct 15 · 1/3 done    #742 est 3.0 loop-days  L  cx:high
 * ```
 *
 * Everything a row prints is composed here from the stored version and the tracker's mirror —
 * the card (#631) formats nothing itself.
 */

import type {
  IssueRow,
  PipelineInvestigation,
  PipelineSettings,
  RepoProjection,
  SuggestionRow,
  VersionRow,
  DocRow,
} from "./pipeline.repository";
import type { DriftDifference } from "./roadmap.drift";
import { itemsOf, targetLabel, type RoadmapEffort } from "./roadmap.structure";

/** Minutes of loop time in one loop-day. */
export const MINUTES_PER_LOOP_DAY = 1_440;

/** A version's place in the repository. */
export interface ProjectionResource {
  readonly state: RepoProjection["state"];
  /** `docs/ROADMAP.md`. */
  readonly path: string;
  /** `#88` while a pull request is open, or the PR a commit came from; else null. */
  readonly prRef: string | null;
  readonly committedSha: string | null;
  /** The repository commit a drift was seen at. */
  readonly observedSha: string | null;
  /** `docs/ROADMAP.md · committed 8c1b2e4` — the card's line. */
  readonly label: string;
  /** Why the projection could not be moved just now; null when nothing is wrong. */
  readonly problem: string | null;
}

/** One item of a milestone, with its issue once filed. */
export interface RoadmapItemResource {
  readonly key: string;
  readonly title: string;
  readonly mvp: boolean;
  /** The effort the roadmap states. */
  readonly effort: RoadmapEffort | null;
  /** Whether its issue is closed. */
  readonly checked: boolean;
  /** The Planning draft it became, or null before `create-issues`. */
  readonly draftId: string | null;
  /** Its issue in the tracker, or null while unfiled. */
  readonly ticket: {
    readonly id: string;
    /** `#742`. */
    readonly key: string;
    readonly url: string | null;
    readonly state: "open" | "closed" | null;
  } | null;
  /** The estimator's answer for the issue, or null while unsized. */
  readonly estimate: {
    readonly effort: RoadmapEffort;
    /** `low | medium | high` — the `cx:` chip. */
    readonly complexity: string | null;
    /** Loop time in minutes, or null. */
    readonly estMinutes: number | null;
    /** `3.0` — {@link estMinutes} in loop-days, one decimal; null with it. */
    readonly loopDays: number | null;
  } | null;
}

/** One milestone. */
export interface RoadmapMilestoneResource {
  readonly key: string;
  readonly name: string;
  /** `YYYY-MM-DD`, or null. */
  readonly targetDate: string | null;
  /** `due Oct 15`, or null without a date. */
  readonly dueLabel: string | null;
  /** How many of its items are done, and how many it has. */
  readonly done: number;
  readonly total: number;
  readonly items: readonly RoadmapItemResource[];
}

/** One suggested change. */
export interface SuggestionResource {
  readonly id: string;
  readonly authorKind: "user" | "ai";
  /** The author's chip — initials for a person (`KS`), `AI` for the product. */
  readonly authorLabel: string;
  /** The person's name, or the agent that raised it. */
  readonly authorName: string | null;
  readonly text: string;
  /** The structured hint handed to the re-run, or null. */
  readonly hint: Record<string, unknown> | null;
  readonly status: "open" | "applied" | "dismissed";
  /** The version applying it produced — `applied@v2`; null unless applied. */
  readonly appliedVersion: number | null;
  readonly createdAt: string;
}

/** The pipeline card. */
export interface RoadmapResource {
  readonly investigation: { readonly id: string; readonly displayId: string };
  readonly doc: {
    readonly id: string;
    readonly title: string;
    /** The current version. */
    readonly version: number;
    /** The skill run that generated it — `create-roadmap@v1`. */
    readonly generatedBy: string;
    readonly generatedAt: string;
    /** The ticket source it is projected to and filed in, or null when that source was removed. */
    readonly targetSourceId: string | null;
  };
  readonly projection: ProjectionResource;
  /** `ROADMAP.md`, exactly as projected. */
  readonly markdown: string;
  readonly milestones: readonly RoadmapMilestoneResource[];
  readonly issues: {
    /** The Planning batch `create-issues` composed, or null before it ran. */
    readonly batchId: string | null;
    /** Items with an issue in the tracker. */
    readonly filed: number;
    /** Items in the document. */
    readonly total: number;
    /** `6 issues · 2 milestones`. */
    readonly label: string;
  };
  readonly suggestions: {
    readonly open: number;
    readonly items: readonly SuggestionResource[];
  };
}

/** What `create-issues` did. */
export interface IssuesResource {
  /**
   * `sizing` — the drafts exist and the estimator has not finished; call again. `filed` — every
   * item has its issue and the document says so. `partial` — the push stopped short; call again.
   */
  readonly stage: "sizing" | "filed" | "partial";
  readonly batchId: string;
  /** Whether this call wrote a new version of the document — the writeback. */
  readonly wroteVersion: boolean;
  /** Selected drafts the estimator has not sized yet — what `sizing` is waiting for. */
  readonly unsized: number;
  /**
   * Items with no draft because they joined the roadmap after `create-issues` composed its
   * batch. They are not filed by this route.
   */
  readonly undrafted: readonly string[];
  readonly roadmap: RoadmapResource;
}

/** What a drift check found. */
export interface DriftResource {
  /** True when document and tracker — and the repository's file — say the same. */
  readonly identical: boolean;
  readonly differences: readonly DriftDifference[];
  /** The suggestion this check raised, or null when it raised none. */
  readonly raised: SuggestionResource | null;
  readonly roadmap: RoadmapResource;
}

/** What **Draft epic from gaps →** created. */
export interface DraftEpicResource {
  /** False when the investigation's epic had already been drafted and is answered again. */
  readonly created: boolean;
  readonly epic: { readonly id: string | null; readonly name: string };
  readonly batch: {
    readonly id: string;
    readonly status: string;
    readonly drafts: readonly {
      readonly id: string;
      readonly localKey: string;
      readonly title: string;
      readonly capability: string | null;
      readonly severity: "high" | "med" | null;
      /** The effort the brief proposed. */
      readonly effort: RoadmapEffort | null;
      /** How many ledger records it cites. */
      readonly sources: number;
    }[];
  };
  /** Where to review, size and push it — `/planning?batch=<id>`. */
  readonly href: string;
}

/** The workspace's pipeline policy. */
export interface PipelineSettingsResource {
  /** Whether `ROADMAP.md` may be committed without a pull request. Default false. */
  readonly directCommit: boolean;
}

/**
 * The Planning page, opened on one batch.
 *
 * @param batchId - The batch.
 * @returns The path.
 */
export function planningHref(batchId: string): string {
  return `/planning?batch=${batchId}`;
}

/**
 * A person's initials for the suggestion chip.
 *
 * @param name - Their name.
 * @returns Up to two upper-case initials — `KS` — or `?` for a blank name.
 */
export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
  const letters = [parts[0], parts.length > 1 ? parts[parts.length - 1] : undefined]
    .map((part) => part?.[0] ?? "")
    .join("");

  return letters === "" ? "?" : letters.toUpperCase();
}

/**
 * One suggestion as the card draws it.
 *
 * @param row - The stored suggestion.
 * @returns The resource.
 */
export function suggestionResource(row: SuggestionRow): SuggestionResource {
  return {
    id: row.id,
    authorKind: row.authorKind,
    authorLabel:
      row.authorKind === "ai" ? "AI" : row.authorName === null ? "?" : initialsOf(row.authorName),
    authorName: row.authorKind === "ai" ? row.authorAgent : row.authorName,
    text: row.text,
    hint: row.hint,
    status: row.status,
    appliedVersion: row.appliedVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A projection as the card draws it.
 *
 * @param projection - The stored projection.
 * @param problem - Why it could not be moved just now, or null.
 * @returns The resource, with its line.
 */
export function projectionResource(
  projection: RepoProjection,
  problem: string | null = null,
): ProjectionResource {
  const sha = projection.committed_sha?.slice(0, 7) ?? null;
  const words: Record<RepoProjection["state"], string> = {
    pending: "not in the repository yet",
    pr_open: `pull request ${projection.pr_ref ?? ""} open`.replace("  ", " "),
    committed: `committed ${sha ?? ""}`.trim(),
    drift_detected: `drift detected since ${sha ?? ""}`.trim(),
  };

  return {
    state: projection.state,
    path: projection.path,
    prRef: projection.pr_ref,
    committedSha: projection.committed_sha,
    observedSha: projection.observed_sha,
    label: `${projection.path} · ${words[projection.state]}`,
    problem,
  };
}

/**
 * The pipeline card.
 *
 * @param investigation - The investigation the document came from.
 * @param doc - The document.
 * @param version - Its current version.
 * @param issues - The tracker's mirror of its filed items.
 * @param suggestions - Its suggestions, oldest first.
 * @param problem - Why the projection could not be moved just now, or null.
 * @returns The card.
 */
export function roadmapResource(
  investigation: PipelineInvestigation,
  doc: DocRow,
  version: VersionRow,
  issues: readonly IssueRow[],
  suggestions: readonly SuggestionRow[],
  problem: string | null = null,
): RoadmapResource {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const all = itemsOf(version.structure);
  const filed = all.filter(({ item }) => item.ticket_id !== null).length;
  const milestones = version.structure.milestones.map((milestone) => ({
    key: milestone.key,
    name: milestone.name,
    targetDate: milestone.target_date,
    dueLabel: milestone.target_date === null ? null : `due ${targetLabel(milestone.target_date)}`,
    done: milestone.items.filter((item) => item.checked).length,
    total: milestone.items.length,
    items: milestone.items.map((item) => {
      const issue = item.ticket_id === null ? undefined : byId.get(item.ticket_id);

      return {
        key: item.key,
        title: item.title,
        mvp: item.mvp,
        effort: item.effort,
        checked: item.checked,
        draftId: item.draft_id,
        ticket:
          item.ticket_id === null || item.ticket_key === null
            ? null
            : {
                id: item.ticket_id,
                key: item.ticket_key,
                url: issue?.url ?? null,
                state: issue?.state ?? null,
              },
        estimate:
          issue?.estimate === null || issue?.estimate === undefined
            ? null
            : {
                effort: issue.estimate.effort,
                complexity: issue.estimate.risk,
                estMinutes: issue.estimate.estMinutes,
                loopDays:
                  issue.estimate.estMinutes === null
                    ? null
                    : Math.round((issue.estimate.estMinutes / MINUTES_PER_LOOP_DAY) * 10) / 10,
              },
      };
    }),
  }));

  return {
    investigation: { id: investigation.id, displayId: investigation.displayId },
    doc: {
      id: doc.id,
      title: doc.title,
      version: version.version,
      generatedBy: version.generatedBy,
      generatedAt: version.createdAt.toISOString(),
      targetSourceId: doc.targetSourceId,
    },
    projection: projectionResource(version.projection, problem),
    markdown: version.markdown,
    milestones,
    issues: {
      batchId: doc.batchId,
      filed,
      total: all.length,
      label:
        `${String(filed)} issue${filed === 1 ? "" : "s"} · ` +
        `${String(milestones.length)} milestone${milestones.length === 1 ? "" : "s"}`,
    },
    suggestions: {
      open: suggestions.filter((suggestion) => suggestion.status === "open").length,
      items: suggestions.map(suggestionResource),
    },
  };
}

/**
 * The policy as the API answers it.
 *
 * @param settings - The stored policy.
 * @returns The resource.
 */
export function settingsResource(settings: PipelineSettings): PipelineSettingsResource {
  return { directCommit: settings.directCommit };
}
