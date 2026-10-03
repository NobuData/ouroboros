/**
 * Every decision the two suggestion cards make, and every sentence they say (BW.3,
 * [#518](https://github.com/NobuData/ouroboros/issues/518), mockup 18's **Suggested build-process
 * changes** and **Suggested workflow changes**) — pure, so each honesty rule is a unit test on a
 * small value rather than an assertion about markup.
 *
 * ### No number without its basis
 *
 * `conf 91%` and `−3m 40s per loop` are the figures a team acts on. Each is drawn from what the
 * composer stored and nothing here recomputes one; what this module adds is the route to what
 * produced it — {@link confidenceLines} states the formula with every input it read, and
 * {@link impactLines} the method, the formula, its inputs, and the calibration that scaled the raw
 * estimate.
 *
 * ### A spike is a different action, not a lesser suggestion
 *
 * A suggestion flagged `needsSpike` is offered **Draft spike ticket** in the primary slot, where
 * the others have Apply. It shows the estimate it carries, when it carries one, and says that the
 * figure is extrapolated and unverified; one whose impact was never quantified draws no figure.
 *
 * ### The preview is the payload
 *
 * {@link previewFacts} lays out the consequence preview from the service's `change` — the very
 * payload Apply hands the owning plane — so what the dialog names is what will be executed.
 *
 * **Framework-free**, as `app/analyzer/view.ts` is.
 */

import type {
  AnalysisSuggestion,
  AnalysisSuggestionFinding,
  AnalysisSuggestionImpact,
  AnalysisSuggestions,
  CalibrationCell,
  SuggestionPreview,
} from "@/app/api/analyzer";
import { spanOfMs } from "@/app/format";
import { dayLabel } from "@/app/insights/series-view";
import { PLANNING_PATH } from "@/app/paths";
import { batchHref } from "@/app/planning/generator";

import { shiftDay } from "./duration-view";
import { count } from "./view";

/* ------------------------------------------------------------------ the cards */

/** The kinds the two cards draw. */
export type CardKind = AnalysisSuggestion["kind"];

/** Each card's title, verbatim from the mockup (the card head upper-cases it). */
export const CARD_TITLES: Readonly<Record<CardKind, string>> = {
  build_process: "Suggested build-process changes",
  workflow: "Suggested workflow changes",
};

/** The workflow card's header link, verbatim from the mockup; its arrow is decorative. */
export const STUDIO_LINK = "Open workflow studio";

/** The arrow after a control that leads somewhere — decorative, so kept out of its name. */
export const GO_GLYPH = "→";

/** The mockup's label before each evidence line. */
export const EVIDENCE_LABEL = "Evidence";

/** The pill a spike carries, verbatim from the mockup. */
export const SPIKE_PILL = "needs a spike";

/**
 * The id the Predicted vs Measured card answers to — where an applied row's link leads. Written
 * here for the reason every route in `app/paths.ts` is: this card links to it and that card
 * (BW.5, [#520](https://github.com/NobuData/ouroboros/issues/520)) renders it, and neither can
 * import the other.
 */
export const MEASUREMENTS_ANCHOR = "predicted-vs-measured";

/** What a card with nothing to list says. */
export interface CardEmpty {
  readonly title: string;
  readonly note: string;
}

/** Before any analysis has composed a suggestion. */
export const NO_SUGGESTIONS_YET: CardEmpty = {
  title: "No suggestions yet",
  note: "Suggestions are composed by an analysis run, from the patterns it finds in the build history. Run an analysis to see them.",
};

/** When no current suggestion is of a card's kind. */
export const NOTHING_OF_KIND: Readonly<Record<CardKind, CardEmpty>> = {
  build_process: {
    title: "No build-process changes suggested",
    note: "The last analysis that looked found nothing to change about how builds run.",
  },
  workflow: {
    title: "No workflow changes suggested",
    note: "The last analysis that looked found nothing to change about the workflows.",
  },
};

/* ------------------------------------------------------------------ local resolutions */

/**
 * A resolution this page made and the poll has not confirmed yet — what lets a row resolve the
 * moment its action is taken (a dismissal, optimistically) or answered (an apply, a draft).
 */
export interface LocalResolution {
  readonly status: "applied" | "dismissed" | "drafted";
  /** When, as an ISO instant. */
  readonly at: string;
  /** A dismissal's reason, or `null`. */
  readonly reason: string | null;
  /** The planning batch a spike was drafted into, or `null`. */
  readonly draftBatchId: string | null;
  /** The measurement window an apply opened, in days, or `null`. */
  readonly windowDays: number | null;
}

/**
 * A suggestion with a local resolution laid over it — **only while the service still says it is
 * open**. Once the poll reports a resolution, the service's is the one drawn.
 *
 * @param suggestion The suggestion, as the page read it.
 * @param local The page's own resolution of it, if any.
 * @returns The suggestion to draw.
 */
