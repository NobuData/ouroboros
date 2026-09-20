/**
 * Every decision the build farm's runners table makes, and every word it says
 * (AI.2, [#257](https://github.com/NobuData/ouroboros/issues/257)).
 *
 * Mockup 08's `RUNNERS` card is the one table in the product that renders **machines that are
 * running right now** rather than stored records, and what it draws is a list of judgements:
 * which pill a status takes, when a CPU figure is a warning, how much RAM is *14.2/32 GB*, what
 * order the fleet stands in — and, above all, **when a figure is not drawn at all**. Each of them
 * lives here so its acceptance criterion is a unit test on a small value rather than an
 * assertion about markup.
 *
 * **Framework-free and pure**, the way `app/farm/view.ts` is: nothing here imports React,
 * `next/*` or the server-only client. The drawing is `app/farm/runners-card.tsx`'s and
 * `app/farm/runner-cells.tsx`'s.
 *
 * ### Stale data is not rendered as current
 *
 * A runner that went offline two hours ago still *had* a CPU figure, and printing it would be
 * a quiet lie. The service already clears the snapshot when the presence sweep flips a machine
 * offline (V040), and this module does not rely on that: a row the fleet cannot vouch for —
 * {@link isVouchedFor} — draws {@link NOT_MEASURED} in every cell an **agent** reported (CPU,
 * RAM, uptime) whatever the payload carries, and `last seen 2h ago` says exactly how stale the
 * row is. What the **control plane** knows stays: the queue depth is its own count and is still
 * true of a machine nobody can hear.
 *
 * ### `null` is not `0`
 *
 * The same rule as the stat row, one level down: a metric an agent could not collect on its
 * platform (AG.3, [#245](https://github.com/NobuData/ouroboros/issues/245)) arrives as `null`
 * and is drawn as an em dash with **no meter** — an empty bar is a picture of `0%`.
 *
 * ### Every row is flat
 *
 * A {@link RunnerRow} holds strings, numbers and booleans only, already formatted. That is what
 * lets each cell be a memoised component over primitive props (`app/farm/runner-cells.tsx`): a
 * poll that changed one machine's CPU re-renders that one cell and nothing beside it.
 */

import type { FarmPage, FarmRunner } from "@/app/api/farm";
import { ageOfSeconds } from "@/app/format";
import type { ChipDot, ChipTone } from "@/app/ui/chip";
import type { MeterTone } from "@/app/ui/meter";

import { NOT_MEASURED } from "./view";

/* ------------------------------------------------------------------ copy */

/** What the card is called, as the mockup titles it. */
export const RUNNERS_TITLE = "Runners";

/** The table's own name, for a reader moving between the page's tables by landmark. */
export const RUNNERS_CAPTION = "The fleet — every runner, its status and its live telemetry";

/** The column headings, verbatim from the mockup. The last column has none to show. */
export const RUNNER_COLUMNS = {
  runner: "Runner",
  pool: "Pool",
  status: "Status",
  job: "Current job",
  cpu: "CPU",
  ram: "RAM",
  queue: "Queue",
  uptime: "Uptime",
  actions: "Actions",
} as const;

/** The head link, verbatim from the mockup. */
export const HEALTH_HISTORY = "Health history →";

/**
 * Why {@link HEALTH_HISTORY} cannot act: its destination is AJ.4
 * ([#266](https://github.com/NobuData/ouroboros/issues/266)), which does not exist. The mockup
 * links it to `#`; here it is an honest *soon* that navigates nowhere.
 */
export const HEALTH_HISTORY_SOON = "Health history arrives with #266.";

/** The glyph on a row's overflow control, verbatim from the mockup. */
export const RUNNER_ACTIONS_GLYPH = "⋯";

/**
 * The accessible name of a row's overflow control.
 *
 * The mockup names all five *Runner actions*; five controls answering to one name cannot be
 * told apart by a reader moving between them, so each names its machine.
 *
 * @param name The runner's name.
 * @returns The label.
 */
export function runnerActionsLabel(name: string): string {
  return `Runner actions for ${name}`;
}

/** What the grouping control is called. */
export const GROUP_BY_STATUS = "Group by status";

/** What the card says over a fleet with nobody in it. */
export const NO_RUNNERS_TITLE = "No runners enrolled yet.";

