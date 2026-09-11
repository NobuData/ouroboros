/**
 * The issue detail panel's copy and its decisions — every word mockup 03's `ISSUE DETAIL` card
 * prints, and every judgement about one issue's sizing story, as data and pure functions
 * ([#119](https://github.com/NobuData/ouroboros/issues/119)).
 *
 * `app/issues/detail-panel.tsx` draws, `app/issues/head-actions.ts` sends, and this decides:
 * what the meta line reads, where the excerpt is cut, how a token count and a cycle range are
 * spelled, which hue and how much of the meter a risk level takes, when each of the three
 * actions is inert and why, what the trace's lines say, and which of the four sizing states an
 * answer is in. Framework-free and deliberately not `server-only`, the way `app/issues/table.ts`
 * is: the Client Component, the Server Action and the suite all read from here, so the sentence
 * a control's tooltip carries and the one its action answers with are one string.
 *
 * ### The trace is honest, or it is not drawn
 *
 * The mockup's trace reads *sized by claude-sonnet-5 · 2m ago · 41k tokens* over *signals: 3
 * similar closed issues · driver map · HIL test index*, and the v0 estimator produced neither: it
 * is a rule engine that called no model, spent no tokens and consulted no knowledge layer.
 * Decision **K10** makes provenance a constraint of its own — an estimate says what produced it,
 * and a panel never says more than that — so every line below is built from the trace's actual
 * fields: the estimator's own name, the instant it sized the issue, tokens only when any were
 * spent, and the signals it recorded or the plain statement that it recorded none. The mockup's
 * knowledge signals arrive with the estimator that produces them.
 *
 * ### Empty is a real answer, and it is said rather than boxed
 *
 * The heuristic estimator cannot know which files an issue touches, so its breakdown answers
 * `files: []` — a real answer rather than a gap, as the contract says — and the panel renders
 * that absence as a designed sentence naming what it waits for, never as an empty list or a
 * list invented to match the mockup's three paths. The seeds carry the mockup's paths for
 * `#485`, so the seeded panel draws the list; a live estimate draws the sentence.
 */

import type {
  BacklogIssueDetail,
  EstimationAccepted,
  IssueDetail,
  IssueEstimateDetail,
  IssueEstimateTrace,
} from "@/app/api/backlog";
import { compactNumber } from "@/app/format";
import type { MeterTone } from "@/app/ui/meter";

import { age } from "./table";
import { type HeadOutcome, QUEUE_ROLE_REASON } from "./view";

/* ------------------------------------------------------------------ the card */

/**
 * The card's title. The mockup writes it in capitals; the card head's own treatment
 * (`ou-card__title`) is what capitalises it, so the string is written the way a heading is.
 */
export const PANEL_TITLE = "Issue detail";

/** The close control's name — an icon-only button, so the name is the whole of its label. */
export const CLOSE_PANEL_LABEL = "Close issue detail";

/** What the card says while no row is open. */
export const NO_ISSUE_OPEN = "No issue open";

/** The note under {@link NO_ISSUE_OPEN} — how a row gets here. */
export const NO_ISSUE_OPEN_NOTE =
  "Click a row in the backlog table, or press Enter on it, to read its sizing story here.";

/** What the card says when the issue it was asked for could not be read at all. */
export const ISSUE_UNREAD = "The issue could not be read";

/** What is said, over the issue, when the poll that keeps it fresh stopped succeeding. */
export const ISSUE_STALE = "The issue stopped refreshing.";

/** What the body's seat says between a row being opened and its detail arriving. */
export const READING_ISSUE = "Reading the issue…";

/* ------------------------------------------------------------------ the head */

/**
 * The mono meta line — `#485 · opened 2d ago by field-support`.
 *
 * @param issue The number, the author and the opening instant.
 * @param nowSeconds What time it is, in whole seconds since the epoch — the reader's own clock,
 *   ticking (`app/shell/clock.ts`), so *2d ago* is measured from now rather than from the poll.
 * @returns The line. An author GitHub no longer has (`null`) drops the *by*; an opening instant
 *   that cannot be read — which every stamp in the contract can — drops the *opened*, so the
 *   guard is that rather than the expected case.
 */
