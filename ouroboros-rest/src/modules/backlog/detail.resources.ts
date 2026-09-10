/**
 * One issue, in full — as mockup 03's `ISSUE DETAIL` panel reads it
 * (M.2, [#111](https://github.com/NobuData/ouroboros/issues/111)).
 *
 * Three shapes in one answer, and they are the panel top to bottom: the meta line, title, tags
 * and body excerpt come from {@link IssueDetail.issue}; *AI Work Breakdown*, the risk meter, the
 * workflow and model tags and the collapsible *Estimation trace* come from
 * {@link IssueDetail.estimate}; and {@link IssueDetail.history} is the version list nothing draws
 * yet.
 *
 * ## Why this is not the listing with more columns
 *
 * `listing.resources.ts` says what a backlog row deliberately does not carry — *"no body, no
 * author and no `gh_url` here — those are the side panel's, and M.2 serves them for the one
 * issue that is open rather than for every row of a page nobody has clicked"*. This is the
 * other side of that sentence. The listing pays for nine rows of cells; this pays, once, for
 * the panel a person actually opened.
 *
 * ## The panel's head and the table's row are the same nine fields, by construction
 *
 * {@link BacklogIssueDetail} extends `BacklogRow` minus its estimate rather than restating it,
 * so `#485`'s number, title, labels, state and status mean here exactly what they mean in the
 * row the panel was opened from. A field spelled twice is a field that can be spelled
 * differently, and a panel head disagreeing with the row behind it is the bug that would
 * follow.
 *
 * The ninth arrived that way and is the point being made: M.3
 * ([#112](https://github.com/NobuData/ouroboros/issues/112)) added `queued` to the row, and the
 * panel — whose **Queue for loop** button is one of the three that call that endpoint — got it
 * without this file being asked to.
 *
 * Its own four additions are exactly the ticket's: {@link BacklogIssueDetail.body} for the
 * `.panel-body-excerpt`, {@link BacklogIssueDetail.authorLogin} and
 * {@link BacklogIssueDetail.ghCreatedAt} for *"#485 · opened 2d ago by field-support"*, and
 * {@link BacklogIssueDetail.ghUrl} for **Open on GitHub ↗**. There is no `ghUpdatedAt`, for
 * `listing.resources.ts`' reason: the panel has nowhere to print one, and a field added for a
 * cell that does not exist is a field this endpoint would then have to keep.
 *
 * ## The estimate is one object or nothing — the listing's contract, one level deeper
 *
 * An issue has a latest estimate or it has none, which is the ticket's *"unsized issues return
 * the issue-only shape … rather than a 404 or a null-riddled estimate object"*. `#483` is that
 * fixture: `estimating`, and no `issue_estimates` row at all. It answers `estimate: null` and
 * `history: []`, and every other field of the panel is still there to draw.
 *
 * ## The estimate and the history are the *same* rows, so they cannot disagree
 *
 * Both are built here from one list — see {@link issueDetail} — which is `listing.resources.ts`'
 * argument about the page head applied to a smaller pair: an `estimate` read in one statement
 * and a `history` read in another would eventually answer a panel whose trace names version 3
 * over a history that ends at 2, because a re-estimation landed between the two reads.
 *
 * ## The names change case here and only here
 *
 * `breakdown` and `trace` are stored in the **database's** `snake_case` — `est_tokens`,
 * `sized_at` — because `ouroboros.issue_estimate_breakdown_valid()` checks those keys by name
 * (see `db/schema.ts`). This API is `camelCase` like every other resource in it, so the two
 * documents are translated field by field below rather than published raw. It is the mirror of
 * `estimation/estimation.outcome.ts`, which does the same translation in the writing direction.
 */

import type {
  EstimateBreakdownDocument,
  EstimateEffort,
  EstimateRisk,
  EstimateTraceDocument,
} from "../db/schema";
import type { BacklogRow } from "./listing.resources";
import type { IssueDetailRow, IssueEstimateRow } from "./detail.repository";

/**
 * The issue as the panel's head, tags and excerpt read it.
 *
 * The table's row without its summary estimate, plus the four fields the panel draws and the
 * table does not — see this file's header on why it is an extension rather than a restatement.
 */
