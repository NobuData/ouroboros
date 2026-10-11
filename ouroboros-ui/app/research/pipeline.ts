/**
 * The roadmap pipeline card's rules (CN.5, [#631](https://github.com/NobuData/ouroboros/issues/631))
 * — `docs/mockups/22-research.html`'s *from brief to roadmap to issues*, as decisions a suite can
 * test without a browser. Pure: no service call, no React.
 *
 * ### What the card draws, and from where
 * Everything is CM.5's `GET …/roadmap` ([#624](https://github.com/NobuData/ouroboros/issues/624)),
 * which this ticket extended with three things the card could not honestly make up: the address
 * **Open ROADMAP.md ↗** goes to (`projection.href`), each filed issue's status pill read from the
 * tracker and its newest run together (`status`), and the two skills' published versions
 * (`skills`).
 *
 * ### What is deliberately not drawn
 * The mockup's issue rows carry a per-issue due date and a dollar estimate. Nothing stores
 * either — only a milestone has a due date, and an estimate holds tokens and loop minutes with no
 * price — so the rows show what is measured: the loop-days, the effort and the complexity. The
 * milestone's head keeps its date.
 *
 * ### The sync tag tells the truth
 * *"The file and the tracker never drift"* is the card's claim, so the tag says `synced` only
 * when it is so: the version is committed and every item has its issue. A drift the service saw
 * reads `drift detected`, with the suggestion the detector raised shown beside it.
 */

import type {
  Investigation,
  ResearchRoadmap,
  RoadmapIssueStatus,
  RoadmapItem,
  RoadmapMilestone,
  RoadmapSkill,
  RoadmapSuggestion,
} from "@/app/api/research";
import { SKILLS_REGION_ID } from "@/app/knowledge/view";
import { KNOWLEDGE_PATH } from "@/app/paths";
import type { ChipTone, Effort } from "@/app/ui";

/** What the pipeline's seat draws: a roadmap document, and the kind of investigation it is from. */
export interface FeaturedPipeline {
  readonly roadmap: ResearchRoadmap;
  /** The investigation's kind — the head's chip. */
  readonly kind: Investigation["kind"];
}

/** The service's refusal, as the card prints it. */
export interface PipelineRefusal {
  readonly code: string;
  readonly message: string;
}

/** What a write answers: the card as it now reads, or the service's refusal. */
export type PipelineOutcome =
  | { readonly ok: true; readonly roadmap: ResearchRoadmap }
  | { readonly ok: false; readonly refusal: PipelineRefusal };

/** The seat's heading while there is no card to name. */
export const PIPELINE_TITLE = "Roadmap pipeline";

/** The card's title, after the investigation's id. */
export const PIPELINE_HEADLINE = "From brief to roadmap to issues";

/** The head's button. */
export const OPEN_LABEL = "Open ROADMAP.md ↗";

/** Why the head's button is inert while the version is not in the repository. */
export const OPEN_PENDING = "ROADMAP.md is not in the repository yet.";

/** Why the head's button is inert for a repository the product cannot address. */
export const OPEN_NO_ADDRESS = "This repository has no web address to open.";

/** The two steps' headings. */
export const STEP_DOCUMENT = "1 · create-roadmap → ROADMAP.md";
export const STEP_TRACKER = "2 · create-issues → GitHub";

/** The segmented control's name and its two views. */
export const VIEW_LABEL = "Roadmap view";
export type RoadmapView = "rendered" | "raw";
export const VIEWS: readonly { readonly id: RoadmapView; readonly label: string }[] = [
  { id: "rendered", label: "Rendered" },
  { id: "raw", label: "Raw .md" },
];

/** What the raw view is, to a reader who cannot see it. */
export const RAW_LABEL = "ROADMAP.md, as projected to the repository";

/** The note under the suggestions' heading — verbatim. */
export const APPLY_NOTE = "applying re-runs create-roadmap";

/** The suggestion rows' two actions. */
export const APPLY_LABEL = "Apply ⟳";
export const DISMISS_LABEL = "Dismiss";