/** And the line under it. How to enroll one is the enroll card's (AI.3, #258). */
export const NO_RUNNERS_NOTE = "A runner appears here as soon as its agent has enrolled.";

/** What the card says when the page could not be read. The *why* is the banner's, once. */
export const RUNNERS_UNREAD_TITLE = "The fleet could not be read.";

/* ------------------------------------------------------------------ the status pill */

/** What the fleet last observed of a runner — the payload's own vocabulary. */
export type RunnerStatus = FarmRunner["status"];

/** How a status is drawn: its word, its hue and the shape of its dot. */
export interface RunnerPill {
  /** The word in the pill. */
  readonly label: string;
  /** Which hue. */
  readonly tone: ChipTone;
  /** Which dot — hue is never the only signal (`app/ui/chip.tsx`). */
  readonly dot: ChipDot;
}

/**
 * The mockup's pill for each status.
 *
 * - `building` is the accent with the pulse: the one state that is happening *now*.
 * - `online` reads **idle** — a connected machine with nothing to do, which is what the mockup
 *   calls it and what an operator asks (*which runner is free?*).
 * - `draining` is a warning: connected, finishing, and taking no new work.
 * - `offline` is an error, and carries {@link lastSeen} beside it.
 * - `removed` is never served — the page excludes retired machines — and is drawn, rather than
 *   thrown over, if something sends one: no hue, and a ring for a state nobody is reporting.
 */
export const RUNNER_PILLS: Readonly<Record<RunnerStatus, RunnerPill>> = {
  building: { label: "building", tone: "accent", dot: "pulse" },
  online: { label: "idle", tone: "neutral", dot: "filled" },
  draining: { label: "draining", tone: "warn", dot: "filled" },
  offline: { label: "offline", tone: "err", dot: "filled" },
  removed: { label: "removed", tone: "neutral", dot: "ring" },
};

/**
 * Whether the fleet can vouch for a runner right now — whether anything its agent reported may
 * be drawn as current.
 *
 * @param status What was last observed.
 * @returns `true` for a connected machine: `online`, `building` or `draining` — the same three
 *   the stat row counts as *online*.
 */
export function isVouchedFor(status: RunnerStatus): boolean {
  return status === "online" || status === "building" || status === "draining";
}

/** What an operator **intended** for a runner — the payload's own vocabulary. */
export type RunnerIntent = FarmRunner["desiredState"];

/** Beside the pill of a runner that has been drained and has not said so yet. */
export const DRAIN_REQUESTED = "drain requested";

/** Beside the pill of a runner that has been returned to service and still reports `draining`. */
export const UNDRAIN_REQUESTED = "returning to service";

/**
 * What stands beside the pill while intent and observation disagree
 * (AI.5, [#260](https://github.com/NobuData/ouroboros/issues/260)).
 *
 * A drain writes `desiredState`; the pill is `status`, the agent's own heartbeat, and it follows
 * on the next one. This is the honest reading of the seconds in between: the pill still says
 * *building*, because that is what the machine last reported, and the note says what was asked
 * of it. Without it a drain would look like a click that did nothing.
 *
 * @param status What the fleet last observed.
 * @param intent What an operator last intended.
 * @returns The note, or `null` when the two agree — or when the machine is gone.
 */
export function intentNote(status: RunnerStatus, intent: RunnerIntent): string | null {
  if (status === "removed" || intent === "removed") return null;
  if (intent === "draining" && status !== "draining") return DRAIN_REQUESTED;
  if (intent === "active" && status === "draining") return UNDRAIN_REQUESTED;

  return null;
}

/** What stands beside the pill of a machine that enrolled and never connected. */
export const NEVER_SEEN = "never seen";

/** Milliseconds in a second. */
const SECOND_MS = 1000;

/**
 * `last seen 2h ago` — exactly how stale an offline row is.
 *
 * The age is `ageOfSeconds`, the rule the service composes the stat row's *forge-03 offline · 2h*
 * by, so the tile and the row it names read one figure.
 *
 * @param lastSeenAt When the last heartbeat arrived, ISO 8601, or `null` for a machine that has
 *   never connected — enrolment is not a sighting.
 * @param nowMs The instant the page on screen was confirmed current, in epoch milliseconds —
 *   the store's `dataAt`, so a server render and its hydration agree, and a page kept under the
 *   stale banner ages against the moment it was true rather than against the wall clock.
 * @returns The phrase; {@link NEVER_SEEN} when there is no sighting, or none that parses.
 */
