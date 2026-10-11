/**
 * Research's states and guards (CN.7, [#633](https://github.com/NobuData/ouroboros/issues/633))
 * — what the page says before it has tools, investigations or baselines, what it says when the
 * deployment cannot run research at all, and what a stopped investigation leaves behind. The
 * decisions and the copy, with no React in them.
 *
 * ### The gateway is the honesty edge
 *
 * Research is model-backed. A deployment without the invocation gateway (AF.2,
 * [#235](https://github.com/NobuData/ouroboros/issues/235)) cannot synthesise a brief, and the
 * service says so on `GET /research/settings` § `gateway.available`. The page then says it
 * **once**, above the grid ({@link GATEWAY_NOTICE_TITLE}), switches both start controls off with
 * {@link GATEWAY_START_REASON} — and leaves every surface that needs no model alone: the
 * regression watch, the tools' health, the briefs and the roadmap already written.
 *
 * A settings read that failed is **not** an absent gateway: the page then offers the start and
 * the service's own refusal is what a reader sees, as with the starter role.
 */

import type { Reading } from "@/app/api/reading";
import type {
  InvestigationDetail,
  InvestigationList,
  ResearchSettings,
  ResearchToolCatalog,
} from "@/app/api/research";
import { PROVIDERS_PATH } from "@/app/paths";

/* ------------------------------------------------------------------ the gateway */

/**
 * Whether the deployment is known to have no invocation gateway.
 *
 * @param settings The workspace's research settings, or why they could not be read.
 * @returns True only when the service answered and said the gateway is not available.
 */
export function gatewayAbsent(settings: Reading<ResearchSettings>): boolean {
  return settings.ok && !settings.value.gateway.available;
}

/** Why a start control is inert on a deployment without the gateway. */
export const GATEWAY_START_REASON = "Research needs the invocation gateway — see Providers.";

/** The notice's headline — the state, said once for the whole page. */
export const GATEWAY_NOTICE_TITLE = "Research needs the invocation gateway";

/** What the notice says is off. */
export const GATEWAY_NOTICE_OFF =
  "This deployment has no invocation gateway, so a new investigation cannot be started: there is nothing to write its brief.";

/** What the notice says still works. */
export const GATEWAY_NOTICE_STILL =
  "The regression watch still detects and bisects, the tools card still reports health, and the briefs and roadmap already written still read.";

/** The notice's link — where model access is set up. */
export const GATEWAY_NOTICE_LINK = "See Providers";

/** Where that link goes. */
export const GATEWAY_NOTICE_HREF = PROVIDERS_PATH;

/* ------------------------------------------------------------------ the first question */

/** The investigations card with nothing in it: the heading… */
export const FIRST_QUESTION_TITLE = "Ask your first question";

/** …what it explains… */
export const FIRST_QUESTION_NOTE =
  "An investigation reads your code, history, telemetry and the web, and answers with a cited brief. Every one you start is listed here.";

/** …and its action, which puts the reader in the composer. */
export const FIRST_QUESTION_ACTION = "Ask a question";

/**
 * Whether the workspace has no investigation to show for itself: none that is active, and none
 * opened this quarter. A workspace whose every investigation stopped is not a first-time one —
 * it gets the plain empty line and its history.
 *
 * @param list The list's computed counts.
 * @returns Whether the empty card is the first question's.
 */
export function neverAsked(list: Pick<InvestigationList, "counts">): boolean {
  return list.counts.active === 0 && list.counts.thisQuarter === 0;
}

/* ------------------------------------------------------------------ no tools connected */

/**
 * Whether no research tool is connected — the tools card's tag reads `0 connected`.
 *
 * @param catalog The tools catalog.
 * @returns True for a catalog with tools and none answering.
 */
export function noToolConnected(catalog: ResearchToolCatalog): boolean {
  return catalog.tools.length > 0 && catalog.connectedCount === 0;
}

/** The tools card's lead while nothing is connected, for a reader who may enable one. */
export const NO_TOOL_CONNECTED_NOTE =
  "No research tool is connected yet. Enable one below — an investigation reads only through connected tools.";

/** The same, for a reader who may not. */
export const NO_TOOL_CONNECTED_READ_ONLY =
  "No research tool is connected yet. A workspace owner or admin enables them here.";

/** The composer's pointer under its chips while nothing is connected: the words before the link… */
export const COMPOSER_NO_TOOLS_PREFIX = "No research tool is connected yet —";

/** …and the link, to the tools card's seat. */
export const COMPOSER_NO_TOOLS_LINK = "enable one in Research tools";

/* ------------------------------------------------------------------ a stopped investigation */

/** Why an investigation stopped, in the page's words — one per reason the loop records. */
export const FAILURE_REASONS: Readonly<
  Record<NonNullable<InvestigationDetail["failure"]>["reason"], string>
> = {
  tool_exhaustion: "tools exhausted",
  budget_breach: "budget reached",
  synthesis_failure: "synthesis failed",
  engine_error: "engine error",
};

/** What a failed investigation says when the loop recorded no reason. */
export const FAILURE_UNRECORDED = "no reason recorded";

/** What a cancelled investigation says in the reason's place. */
export const CANCELLED_REASON = "cancelled before it finished";

/** The label before the reason. */
export const STOPPED_REASON_LABEL = "Stopped:";

/** What a stopped investigation says about what it kept. */
export const STOPPED_KEPT_NOTE = "What it read before it stopped is kept, and listed here.";

/** The partial ledger's states. */
export const PARTIAL_LEDGER_LOADING = "Reading its sources…";
export const PARTIAL_LEDGER_UNAVAILABLE = "Its sources could not be read.";
export const PARTIAL_LEDGER_EMPTY = "It stopped before it read a source.";

/**
 * Whether an investigation stopped without finishing — `failed` or `cancelled`.
 *
 * @param detail The investigation.
 * @returns Whether its opened view is the stopped one.
 */
export function isStopped(detail: Pick<InvestigationDetail, "status">): boolean {
  return detail.status === "failed" || detail.status === "cancelled";
}

/**
 * Why a stopped investigation stopped.
 *
 * @param detail The investigation.
 * @returns `budget reached — <the loop's detail>` for a failure, the cancelled sentence for a
 *   cancel.
 */
export function stoppedReason(detail: Pick<InvestigationDetail, "status" | "failure">): string {
  if (detail.status === "cancelled") return CANCELLED_REASON;
  if (detail.failure === null) return FAILURE_UNRECORDED;

  const words = FAILURE_REASONS[detail.failure.reason];

  return detail.failure.detail === "" ? words : `${words} — ${detail.failure.detail}`;
}

/**
 * How far a stopped investigation got.
 *
 * @param total How many records its ledger holds.
 * @returns `31 sources reached`.
 */
export function sourcesReached(total: number): string {
  return `${String(total)} ${total === 1 ? "source" : "sources"} reached`;
}

/* ------------------------------------------------------------------ a stale side column */

/** The banner over the side column when its re-read failed and the last answer is still drawn. */
export const SIDE_STALE_HEADLINE = "The tools and the watch could not be refreshed.";

/* ------------------------------------------------------------------ loading */

/** What the `<main>` is labelled while the page's reads are in flight. */
export const LOADING_LABEL = "Loading Research";

/** How many rows each region's skeleton reserves — the seeded workspace's counts. */
export const SKELETON_ROWS = { kinds: 4, chips: 6, tools: 6, watch: 3, brief: 4, pipeline: 6, list: 4 } as const;
