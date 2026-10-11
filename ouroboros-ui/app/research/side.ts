/**
 * The Research side column — the tools card over the regression watch (CN.3,
 * [#629](https://github.com/NobuData/ouroboros/issues/629)) — as values: what the two cards
 * read, what they say and how a row's fragments are composed. Pure, so the cards, the server
 * reads and the tests share one vocabulary.
 *
 * **Nothing here is a count or a state of its own.** A tool's dot is the service's `health.dot`,
 * its sub-line is the service's computed line, and the *N connected* tag is the service's count.
 * The watch's pill and title are the service's too; this module only decides which fragment of a
 * row is a link and where it leads.
 */

import type { Reading } from "@/app/api/reading";
import type {
  RegressionWatchCard,
  RegressionWatchItem,
  ResearchToolCatalog,
  ResearchToolCatalogEntry,
  ResearchToolConfigSubmission,
  ResearchToolEnableForm,
} from "@/app/api/research";
import { prPath, runPath } from "@/app/paths";
import { configOf } from "@/app/sources/catalog";
import type { SchemaFieldErrors, SchemaFieldSpec } from "@/app/ui";

import { RESEARCH_ORIGIN } from "./brief";

/** What the side column reads in one ask: both cards. */
export interface ResearchSide {
  readonly tools: ResearchToolCatalog;
  readonly watch: RegressionWatchCard;
}

/** The side column's first paint: each card's reading, failing alone. */
export interface SideReadings {
  readonly tools: Reading<ResearchToolCatalog>;
  readonly watch: Reading<RegressionWatchCard>;
}

/** Where the side column is polled from — this origin's pass-through. */
export const RESEARCH_SIDE_ENDPOINT = "/api/research/side";

/**
 * How often the side column is re-read, in seconds — the health cycle. A tool that goes down
 * shows its dot within one of these without a reload.
 */
export const HEALTH_CYCLE_SECONDS = 30;

/** What is said when the side column could not be reached. */
export const UNREACHABLE_SIDE = "The research tools and the regression watch could not be reached.";

/** What is said when the side column answered something that could not be read. */
export const UNREADABLE_SIDE = "The research tools and the regression watch could not be read.";

/**
 * Whether a value is the side column's payload — enough of its shape to draw from.
 *
 * @param value What the route answered.
 * @returns Whether both cards are present.
 */
export function isResearchSide(value: unknown): value is ResearchSide {
  if (typeof value !== "object" || value === null) return false;

  const { tools, watch } = value as { tools?: { tools?: unknown } | null; watch?: { items?: unknown } | null };

  return Array.isArray(tools?.tools) && Array.isArray(watch?.items);
}

/**
 * What each card draws from: the newest poll's answer, or the page's own reading before one.
 *
 * @param readings The first paint's readings.
 * @param polled The poll's last payload, or null before its first answer.
 * @returns The readings to draw.
 */
export function sideReadings(readings: SideReadings, polled: ResearchSide | null): SideReadings {
  if (polled === null) return readings;

  return { tools: { ok: true, value: polled.tools }, watch: { ok: true, value: polled.watch } };
}

/* ------------------------------------------------------------------ the tools card */

/** The tools card's title. */
export const TOOLS_TITLE = "Research tools";

/** The enable button's label — the mockup's, lower case. */
export const ENABLE_LABEL = "enable";

/** Why a non-administrator cannot enable a tool. */
export const ENABLE_READ_ONLY = "Enabling a research tool is for workspace owners and admins.";

/** What the card says when the catalog could not be read. */
export const TOOLS_UNREADABLE = "The research tools could not be read.";

/** What the card says for an installation with no tools at all. */
export const NO_TOOLS = "This installation has no research tools.";

/** What each dot says to a reader who cannot see its colour. */
export const DOT_LABELS: Readonly<Record<ResearchToolCatalogEntry["health"]["dot"], string>> = {
  ok: "Healthy",
  warn: "Degraded",
  err: "Down",
  idle: "Not enabled",
};

/**
 * The count tag.
 *
 * @param catalog The catalog.
 * @returns `5 connected`.
 */
export function connectedTag(catalog: ResearchToolCatalog): string {
  return `${catalog.connectedCount.toString()} connected`;
}

/**
 * A dot's accessible description: the state and the service's detail.
 *
 * @param tool The tool.
 * @returns `Healthy — SearXNG · 200 · 41ms`.
 */
export function dotLabel(tool: ResearchToolCatalogEntry): string {
  return `${DOT_LABELS[tool.health.dot]} — ${tool.health.detail}`;
}

