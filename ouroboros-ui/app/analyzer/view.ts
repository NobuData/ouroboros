/**
 * Every sentence and number format the Build Analyzer's frame draws (BW.1,
 * [#516](https://github.com/NobuData/ouroboros/issues/516), mockup 18's head and meta strip) —
 * pure, so the honesty rules are tested here rather than through a render.
 *
 * **Decision A3 — provenance.** The strip never borrows a model pill for statistical work:
 * `Analyzed by` names the run's analyzer set (`deterministic analyzers v1`), and a model pill
 * appears only for an analyzer of kind `llm` in that set. The run's cost is its **compute
 * time**; a `$` figure is drawn only when `llmCostCents` is non-null, which the database allows
 * only when an LLM pass ran.
 *
 * **The headline is computed.** Its number is the corpus manifest's build count, and a corpus
 * thinner than one build a day — the confidence rule's own floor for *medium* — gets a sentence
 * that says so instead of a boast.
 */

import type {
  AnalysisConfidenceBasis,
  AnalysisManifest,
  AnalysisRun,
  AnalysisSchedule,
  AnalysisScheduleInput,
  AnalyzerProgress,
  AnalyzerSet,
} from "@/app/api/analyzer";
import { coarseAgo, compactNumber, moneyOfCents, percentOf } from "@/app/format";

/* ------------------------------------------------------------------ the head */

/** The eyebrow's first half, before the repository. */
export const ANALYZER_EYEBROW = "Build Analyzer";

/** The subline, verbatim from the mockup. */
export const ANALYZER_SUBLINE =
  "The analyzer reads every build, test run, and loop transcript in your history, finds the patterns humans miss, and drafts the fixes — processes, workflows, even tickets.";

/** The primary action, verbatim from the mockup. */
export const RUN_LABEL = "Run analysis now";

/** The glyph after the primary action's label — decorative, so kept out of its name. */
export const RUN_GLYPH = "⟳";

/** The glyph after the schedule control's label — decorative, so kept out of its name. */
export const SCHEDULE_GLYPH = "▾";

/** Why a member's *Run analysis now* is inert. */
export const RUN_MEMBER_REASON = "Only an owner or admin can run an analysis.";

/** Why *Run analysis now* is inert while the press is on its way. */
export const RUN_STARTING_REASON = "Starting…";

/** Why *Run analysis now* is inert before the page has been read. */
export const RUN_UNREAD_REASON = "The analyzer has not been read yet.";

/** What the head says when the tenant chip's workspace has no repository enabled. */
export const NO_REPOSITORY = "No repository is enabled in this workspace yet.";

/** The hint under the eyebrow when the chip is on *All repos* and the page chose one. */
export const CHOSEN_REPO_HINT = "Showing the first enabled repository — choose another from the tenant chip.";

/**
 * A repository's display name as the mockup's eyebrow writes it — `Helios-Firmware`.
 *
 * @param repo The repository, `owner/name`.
 * @returns Its name, each hyphen-separated word capitalised.
 */