export interface BacklogIssueDetail extends Omit<BacklogRow, "estimate"> {
  /**
   * GitHub's description, **raw and in full** — the `.panel-body-excerpt`.
   *
   * Untruncated on purpose, which is the ticket's own word: *"the client truncates for the
   * `.panel-body-excerpt` treatment"*. A server-side cut would decide a line count for a panel
   * whose width it cannot see, and would make *"read more"* a second request.
   *
   * Unrendered, too: this is Markdown as GitHub stores it, and turning it into HTML here would
   * be this service authoring markup a browser then has to be trusted with. `null` for an issue
   * opened with no description at all — the seeded `#488` is that row.
   */
  readonly body: string | null;
  /**
   * Who opened it — the `by field-support` of the meta line.
   *
   * GitHub's login in the case GitHub returns it, unfolded (decision **K3**: a mirror, never
   * edited here). `null` when GitHub's author is, which is what an issue whose author deleted
   * their account comes back as.
   */
  readonly authorLogin: string | null;
  /**
   * When GitHub says the issue was opened — what *"opened 2d ago"* counts from.
   *
   * The instant rather than the phrase: *2d ago* is a rendering that depends on when the panel
   * is looked at, and a server that computed it would be publishing a string that is wrong one
   * minute after it was sent.
   */
  readonly ghCreatedAt: string;
  /** The issue on GitHub — the href behind **Open on GitHub ↗**. Always `https`, by constraint. */
  readonly ghUrl: string;
}

/** The *AI Work Breakdown* panel's numbers, in this API's names. */
export interface IssueEstimateBreakdown {
  /**
   * Paths the work is believed to touch — the `.file-list`.
   *
   * Empty is a real answer rather than a gap: the seeded `#488` is a documentation sweep whose
   * estimator named no file, and V026 makes the empty list valid on purpose.
   */
  readonly files: readonly string[];
  /** What the *work* is expected to cost in model tokens — the `Est. tokens` row. Not what sizing cost. */
  readonly estTokens: number;
  /** The optimistic end of `Est. cycle time`, in minutes. Never above {@link cycleMax}. */
  readonly cycleMin: number;
  /** The pessimistic end, in minutes. */
  readonly cycleMax: number;
  /**
   * The single number M.3's queue write plans with, in minutes.
   *
   * Deliberately **not** confined to the range above, which `R__dev_seed_intake.sql` spells out:
   * `#485` is *12–18 min* of cycle time and 45 minutes of work. The range is how long one loop
   * takes; this is what the whole issue costs.
   */
  readonly estMinutes: number;
}

/** Where the estimate came from — the collapsible *Estimation trace* (decision **K10**). */
export interface IssueEstimateTrace {
  /**
   * What produced it — `heuristic-v0` for every estimate v0 writes, and the mockup's *sized by
   * claude-sonnet-5* only once a model sizes anything (O.2,
   * [#123](https://github.com/NobuData/ouroboros/issues/123)).
   *
   * Never blank: `issue_estimates_provenance` is decision K10 as a constraint, so an estimate
   * that cannot say what produced it does not get to exist. That is the ticket's *"the trace's
   * `estimator` is present and reflects reality"* — present because the database refuses the
   * alternative, and real because nothing here invents a nicer one.
   */
  readonly estimator: string;
  /**
   * When the estimate was produced — the trace line's *2m ago*.
   *
   * The estimator's instant rather than the row's: `db/schema.ts` keeps `trace.sized_at` and
   * `created_at` apart deliberately, and they are the same only for a synchronous estimate.
   * {@link EstimateVersion.createdAt} is the other one, and history is where it is published.
   */
  readonly sizedAt: string;
  /** What producing the estimate cost in model tokens — the trace line's *41k tokens*. `0` for a rule engine. */
  readonly tokensUsed: number;
  /**
   * What the answer was reached from, one line each — the trace's *signals:* line.
   *
   * Empty rather than absent, and empty is what `heuristic-v0` answers: the seed's header calls
   * this the sharpest edge of K10, because a signal nothing produced would be a provenance this
   * service made up.
   */
  readonly signals: readonly string[];
}