/**
 * Whether a row offers **enable**: its dot is idle and the service says what enabling opens.
 *
 * @param tool The tool.
 * @returns Whether to draw the button.
 */
export function offersEnable(tool: ResearchToolCatalogEntry): boolean {
  return tool.health.dot === "idle" && tool.enable !== null;
}

/**
 * The enable button's accessible name — the label alone would be six identical buttons.
 *
 * @param tool The tool.
 * @returns `Enable Docs, standards & papers`.
 */
export function enableName(tool: ResearchToolCatalogEntry): string {
  return `Enable ${tool.name}`;
}

/** The planned tool's dialog title. */
export const PLANNED_TITLE = "Not available yet";

/**
 * The honest note for a tool this build has no adapter for.
 *
 * @param tool The tool's name.
 * @param release The release it arrives in.
 * @returns The sentence.
 */
export function plannedNote(tool: string, release: string): string {
  return `${tool} arrives in ${release}. There is nothing to configure yet, so nothing here pretends to connect it.`;
}

/**
 * Where a planned tool is tracked.
 *
 * @param issue The issue number.
 * @returns Its address.
 */
export function plannedIssueUrl(issue: number): string {
  return `https://github.com/NobuData/ouroboros/issues/${issue.toString()}`;
}

/**
 * The link to the tracking issue.
 *
 * @param issue The issue number.
 * @returns `Follow #635`.
 */
export function plannedIssueLabel(issue: number): string {
  return `Follow #${issue.toString()}`;
}

/** The enable sheet's note over a form with a credential field. */
export const SECRET_NOTE = "A credential is stored sealed and is never shown again.";

/** The enable sheet's note over a form that asks for nothing required. */
export const NOTHING_REQUIRED = "This tool needs no settings to work — every field below is optional.";

/** The sheet's primary action. */
export const ENABLE_SUBMIT = "Enable tool";

/** The primary action while the save is in flight. */
export const ENABLING = "Enabling…";

/** The secondary action of every dialog here. */
export const CANCEL = "Cancel";

/** The planned dialog's only action. */
export const CLOSE = "Close";

/**
 * The enable form's fields, each starting from what the workspace has stored.
 *
 * @param form The service's form.
 * @returns The fields for the schema-form primitive. The credential field never starts filled.
 */
export function enableFields(form: ResearchToolEnableForm): SchemaFieldSpec[] {
  return form.fields.map((field) => {
    const stored = form.values[field.name];

    if (field.widget === "secret" || stored === undefined) return field;

    return { ...field, defaultValue: typeof stored === "string" ? stored : stored.join("\n") };
  });
}

/**
 * Assemble the submission from the form.
 *
 * @param form The service's form.
 * @param valueOf What the form holds for a field name.
 * @returns The settings, keyed by field name; an untouched optional field is left out.
 */
export function enableSubmission(
  form: ResearchToolEnableForm,
  valueOf: (name: string) => string,
): ResearchToolConfigSubmission {
  return configOf(form.fields, valueOf);
}