export function repoTitle(repo: string): string {
  const name = repo.slice(repo.indexOf("/") + 1);

  return name
    .split("-")
    .map((word) => (word === "" ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join("-");
}

/**
 * The eyebrow — `Build Analyzer · Helios-Firmware`.
 *
 * @param repo The repository, `owner/name`, or `null` when there is none.
 * @returns The eyebrow.
 */
export function analyzerEyebrow(repo: string | null): string {
  return repo === null ? ANALYZER_EYEBROW : `${ANALYZER_EYEBROW} · ${repoTitle(repo)}`;
}

/** The headline for a run that ended before it had assembled a corpus. */
export const NO_CORPUS_HEADLINE = "The last analysis ended before it read the build history.";

/**
 * The headline over a corpus of this size.
 *
 * @param builds Builds inside the window.
 * @param days The window's length.
 * @returns *Your last 1,284 builds have opinions.* for at least one build a day; a truthful
 *   sentence for a thinner corpus, and for none.
 */
export function corpusHeadline(builds: number, days: number): string {
  if (builds === 0) return `No builds in the last ${days} days to learn from yet.`;
  if (builds < days) {
    return `${count(builds, "build")} in ${days} days — early opinions, held loosely.`;
  }

  return `Your last ${builds.toLocaleString("en-US")} builds have opinions.`;
}

/**
 * The headline, slot-filled from the corpus manifest.
 *
 * @param run The newest run, or `null` before the first.
 * @returns {@link corpusHeadline} over the run's manifest; before a manifest exists, that no
 *   analysis has run, that one is reading the history now, or — for a run that ended without
 *   one — that it ended first. Never *reading…* for a run that is no longer running.
 */
export function analyzerHeadline(run: AnalysisRun | null): string {
  if (run === null) return "No analysis has run here yet.";

  const { manifest } = run;
  if (manifest === null) {
    return run.status === "running" ? "Reading your build history…" : NO_CORPUS_HEADLINE;
  }

  return corpusHeadline(manifest.counts.builds, manifest.window.days);
}

/**
 * Why *Run analysis now* is inert, if it is.
 *
 * @param state Whether this person may run one, whether a press is on its way, and whether the
 *   page has been read.
 * @returns The reason, or `undefined` when the control is live.
 */
export function runBlock(state: {
  readonly mayAdminister: boolean;
  readonly starting: boolean;
  readonly unread: boolean;
}): string | undefined {
  if (!state.mayAdminister) return RUN_MEMBER_REASON;
  if (state.starting) return RUN_STARTING_REASON;

  return state.unread ? RUN_UNREAD_REASON : undefined;
}

/* ------------------------------------------------------------------ the schedule control */

/** ISO weekdays, 1 = Monday, as the picker and the summary name them. */
export const WEEKDAYS: readonly string[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/**
 * The schedule control's label — `Schedule: weekly + every 50 builds`.
 *
 * @param schedule The schedule, or `null` before the page is read.
 * @returns The label, naming each trigger that is on, `paused` when the master switch is off,
 *   and `manual only` when no trigger is.
 */
export function scheduleLabel(schedule: AnalysisSchedule | null): string {
  if (schedule === null) return "Schedule";
  if (!schedule.enabled) return "Schedule: paused";

  const triggers = [
    schedule.weeklyEnabled ? "weekly" : null,
    schedule.everyNBuilds === null ? null : `every ${count(schedule.everyNBuilds, "build")}`,
  ].filter((trigger) => trigger !== null);

  return triggers.length === 0 ? "Schedule: manual only" : `Schedule: ${triggers.join(" + ")}`;
}

/**
 * The live counter beside the every-N stepper — `12 of 50 builds since the last run`.
 *
 * @param schedule The schedule.
 * @returns The sentence; without a threshold, the bare count.
 */
export function counterLine(schedule: AnalysisSchedule): string {
  const since = "since the every-N trigger last fired";

  return schedule.everyNBuilds === null
    ? `${count(schedule.buildCounter, "build")} finished ${since}.`
    : `${schedule.buildCounter} of ${count(schedule.everyNBuilds, "build")} finished ${since}.`;
}

/* ------------------------------------------------------------------ the meta strip */

/** The strip's four labels, verbatim from the mockup. */
export const STRIP_LABELS = {
  corpus: "Corpus",
  analyzedBy: "Analyzed by",
  lastRun: "Last run",
  confidence: "Confidence",
} as const;

/** What the strip says before the first analysis. */
export const NO_RUN_STRIP = "No analysis yet — the corpus, provenance and confidence appear after the first run.";

/** What the corpus slot says while a run is assembling. */
export const ASSEMBLING_CORPUS = "being assembled…";

/** What the corpus slot says for a run that ended before it had assembled one. */
export const NO_CORPUS = "not assembled — the run ended first";

/**
 * The corpus slot's text for a run with no manifest.
 *
 * @param run The run.
 * @returns {@link ASSEMBLING_CORPUS} while it runs; {@link NO_CORPUS} once it has ended — a strip
 *   that kept saying *being assembled…* after a failure would be promising something.
 */
export function missingCorpusLine(run: Pick<AnalysisRun, "status">): string {
  return run.status === "running" ? ASSEMBLING_CORPUS : NO_CORPUS;
}

/** The tag a sampled corpus carries. */
export const SAMPLED_TAG = "sampled";

/** The popover heading over the analyzer list. */
export const ANALYZERS_HEADING = "Analyzers in this run";

/** The popover heading over the confidence basis. */
export const BASIS_HEADING = "How this was judged";

/** What the confidence popover says for a run that stored no basis. */
export const NO_BASIS = "This run did not record the basis of its confidence note.";

/** What the confidence slot says before a run has a note. */
export const NO_CONFIDENCE = "not yet judged";

/** The four counted sources, in the strip's order, with their unit. */
const CORPUS_UNITS = [
  ["builds", "build"],
  ["loops", "loop"],
  ["logLines", "log line"],
  ["hilSessions", "HIL session"],
] as const;

/**
 * A count and its noun, pluralised — `1 build`, `312 loops`.
 *
 * @param value The count.
 * @param noun The singular noun.
 * @returns The phrase, the count grouped in threes.
 */
export function count(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? noun : `${noun}s`}`;
}

/**
 * The corpus line — `1,284 builds · 312 loops · 90 days · 4.1M log lines · 62 HIL sessions`.
 *
 * @param manifest The run's manifest.
 * @returns The line. Log lines are compacted (`4.1M`), as the mockup draws them.
 */
export function corpusLine(manifest: AnalysisManifest): string {
  const parts = CORPUS_UNITS.map(([key, noun]) => {
    const value = manifest.counts[key];

    return key === "logLines" && value >= 10_000
      ? `${compactNumber(value)} ${noun}s`
      : count(value, noun);
  });

  parts.splice(2, 0, count(manifest.window.days, "day"));

  return parts.join(" · ");
}

/** What each budget is called when it bound a sample. */
const CAP_NAMES: Readonly<Record<NonNullable<AnalysisManifest["sources"]["builds"]["cap"]>, string>> = {
  maxBuilds: "the max-builds budget",
  maxLogLines: "the max-log-lines budget",
  computeCeilingSeconds: "the compute ceiling",
};

/** What each source is called in a sampling note. */
const SOURCE_NAMES: Readonly<Record<keyof AnalysisManifest["counts"], string>> = {
  builds: "builds",
  loops: "loops",
  logLines: "log lines",
  hilSessions: "HIL sessions",
};

/**
 * The sampling indicator's sentences — one per source the run read only part of.
 *
 * @param manifest The run's manifest.
 * @returns E.g. `log lines read at 30%, capped by the max-log-lines budget`; empty when every
 *   source was read in full, so the counts may be presented as exhaustive.
 */
export function samplingNotes(manifest: AnalysisManifest): string[] {
  return CORPUS_UNITS.flatMap(([key]) => {
    const record = manifest.sources[key];
    if (!record.sampled) return [];

    const cap = record.cap === null ? "" : `, capped by ${CAP_NAMES[record.cap]}`;

    return [`${SOURCE_NAMES[key]} read at ${Math.round(record.rate * 100)}%${cap}`];
  });
}

/**
 * The analyzers of a set that are language-model passes — the only ones a model pill may name.
 *
 * @param set The run's analyzer set.
 * @returns Their ids; empty for a deterministic set.
 */
export function modelAnalyzers(set: AnalyzerSet): string[] {
  return set.analyzers.filter((entry) => entry.kind === "llm").map((entry) => entry.id);
}

/** One line of the analyzer-list popover. */
export interface AnalyzerLine {
  readonly id: string;
  /** `v1`. */
  readonly version: string;
  /** `deterministic` or `llm`. */
  readonly kind: string;
  /** How it ended in this run, or where it is — `completed · 3 findings`. */
  readonly outcome: string;
}

/** What each progress status reads as. */
const STATUS_WORDS: Readonly<Record<AnalyzerProgress["status"], string>> = {
  pending: "waiting",
  running: "running",
  completed: "completed",
  skipped: "skipped",
  failed: "failed",
  timed_out: "timed out",
  memory_exceeded: "out of memory",
  not_run: "not run",
};

/**
 * One analyzer's state as a phrase — `completed · 3 findings`, `skipped — no jobs in the corpus`.
 *
 * @param entry The analyzer's progress entry.
 * @returns The phrase.
 */
export function analyzerOutcome(entry: AnalyzerProgress): string {
  const word = STATUS_WORDS[entry.status];

  if (entry.status === "completed") {
    return entry.findings === null ? word : `${word} · ${count(entry.findings, "finding")}`;
  }

  return entry.reason === null ? word : `${word} — ${entry.reason}`;
}

/**
 * The analyzer-list popover: every analyzer of the run's set, its version, kind and outcome.
 *
 * @param run The run.
 * @returns One line per analyzer, in the set's order.
 */
export function analyzerLines(run: AnalysisRun): AnalyzerLine[] {
  const progress = new Map(run.progress.analyzers.map((entry) => [entry.id, entry]));

  return run.analyzerSet.analyzers.map((entry) => {
    const state = progress.get(entry.id);

    return {
      id: entry.id,
      version: `v${entry.version}`,
      kind: entry.kind,
      outcome: state === undefined ? "not reported" : analyzerOutcome(state),
    };
  });
}

/**
 * A run's compute time as the strip draws it — `41 min`, `45 s`, `1 h 05 min`.
 *
 * @param seconds The run's `computeSeconds`.
 * @returns The duration.
 */
export function computeDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));

  if (whole < 60) return `${whole} s`;

  const minutes = Math.round(whole / 60);
  if (minutes < 60) return `${minutes} min`;

  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/**
 * The *Last run* slot — `2h ago · 41 min`, plus `· $2.86` only when an LLM pass spent money.
 *
 * @param run The run.
 * @param now The clock.
 * @returns The line; a running run says so, with how long it has been going.
 */
export function lastRunLine(run: AnalysisRun, now: Date): string {
  if (run.status === "running") return `running · started ${coarseAgo(run.startedAt, now)}`;

  const parts = [coarseAgo(run.finishedAt ?? run.startedAt, now), computeDuration(run.computeSeconds)];
  if (run.llmCostCents !== null) parts.push(moneyOfCents(run.llmCostCents));

  return parts.join(" · ");
}

/**
 * The confidence popover's lines — the computed basis, judged against its stored rule.
 *
 * @param basis The run's basis.
 * @returns The coverage line, the rate line, and the rule.
 */
export function basisLines(basis: AnalysisConfidenceBasis): string[] {
  const { high, medium } = basis.rule;

  return [
    `Builds on ${basis.daysWithBuilds} of ${basis.windowDays} days (${percentOf(basis.coverage)}) — high needs ${percentOf(high.coverage)}, medium ${percentOf(medium.coverage)}.`,
    `${basis.perDay.toLocaleString("en-US", { maximumFractionDigits: 2 })} builds a day (${count(basis.builds, "build")}) — high needs ${high.perDay}, medium ${medium.perDay}.`,
    `Judged ${basis.level}: high needs both bars, medium both of its own; anything thinner is low.`,
  ];
}

/* ------------------------------------------------------------------ run progress */

/** The run's phases in order, with what each is called on screen. */
export const PHASES: readonly { readonly id: AnalysisRun["phase"]; readonly label: string }[] = [
  { id: "assembling", label: "Assembling corpus" },
  { id: "analyzing", label: "Analyzing" },
  { id: "composing", label: "Composing suggestions" },
];

/** The progress panel's heading. */
export const PROGRESS_HEADING = "Analysis progress";

/** Where a phase stands relative to the run's. */
export type PhaseState = "done" | "current" | "waiting";

/**
 * Where one phase stands.
 *
 * @param phase The phase asked about.
 * @param run The run.
 * @returns `done` for a phase the run has passed (or the one a complete run ended in),
 *   `current` for the one it is in, `waiting` for one it has not reached.
 */
export function phaseState(phase: AnalysisRun["phase"], run: AnalysisRun): PhaseState {
  const at = PHASES.findIndex((entry) => entry.id === run.phase);
  const index = PHASES.findIndex((entry) => entry.id === phase);

  if (index < at) return "done";
  if (index > at) return "waiting";

  return run.status === "complete" ? "done" : "current";
}

/**
 * The progress panel's status sentence.
 *
 * @param run The run.
 * @returns What is happening, or how it ended — `failed` and `budget_exceeded` each with the
 *   run's own reason, because they mean different things: nothing a broken run found reaches the
 *   page (whatever its analyzers had finished); one that reached its budget kept what its
 *   finished analyzers found, and its reason names the ones that did not finish.
 */
export function runStatusLine(run: AnalysisRun): string {
  const finished = run.progress.analyzers.filter((entry) => entry.status === "completed").length;
  const total = run.progress.analyzers.length;

  switch (run.status) {
    case "running":
      return run.phase === "analyzing"
        ? `Analyzing — ${finished} of ${count(total, "analyzer")} finished.`
        : `${PHASES.find((entry) => entry.id === run.phase)?.label ?? "Working"}…`;
    case "complete":
      return `Analysis complete — ${count(finished, "analyzer")} finished.`;
    case "budget_exceeded":
      // The service's reason says what was kept and names what did not finish; saying the count
      // here as well would say it twice.
      return run.failureReason === null
        ? `Stopped at its budget; the findings of ${count(finished, "analyzer")} were kept.`
        : `Stopped at its budget. ${run.failureReason}`;
    case "failed":
      return `The analysis failed, and nothing from it is shown. ${run.failureReason ?? ""}`.trim();
  }
}

/** What a refused start says, beside the reason the service gave. */
export const START_FAILED = "The analysis could not be started.";

/** The concurrent-run state's link text. */
export const FOLLOW_RUNNING = "Follow its progress";

/**
 * The concurrent-run state — *an analysis is already running*, with when it started and where.
 *
 * @param repo The repository.
 * @param startedAt When the running analysis started, when the service said.
 * @param phase The phase it is in, when the service said.
 * @param now The clock.
 * @returns The sentence. No second run was queued.
 */
export function alreadyRunningLine(
  repo: string,
  startedAt: string | null,
  phase: string | null,
  now: Date,
): string {
  const since = startedAt === null ? "" : ` — started ${coarseAgo(startedAt, now)}`;
  const where = phase === null ? "" : `, ${phase}`;

  return `An analysis of ${repo} is already running${since}${where}. No second run was started.`;
}

/* ------------------------------------------------------------------ the schedule editor */

/** The editor's title. */
export const SCHEDULE_TITLE = "Analysis schedule";

/** What a member is told in the editor. */
export const SCHEDULE_MEMBER_NOTE = "Only an owner or admin can change the schedule.";

/** What a saved-and-unchanged editor says. */
export const SCHEDULE_SAVED = "Schedule saved.";

/** What a save that could not reach the service says. */
export const SCHEDULE_SAVE_FAILED = "The schedule could not be saved.";

/** The form's state: every field as typed, so a half-typed number is not lost. */
export interface ScheduleForm {
  readonly enabled: boolean;
  readonly weeklyEnabled: boolean;
  /** `"1"`…`"7"`, or `""` when no day was ever chosen. */
  readonly weeklyDay: string;
  /** `HH:MM`, or `""`. */
  readonly weeklyTime: string;
  readonly everyEnabled: boolean;
  readonly everyNBuilds: string;
  readonly maxBuilds: string;
  readonly maxLogLines: string;
  readonly computeCeilingSeconds: string;
}

/** The fields a form may be refused on. */
export type ScheduleField = Exclude<keyof ScheduleForm, "enabled" | "weeklyEnabled" | "everyEnabled">;

/** The every-N threshold a newly switched-on trigger starts at — the mockup's `every 50`. */
export const DEFAULT_EVERY_N = 50;

/** The largest value V080's `integer` columns hold. */
const MAX_INT4 = 2_147_483_647;

/**
 * The editor's starting state.
 *
 * @param schedule The schedule as read.
 * @returns The form, every value as the service holds it.
 */
export function scheduleForm(schedule: AnalysisSchedule): ScheduleForm {
  return {
    enabled: schedule.enabled,
    weeklyEnabled: schedule.weeklyEnabled,
    weeklyDay: schedule.weeklyDay === null ? "" : String(schedule.weeklyDay),
    weeklyTime: schedule.weeklyTime ?? "",
    everyEnabled: schedule.everyNBuilds !== null,
    everyNBuilds: String(schedule.everyNBuilds ?? DEFAULT_EVERY_N),
    maxBuilds: String(schedule.maxBuilds),
    maxLogLines: String(schedule.maxLogLines),
    computeCeilingSeconds: String(schedule.computeCeilingSeconds),
  };
}

/**
 * A typed whole number in range, or `null`.
 *
 * @param raw What was typed.
 * @param max The largest allowed.
 * @returns The number, when it is a whole number from 1 to `max`.
 */
function wholeNumber(raw: string, max: number): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;

  const value = Number(raw.trim());

  return value >= 1 && value <= max ? value : null;
}

/** A form's verdict: the input to save, or what is wrong, field by field. */
export type ScheduleVerdict =
  | { readonly ok: true; readonly input: AnalysisScheduleInput }
  | { readonly ok: false; readonly errors: Partial<Record<ScheduleField, string>> };

/**
 * Check a form against V080's rules — the same ones the service enforces — and build the save.
 *
 * @param repo The repository, `owner/name`.
 * @param form The form.
 * @returns The input, or each field's complaint. A slot kept while the weekly trigger is off
 *   must still be a valid one, because the service keeps it.
 */
export function scheduleVerdict(repo: string, form: ScheduleForm): ScheduleVerdict {
  const errors: Partial<Record<ScheduleField, string>> = {};

  const day = form.weeklyDay === "" ? null : wholeNumber(form.weeklyDay, 7);
  if (form.weeklyDay !== "" && day === null) errors.weeklyDay = "Choose a day of the week.";
  if (form.weeklyEnabled && form.weeklyDay === "") errors.weeklyDay = "Choose a day for the weekly run.";

  const time = form.weeklyTime === "" ? null : form.weeklyTime;
  if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.weeklyTime = "Use a 24-hour UTC time, like 06:00.";
  if (form.weeklyEnabled && time === null) errors.weeklyTime = "Choose a time for the weekly run.";

  const everyN = form.everyEnabled ? wholeNumber(form.everyNBuilds, MAX_INT4) : null;
  if (form.everyEnabled && everyN === null) errors.everyNBuilds = "Use a whole number of builds, at least 1.";

  const maxBuilds = wholeNumber(form.maxBuilds, MAX_INT4);
  if (maxBuilds === null) errors.maxBuilds = "Use a whole number of builds, at least 1.";

  const maxLogLines = wholeNumber(form.maxLogLines, Number.MAX_SAFE_INTEGER);
  if (maxLogLines === null) errors.maxLogLines = "Use a whole number of log lines, at least 1.";

  const ceiling = wholeNumber(form.computeCeilingSeconds, MAX_INT4);
  if (ceiling === null) errors.computeCeilingSeconds = "Use a whole number of seconds, at least 1.";

  if (Object.keys(errors).length > 0 || maxBuilds === null || maxLogLines === null || ceiling === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      repo,
      enabled: form.enabled,
      weeklyEnabled: form.weeklyEnabled,
      weeklyDay: day,
      weeklyTime: time,
      everyNBuilds: everyN,
      maxBuilds,
      maxLogLines,
      computeCeilingSeconds: ceiling,
    },
  };
}