export function lastSeen(lastSeenAt: string | null, nowMs: number): string {
  const seenMs = lastSeenAt === null ? Number.NaN : Date.parse(lastSeenAt);
  if (Number.isNaN(seenMs)) return NEVER_SEEN;

  return `last seen ${ageOfSeconds((nowMs - seenMs) / SECOND_MS)} ago`;
}

/* ------------------------------------------------------------------ the telemetry cells */

/** From this percentage up, the CPU meter takes the warn treatment — the mockup's `82%` row. */
export const CPU_WARN_FROM = 80;

/**
 * Below this percentage the meter is the healthy hue — the mockup's `3%` and `6%` rows. Between
 * the two it is the plain accent, its `54%` row.
 */
export const CPU_OK_BELOW = 50;

/** A whole, as a percentage. */
const PERCENT = 100;

/** The CPU cell: the figure, and the meter beside it — or neither. */
export interface CpuReading {
  /** `82%`, or {@link NOT_MEASURED}. */
  readonly text: string;
  /** How full the meter is, `0`–`1`, or `null` for no meter: an empty bar is a picture of `0%`. */
  readonly meter: number | null;
  /** The meter's hue. */
  readonly tone: MeterTone;
}

/** The cell over a figure nobody has. */
const NO_CPU: CpuReading = { text: NOT_MEASURED, meter: null, tone: "accent" };

/**
 * The CPU cell.
 *
 * **The tone is decided on the figure that is drawn**, not on the fraction behind it: `79.6`
 * reads `80%` and takes the warning, so a reader never sees a number and a colour that disagree
 * about which side of the line it is on.
 *
 * @param cpuPct The agent's reading, `0`–`100`, or `null` when it sent none.
 * @returns The figure, the meter and its tone.
 */
export function cpuReading(cpuPct: number | null): CpuReading {
  if (cpuPct === null || !Number.isFinite(cpuPct)) return NO_CPU;

  const pct = Math.min(PERCENT, Math.max(0, Math.round(cpuPct)));
  const tone: MeterTone = pct >= CPU_WARN_FROM ? "warn" : pct < CPU_OK_BELOW ? "ok" : "accent";

  return { text: `${pct}%`, meter: pct / PERCENT, tone };
}

/** Bytes in a gigabyte — decimal, which is how the mockup's `32 GB` machine is `32`. */
const BYTES_PER_GB = 1e9;

/** From this many gigabytes of memory up, tenths are noise and the figures are whole. */
const WHOLE_GB_FROM = 100;

/**
 * A figure with its trailing `.0` dropped — a machine has `32` GB, not `32.0`.
 *
 * @param gb The figure.
 * @returns It, to at most one decimal.
 */
function trimmedGb(gb: number): string {
  return String(Math.round(gb * 10) / 10);
}

/**
 * The RAM cell — the mockup's `14.2/32 GB`, `5.0/64 GB` and `88/256 GB`.
 *
 * **The precision follows the machine.** Under {@link WHOLE_GB_FROM} the used figure is always
 * to one decimal — `5.0`, not `5`, so a column of them does not change width as a figure passes
 * a whole number — and from there up both are whole, because a tenth of a gigabyte on a 256 GB
 * host is noise.
 *
 * @param usedBytes Memory in use, or `null` when the agent sent none.
 * @param totalBytes Memory installed, or `null` when the agent sent none.
 * @returns The cell: {@link NOT_MEASURED} without a used figure — never `0` — and the used figure
 *   alone (`14.2 GB`) when the total is the part that is missing.
 */
export function ramReading(usedBytes: number | null, totalBytes: number | null): string {
  if (usedBytes === null || !Number.isFinite(usedBytes) || usedBytes < 0) return NOT_MEASURED;

  const used = usedBytes / BYTES_PER_GB;
  if (totalBytes === null || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return `${used.toFixed(1)} GB`;
  }

  const total = totalBytes / BYTES_PER_GB;

  return total >= WHOLE_GB_FROM
    ? `${Math.round(used)}/${Math.round(total)} GB`
    : `${used.toFixed(1)}/${trimmedGb(total)} GB`;
}