/** Why a reader who is not an owner or an admin reads the actions inert. */
export const SUGGESTION_READ_ONLY = "Only an owner or an admin can apply or dismiss a suggestion.";

/** Why the actions wait while a re-run is in flight. */
export const SUGGESTION_BUSY = "A re-run is in progress.";

/** The confirmation an apply asks for. */
export const APPLY_TITLE = "Apply this suggestion?";
export const APPLY_CONFIRM_NOTE =
  "Applying re-runs create-roadmap with this suggestion and writes the next version of " +
  "ROADMAP.md. Items that survive the re-run keep their issues.";
export const APPLY_CONFIRM = "Re-run create-roadmap";
export const CANCEL = "Cancel";

/** What the card says when the service refused without a sentence. */
export const APPLY_FAILED = "The re-run could not be started.";
export const DISMISS_FAILED = "The suggestion could not be dismissed.";

/** The applied suggestions' heading. */
export const APPLIED_TITLE = "Applied";

/** What the suggestions' block says when none is open. */
export const NO_SUGGESTIONS = "No open suggestion.";

/** The caption under the tracker — verbatim, estimator attribution included. */
export const PIPELINE_CAPTION =
  "create-issues writes the issue numbers, MVP flags, and descriptions back into ROADMAP.md — " +
  "the file and the tracker never drift. Dates, estimates, effort, and complexity come from the " +
  "estimator during issue creation.";

/** The seat's states without a card. */
export const NO_PIPELINE_TITLE = "No roadmap yet";
export const NO_PIPELINE_NOTE =
  "A roadmap document generated from a brief, and the issues filed from it, appear here.";
export const PIPELINE_UNREADABLE = "The roadmap pipeline could not be read";
export const RELOAD = "Reload";

/** What the tracker says before `create-issues` has run. */
export const NO_ISSUES = "No issue filed yet — create-issues has not run for this roadmap.";

/** The agent name the service gives the suggestion a drift check raises. */
export const DRIFT_AGENT = "drift-detector";

/** The words before the drift's auto-raised suggestion. */
export const DRIFT_RAISED = "Drift detected — suggestion raised:";

/** How many of the newest finished investigations the seat asks for a roadmap. */
export const PIPELINE_PROBES = 3;

/**
 * The card's title.
 *
 * @param roadmap The card.
 * @returns `RS-124 — From brief to roadmap to issues`.
 */
export function pipelineTitle(roadmap: ResearchRoadmap): string {
  return `${roadmap.investigation.displayId} — ${PIPELINE_HEADLINE}`;
}

/**
 * Why **Open ROADMAP.md ↗** is inert.
 *
 * @param roadmap The card.
 * @returns The reason, or null when the button has somewhere to go.
 */
export function openReason(roadmap: ResearchRoadmap): string | null {
  if (roadmap.projection.href !== null) return null;

  return roadmap.projection.state === "pending" ? OPEN_PENDING : OPEN_NO_ADDRESS;
}

/**
 * The rendered document's meta line.
 *
 * @param roadmap The card.
 * @returns `docs/ROADMAP.md · committed 8c1b2e4 · generated from the RS-124 brief`.
 */
export function metaLine(roadmap: ResearchRoadmap): string {
  return `${roadmap.projection.label} · generated from the ${roadmap.investigation.displayId} brief`;
}

/**
 * The version tag beside the document's heading — what an apply visibly advances.
 *
 * @param roadmap The card.
 * @returns `v2`.
 */
export function versionTag(roadmap: ResearchRoadmap): string {
  return `v${String(roadmap.doc.version)}`;
}

/** A calendar date read as the day it names, wherever the reader is. */
const TARGET_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * A milestone's heading in the rendered document.
 *
 * @param milestone The milestone.
 * @returns `M1 · Docking parity — target Oct 15`; without the target for an undated one.
 */
export function milestoneHeading(milestone: RoadmapMilestone): string {
  const name = `${milestone.key.toUpperCase()} · ${milestone.name}`;
  const target = milestone.targetDate === null ? Number.NaN : Date.parse(`${milestone.targetDate}T00:00:00Z`);

  return Number.isNaN(target) ? name : `${name} — target ${TARGET_DAY.format(target)}`;
}