export function withLocal(suggestion: AnalysisSuggestion, local: LocalResolution | undefined): AnalysisSuggestion {
  if (local === undefined || suggestion.status !== "open") return suggestion;

  const appliedOn = local.at.slice(0, 10);

  return {
    ...suggestion,
    status: local.status,
    resolution: { at: local.at, by: null, reason: local.reason, draftBatchId: local.draftBatchId },
    measurement:
      local.status === "applied" && local.windowDays !== null
        ? {
            id: "",
            appliedOn,
            day: 0,
            windowDays: local.windowDays,
            windowEndsOn: shiftDay(appliedOn, local.windowDays),
            verdict: "pending",
          }
        : null,
  };
}

/**
 * One card's rows: its kind's suggestions, each under the page's own resolution of it, the open
 * ones first — in the service's order, most confident first — and the resolved ones after them.
 *
 * @param page The page's suggestions.
 * @param kind The card's kind.
 * @param local The page's own resolutions, by suggestion.
 * @returns The rows.
 */
export function cardRows(
  page: AnalysisSuggestions,
  kind: CardKind,
  local: ReadonlyMap<string, LocalResolution> = new Map(),
): AnalysisSuggestion[] {
  const rows = page.suggestions
    .filter((suggestion) => suggestion.kind === kind)
    .map((suggestion) => withLocal(suggestion, local.get(suggestion.id)));

  return [...rows.filter((row) => row.status === "open"), ...rows.filter((row) => row.status !== "open")];
}

/**
 * The build-process card's tag — `4 open`.
 *
 * @param rows The card's rows.
 * @returns How many are open.
 */
export function openTag(rows: readonly AnalysisSuggestion[]): string {
  return `${rows.filter((row) => row.status === "open").length} open`;
}

/**
 * Why a card lists nothing, if it lists nothing.
 *
 * @param page The page's suggestions.
 * @param kind The card's kind.
 * @returns The empty state, or `null` when the card has rows.
 */
export function cardEmpty(page: AnalysisSuggestions, kind: CardKind): CardEmpty | null {
  if (page.runId === null) return NO_SUGGESTIONS_YET;

  return page.suggestions.some((suggestion) => suggestion.kind === kind) ? null : NOTHING_OF_KIND[kind];
}

/* ------------------------------------------------------------------ numbers */

/**
 * A number as these cards write one — grouped, at most four decimals (a calibration factor's
 * precision), with a true minus sign.
 *
 * @param value The number.
 * @returns E.g. `−206`, `1.0682`, `0.6545`.
 */
export function figure(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 }).replace("-", "−");
}

/**
 * An estimate's magnitude with its sign in front — `−3m 40s`, `+12s`, `−1 intervention`.
 *
 * @param estimate The signed estimate.
 * @param unit Its unit — `seconds`, `interventions` or `count`.
 * @returns The amount. Seconds are written as a span; a fraction of anything else to three places.
 */
export function impactAmount(estimate: number, unit: string): string {
  const sign = estimate < 0 ? "−" : estimate > 0 ? "+" : "";
  const size = Math.abs(estimate);

  if (unit === "seconds") return `${sign}${spanOfMs(Math.round(size) * 1000)}`;
  if (unit === "interventions") return `${sign}${count(size, "intervention")}`;

  return `${sign}${figure(size)}`;
}

/**
 * The impact pill's text, as the mockup writes each one — `−3m 40s per loop`, `−1m 50s on ~20% of
 * builds`, `−4m queue p95`, `−1 intervention/wk projected`.
 *
 * @param impact The suggestion's impact.
 * @returns The pill's text, or `null` for an impact that was never quantified — or is absent —
 *   which draws no figure at all.
 */
export function impactText(impact: AnalysisSuggestionImpact | null): string | null {
  if (impact === null || impact.estimate === null) return null;

  const amount = impactAmount(impact.estimate, impact.unit);

  if (impact.unit === "interventions") {
    const per = impact.appliesTo === "per week" ? "/wk" : ` ${impact.appliesTo}`;

    return `${amount}${per}${impact.basis.method === "extrapolated" ? " projected" : ""}`;
  }
  if (impact.share !== null) return `${amount} on ~${Math.round(impact.share * 100)}% of builds`;

  return `${amount} ${impact.appliesTo}`.trim();
}

/**
 * The impact pill's tint, **by the sign of the estimate**: a saving is good news; anything a change
 * would cost wears the warning hue.
 *
 * @param impact The impact, with an estimate.
 * @returns `ok` or `warn`.
 */
export function impactTone(impact: Pick<AnalysisSuggestionImpact, "estimate">): "ok" | "warn" {
  return impact.estimate !== null && impact.estimate > 0 ? "warn" : "ok";
}