/**
 * The uptime cell — the mockup's compact `41d`.
 *
 * @param uptimeSeconds Uptime as the agent last reported it, or `null` with no live report.
 * @returns The span, or {@link NOT_MEASURED} — never `0s` for a machine nobody has heard from.
 */
export function uptimeReading(uptimeSeconds: number | null): string {
  return uptimeSeconds === null || !Number.isFinite(uptimeSeconds)
    ? NOT_MEASURED
    : ageOfSeconds(uptimeSeconds);
}

/**
 * The queue chip — the mockup's `q:2`.
 *
 * This one is a **count**, and the control plane's own (`queueDepth` on the runner, not the
 * agent's `telemetry.queueDepth`), so `q:0` is a genuine zero and is still true of an offline
 * machine — which is why the mockup's dimmed row keeps it.
 *
 * @param queueDepth Builds assigned to the machine and not started.
 * @returns The chip's text.
 */
export function queueReading(queueDepth: number): string {
  return `q:${Math.max(0, Math.round(queueDepth))}`;
}

/* ------------------------------------------------------------------ the current job */

/** What a draining machine's build is doing — the mockup's `HIL test rig · finishing`. */
export const FINISHING = "finishing";

/** The separator the mockups join a caption's parts with. */
const SEPARATOR = " · ";

/**
 * The words beside a job's number — `zephyr build`, or `HIL test rig · finishing`.
 *
 * *Finishing* is derived, not served: a draining runner takes no new work, so the build it
 * holds is by definition the one it is finishing.
 *
 * @param label The job's short label.
 * @param status What the runner is doing.
 * @returns The note.
 */
export function jobNote(label: string, status: RunnerStatus): string {
  return status === "draining" ? `${label}${SEPARATOR}${FINISHING}` : label;
}

/**
 * A job's public name — mockup 08's `#479`.
 *
 * @param number The job's number.
 * @returns It, with its hash.
 */
export function jobNumber(number: number): string {
  return `#${number}`;
}

/* ------------------------------------------------------------------ the rows */

/** One row of the table: flat, formatted, and nothing but primitives — see the module note. */
export interface RunnerRow {
  /** The runner's id — the row's key, and what the selection holds. */
  readonly id: string;
  /** `forge-01`. */
  readonly name: string;
  /** `linux/arm64` — the line under the name. */
  readonly arch: string;
  /** `pool-a` — the tag. */
  readonly pool: string;
  /** Whether the connection fell back to a bearer token (decision **B3**): the shield affix. */
  readonly degraded: boolean;
  /** What was last observed, in the payload's vocabulary. */
  readonly status: RunnerStatus;
  /** What an operator last intended — what decides between Drain and Undrain (#260). */
  readonly desiredState: RunnerIntent;
  /** `drain requested`, while intent and observation disagree, or `null`. */
  readonly intent: string | null;
  /** `last seen 2h ago`, for an offline row and only for one. */
  readonly lastSeen: string | null;
  /** Whether the row is dimmed: the fleet cannot vouch for it. */
  readonly dim: boolean;
  /** The current job's id, or `null` when it is running nothing. */
  readonly jobId: string | null;
  /** `#479`, or `null`. */
  readonly jobNumber: string | null;
  /** `zephyr build`, `HIL test rig · finishing`, or `null`. */
  readonly jobNote: string | null;
  /** The job's full title — the link's tooltip, and the sheet's heading. */
  readonly jobTitle: string | null;
  /** When the job started, ISO 8601, or `null`. */
  readonly jobStartedAt: string | null;
  /** `82%`, or an em dash. */
  readonly cpu: string;
  /** How full the CPU meter is, or `null` for no meter. */
  readonly cpuMeter: number | null;
  /** The CPU meter's hue. */
  readonly cpuTone: MeterTone;
  /** `14.2/32 GB`, or an em dash. */
  readonly ram: string;
  /** `q:2`. */
  readonly queue: string;
  /** `41d`, or an em dash. */
  readonly uptime: string;
}

/**
 * One runner, as the table draws it.
 *
 * @param runner The runner, as served.
 * @param nowMs The instant the page on screen was confirmed current — see {@link lastSeen}.
 * @returns The row. A machine the fleet cannot vouch for has an em dash in every agent-reported
 *   cell **whatever the payload carried**, and is dimmed.
 */