export function metaLine(
  issue: Pick<BacklogIssueDetail, "number" | "authorLogin" | "ghCreatedAt">,
  nowSeconds: number,
): string {
  const parts = [`#${issue.number}`];
  const opened = Date.parse(issue.ghCreatedAt);

  if (!Number.isNaN(opened)) parts.push(`opened ${age(nowSeconds - opened / 1000)} ago`);
  if (issue.authorLogin !== null) parts.push(`by ${issue.authorLogin}`);

  // `opened … by …` is one phrase, the mockup's, so the two join with a space when both are
  // present; the number joins the rest with the mockup's separator.
  const [number, ...rest] = parts;

  return rest.length === 0 ? number! : `${number} · ${rest.join(" ")}`;
}

/* ------------------------------------------------------------------ the excerpt */

/**
 * How much of the body the excerpt shows before it is cut, in characters.
 *
 * Generous enough that every seeded body — the mockup's own `#485` paragraph included — is
 * drawn whole, and short enough that a GitHub issue with a template's worth of headings does
 * not push the breakdown off the panel.
 */
export const EXCERPT_LIMIT = 320;

/** What the excerpt says for an issue opened with a title and no description. */
export const NO_BODY = "No description on GitHub — the issue was opened with a title alone.";

/** The affordance under a cut excerpt. */
export const READ_MORE = "Read more";

/** The affordance under a body drawn in full, after the excerpt was expanded. */
export const SHOW_LESS = "Show less";

/**
 * The body, cut for the `.panel-body-excerpt` treatment.
 *
 * Cut at the last whitespace before {@link EXCERPT_LIMIT}, so a word is never split, and never
 * earlier than half of it, so a body that is one long token is still cut somewhere. The ellipsis
 * is the panel's own mark that something was left out.
 *
 * @param body The description as GitHub stores it — raw Markdown, untruncated.
 * @returns The text to draw, and whether anything was cut.
 */
export function excerpt(body: string): { readonly text: string; readonly truncated: boolean } {
  const trimmed = body.trim();
  if (trimmed.length <= EXCERPT_LIMIT) return { text: trimmed, truncated: false };

  const head = trimmed.slice(0, EXCERPT_LIMIT);
  const boundary = head.search(/\s\S*$/);
  const cut = boundary >= EXCERPT_LIMIT / 2 ? head.slice(0, boundary) : head;

  return { text: `${cut.trimEnd()}…`, truncated: true };
}

/**
 * The excerpt as the mockup draws it: a quotation, in curly quotes the panel supplies rather
 * than characters GitHub holds.
 *
 * @param text The excerpt's text.
 * @returns `“…”`.
 */
export function quoted(text: string): string {
  return `“${text}”`;
}

/* ------------------------------------------------------------------ the breakdown */

/** The section's eyebrow, verbatim from the mockup. */
export const BREAKDOWN_EYEBROW = "AI Work Breakdown";

/** The file list's caption, verbatim from the mockup. */
export const FILES_LABEL = "Estimated files touched";

/**
 * What the rule engine calls itself in every trace it writes — the contract's own spelling,
 * held to `ouroboros-rest/openapi.yaml` by the suite. The one estimator whose empty file list
 * means *cannot know* rather than *none*.
 */
export const HEURISTIC_ESTIMATOR = "heuristic-v0";

/** What stands where the file list would be, for an estimate the rule engine wrote. */
export const FILES_PENDING_NOTE =
  "The file estimate arrives with the full estimator — heuristic-v0 sizes from the issue's " +
  "words and names no files.";

/** What stands there for any other estimator that named none — a real answer. */
export const NO_FILES_NOTE = "This estimate names no files.";