/** A unit as it is written after a bare number. */
function unitMark(unit: string): string {
  return unit === "seconds" ? " s" : unit === "" ? "" : ` ${unit}`;
}

/** What the impact popover says about a spike's figure. */
export const SPIKE_IMPACT_NOTE =
  "Needs a spike: this figure is extrapolated and has not been verified. Drafting the spike asserts no impact — finding out whether it holds is the work.";

/** What the impact popover says when no impact is stored at all. */
export const NO_IMPACT = "This suggestion carries no impact estimate.";

/** The impact popover's heading. */
export const IMPACT_HEADING = "How this impact was computed";

/**
 * The route from an impact to its computed basis — the method, the formula and its inputs, the
 * raw estimate and the calibration that scaled it, and the window the inputs were measured over.
 *
 * @param suggestion The suggestion.
 * @returns One sentence per thing the composer stored; an older row says what it has.
 */
export function impactLines(suggestion: Pick<AnalysisSuggestion, "impact" | "needsSpike">): string[] {
  const impact = suggestion.impact;
  if (impact === null) return [NO_IMPACT];

  const { basis } = impact;
  const lines: string[] = [];
  const description = basis.description === "" ? "" : ` — ${basis.description}`;

  if (basis.method === "measured") {
    const over = basis.sampleSize === null ? "" : ` over ${count(basis.sampleSize, "occurrence")}`;
    lines.push(`Measured${over}${description}.`);
  } else if (basis.method === "unquantified") {
    lines.push(`Not quantified${description}.`);
  } else {
    lines.push(`Extrapolated${description}.`);
  }

  if (basis.formula !== null) lines.push(`Formula: ${basis.formula}.`);
  if (basis.inputs !== null && Object.keys(basis.inputs).length > 0) {
    lines.push(
      `Inputs: ${Object.entries(basis.inputs)
        .map(([name, value]) => `${name} = ${scalarText(value) ?? "—"}`)
        .join(" · ")}.`,
    );
  }
  if (basis.raw !== null && basis.calibration !== null && impact.estimate !== null) {
    const unit = unitMark(impact.unit);
    const { analyzer, impactClass, factor } = basis.calibration;

    lines.push(
      `${figure(basis.raw)}${unit} raw × ${figure(factor)} calibration (${analyzer} · ${impactClass}) = ${figure(impact.estimate)}${unit}.`,
    );
  }
  if (basis.window !== null) {
    lines.push(
      `Inputs read from ${dayLabel(basis.window.from)} – ${dayLabel(basis.window.to)} (${count(basis.window.days, "day")}).`,
    );
  }
  if (impact.share !== null) {
    lines.push(`Applies to about ${Math.round(impact.share * 100)}% of builds — ${impact.appliesTo}.`);
  }
  if (suggestion.needsSpike && impact.estimate !== null) lines.push(SPIKE_IMPACT_NOTE);

  return lines;
}

/* ------------------------------------------------------------------ confidence */

/**
 * The confidence affix — `conf 91%`.
 *
 * @param confidence 0–100.
 * @returns The affix.
 */
export function confidenceText(confidence: number): string {
  return `conf ${confidence}%`;
}

/** The scoring popover's heading. */
export const CONFIDENCE_HEADING = "How this confidence was scored";

/** What the scoring popover says for a suggestion composed before its inputs were stored. */
export const NO_CONFIDENCE_BASIS = "This suggestion was composed before its scoring inputs were stored.";

/**
 * The scoring popover — sample size, effect size, stability and the formula they went through.
 *
 * @param suggestion The suggestion.
 * @returns One sentence per input, then the arithmetic and the formula's own text.
 */
export function confidenceLines(suggestion: Pick<AnalysisSuggestion, "confidence" | "confidenceBasis">): string[] {
  const basis = suggestion.confidenceBasis;
  if (basis === null) return [NO_CONFIDENCE_BASIS];

  const { n, scale, support, stability, effectSize, effectTarget, effect } = basis.inputs;
  const lines: string[] = [];

  if (n !== null) {
    const how = scale === null || support === null ? "" : ` Support 1 − e^(−${figure(n)}/${figure(scale)}) = ${support.toFixed(3)}.`;
    lines.push(`Sample size: ${figure(n)} — the smallest sample among the cited findings.${how}`);
  }
  if (effectSize === null || effectTarget === null) {
    lines.push("Effect size: none to weigh — an absence claim counts in full.");
  } else {
    const weighed = effect === null ? "" : ` → ${effect.toFixed(2)}`;
    lines.push(`Effect size: ${figure(effectSize)} against a decisive ${figure(effectTarget)}${weighed}.`);
  }
  if (stability !== null) lines.push(`Stability: ${figure(stability)} — the least stable cited finding.`);
  if (support !== null && stability !== null && effect !== null) {
    lines.push(
      `Score: round(100 × ${support.toFixed(3)} × ${figure(stability)} × ${effect.toFixed(2)}) = ${suggestion.confidence}.`,
    );
  }
  if (basis.formula !== "") lines.push(`Formula: ${basis.formula}.`);

  return lines;
}