/**
 * A milestone's name on the tracker's side.
 *
 * @param milestone The milestone.
 * @returns `◆ M1 · Docking parity`.
 */
export function trackerMilestone(milestone: RoadmapMilestone): string {
  return `◆ ${milestone.key.toUpperCase()} · ${milestone.name}`;
}

/**
 * A milestone's progress.
 *
 * @param milestone The milestone.
 * @returns `1/3 done`.
 */
export function doneLabel(milestone: RoadmapMilestone): string {
  return `${String(milestone.done)}/${String(milestone.total)} done`;
}

/**
 * The effort chip of an item: the estimator's answer once the issue is sized, else the roadmap's.
 *
 * @param item The item.
 * @returns The chip's size, or null when neither states one.
 */
export function effortOf(item: RoadmapItem): Effort | null {
  const effort = item.estimate?.effort ?? item.effort;

  return effort === null ? null : (effort.toUpperCase() as Effort);
}

/**
 * An issue row's estimate.
 *
 * @param item The item.
 * @returns `est 3.0 loop-days` — `loop-day` up to one — or null while unsized.
 */
export function estimateLabel(item: RoadmapItem): string | null {
  const days = item.estimate?.loopDays ?? null;

  if (days === null) return null;

  return `est ${days.toFixed(1)} loop-day${days > 1 ? "s" : ""}`;
}

/** The complexity chip of each word the estimator uses. */
const COMPLEXITY: Readonly<Record<string, { label: string; tone: ChipTone }>> = {
  low: { label: "cx:low", tone: "ok" },
  medium: { label: "cx:med", tone: "warn" },
  high: { label: "cx:high", tone: "err" },
};

/**
 * An issue row's `cx:` chip.
 *
 * @param item The item.
 * @returns The chip — a word the card does not know is drawn plainly — or null while unsized.
 */
export function complexityChip(item: RoadmapItem): { label: string; tone: ChipTone } | null {
  const complexity = item.estimate?.complexity ?? null;

  if (complexity === null) return null;

  return COMPLEXITY[complexity] ?? { label: `cx:${complexity}`, tone: "neutral" };
}

/** The chip tone of each pill tone the service names. */
export const STATUS_TONE: Readonly<Record<RoadmapIssueStatus["tone"], ChipTone>> = {
  ok: "ok",
  run: "accent",
  warn: "warn",
  err: "err",
  idle: "neutral",
};

/**
 * The tracker's sync tag — the issue count, and whether the file and the tracker agree.
 *
 * @param roadmap The card.
 * @returns `6 issues · 2 milestones · synced`, or what stands between the two and that.
 */
export function syncTag(roadmap: ResearchRoadmap): { label: string; tone: "neutral" | "warn"; synced: boolean } {
  const { issues, projection } = roadmap;
  const say = (word: string, tone: "neutral" | "warn" = "warn") => ({
    label: `${issues.label} · ${word}`,
    tone,
    synced: false,
  });

  if (projection.state === "drift_detected") return say("drift detected");
  if (issues.filed === 0) return say("not filed yet", "neutral");
  if (issues.filed < issues.total) return say(`${String(issues.filed)} of ${String(issues.total)} filed`);
  if (projection.state !== "committed") return say("writeback not committed yet");

  return { label: `${issues.label} · synced`, tone: "neutral", synced: true };
}

/**
 * The suggestion a drift check raised, while the document is in drift.
 *
 * @param roadmap The card.
 * @returns The detector's open suggestion, or null when the document is not in drift.
 */
export function driftSuggestion(roadmap: ResearchRoadmap): RoadmapSuggestion | null {
  if (roadmap.projection.state !== "drift_detected") return null;

  return (
    roadmap.suggestions.items.find(
      (suggestion) => suggestion.status === "open" && suggestion.authorName === DRIFT_AGENT,
    ) ?? null
  );
}

/**
 * The open suggestions, oldest first — the service's order.
 *
 * @param roadmap The card.
 * @returns Those still waiting for an answer.
 */