/**
 * What to say for an empty file list.
 *
 * @param estimator The trace's `estimator`.
 * @returns {@link FILES_PENDING_NOTE} for the rule engine, which cannot name files, else
 *   {@link NO_FILES_NOTE}, which is an estimator saying it found none.
 */
export function filesNote(estimator: string): string {
  return estimator === HEURISTIC_ESTIMATOR ? FILES_PENDING_NOTE : NO_FILES_NOTE;
}

/** The three `.breakdown-row` keys, verbatim from the mockup. */
export const ROW_LABELS = {
  tokens: "Est. tokens",
  cycle: "Est. cycle time",
  effort: "Effort",
} as const;

/**
 * A count of tokens, compacted and without a decimal — `180k`, `1.2M`, `900`.
 *
 * `compactNumber` always keeps one decimal once it compacts, so a stat row does not shuffle;
 * a token estimate is a round figure by nature, and `180.0k` would be a precision nobody
 * measured. The decimal stays only when it is not zero.
 *
 * @param tokens How many.
 * @returns The figure.
 */
function tokenFigure(tokens: number): string {
  return compactNumber(tokens).replace(/\.0(?=[kMBT]$)/, "");
}

/**
 * The *Est. tokens* row — `~180k`, the mockup's own spelling of an estimate.
 *
 * @param estTokens The breakdown's `estTokens`.
 * @returns The figure with the tilde that says it is an estimate.
 */
export function tokensLabel(estTokens: number): string {
  return `~${tokenFigure(estTokens)}`;
}

/**
 * The *Est. cycle time* row — `12–18 min`, with the mockup's en dash.
 *
 * @param cycleMin The optimistic end, in minutes.
 * @param cycleMax The pessimistic end, in minutes.
 * @returns The range, or the one figure when the two ends agree.
 */
export function cycleLabel(cycleMin: number, cycleMax: number): string {
  const low = Math.round(cycleMin);
  const high = Math.round(cycleMax);

  return low === high ? `${low} min` : `${low}–${high} min`;
}

/**
 * The figure beside the *Effort* chip — `conf 92%`.
 *
 * @param confidence The estimate's `confidence`, `0`–`100`.
 * @returns The mockup's phrase over the rounded figure.
 */
export function confidenceLabel(confidence: number): string {
  return `conf ${Math.round(confidence)}%`;
}

/** The regression-risk caption, verbatim from the mockup. */
export const RISK_LABEL = "Regression risk";

/** The contract's three risk levels. */
export type Risk = IssueEstimateDetail["risk"];

/** The hue each level takes — the ticket's map: ok, warn, err. */
export const RISK_TONE: Record<Risk, MeterTone> = {
  low: "ok",
  medium: "warn",
  high: "err",
};

/**
 * How much of the meter each level fills. `low` is the mockup's own `22%`; the other two step
 * up from it so the three are told apart by length as well as by hue, for a reader who cannot
 * separate the hues.
 */
export const RISK_FILL: Record<Risk, number> = {
  low: 0.22,
  medium: 0.55,
  high: 0.88,
};

/* ------------------------------------------------------------------ the actions */

/** The primary action, verbatim from the mockup — M.3 with a selection of one. */
export const QUEUE_ONE_LABEL = "Queue for loop";

/** The second action, verbatim — L.4's single re-estimate. */
export const REESTIMATE_ONE_LABEL = "Re-estimate";

/** The third, verbatim — the issue's own `ghUrl`, in a new tab. */
export const OPEN_ON_GITHUB_LABEL = "Open on GitHub ↗";

/** Why **Queue for loop** is inert on an issue the queue already holds. */
export const QUEUE_ALREADY_QUEUED = "This issue is already in the queue.";

/**
 * Why **Queue for loop** is inert on an issue that is not `sized`, by the state it is in —
 * the same three sentences the selection bar's refusal dialog prints for the same three
 * facts, so a press that went around the tooltip is refused in the words the tooltip used.
 */