/* ------------------------------------------------------------------ a row's actions */

/** What a row's primary control does. */
export type PrimaryKind = "apply" | "draft_workflow" | "draft_spike";

/** A row's primary control. */
export interface PrimaryAction {
  readonly kind: PrimaryKind;
  /** Its label — `Apply`, `Draft spike ticket`, `Draft as v15`. */
  readonly label: string;
  /** Whether the label is followed by the decorative arrow. */
  readonly leads: boolean;
  /** Why it cannot act at all, when it cannot. Its presence makes the control inert. */
  readonly reason?: string;
}

/** Why a workflow suggestion whose workflow is gone cannot be drafted. */
export const WORKFLOW_GONE_REASON = "The workflow this suggestion names is no longer in the workspace.";

/**
 * A row's primary control — the mockup's **Apply**, **Draft spike ticket** or **Draft as v16 →**.
 *
 * A spike is checked first: whatever plane a spike names, it is drafted as an investigation. The
 * workflow label's version is the one the draft would become when a person publishes it, read
 * from the workflow as it stands — never a number written down.
 *
 * @param suggestion The suggestion.
 * @returns The control.
 */
export function primaryAction(
  suggestion: Pick<AnalysisSuggestion, "needsSpike" | "plane" | "workflow">,
): PrimaryAction {
  if (suggestion.needsSpike) return { kind: "draft_spike", label: "Draft spike ticket", leads: false };
  if (suggestion.plane !== "workflow") return { kind: "apply", label: "Apply", leads: false };
  if (suggestion.workflow === null) {
    return { kind: "draft_workflow", label: "Draft a workflow change", leads: true, reason: WORKFLOW_GONE_REASON };
  }

  return { kind: "draft_workflow", label: `Draft as v${suggestion.workflow.nextVersion}`, leads: true };
}

/** The row's other controls, verbatim from the mockup. */
export const DETAILS_LABEL = "Details";
export const DISMISS_LABEL = "Dismiss";
export const SIMULATE_LABEL = "Simulate on last 50 loops";

/** The mark an unbuilt control carries in its text, as the insights head's *soon* actions do. */
export const SOON_MARK = "soon";

/** Why **Simulate on last 50 loops** is inert: it does not exist until BX.2. */
export const SIMULATE_SOON = "Simulating a workflow change on past loops arrives with BX.2 (#523).";

/** Why a member's confirm is inert in the consequence preview. */
export const APPLY_ROLE_REASON = "Only an owner or admin can apply a suggestion.";

/** Why a member's confirm is inert in the spike dialog. */
export const DRAFT_ROLE_REASON = "Only an owner or admin can draft a ticket from a suggestion.";

/** Why a viewer's **Dismiss** is inert. */
export const DISMISS_ROLE_REASON = "Dismissing a suggestion is for workspace members — viewers can read them.";

/* ------------------------------------------------------------------ a resolved row */

/** Where a resolved row leads. */
export interface RowLink {
  readonly label: string;
  readonly href: string;
  /** Whether the address is on this page — an anchor rather than a route. */
  readonly anchor: boolean;
}

/** How a resolved row reads. */
export interface Resolved {
  /** `Applied Oct 2 by Ken Suenobu`, `Dismissed Oct 2`, … */
  readonly headline: string;
  /** What follows from it — the measurement, the persistence guarantee, who publishes. */
  readonly note: string;
  /** A dismissal's reason, as written; `null` otherwise. */
  readonly reason: string | null;
  /** Where to go from here. */
  readonly links: readonly RowLink[];
}

/** The persistence guarantee a dismissal carries, on the row and in the dialog. */
export const DISMISSED_NOTE = "won't be suggested again";

/** What a workflow draft's row says about who publishes. */
export const DRAFT_HUMAN_NOTE = "publishing remains a person's step";

/** The link an applied row carries to its measurement. */
export const MEASUREMENTS_LINK = "Predicted vs measured";

/** The link a workflow draft's row carries to the studio. */
export const OPEN_STUDIO = "Open in the studio";

/** The link a drafted spike's row and dialog carry to its batch. */
export const OPEN_DRAFT = "Open the draft in Planning";

/** What each closed verdict is called. */
const VERDICT_WORDS: Readonly<Record<string, string>> = {
  delivered: "delivered what was predicted",
  under: "under-delivered",
  over: "over-delivered",
  confounded: "confounded by another change",
};