export function runnerRow(runner: FarmRunner, nowMs: number): RunnerRow {
  const vouched = isVouchedFor(runner.status);
  const telemetry = vouched ? runner.telemetry : null;
  const cpu = cpuReading(telemetry?.cpuPct ?? null);
  const job = runner.currentJob;

  return {
    id: runner.id,
    name: runner.name,
    arch: runner.arch,
    pool: runner.pool,
    degraded: runner.securityMode === "bearer_fallback",
    status: runner.status,
    desiredState: runner.desiredState,
    intent: intentNote(runner.status, runner.desiredState),
    lastSeen: runner.status === "offline" ? lastSeen(runner.lastSeenAt, nowMs) : null,
    dim: !vouched,
    jobId: job?.id ?? null,
    jobNumber: job ? jobNumber(job.number) : null,
    jobNote: job ? jobNote(job.label, runner.status) : null,
    jobTitle: job?.title ?? null,
    jobStartedAt: job?.startedAt ?? null,
    cpu: cpu.text,
    cpuMeter: cpu.meter,
    cpuTone: cpu.tone,
    ram: ramReading(telemetry?.ramUsedBytes ?? null, telemetry?.ramTotalBytes ?? null),
    queue: queueReading(runner.queueDepth),
    uptime: uptimeReading(vouched ? runner.uptimeSeconds : null),
  };
}

/* ------------------------------------------------------------------ the order */

/** How the fleet is ordered. */
export type RunnerGrouping =
  /** By pool, then by name. The default: **a row never moves because a machine got busy.** */
  | "pool"
  /** By status first — building, idle, draining, offline — then by pool and name. */
  | "status";

/**
 * Where each status stands when the table is grouped by it: what is working, what could be,
 * what is leaving, what is gone. It is the mockup's own row order.
 */
const STATUS_RANK: Readonly<Record<RunnerStatus, number>> = {
  building: 0,
  online: 1,
  draining: 2,
  offline: 3,
  removed: 4,
};

/**
 * Order two strings by code unit.
 *
 * Not `localeCompare`: collation is the runtime's ICU data, and a server and a browser that
 * disagreed about two names would hydrate the table in a different order than it was served.
 *
 * @param a One string.
 * @param b The other.
 * @returns Negative, zero or positive, as a comparator does.
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The fleet, in the order the table draws it.
 *
 * **Stable across polls by construction**: the order is a total one over facts that do not move
 * on a heartbeat — pool, name, and the id to break a tie that cannot happen — so a table left on
 * a wall display never shuffles its rows because a build started. Grouping by status is the
 * reader's choice, and trades exactly that away for having what is working at the top.
 *
 * @param runners The fleet, in any order.
 * @param grouping How to order it.
 * @returns A new array; the input is not touched.
 */
export function sortRunners(
  runners: readonly FarmRunner[],
  grouping: RunnerGrouping,
): readonly FarmRunner[] {
  return [...runners].sort(
    (a, b) =>
      (grouping === "status" ? STATUS_RANK[a.status] - STATUS_RANK[b.status] : 0) ||
      byCodeUnit(a.pool, b.pool) ||
      byCodeUnit(a.name, b.name) ||
      byCodeUnit(a.id, b.id),
  );
}

/**
 * The table's rows.
 *
 * @param page The page, or `null` when nothing has been read.
 * @param nowMs The instant the page was confirmed current, or `null` when there is no page.
 * @param grouping How to order the fleet.
 * @returns One row per runner served, ordered — none for a page that could not be read, and
 *   none without the instant to age its rows against.
 */
export function runnerRows(
  page: FarmPage | null,
  nowMs: number | null,
  grouping: RunnerGrouping,
): readonly RunnerRow[] {
  // `dataAt` is never null beside a page (`app/farm/farm-store.tsx`), so the second test is the
  // type's — and it keeps this module pure: no row is ever aged against a clock read here, which
  // a server render and its hydration would read differently.
  if (page === null || nowMs === null) return [];

  return sortRunners(page.runners, grouping).map((runner) => runnerRow(runner, nowMs));
}

/* ------------------------------------------------------------------ the head's pill */