export const QUEUE_NOT_SIZED: Record<Exclude<BacklogIssueDetail["sizingStatus"], "sized">, string> = {
  unsized: "This issue has not been sized yet — the loop takes sized issues only.",
  estimating: "This issue is still being sized — the loop takes sized issues only.",
  needs_human: "This issue needs a human before it can be queued.",
};

/**
 * Why **Queue for loop** cannot act, if it cannot.
 *
 * **The role comes first**, for the reason the head's button gives: a viewer would be refused
 * whatever the issue's state, and naming the state would send them to wait for a change that
 * ends in that refusal.
 *
 * @param issue Where the issue is, and whether the queue holds it.
 * @param mayContribute Whether this reader's role may queue.
 * @returns The reason, or `undefined` when the button may be pressed.
 */
export function queueOneReason(
  issue: Pick<BacklogIssueDetail, "sizingStatus" | "queued">,
  mayContribute: boolean,
): string | undefined {
  if (!mayContribute) return QUEUE_ROLE_REASON;
  if (issue.queued) return QUEUE_ALREADY_QUEUED;
  if (issue.sizingStatus !== "sized") return QUEUE_NOT_SIZED[issue.sizingStatus];
  return undefined;
}

/** Why a viewer's **Re-estimate** is inert. A `403` for a press that went around it says the same. */
export const REESTIMATE_ONE_ROLE_REASON =
  "Re-estimating an issue is for workspace owners, admins and members — a viewer can read the " +
  "backlog but not spend the workspace's estimates.";

/** Why **Re-estimate** is inert while an estimate is already in flight. */
export const REESTIMATE_ONE_BUSY = "This issue is being estimated now — the panel follows it.";

/**
 * Why **Re-estimate** cannot act, if it cannot. The role first, for {@link queueOneReason}'s
 * reason.
 *
 * @param sizingStatus Where the issue is.
 * @param mayContribute Whether this reader's role may re-estimate one issue.
 * @returns The reason, or `undefined` when the button may be pressed.
 */
export function reestimateOneReason(
  sizingStatus: BacklogIssueDetail["sizingStatus"],
  mayContribute: boolean,
): string | undefined {
  if (!mayContribute) return REESTIMATE_ONE_ROLE_REASON;
  if (sizingStatus === "estimating") return REESTIMATE_ONE_BUSY;
  return undefined;
}

/** Why **Open on GitHub ↗** is inert when the address the service sent is not a web address. */
export const OPEN_ON_GITHUB_UNLINKED = "This issue's GitHub address could not be read.";

/**
 * The address behind **Open on GitHub ↗**, if it is one a link may carry.
 *
 * The contract promises an `https` URI, and this is the boundary where that promise is
 * checked rather than trusted: a value that is not a web address — whatever answered on that
 * wire — is not put into an `href`, because an anchor is the one element that turns a string
 * into an action.
 *
 * @param url The issue's `ghUrl`, as it arrived.
 * @returns The address, or `null` when it is not a web address.
 */