/**
 * An applied suggestion's measurement, in words.
 *
 * @param measurement The measurement its apply opened, or `null` when the page has none.
 * @returns `measurement pending — day 3 of 14`, or the verdict once the window has closed.
 */
export function measurementNote(measurement: AnalysisSuggestion["measurement"]): string {
  if (measurement === null) return "measurement pending";
  if (measurement.verdict === "pending") {
    return `measurement pending — day ${measurement.day} of ${measurement.windowDays}`;
  }

  return `measured — ${VERDICT_WORDS[measurement.verdict] ?? measurement.verdict}`;
}

/**
 * How a resolved row reads, and where it leads.
 *
 * @param suggestion A suggestion that is not open.
 * @returns The headline, the note, a dismissal's reason and the links; `null` for an open one.
 */
export function resolved(suggestion: AnalysisSuggestion): Resolved | null {
  const { resolution } = suggestion;
  if (suggestion.status === "open" || resolution === null) return null;

  const when = `${dayLabel(resolution.at.slice(0, 10))}${resolution.by === null ? "" : ` by ${resolution.by}`}`;
  const measurements: RowLink = { label: MEASUREMENTS_LINK, href: `#${MEASUREMENTS_ANCHOR}`, anchor: true };

  if (suggestion.status === "dismissed") {
    return { headline: `Dismissed ${when}`, note: DISMISSED_NOTE, reason: resolution.reason, links: [] };
  }
  if (suggestion.status === "drafted") {
    return {
      headline: `Spike drafted ${when}`,
      note: "nothing reaches the tracker until its batch is pushed",
      reason: null,
      links:
        resolution.draftBatchId === null
          ? []
          : [{ label: OPEN_DRAFT, href: batchHref(PLANNING_PATH, resolution.draftBatchId), anchor: false }],
    };
  }
  if (suggestion.plane === "workflow") {
    return {
      headline: `Draft created ${when}`,
      note: `${DRAFT_HUMAN_NOTE} · ${measurementNote(suggestion.measurement)}`,
      reason: null,
      links: [
        ...(suggestion.workflow === null
          ? []
          : [{ label: OPEN_STUDIO, href: suggestion.workflow.studioPath, anchor: false }]),
        measurements,
      ],
    };
  }

  return {
    headline: `Applied ${when}`,
    note: measurementNote(suggestion.measurement),
    reason: null,
    links: [measurements],
  };
}

/* ------------------------------------------------------------------ the consequence preview */

/** The preview dialog's eyebrow. */
export const PREVIEW_EYEBROW = "Consequence preview";

/** What the dialog says while the preview is read. */
export const PREVIEW_LOADING = "Reading what this would change…";

/** What the dialog says when the preview could not be read. */
export const PREVIEW_FAILED = "The preview could not be read.";

/** The label over where the change lands. */
export const LANDS_LABEL = "Lands in";

/** The heading over the reason a change cannot be applied. */
export const CANNOT_APPLY = "This cannot be applied yet";

/** What follows an apply, said before it is confirmed. */
export const MEASURE_NOTE =
  "Applying freezes today's baseline and opens a measurement: the change is re-measured against this prediction, and the result appears under Predicted vs measured.";

/** What a workflow draft does and does not do, said before it is confirmed. */
export const PUBLISH_HUMAN_NOTE =
  "Publishing remains human. This creates a draft in the workflow studio and opens it there; nothing changes how loops run until a person reviews the draft and publishes it.";

/** What the dialog says when the preview moved between being read and being confirmed. */
export const STALE_NOTE =
  "What this would do changed while the preview was open. This is the preview as it stands now — read it before applying.";

/** What the dialog says when somebody else resolved the suggestion first. */
export const ALREADY_RESOLVED = "This suggestion was resolved while the preview was open; nothing was applied.";

/** What an apply that could not reach the service says. */
export const APPLY_FAILED = "The suggestion could not be applied.";

/**
 * The confirm control of a preview.
 *
 * @param preview The preview.
 * @returns Its label and its in-flight label; the workflow one leads to the studio.
 */
export function confirmLabels(preview: Pick<SuggestionPreview, "plane">): {
  readonly label: string;
  readonly busy: string;
  readonly leads: boolean;
} {
  return preview.plane === "workflow"
    ? { label: "Create draft & open studio", busy: "Creating the draft…", leads: true }
    : { label: "Apply", busy: "Applying…", leads: false };
}

/** One labelled fact of a preview. */
export interface PreviewFact {
  readonly label: string;
  readonly value: string;
  /** Whether the value is an identifier or a command, drawn in mono. */
  readonly mono: boolean;
}

/** ISO weekdays, 1 = Monday. */
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A set of ISO weekdays as a person says them — the service's own phrasing.
 *
 * @param days ISO weekdays.
 * @returns `weekdays (Mon–Fri)`, `weekends`, `every day`, or `Mon, Wed`.
 */