export function openSuggestions(roadmap: ResearchRoadmap): RoadmapSuggestion[] {
  return roadmap.suggestions.items.filter((suggestion) => suggestion.status === "open");
}

/**
 * The applied suggestions, newest version first. A dismissed one is not shown at all.
 *
 * @param roadmap The card.
 * @returns Those a re-run took.
 */
export function appliedSuggestions(roadmap: ResearchRoadmap): RoadmapSuggestion[] {
  return roadmap.suggestions.items
    .filter((suggestion) => suggestion.status === "applied")
    .sort((a, b) => (b.appliedVersion ?? 0) - (a.appliedVersion ?? 0));
}

/**
 * The suggestions' heading.
 *
 * @param open How many are open.
 * @returns `Suggested changes — 2 open`.
 */
export function suggestionsTitle(open: number): string {
  return `Suggested changes — ${String(open)} open`;
}

/**
 * Where an applied suggestion went.
 *
 * @param suggestion The suggestion.
 * @returns `applied · v2`.
 */
export function appliedTag(suggestion: RoadmapSuggestion): string {
  return suggestion.appliedVersion === null ? "applied" : `applied · v${String(suggestion.appliedVersion)}`;
}

/** One piece of a suggestion's text: words, or an issue reference drawn in the accent. */
export interface SuggestionPart {
  readonly text: string;
  readonly ref: boolean;
}

/**
 * A suggestion's text with its inline issue references told apart.
 *
 * @param text The text.
 * @returns The pieces, in order — `#744` a reference, everything else words.
 */
export function suggestionParts(text: string): SuggestionPart[] {
  return text
    .split(/(#\d+)/)
    .filter((piece) => piece.length > 0)
    .map((piece) => ({ text: piece, ref: /^#\d+$/.test(piece) }));
}

/**
 * What a suggestion's author chip says to a reader who cannot see it.
 *
 * @param suggestion The suggestion.
 * @returns The person's name, or the agent that raised it.
 */
export function authorTitle(suggestion: RoadmapSuggestion): string {
  if (suggestion.authorName !== null) return suggestion.authorName;

  return suggestion.authorKind === "ai" ? "Raised by the product" : "A member";
}

/**
 * An action's accessible name — two rows both say **Apply ⟳**.
 *
 * @param action The action's label.
 * @param suggestion The suggestion.
 * @returns `Apply ⟳: Pull #744 into the M1 MVP set — …`.
 */
export function actionName(action: string, suggestion: RoadmapSuggestion): string {
  return `${action}: ${suggestion.text}`;
}

/**
 * The progress line while a re-run is in flight.
 *
 * @param version The version being re-run.
 * @returns `Re-running create-roadmap on v1…`.
 */
export function applyRunning(version: number): string {
  return `Re-running create-roadmap on v${String(version)}…`;
}

/**
 * The progress line once a re-run answered.
 *
 * @param from The version before.
 * @param to The version the re-run wrote.
 * @returns `create-roadmap finished — v1 → v2`.
 */
export function applyDone(from: number, to: number): string {
  return `create-roadmap finished — v${String(from)} → v${String(to)}`;
}

/** Where a skill chip goes — the Knowledge registry's skills table. */
export const SKILLS_HREF = `${KNOWLEDGE_PATH}#${SKILLS_REGION_ID}`;

/**
 * A skill chip's tooltip.
 *
 * @param skill The skill.
 * @returns The version the pipeline runs, or that the workspace holds none yet.
 */
export function skillTitle(skill: RoadmapSkill): string {
  return skill.version === null
    ? `${skill.slug} is created in this workspace's registry on first use — open the Knowledge registry`
    : `${skill.slug} · published v${String(skill.version)} — open in the Knowledge registry`;
}

/**
 * Which finished investigations the seat asks for a roadmap, in order: those the service already
 * links to a roadmap document first, then the rest, newest first within each.
 *
 * @param rows The newest finished investigations.
 * @returns The rows to probe.
 */
export function pipelineCandidates(rows: readonly Investigation[]): Investigation[] {
  const linked = rows.filter((row) => row.link?.kind === "roadmap");

  return [...linked, ...rows.filter((row) => !linked.includes(row))];
}