export function githubHref(url: string): string | null {
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

/** What a **Re-estimate** press that took says. */
export const REESTIMATE_ONE_STARTED =
  "Sizing again. The breakdown lands here when the estimator answers.";

/** What a press on an issue this workspace no longer has says. */
export const REESTIMATE_ONE_NOT_FOUND = "This issue is not in this workspace any more.";

/** What a refused press says when the service gave no sentence of its own. */
export const REESTIMATE_ONE_FAILED = "The issue could not be re-estimated.";

/**
 * What a **Re-estimate** press that took says, from what the service answered.
 *
 * @param accepted The service's answer — the issue, in `estimating`.
 * @returns {@link REESTIMATE_ONE_STARTED}. The answer's status is already true when it is sent,
 *   so there is nothing in it to qualify the sentence with; what the panel draws next is the
 *   poll's business.
 */
export function estimationOutcome(accepted: EstimationAccepted): HeadOutcome {
  void accepted;

  return { ok: true, message: REESTIMATE_ONE_STARTED };
}

/* ------------------------------------------------------------------ the trace */

/** The collapsible's summary, verbatim from the mockup. */
export const TRACE_LABEL = "Estimation trace";

/**
 * The trace's first line — `sized by heuristic-v0 · 2m ago`, the mockup's phrase over the
 * trace's own fields.
 *
 * @param trace Where the estimate came from.
 * @param version Which estimate of the issue this is.
 * @param nowSeconds What time it is, in whole seconds since the epoch — the reader's clock.
 * @returns The line: the estimator's own name, how long ago it sized the issue, the tokens it
 *   spent only when it spent any — a rule engine spends none, and `0 tokens` would dress an
 *   absence as a measurement — and the version only past the first, since a re-estimated
 *   issue is the one whose version is worth saying.
 */
export function provenanceLine(
  trace: IssueEstimateTrace,
  version: number,
  nowSeconds: number,
): string {
  const parts = [`sized by ${trace.estimator}`];
  const sized = Date.parse(trace.sizedAt);

  if (!Number.isNaN(sized)) parts.push(`${age(nowSeconds - sized / 1000)} ago`);
  if (trace.tokensUsed > 0) parts.push(`${tokenFigure(trace.tokensUsed)} tokens`);
  if (version > 1) parts.push(`v${version}`);

  return parts.join(" · ");
}

/** The signals line for a trace that recorded none — the rule engine's honest answer. */
export const NO_SIGNALS = "signals: none recorded by this estimator";

/**
 * The trace's *signals:* line, from the signals it actually recorded.
 *
 * @param signals The trace's `signals`, one line each.
 * @returns `signals: label-map · title-verb`, or {@link NO_SIGNALS} for an empty list.
 */
export function signalsLine(signals: readonly string[]): string {
  return signals.length === 0 ? NO_SIGNALS : `signals: ${signals.join(" · ")}`;
}

/**
 * The line a `needs_human` trace opens with — why a person is deciding.
 *
 * @param estimate The estimate that sent the issue there, or `null` when the estimator
 *   produced none.
 * @returns The low-confidence sentence over the estimate's own figure, or the failure sentence.
 */
export function needsHumanLine(estimate: IssueEstimateDetail | null): string {
  return estimate === null
    ? "needs a human: the estimator produced no estimate for this issue"
    : `needs a human: confidence ${Math.round(estimate.confidence)}% was under the floor for a sized estimate`;
}

/* ------------------------------------------------------------------ the states */

/** What the panel says over an issue nothing has sized yet. */
export const FIRST_ESTIMATE_PENDING = "First estimate pending";

/** The note under {@link FIRST_ESTIMATE_PENDING}. */
export const FIRST_ESTIMATE_NOTE =
  "Ouroboros sizes every issue it mirrors; this one has not been picked up yet. Re-estimate " +
  "asks for it now.";

/** What the panel says while the estimator is working. */
export const SIZING_NOW = "Sizing now";

/** The note under {@link SIZING_NOW}. */
export const SIZING_NOW_NOTE = "The breakdown lands here when the estimator answers — no reload needed.";

/** What the panel says over an issue sent to a person with no estimate to show. */
export const NEEDS_HUMAN_TITLE = "Needs a human";

/**
 * Which of the four sizing states the panel is in — the ticket's four, and the four the
 * contract's `sizingStatus` names.
 */
export type PanelState = BacklogIssueDetail["sizingStatus"];

/**
 * Which state an answer is in.
 *
 * `sizingStatus` decides, with one guard: a `sized` issue whose estimate is `null` cannot
 * happen through the pipeline, and a panel that drew a breakdown skeleton over *sized* would
 * be the one dishonest state, so it is drawn as `unsized` — the issue's content and the
 * pending note, which is what is actually known.
 *
 * @param detail The answer.
 * @returns The state to draw.
 */
export function panelState(detail: IssueDetail): PanelState {
  const { sizingStatus } = detail.issue;

  return sizingStatus === "sized" && detail.estimate === null ? "unsized" : sizingStatus;
}