export function daysText(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((day) => day >= 1 && day <= 7).sort((a, b) => a - b);
  const key = sorted.join(",");

  if (key === "1,2,3,4,5") return "weekdays (Mon–Fri)";
  if (key === "6,7") return "weekends";
  if (key === "1,2,3,4,5,6,7") return "every day";

  return sorted.map((day) => DAY_NAMES[day - 1]).join(", ");
}

/** A payload member as a non-empty string, or `null`. */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The binding-specific facts of a preview, read from the payload Apply would hand its plane:
 *
 * - a **pool move** — the runner, the pool it joins, the UTC window and the days;
 * - a **job hook** — the repository, what triggers it, the command and the pool it runs in;
 * - a **workflow draft** — the workflow, the version the draft becomes, and its change note.
 *
 * @param preview The preview.
 * @returns The facts, in reading order; none for a change no plane can take.
 */
export function previewFacts(preview: Pick<SuggestionPreview, "plane" | "change">): PreviewFact[] {
  const change = preview.change;
  if (change === null) return [];

  const fact = (label: string, value: string | null, mono = false): PreviewFact[] =>
    value === null ? [] : [{ label, value, mono }];

  if (preview.plane === "farm_config") {
    const starts = text(change.startsAt);
    const ends = text(change.endsAt);
    const days = Array.isArray(change.daysOfWeek)
      ? change.daysOfWeek.filter((day): day is number => typeof day === "number")
      : [];

    return [
      ...fact("Runner", text(change.runner), true),
      ...fact("Joins pool", text(change.pool), true),
      ...fact("Window", starts === null || ends === null ? null : `${starts}–${ends} UTC`),
      ...fact("Days", days.length === 0 ? null : daysText(days)),
    ];
  }
  if (preview.plane === "job_hook") {
    const filter = text(change.titleContains);
    const command = Array.isArray(change.command)
      ? change.command.filter((part): part is string => typeof part === "string").join(" ")
      : "";

    return [
      ...fact("Repository", text(change.repo), true),
      ...fact("Runs on", filter === null ? "every merge" : `every merge whose title contains “${filter}”`),
      ...fact("Command", command === "" ? null : command, true),
      ...fact("In pool", text(change.pool), true),
    ];
  }
  if (preview.plane === "workflow") {
    const version = typeof change.nextVersion === "number" ? change.nextVersion : null;

    return [
      ...fact("Workflow", text(change.slug), true),
      ...fact("Becomes", version === null ? null : `v${version} — only when a person publishes it`),
      ...fact("Change note", text(change.changeNote)),
    ];
  }

  return [];
}

/** One list of a workflow draft's delta. */
export interface DeltaGroup {
  readonly heading: string;
  readonly items: readonly string[];
}

/** What a draft whose document does not differ in shape says. */
export const NO_DELTA = "The draft's stages and connections are the ones the workflow already has.";

/**
 * A workflow draft's stage and connection delta, as lists — the ones that have anything in them.
 *
 * @param delta The preview's `delta`.
 * @returns Stages added and removed, then connections added and removed.
 */
export function deltaGroups(delta: SuggestionPreview["delta"]): DeltaGroup[] {
  if (delta === null) return [];

  return [
    { heading: "Stages added", items: delta.nodesAdded },
    { heading: "Stages removed", items: delta.nodesRemoved },
    { heading: "Connections added", items: delta.edgesAdded },
    { heading: "Connections removed", items: delta.edgesRemoved },
  ].filter((group) => group.items.length > 0);
}

/* ------------------------------------------------------------------ dismissing */

/** The dismiss dialog's title. */
export const DISMISS_TITLE = "Dismiss this suggestion?";

/** The persistence guarantee, stated before a dismissal is confirmed. */
export const DISMISS_GUARANTEE =
  "Dismissing is permanent. This suggestion won't be suggested again — a later analysis that finds the same pattern keeps it dismissed.";

/** The reason field's label and hint. */
export const REASON_LABEL = "Reason (optional)";
export const REASON_HINT = "Kept with the dismissal, for whoever wonders why later.";

/** The longest reason the service keeps. */
export const MAX_REASON_LENGTH = 4096;

/** What a refused dismissal says on its row, before the service's own reason. */
export const DISMISS_FAILED = "The suggestion could not be dismissed, so it is open again.";

/**
 * What is wrong with a typed reason, if anything.
 *
 * @param typed The field's value.
 * @returns The complaint, or `undefined` for a reason the service would take — including none.
 */
export function reasonProblem(typed: string): string | undefined {
  return typed.trim().length > MAX_REASON_LENGTH
    ? `Keep the reason under ${MAX_REASON_LENGTH.toLocaleString("en-US")} characters.`
    : undefined;
}