/** The estimate in force, in full — everything the panel draws below the excerpt. */
export interface IssueEstimateDetail {
  /**
   * Which estimate of this issue this is — the highest version, which is the one in force
   * (decision **K4**).
   *
   * Carried so a client holding both halves of this answer can say *which* entry of
   * {@link IssueDetail.history} it is looking at, without inferring it from the list's order.
   */
  readonly version: number;
  /** The *Effort* chip — `xs`–`xl`, lower-case as the column holds it. */
  readonly effort: EstimateEffort;
  /** The `conf 92%` beside it, 0–100. */
  readonly confidence: number;
  /** The *Suggested workflow* tag. Opaque (decision **K5**). */
  readonly suggestedWorkflow: string;
  /** The *Routed model* pill. Opaque (decision **K6**), and resolved rather than invoked. */
  readonly routedModel: string;
  /** The *AI Work Breakdown* numbers. */
  readonly breakdown: IssueEstimateBreakdown;
  /** The regression-risk meter's three colours. */
  readonly risk: EstimateRisk;
  /** The sentence under the meter, saying why. Never blank, by constraint. */
  readonly riskNote: string;
  /** The collapsible trace. */
  readonly trace: IssueEstimateTrace;
}

/**
 * One entry of the version list — what the ticket calls the *estimate history summary*.
 *
 * Three fields and no more, deliberately: this is *"cheap to include, and it makes a future
 * history view a UI-only change"*, and a summary that carried every superseded breakdown would
 * be neither. A view that wants a superseded estimate in full is a ticket, and it has a version
 * number to ask with.
 */
export interface EstimateVersion {
  /** Which estimate of the issue this was. Monotonic within the issue; gaps are legal. */
  readonly version: number;
  /** What produced it — see {@link IssueEstimateTrace.estimator}. */
  readonly estimator: string;
  /**
   * When the **row** was written.
   *
   * `issue_estimates.created_at`, which is not `trace.sized_at` — see
   * {@link IssueEstimateTrace.sizedAt}. This is the one a history view orders and dates by,
   * because it is the instant this service observed the estimate rather than the instant an
   * estimator claims to have produced it.
   */
  readonly createdAt: string;
}

/** `GET /api/v1/backlog/{id}` — the panel, in one answer. */
export interface IssueDetail {
  /** The meta line, the title, the tags and the excerpt. Always present. */
  readonly issue: BacklogIssueDetail;
  /**
   * The estimate in force, or `null` for an issue that has none.
   *
   * `null` is a state the panel renders — N.5
   * ([#119](https://github.com/NobuData/ouroboros/issues/119))'s no-estimate state — rather than
   * a failure. See this file's header.
   */
  readonly estimate: IssueEstimateDetail | null;
  /**
   * Every estimate this issue has had, **oldest first**.
   *
   * Ascending because that is how a history reads and how the ticket asks for it, and because
   * the entry a reader most often wants — the one in force — is then the last, beside the
   * `estimate` above it. `[]` for an issue that has never been sized, which is the same fact
   * `estimate: null` states.
   *
   * **Uncapped, deliberately.** A version exists only because somebody asked for a re-estimate —
   * decision **K4**, and L.4's rate limiter bounds how fast they can — so the list is short for
   * every issue this product expects to have. A cap would be the one thing that could make the
   * ticket's *oldest→newest* untrue, and a page a client cannot ask for a second page of is
   * worse than a long list; if a workspace ever makes this real, a windowed history is its own
   * ticket and has a `version` to page from.
   */
  readonly history: readonly EstimateVersion[];
}

/**
 * The panel, from the issue and its estimates.
 *
 * A pure function over what the two statements returned, for `listing.resources.ts`' reason:
 * the mapping is the contract, and a contract worth testing is worth testing without a
 * database.
 *
 * @param row - The issue, already scoped to the workspace by the statement that read it.
 * @param versions - Every estimate of that issue, oldest first. Empty for an unsized issue.
 * @returns The panel. `estimate` is the highest version among `versions` — decision K4's
 *   latest-wins, asserted here rather than assumed from the order the rows arrived in.
 */