/** A refusal from the service, as an action hands it to a card. */
export interface SideRefusal {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** What a dialog prints about a refusal: a sentence, and the fields it is about. */
export interface SideFailure {
  readonly message: string;
  readonly fields: SchemaFieldErrors;
}

/** The service's code for a submission its schema refused. */
export const TOOL_CONFIG_INVALID_CODE = "research_tool_config_invalid";

/** The service's code for a body that failed validation. */
export const VALIDATION_FAILED_CODE = "validation_failed";

/** The service's code for a caller without the role. */
export const FORBIDDEN_CODE = "forbidden";

/** What the sheet says over fields the tool's schema refused. */
export const TOOL_CONFIG_INVALID = "Some settings do not satisfy this tool's schema — see below. Nothing was stored.";

/** What the sheet says when the save failed for no reason it can name. */
export const ENABLE_FAILED = "The tool could not be enabled. Nothing was stored. Try again in a moment.";

/**
 * A `{field: [sentences]}` map out of a refusal's details, tolerating anything else.
 *
 * @param value `details.fields`.
 * @returns The sentences by field.
 */
function fieldSentences(value: unknown): Record<string, readonly string[]> {
  if (typeof value !== "object" || value === null) return {};

  const fields: Record<string, readonly string[]> = {};

  for (const [name, messages] of Object.entries(value)) {
    if (!Array.isArray(messages)) continue;

    const sentences = messages.filter((message): message is string => typeof message === "string");

    if (sentences.length > 0) fields[name] = sentences;
  }

  return fields;
}

/**
 * Turn the service's refusal of a save into what the sheet prints.
 *
 * @param refusal The refusal.
 * @returns The sentence and the fields it is about.
 */
export function enableFailure(refusal: SideRefusal): SideFailure {
  if (refusal.code === TOOL_CONFIG_INVALID_CODE) {
    return { message: TOOL_CONFIG_INVALID, fields: fieldSentences(refusal.details.fields) };
  }

  if (refusal.code === FORBIDDEN_CODE) return { message: ENABLE_READ_ONLY, fields: {} };

  return { message: refusal.message.length === 0 ? ENABLE_FAILED : refusal.message, fields: {} };
}

/* ------------------------------------------------------------- the regression watch */

/** The watch card's title. */
export const WATCH_TITLE = "Regression watch";

/** The card's caption — mockup 22's, verbatim. */
export const WATCH_CAPTION =
  "Watch compares every nightly HIL run to the last release baseline; any drift opens a forensics investigation automatically.";

/** What the card says when the watch could not be read. */
export const WATCH_UNREADABLE = "The regression watch could not be read.";

/** The empty state's title: no baseline has been captured. */
export const NO_BASELINES_TITLE = "No release baseline yet";

/** The empty state's note. */
export const NO_BASELINES_NOTE =
  "The watch compares each nightly run to a release's baseline. Capture one and drift is watched from the next night on.";

/** What a non-administrator reads in place of the capture action. */
export const CAPTURE_READ_ONLY = "Capturing a baseline is for workspace owners and admins.";

/** What the card says with baselines and nothing drifting. */
export const NO_DRIFT = "Nothing has drifted from the baseline.";

/** The capture action's label. */
export const CAPTURE_LABEL = "Capture a baseline";

/** The capture dialog's note. */
export const CAPTURE_NOTE =
  "Reads each watched metric of the repository over its window and stores the result as the release's baseline. A metric with too few samples is skipped, and says so.";

/** The capture form's repository field. */
export const CAPTURE_REPOSITORY_LABEL = "Repository";

/** Its help line. */
export const CAPTURE_REPOSITORY_HELP = "As owner/name — acme-robotics/helios-firmware.";

/** The capture form's release field. */
export const CAPTURE_RELEASE_LABEL = "Release tag";

/** Its help line. */
export const CAPTURE_RELEASE_HELP = "The release the nightly runs are compared to — v2.0.4.";

/** The capture dialog's primary action. */
export const CAPTURE_SUBMIT = "Capture baseline";

/** The primary action while the capture is in flight. */
export const CAPTURING = "Capturing…";

/** What the dialog says when the capture failed for no reason it can name. */
export const CAPTURE_FAILED = "The baseline could not be captured. Try again in a moment.";

/** What a repository must look like, as the service judges it. */
export const REPOSITORY_PATTERN = "[A-Za-z0-9._-]+/[A-Za-z0-9._-]+";

/** What a release tag must look like, as the service judges it. */
export const RELEASE_PATTERN = "\\S{1,128}";

/**
 * What a capture stored, in a sentence.
 *
 * @param captured How many baselines were captured.
 * @param skipped The metrics skipped, each with its reason.
 * @returns `Captured 2 baselines.`, with what was skipped and why.
 */
export function captureSummary(
  captured: number,
  skipped: readonly { readonly metric: string; readonly reason: string }[],
): string {
  const stored =
    captured === 0
      ? "No baseline was captured."
      : `Captured ${captured.toString()} ${captured === 1 ? "baseline" : "baselines"}.`;

  if (skipped.length === 0) return stored;

  return `${stored} Skipped: ${skipped.map((skip) => `${skip.metric} (${skip.reason})`).join("; ")}.`;
}

/** The dismiss action's label. */
export const DISMISS_LABEL = "dismiss";

/** Why a non-administrator cannot dismiss an item. */
export const DISMISS_READ_ONLY = "Dismissing a watch item is for workspace owners and admins.";

/** The dismiss dialog's title. */
export const DISMISS_TITLE = "Dismiss this drift";

/** The dismiss dialog's note. */
export const DISMISS_NOTE =
  "The item leaves the card and the reason is written to the audit log. If a later night reads the drift again, the watch opens a new item.";

/** The reason field's label. */
export const DISMISS_REASON_LABEL = "Reason";

/** The longest reason the service takes. */
export const DISMISS_REASON_MAX = 1000;

/** The dismiss dialog's primary action. */
export const DISMISS_SUBMIT = "Dismiss item";

/** The primary action while the dismissal is in flight. */
export const DISMISSING = "Dismissing…";

/** What the dialog says when the dismissal failed for no reason it can name. */
export const DISMISS_FAILED = "The item could not be dismissed. Try again in a moment.";

/** The prefix the service writes on an item it cannot bisect. */
export const NEEDS_REPRO_PREFIX = "needs repro";

/** The watch statuses the card draws: everything a person has not dismissed. */
export function watchRows(card: RegressionWatchCard): RegressionWatchItem[] {
  return card.items.filter((item) => item.status !== "dismissed");
}

/**
 * Whether an item is still open — what **dismiss** applies to.
 *
 * @param item The item.
 * @returns False once it is merged or dismissed.
 */
export function isOpen(item: RegressionWatchItem): boolean {
  return item.status !== "fixed_merged" && item.status !== "dismissed";
}

/** The spelled-out unit suffixes a measurement's key may end in, by the unit they stand for. */
const UNIT_SUFFIXES: Readonly<Record<string, string>> = { "%": "pct" };

/**
 * A measurement's key as words — `hover_drift_cm`, measured in `cm`, is *Hover drift*.
 *
 * The service names a metric by its key (`metricLabel`); a card reads better with the words in
 * it. The trailing unit is dropped only when it is the unit the samples are actually in, so a
 * key is never shortened on a guess.
 *
 * @param item The item.
 * @returns The name, first letter capitalised.
 */
export function watchMetricName(item: RegressionWatchItem): string {
  const words = item.metricLabel.split("_").filter((word) => word.length > 0);
  const unit = item.baseline.unit.toLowerCase();
  const last = words.at(-1)?.toLowerCase();

  if (words.length > 1 && (last === unit || last === UNIT_SUFFIXES[unit])) words.pop();

  const name = words.join(" ");

  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The row's title: the metric, its signed drift with its unit, and the release it is measured
 * against — `Hover drift +14% since v2.0.4`.
 *
 * @param item The item.
 * @returns The title.
 */
export function watchTitle(item: RegressionWatchItem): string {
  return `${watchMetricName(item)} ${item.drift} since ${item.releaseTag}`;
}

/**
 * The dismiss button's accessible name.
 *
 * @param item The item.
 * @returns `Dismiss Hover drift +14% since v2.0.4`.
 */
export function dismissName(item: RegressionWatchItem): string {
  return `Dismiss ${watchTitle(item)}`;
}

/**
 * Whether an item rests at `detected` because it cannot be bisected.
 *
 * @param item The item.
 * @returns Whether its note says *needs repro*.
 */
export function needsRepro(item: RegressionWatchItem): boolean {
  return item.status === "detected" && item.note !== null && item.note.startsWith(NEEDS_REPRO_PREFIX);
}

/** One fragment of a row's sub-line: words, or words that lead somewhere. */
export interface WatchFragment {
  readonly text: string;
  /** Where the fragment leads; null for plain words. */
  readonly href: string | null;
  /** Whether the link leaves the product — a commit or a ticket on its host. */
  readonly external: boolean;
  /** Whether the fragment is an identifier, drawn in the mono face. */
  readonly mono: boolean;
}

/** A plain fragment. */
const words = (text: string): WatchFragment => ({ text, href: null, external: false, mono: false });

/**
 * A row's sub-line as fragments — the service's `detail`, with each identifier in it leading
 * where it points: the bisect's commit, the fix's run (or its ticket while no run exists) and
 * the merged pull request.
 *
 * The service composes `detail` from the same fields this reads, joined by ` · `; a part that
 * matches none of them is kept as the words it is, so a status this module has never heard of
 * still reads correctly.
 *
 * @param item The item.
 * @returns The fragments, in order; the ` · ` between parts is the renderer's.
 */
export function watchFragments(item: RegressionWatchItem): WatchFragment[][] {
  return item.detail.split(" · ").map((part): WatchFragment[] => {
    const { bisect, fixTicket, pullRequest } = item;

    if (bisect !== null && part === `bisected → ${bisect.culprit}`) {
      return [words("bisected → "), { text: bisect.culprit, href: bisect.commitUrl, external: true, mono: true }];
    }

    if (fixTicket !== null && part === fixTicket.key) {
      const href =
        item.fixRun !== null ? runPath(item.fixRun.id, RESEARCH_ORIGIN) : item.fixTicketUrl;

      return [{ text: fixTicket.key, href, external: item.fixRun === null && href !== null, mono: true }];
    }

    if (pullRequest !== null && part === `PR ${pullRequest.key}`) {
      return [{ text: part, href: prPath(pullRequest.id, RESEARCH_ORIGIN), external: false, mono: true }];
    }

    return [words(part)];
  });
}