/**
 * The reason a dismissal is sent with.
 *
 * @param typed The field's value.
 * @returns It, trimmed, or `null` when nothing was written — a dismissal needs no reason.
 */
export function reasonOf(typed: string): string | null {
  const trimmed = typed.trim();

  return trimmed === "" ? null : trimmed;
}

/* ------------------------------------------------------------------ drafting a spike */

/** The spike dialog's eyebrow. */
export const SPIKE_EYEBROW = "Spike ticket";

/** What a spike is, said before it is drafted. */
export const SPIKE_LEDE =
  "The analyzer could not verify what this change would win, so the ticket it drafts is an investigation. It asserts no impact — finding out whether the change pays off, and by how much, is the work.";

/** The labels over the draft's parts. */
export const SPIKE_LABELS = {
  title: "Ticket title",
  uncertain: "What is uncertain",
  evidence: "Evidence",
  tracker: "Target tracker",
} as const;

/** What the uncertainty slot says for a spike whose basis gives no description. */
export const NO_UNCERTAINTY = "The analyzer did not say what it could not quantify.";

/** What the tracker slot says while the workspace's trackers are read, and when they were not. */
export const TRACKERS_LOADING = "Reading the workspace's trackers…";
export const TRACKERS_FAILED = "The workspace's trackers could not be read.";

/** Why the confirm is inert until a tracker is chosen. */
export const CHOOSE_TRACKER = "Choose the tracker the ticket is drafted for.";

/** The confirm control, and what it says in flight. */
export const SPIKE_CONFIRM = "Draft spike ticket";
export const SPIKE_DRAFTING = "Drafting…";

/** What a draft that could not reach the service says. */
export const SPIKE_FAILED = "The spike could not be drafted.";

/** What the dialog says once the spike is drafted. */
export const SPIKE_DRAFTED =
  "Drafted into a planning batch. Nothing reaches the tracker until the batch is pushed — open it to edit the ticket, or push it.";

/**
 * The title the drafted ticket carries — the service's own `Spike: …`.
 *
 * @param suggestion The suggestion.
 * @returns The title.
 */
export function spikeTitle(suggestion: Pick<AnalysisSuggestion, "title">): string {
  return `Spike: ${suggestion.title}`;
}

/**
 * What the ticket will say is uncertain — the impact basis's own description.
 *
 * @param suggestion The suggestion.
 * @returns The description, or {@link NO_UNCERTAINTY}.
 */
export function spikeUncertainty(suggestion: Pick<AnalysisSuggestion, "impact">): string {
  const description = suggestion.impact?.basis.description ?? "";

  return description === "" ? NO_UNCERTAINTY : description;
}

/* ------------------------------------------------------------------ the Details sheet */

/** The sheet's headings. */
export const SHEET_HEADINGS = {
  impact: "Impact",
  calibration: "Calibration in effect",
  history: "How the factor moved",
  confidence: "Confidence",
  findings: "Findings behind it",
  evidence: "Evidence",
  resolution: "Resolution",
} as const;

/** What each kind is called in the sheet's eyebrow. */
const KIND_WORDS: Readonly<Record<CardKind, string>> = {
  build_process: "build process",
  workflow: "workflow",
};

/**
 * The sheet's eyebrow — `Suggestion · build process`.
 *
 * @param suggestion The suggestion.
 * @returns The eyebrow.
 */
export function sheetEyebrow(suggestion: Pick<AnalysisSuggestion, "kind">): string {
  return `Suggestion · ${KIND_WORDS[suggestion.kind]}`;
}

/** What the findings section says once retention has removed them. */
export const FINDINGS_GONE =
  "The findings this suggestion was composed from have aged out of retention. The suggestion and its figures are kept as composed.";

/**
 * A scalar as text, or `null` for anything that is not one.
 *
 * @param value A stored JSON value.
 * @returns The string, the number as {@link figure} writes it, `yes`/`no`, or `null`.
 */
function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return figure(value);
  if (typeof value === "boolean") return value ? "yes" : "no";

  return null;
}

/**
 * A finding's data as labelled facts — every scalar the analyzer wrote, its keys in words.
 *
 * A list of scalars is joined; an object of scalars is flattened (`window from`). What is left out
 * is what the evidence list already shows resolved: ids (`pool_id`) and reference lists.
 *
 * @param finding The finding.
 * @returns `[label, value]` pairs, in the stored order.
 */