export function issueDetail(
  row: IssueDetailRow,
  versions: readonly IssueEstimateRow[],
): IssueDetail {
  const inForce = latest(versions);

  return {
    issue: detailIssue(row),
    estimate: inForce === undefined ? null : estimateDetail(inForce),
    history: versions.map(estimateVersion),
  };
}

/**
 * The estimate in force — the highest version.
 *
 * Decision **K4** in one function: re-estimation writes a new row and the highest version wins.
 * Computed rather than taken from the end of the list, so the rule is stated in one place and
 * does not quietly become *"whatever the statement ordered last"* — the seeded `#487` carries
 * two versions whose every visible field differs, and it is the fixture that tells the two
 * readings apart.
 *
 * @param versions - Every estimate of one issue, in any order.
 * @returns The one in force, or `undefined` when the issue has never been sized.
 */
function latest(versions: readonly IssueEstimateRow[]): IssueEstimateRow | undefined {
  return versions.reduce<IssueEstimateRow | undefined>(
    (highest, candidate) =>
      highest === undefined || candidate.version > highest.version ? candidate : highest,
    undefined,
  );
}

/**
 * The issue half, JSON-safe.
 *
 * @param row - The joined issue and its repository.
 * @returns The panel's head, tags and excerpt.
 */
function detailIssue(row: IssueDetailRow): BacklogIssueDetail {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    labels: row.labels,
    state: row.state,
    sizingStatus: row.sizingStatus,
    queued: row.queued,
    githubRepoId: row.githubRepoId,
    repository: row.repository,
    body: row.body,
    authorLogin: row.authorLogin,
    ghCreatedAt: row.ghCreatedAt.toISOString(),
    ghUrl: row.ghUrl,
  };
}

/**
 * One estimate row, in full — the two stored documents translated into this API's names.
 *
 * @param row - The estimate, with `breakdown` and `trace` already parsed by the driver.
 * @returns Everything the panel draws below the excerpt.
 */
function estimateDetail(row: IssueEstimateRow): IssueEstimateDetail {
  return {
    version: row.version,
    effort: row.effort,
    confidence: row.confidence,
    suggestedWorkflow: row.suggestedWorkflow,
    routedModel: row.routedModel,
    breakdown: breakdownOf(row.breakdown),
    risk: row.risk,
    riskNote: row.riskNote,
    trace: traceOf(row.trace),
  };
}

/**
 * The stored breakdown document, in this API's names.
 *
 * Field by field rather than by a generic key rewrite, so the two vocabularies are legible side
 * by side and a key added to V026 is a compile error here rather than a field that silently
 * appears in a client's payload.
 *
 * @param document - `issue_estimates.breakdown`, as `pg` parsed it.
 * @returns The *AI Work Breakdown* numbers.
 */
function breakdownOf(document: EstimateBreakdownDocument): IssueEstimateBreakdown {
  return {
    files: document.files,
    estTokens: document.est_tokens,
    cycleMin: document.cycle_min,
    cycleMax: document.cycle_max,
    estMinutes: document.est_minutes,
  };
}

/**
 * The stored trace document, in this API's names.
 *
 * @param document - `issue_estimates.trace`, as `pg` parsed it.
 * @returns The *Estimation trace*. `sizedAt` is carried through as the stored string: V026
 *   checks its shape by regex against exactly what `Date.toISOString()` produces, so parsing it
 *   into a `Date` and back would be a round trip that can only lose.
 */
function traceOf(document: EstimateTraceDocument): IssueEstimateTrace {
  return {
    estimator: document.estimator,
    sizedAt: document.sized_at,
    tokensUsed: document.tokens_used,
    signals: document.signals,
  };
}

/**
 * One history entry, from the estimate row it summarises.
 *
 * @param row - The estimate.
 * @returns The version, what produced it, and when the row was written.
 */
function estimateVersion(row: IssueEstimateRow): EstimateVersion {
  return {
    version: row.version,
    estimator: row.trace.estimator,
    createdAt: row.createdAt.toISOString(),
  };
}