/**
 * The card head's live pill — the mockup's `1 building`.
 *
 * @param rows The rows on screen.
 * @returns The pill's text, or `null` when nothing is building: a *live* pill over a fleet at
 *   rest would be the card's one-word summary contradicting the rows under it.
 */
export function buildingPill(rows: readonly RunnerRow[]): string | null {
  const building = rows.filter((row) => row.status === "building").length;

  return building === 0 ? null : `${building} building`;
}

/* ------------------------------------------------------------------ what is said out loud */

/** What the shield affix says — its tooltip, and its text for a reader who cannot see it. */
export const BEARER_FALLBACK_NOTE =
  "Bearer-token fallback — this runner connected without a client certificate, which is less " +
  "secure than mTLS.";

/** The short form of {@link BEARER_FALLBACK_NOTE}, for the row announcement. */
const BEARER_FALLBACK_SHORT = "bearer-token fallback";

/**
 * What is announced when a row becomes current — by arrow key or by pointer.
 *
 * The row's identity and its state, in the order the columns read, and the degraded-security
 * mark in words: a shield that only a sighted reader is warned by is half a warning.
 *
 * @param row The row.
 * @returns The sentence.
 */
export function rowAnnouncement(row: RunnerRow): string {
  const parts = [row.name, row.pool, RUNNER_PILLS[row.status].label];

  if (row.intent !== null) parts.push(row.intent);
  if (row.lastSeen !== null) parts.push(row.lastSeen);
  if (row.jobNumber !== null && row.jobNote !== null) parts.push(`${row.jobNumber} ${row.jobNote}`);
  if (row.degraded) parts.push(BEARER_FALLBACK_SHORT);

  return parts.join(", ");
}

/* ------------------------------------------------------------------ the job sheet */

/** What the job sheet is headed with, before the job's number. */
export const JOB_SHEET_EYEBROW = "Build job";

/** What the job sheet's dismissal says. */
export const JOB_SHEET_CLOSE = "Close";

/**
 * The job sheet's name — its eyebrow, and what the dialog answers to.
 *
 * @param number The job's number, as {@link jobNumber} writes it.
 * @returns `Build job #479`.
 */
export function jobSheetLabel(number: string): string {
  return `${JOB_SHEET_EYEBROW} ${number}`;
}

/**
 * Why the current-job cell opens a sheet rather than a page.
 *
 * The cell's honest destination is the run the build belongs to, and the route that draws one
 * is AQ.1 ([#309](https://github.com/NobuData/ouroboros/issues/309)) — not built, and the
 * reference from a job to its run is AO.3's
 * ([#300](https://github.com/NobuData/ouroboros/issues/300)). Until both land the cell opens
 * this sheet over what the page already knows; on the commit that makes `/runs/:id` real it
 * becomes a link there, per the amendment on #257.
 */
export const JOB_SHEET_NOTE =
  "The run console arrives with #309 — until then this is everything the farm reports about " +
  "the build.";

/** One fact in the job sheet. */
export interface JobFact {
  /** What the fact is. */
  readonly term: string;
  /** Its value, already formatted. */
  readonly value: string;
}

/** What stands for a start the payload does not carry — a job is `running`, so this is rare. */
const NOT_STARTED = NOT_MEASURED;

/**
 * What the job sheet lists about a row's current build.
 *
 * @param row The row whose job was opened.
 * @param nowMs The instant the page was confirmed current, for the running time.
 * @param clock How to say an instant. A parameter so the list is a pure function of its inputs —
 *   the caller passes the reader's own locale's clock.
 * @returns The facts, in reading order — none for a row with no job.
 */
export function jobFacts(
  row: RunnerRow,
  nowMs: number,
  clock: (atMs: number) => string,
): readonly JobFact[] {
  if (row.jobNumber === null || row.jobNote === null) return [];

  const startedMs = row.jobStartedAt === null ? Number.NaN : Date.parse(row.jobStartedAt);
  const started = !Number.isNaN(startedMs);

  return [
    { term: "Job", value: `${row.jobNumber} ${row.jobNote}` },
    { term: "Runner", value: `${row.name} · ${row.arch}` },
    { term: "Pool", value: row.pool },
    { term: "Started", value: started ? clock(startedMs) : NOT_STARTED },
    {
      term: "Running for",
      value: started ? ageOfSeconds((nowMs - startedMs) / SECOND_MS) : NOT_STARTED,
    },
  ];
}