export function findingFacts(finding: Pick<AnalysisSuggestionFinding, "data">): [string, string][] {
  const facts: [string, string][] = [];
  const label = (key: string) => key.replaceAll("_", " ");

  for (const [key, value] of Object.entries(finding.data)) {
    if (key.endsWith("_id") || key.endsWith("_refs")) continue;

    const scalar = scalarText(value);
    if (scalar !== null) {
      facts.push([label(key), scalar]);
    } else if (Array.isArray(value)) {
      const items = value.map(scalarText);
      if (items.length > 0 && items.every((item) => item !== null)) facts.push([label(key), items.join(", ")]);
    } else if (typeof value === "object" && value !== null) {
      for (const [inner, nested] of Object.entries(value)) {
        const text = scalarText(nested);
        if (text !== null) facts.push([`${label(key)} ${label(inner)}`, text]);
      }
    }
  }

  return facts;
}

/**
 * A finding's heading — `queue_correlation v1 · pool-a@14:00-16:00`.
 *
 * @param finding The finding.
 * @returns The analyzer, its version and the finding's subject.
 */
export function findingHeading(
  finding: Pick<AnalysisSuggestionFinding, "analyzer" | "analyzerVersion" | "subjectKey">,
): string {
  return `${finding.analyzer} v${finding.analyzerVersion} · ${finding.subjectKey}`;
}

/**
 * A finding's own confidence with what it was computed from.
 *
 * @param finding The finding.
 * @returns `confidence 84% — sample 14 · effect 0.786 · stability 0.895`.
 */
export function findingConfidence(
  finding: Pick<AnalysisSuggestionFinding, "confidence" | "confidenceBasis">,
): string {
  const { sampleSize, effectSize, stability } = finding.confidenceBasis;
  const parts = [
    sampleSize === null ? null : `sample ${figure(sampleSize)}`,
    effectSize === null ? null : `effect ${figure(effectSize)}`,
    stability === null ? null : `stability ${figure(stability)}`,
  ].filter((part) => part !== null);

  return parts.length === 0
    ? `confidence ${finding.confidence}%`
    : `confidence ${finding.confidence}% — ${parts.join(" · ")}`;
}

/**
 * What the evidence list says when the finding cites more than the page carries.
 *
 * @param finding The finding.
 * @returns `3 of 14 references listed.`, or `null` when every reference is listed.
 */
export function evidenceNote(
  finding: Pick<AnalysisSuggestionFinding, "evidence" | "evidenceTotal">,
): string | null {
  return finding.evidenceTotal > finding.evidence.length
    ? `${finding.evidence.length} of ${count(finding.evidenceTotal, "reference")} listed.`
    : null;
}

/** What the calibration section says for an impact that recorded none. */
export const NO_CALIBRATION = "This suggestion's impact was composed before its calibration was recorded.";

/**
 * The calibration cell an impact's factor came from.
 *
 * @param cells The repository's calibration cells.
 * @param impact The suggestion's impact.
 * @returns The cell for the impact's analyzer and class, or `null` when no measurement of that
 *   model has closed — its factor is then 1.
 */
export function calibrationCell(
  cells: readonly CalibrationCell[],
  impact: AnalysisSuggestionImpact | null,
): CalibrationCell | null {
  const applied = impact?.basis.calibration ?? null;
  if (applied === null) return null;

  return (
    cells.find((cell) => cell.analyzer === applied.analyzer && cell.impactClass === applied.impactClass) ?? null
  );
}

/**
 * The calibration in effect — the factor the estimate was scaled by, whose it is, and whether it
 * has moved since.
 *
 * @param impact The suggestion's impact.
 * @param cell Its model's cell, from {@link calibrationCell}.
 * @returns The sentences.
 */
export function calibrationLines(impact: AnalysisSuggestionImpact | null, cell: CalibrationCell | null): string[] {
  const applied = impact?.basis.calibration ?? null;
  if (applied === null) return [NO_CALIBRATION];

  const lines = [
    `× ${figure(applied.factor)} — the ${applied.analyzer} model's factor for ${applied.impactClass} when this was composed.`,
  ];

  if (cell === null) {
    lines.push("No measurement of this model has closed yet, so its estimates are taken as made.");
  } else {
    lines.push(`Learned from ${count(cell.sampleCount, "closed measurement")} of what this model predicted.`);
    if (cell.factor !== applied.factor) {
      lines.push(`The factor is now × ${figure(cell.factor)}; the next analysis composes with it.`);
    }
  }

  return lines;
}

/**
 * Every update that moved a calibration factor, newest first.
 *
 * @param cell The cell.
 * @returns E.g. `Sep 17 · × 1 → × 0.655 · measured −72 against −110 predicted, over 1 measurement`.
 */
export function calibrationHistory(cell: CalibrationCell): string[] {
  return cell.history.map(
    (entry) =>
      `${dayLabel(entry.createdAt.slice(0, 10))} · × ${figure(entry.fromFactor)} → × ${figure(entry.toFactor)} · ` +
      `measured ${figure(entry.measuredSum)} against ${figure(entry.predictedSum)} predicted, over ${count(entry.sampleCount, "measurement")}`,
  );
}
