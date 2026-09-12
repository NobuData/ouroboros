/**
 * The seeded volume M.5's matrix reads, and what the backlog API must answer about it
 * ([#114](https://github.com/NobuData/ouroboros/issues/114)).
 *
 * `intake.fixture.ts` is mockup 03 as rows — nine issues, hand-chosen, each one carrying an
 * argument. It is the right fixture for *"does this endpoint reproduce the screen"*, and it is
 * the wrong one for *"does every combination of five parameters answer correctly"*: nine rows
 * fit in one page, so paging is invisible; the chip set is small enough that an AND and an OR
 * often coincide; and a leak across a tenant boundary shows up as a row or two that a reader
 * may not notice among the nine they expected.
 *
 * So this file is the other half — a **generated** population, large enough that the filter bar
 * is doing work, and described completely enough in TypeScript that the expected answer to any
 * request is *computed* rather than written down.
 *
 * ---------------------------------------------------------------------------
 * ## The expectation is a model, not a list of numbers
 *
 * A matrix test written the usual way — a table of `{query, expectedNumbers}` — is a second
 * copy of the answer, and when the population changes by one row every cell of it is wrong.
 * Worse, the numbers get filled in from a run, so the test records what the endpoint *did*
 * rather than what it *should have done*, and a wrong answer becomes the expectation.
 *
 * {@link volumeMatching}, {@link volumeOrdered} and {@link volumeFacets} are the alternative:
 * a plain, slow, obviously-correct restatement of the endpoint's own rules over the model
 * above, which the suite runs to derive what the request should have answered. It is
 * deliberately *not* the implementation — the implementation is SQL over indexes, and this is
 * an array filter — so the two agreeing is worth something. Where they can only agree by
 * coincidence, the comments below say so.
 *
 * ---------------------------------------------------------------------------
 * ## Why the generator is arithmetic
 *
 * Every attribute is a function of the row's index through a different modulus — the kind label
 * by 3, the area by 4, the state by 4, the sizing status by 10, the effort by 5, the chip
 * extras by 5 and 7. Co-prime strides mean a two-label AND is a *proper* subset of either
 * label's own rows rather than equal to one of them, which is the difference an OR written in
 * place of the AND would otherwise hide, and no combination in the matrix comes out empty by
 * accident.
 *
 * The whole population is a pure function of its options, so the model and the rows in the
 * database cannot disagree about what was seeded.
 *
 * ## The orders are total without reaching for the row id
 *
 * `BacklogListingRepository.list` breaks ties with `number desc` and then `id asc`. Issue
 * numbers are unique within a workspace here — the two populations take disjoint bands — so
 * `number desc` settles every tie and the model never needs an id it could not know. The one
 * place that could still be decided by a clock is `sort=updated`: {@link volumePopulation}
 * gives each population its own band of `gh_updated_at` (see `clockOffsetMinutes`) so that two
 * rows from two `insert` statements, whose `now()` differ by a millisecond or two, are never
 * within a tie of each other.
 *
 * ```ts
 * const owner = await api.signIn();
 * const workspace = await workspaceWithRepo(api, owner);
 * await seedVolume(api, workspace, PRIMARY_VOLUME);
 * ```
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import { SCHEMA_NAME } from "../modules/db/schema";
import type { SeededWorkspace } from "./dashboard.fixture";
import type { ApiHarness } from "./harness.fixture";

/** The estimate in force on a volume issue, as the listing and the panel publish it. */
export interface VolumeEstimate {
  /** Which estimate of the issue this is. Only {@link VolumeIssue.superseded} rows have a 2. */
  readonly version: number;
  readonly effort: "xs" | "s" | "m" | "l" | "xl";
  readonly confidence: number;
  /**
   * One of `workflows/registry.service.ts`' `BOOTSTRAP_WORKFLOW_SLUGS`, so the queue write can
   * take it as-is: a volume workspace has no workflow entities, which is what that vocabulary
   * is the answer for.
   */
  readonly suggestedWorkflow: string;
  readonly routedModel: string;
  /** What `queue_items.est_minutes` is copied from — never recomputed. */
  readonly estMinutes: number;
  readonly risk: "low" | "medium" | "high";
  /** How long ago it was produced, for `trace.sized_at` and the row's `created_at`. */
  readonly sizedMinutesAgo: number;
}

/** One generated issue, with every column the backlog API reads off it. */
export interface VolumeIssue {
  /** GitHub's number, unique within the repository and — in this fixture — the workspace. */
  readonly number: number;
  readonly title: string;
  /** GitHub's label names, in the order they are stored. */
  readonly labels: readonly string[];
  readonly author: string;
  /** `null` for an issue opened without a description, which is a shape the panel must render. */
  readonly body: string | null;
  readonly state: "open" | "closed";
  readonly sizingStatus: "unsized" | "estimating" | "sized" | "needs_human";
  /** How long ago GitHub says it was opened. Always well before {@link updatedMinutesAgo}. */
  readonly openedHoursAgo: number;
  /** How long ago GitHub last touched it — distinct across the whole workspace. */
  readonly updatedMinutesAgo: number;
  /** The estimate in force, or `null` for an issue that has none. */
  readonly estimate: VolumeEstimate | null;
  /**
   * The estimate this one replaced, for the few issues estimated twice.
   *
   * Every visible field differs from {@link estimate}'s, which is what makes *latest wins* an
   * assertion rather than a coincidence — a join that took an arbitrary row would answer this
   * one about half the time.
   */
  readonly superseded: VolumeEstimate | null;
}

/** The three labels that say what kind of change an issue is — one per issue, by `index % 3`. */
const KIND_LABELS = ["bug", "enhancement", "docs"] as const;

/** The four that say where it lands — one per issue, by `index % 4`. */
const AREA_LABELS = ["telemetry", "motor-control", "i2c", "ble"] as const;

/** Carried by every seventh issue, so `bug` + this is a proper subset of `bug`. */
const PRIORITY_LABEL = "priority-high";

/** Carried by every fifth, for a second AND that overlaps the first without coinciding. */
const DEBT_LABEL = "tech-debt";

/** The six subjects titles are built from — `index % 6`, so a topic search matches one in six. */
const TOPICS = [
  "Watchdog reset on bus lockup",
  "Motor PID integral windup",
  "Telemetry frame drops under load",
  "Battery health over GATT",
  "OTA rollback leaves a stale slot",
  "Arbitration storm on the drive bus",
] as const;

/**
 * The two titles that exist to prove the search box escapes what a person typed.
 *
 * `listing.search.ts` escapes `%` before it wraps the term in `%…%`, and the only way to see
 * that from outside is a population where the unescaped reading matches something extra:
 * `q=100%` must find the first of these and not the second, while `q=100` finds both. They are
 * given to two adjacent indices so that neither is a closed issue and both carry estimates.
 */
const WILDCARD_TITLES: ReadonlyMap<number, string> = new Map([
  [4, "Charge controller pegs at 100% duty cycle"],
  [5, "Charge controller settles after 100 ms"],
]);

/** Who filed it — `renovate[bot]` included, which is the login V028 widened the column for. */
const AUTHORS = ["jorge-reyes", "field-support", "renovate[bot]", "mei-tanaka"] as const;

/** The effort chips, in the order `array_position` ranks them. */
const EFFORTS = ["xs", "s", "m", "l", "xl"] as const;

/** The workflow tags an estimate may suggest — `estimation.context.ts`' fixed four. */
const WORKFLOWS = ["standard-fix", "docs-loop", "feature-loop", "deps-refresh"] as const;

/** What the estimator routed to. Opaque text by decision K6; three is enough to vary it. */
const MODELS = ["claude-sonnet-4-6", "gpt-5-mini", "llama-4-scout"] as const;

/** The regression-risk meter's three levels. */
const RISKS = ["low", "medium", "high"] as const;

/** How many issues a population holds unless it says otherwise. */
export const VOLUME_SIZE = 120;

/** Where the primary repository's numbers start. */
const PRIMARY_FIRST_NUMBER = 1000;

/** Where the second repository's start — far enough away that no number appears twice. */
const SECOND_FIRST_NUMBER = 2000;

/** How many issues the second repository gets. Smaller, so `?repo=` visibly narrows. */
const SECOND_SIZE = 40;

/** How the second repository's `gh_updated_at` band is separated from the first's. */
const SECOND_CLOCK_OFFSET_MINUTES = 1000;

/** What {@link volumePopulation} may vary. */
export interface VolumeOptions {
  /** How many issues. Defaults to {@link VOLUME_SIZE}. */
  readonly count?: number;
  /** The first issue number; the rest ascend from it by one. */
  readonly firstNumber?: number;
  /**
   * Added to every `updatedMinutesAgo`, moving the whole population into its own band.
   *
   * Two populations seeded by two statements have two `now()`s, a millisecond or so apart. A
   * band keeps rows from different statements further apart than that, so `sort=updated` cannot
   * come down to which `insert` ran first.
   */
  readonly clockOffsetMinutes?: number;
}

/**
 * Generate a population.
 *
 * Pure and total: the same options give the same rows, in this process and in the database.
 *
 * @param options - How many issues, numbered from where, on which clock band.
 * @returns The issues, in ascending number order — which is *not* any of the four sorts.
 */
export function volumePopulation(options: VolumeOptions = {}): readonly VolumeIssue[] {
  const count = options.count ?? VOLUME_SIZE;
  const firstNumber = options.firstNumber ?? PRIMARY_FIRST_NUMBER;
  const clockOffset = options.clockOffsetMinutes ?? 0;

  return Array.from({ length: count }, (_unused, index): VolumeIssue => {
    const sizingStatus = statusAt(index);
    const estimated = sizingStatus === "sized" || sizingStatus === "needs_human";
    // Every twentieth issue, which lands only on `index % 10 === 0` and therefore only on rows
    // that have an estimate at all — so a `superseded` estimate never appears without one in
    // force above it.
    const twice = estimated && index % 20 === 0;

    return {
      number: firstNumber + index,
      title: WILDCARD_TITLES.get(index) ?? TOPICS[index % TOPICS.length],
      labels: labelsAt(index),
      author: AUTHORS[index % AUTHORS.length],
      // Every eleventh issue was opened with no description. A null body is the shape the
      // detail panel has to render without inventing an empty string for it.
      body: index % 11 === 0 ? null : `Seeded volume issue ${firstNumber + index}.`,
      state: index % 4 === 3 ? "closed" : "open",
      sizingStatus,
      openedHoursAgo: 500 + index,
      updatedMinutesAgo: clockOffset + 5 + index * 3,
      estimate: estimated ? estimateAt(index, twice ? 2 : 1) : null,
      superseded: twice ? estimateAt(index, 1) : null,
    };
  });
}

/**
 * Where an issue is in the sizing pipeline.
 *
 * Seven in ten are `sized`; the other three are the three ways an issue is not queueable, and
 * each is here because the queue suite needs one. `needs_human` deliberately *keeps* its
 * estimate and `estimating` deliberately has none, which is the pair that stops either column
 * being derived from the other.
 *
 * @param index - The row's position.
 * @returns The status.
 */
function statusAt(index: number): VolumeIssue["sizingStatus"] {
  switch (index % 10) {
    case 7:
      return "estimating";
    case 8:
      return "needs_human";
    case 9:
      return "unsized";
    default:
      return "sized";
  }
}

/**
 * The labels an issue carries.
 *
 * A kind and an area always, plus `priority-high` on every seventh and `tech-debt` on every
 * fifth. `3`, `4`, `5` and `7` are pairwise co-prime, so `?labels=bug,priority-high` is one
 * issue in twenty-one rather than one in three — which is what makes an AND written as an OR
 * fail loudly.
 *
 * @param index - The row's position.
 * @returns The names, in the order they are stored.
 */
function labelsAt(index: number): readonly string[] {
  return [
    KIND_LABELS[index % KIND_LABELS.length],
    AREA_LABELS[index % AREA_LABELS.length],
    ...(index % 7 === 0 ? [PRIORITY_LABEL] : []),
    ...(index % 5 === 0 ? [DEBT_LABEL] : []),
  ];
}

/**
 * One estimate.
 *
 * **Version 1 and version 2 of the same issue differ in every visible field**, which is the
 * whole point of writing two: effort walks one chip up the scale, confidence moves by twenty,
 * the workflow and the model are the next ones along, and the minutes differ. A latest-wins
 * lateral and a join that takes whichever row it finds first are indistinguishable until that
 * is true.
 *
 * @param index - The issue's position.
 * @param version - Which estimate of it.
 * @returns The estimate.
 */
function estimateAt(index: number, version: number): VolumeEstimate {
  // Version 1 sits one step *behind* version 2 on every axis, so the row in force is never the
  // one a naive join would have picked out of insertion order.
  const step = version === 1 ? 1 : 0;

  return {
    version,
    effort: EFFORTS[(index + step) % EFFORTS.length],
    confidence: 50 + ((index * 7) % 50) - step * 20,
    suggestedWorkflow: WORKFLOWS[(index + step) % WORKFLOWS.length],
    routedModel: MODELS[(index + step) % MODELS.length],
    estMinutes: 30 + (index % 12) * 5 + step * 5,
    risk: RISKS[(index + step) % RISKS.length],
    // Version 1 is older than version 2, as an estimate it preceded must be.
    sizedMinutesAgo: 2 + index + step * 60,
  };
}

/** The population the workspace's primary repository gets. */
export const PRIMARY_VOLUME: readonly VolumeIssue[] = volumePopulation();

/** The smaller one a second repository gets, on its own number band and its own clock band. */
export const SECOND_VOLUME: readonly VolumeIssue[] = volumePopulation({
  count: SECOND_SIZE,
  firstNumber: SECOND_FIRST_NUMBER,
  clockOffsetMinutes: SECOND_CLOCK_OFFSET_MINUTES,
});

/**
 * Write a population into a repository.
 *
 * **Three statements, not three hundred.** `seedIntake` writes its nine rows one at a time and
 * is the clearer file for it; a hundred and twenty round trips per workspace, in a suite that
 * seeds several, is most of this ticket's sixty-second budget spent on `insert`. Each statement
 * here carries its whole batch as one `jsonb` parameter and unpacks it with
 * `jsonb_to_recordset`, which also makes `now()` a single instant across the batch — the thing
 * {@link volumeOrdered} relies on to reproduce `sort=updated` exactly.
 *
 * **The two estimate versions go in two statements**, because V026's monotonicity trigger
 * requires a new version to be above every version the issue already has, and one statement
 * holding both would be asking the trigger to see them in an order `insert … select` does not
 * promise.
 *
 * @param api - The started harness, whose connection writes the rows.
 * @param workspace - Where they go.
 * @param population - Which population — {@link PRIMARY_VOLUME} or {@link SECOND_VOLUME}.
 * @param repoId - Which repository. Defaults to the workspace's own.
 * @returns When every row exists.
 */
export async function seedVolume(
  api: ApiHarness,
  workspace: SeededWorkspace,
  population: readonly VolumeIssue[] = PRIMARY_VOLUME,
  repoId: string = workspace.repoId,
): Promise<void> {
  await api.sql.query(
    `insert into ${SCHEMA_NAME}.github_issues
            (organization_id, github_repo_id, number, title, body, state, labels,
             author_login, gh_created_at, gh_updated_at, gh_url, synced_at, sizing_status)
     select $1, $2::uuid, seed.number, seed.title, seed.body, seed.state, seed.labels,
            seed.author,
            now() - make_interval(hours => seed.opened_hours),
            now() - make_interval(mins => seed.updated_minutes),
            'https://github.com/ouroboros-volume/backlog/issues/' || seed.number::text,
            now() - interval '40 seconds',
            seed.sizing_status
       from jsonb_to_recordset($3::jsonb)
         as seed(number int, title text, body text, state text, labels jsonb, author text,
                 opened_hours int, updated_minutes int, sizing_status text)`,
    [
      workspace.id,
      repoId,
      JSON.stringify(
        population.map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          labels: issue.labels,
          author: issue.author,
          opened_hours: issue.openedHoursAgo,
          updated_minutes: issue.updatedMinutesAgo,
          sizing_status: issue.sizingStatus,
        })),
      ),
    ],
  );

  // Every estimate the population holds, superseded ones included, flattened out of the issues
  // that carry them. Grouped by version below rather than written in one statement, so the
  // monotonicity trigger sees version 1 committed before version 2 is offered to it.
  const estimates = population.flatMap((issue) =>
    issue.estimate === null
      ? []
      : [
          ...(issue.superseded === null ? [] : [{ issue, estimate: issue.superseded }]),
          { issue, estimate: issue.estimate },
        ],
  );

  for (const version of [1, 2]) {
    const batch = estimates.filter((entry) => entry.estimate.version === version);

    if (batch.length === 0) continue;

    await api.sql.query(
      `insert into ${SCHEMA_NAME}.issue_estimates
              (github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
               breakdown, risk, risk_note, trace, created_at)
       select issues.id, seed.version, seed.effort, seed.confidence, seed.suggested_workflow,
              seed.routed_model,
              jsonb_build_object('files', seed.files, 'est_tokens', seed.est_tokens,
                                 'cycle_min', seed.cycle_min, 'cycle_max', seed.cycle_max,
                                 'est_minutes', seed.est_minutes),
              seed.risk, seed.risk_note,
              jsonb_build_object('estimator', 'heuristic-v0',
                                 'sized_at',
                                 to_char((now() - make_interval(mins => seed.sized_minutes))
                                           at time zone 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                 'tokens_used', 0, 'signals', '[]'::jsonb),
              now() - make_interval(mins => seed.sized_minutes)
         from jsonb_to_recordset($3::jsonb)
           as seed(number int, version int, effort text, confidence int,
                   suggested_workflow text, routed_model text, files jsonb, est_tokens int,
                   cycle_min int, cycle_max int, est_minutes int, risk text, risk_note text,
                   sized_minutes int)
         join ${SCHEMA_NAME}.github_issues issues
           on issues.organization_id = $1
          and issues.github_repo_id = $2::uuid
          and issues.number = seed.number`,
      [
        workspace.id,
        repoId,
        JSON.stringify(
          batch.map(({ issue, estimate }) => ({
            number: issue.number,
            version: estimate.version,
            effort: estimate.effort,
            confidence: estimate.confidence,
            suggested_workflow: estimate.suggestedWorkflow,
            routed_model: estimate.routedModel,
            files: [`src/volume/${issue.number}.ts`],
            est_tokens: 1000 + issue.number,
            cycle_min: estimate.estMinutes,
            cycle_max: estimate.estMinutes + 15,
            est_minutes: estimate.estMinutes,
            risk: estimate.risk,
            risk_note: `Seeded ${estimate.risk} risk for #${issue.number}, version ${estimate.version}.`,
            sized_minutes: estimate.sizedMinutesAgo,
          })),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// The model — a restatement of the endpoint's rules, in the slowest form that is obviously
// right. Everything below is pure, and nothing below knows the implementation exists.
// ---------------------------------------------------------------------------

/** A request's row filters, as `listing.dto.ts` spells them. */
export interface VolumeFilter {
  /** The chip set, ANDed. */
  readonly labels?: readonly string[];
  /** The *State* select. Absent means the endpoint's own default, `open`. */
  readonly state?: "open" | "closed" | "all";
  /** The search box, already trimmed. */
  readonly q?: string;
}

/** The four orderings, as `listing.dto.ts` spells them. */
export type VolumeSort = "effort" | "confidence" | "updated" | "number";

/** A search that names an issue number — `listing.search.ts`' own rule, restated. */
const ISSUE_REFERENCE = /^#?(\d{1,9})$/;

/**
 * The rows a request should match.
 *
 * The three predicates, in the endpoint's own terms:
 *
 *   * **State** — `open` unless the request said otherwise, and `all` is no predicate at all.
 *   * **Labels** — containment, which is *every* named label present. The array filter below is
 *     the honest reading of `labels @> '[…]'`, and an implementation that had written `?|`
 *     (any of) instead would answer far more rows for the same request.
 *   * **Search** — the placeholder's three matches as a disjunction: a case-insensitive
 *     *literal* substring of the title, an exact label name, and the issue number when the text
 *     names one. `includes` is `ilike` with the term escaped, which is what
 *     `listing.search.ts` builds — so a `%` a person typed is a per cent sign here as well.
 *
 * @param population - The rows to filter.
 * @param filter - What the filter bar narrowed it to.
 * @returns The matching rows, in the population's own order.
 */
export function volumeMatching(
  population: readonly VolumeIssue[],
  filter: VolumeFilter = {},
): readonly VolumeIssue[] {
  const state = filter.state ?? "open";
  const term = filter.q;
  const reference = term === undefined ? null : ISSUE_REFERENCE.exec(term);

  return population.filter((issue) => {
    if (state !== "all" && issue.state !== state) return false;

    if (
      filter.labels !== undefined &&
      !filter.labels.every((name) => issue.labels.includes(name))
    ) {
      return false;
    }

    if (term === undefined) return true;

    return (
      issue.title.toLowerCase().includes(term.toLowerCase()) ||
      issue.labels.includes(term) ||
      (reference !== null && issue.number === Number(reference[1]))
    );
  });
}

/**
 * The order a sort should put rows in.
 *
 * Each key, then `number desc` — the tie-break that makes every one of the four total over this
 * fixture. `id asc` is the repository's third key and is deliberately not modelled: it can only
 * decide between two rows that share a number, and no two rows here do.
 *
 * `nulls last` is written out on both descending keys because PostgreSQL's default for `desc`
 * is `nulls first`, and the whole of *"unsized last"* is that difference.
 *
 * @param rows - The matching rows.
 * @param sort - Which ordering.
 * @returns A new array, ordered.
 */
export function volumeOrdered(
  rows: readonly VolumeIssue[],
  sort: VolumeSort = "effort",
): readonly VolumeIssue[] {
  const keys = (issue: VolumeIssue): readonly number[] => {
    // `Infinity` is `nulls last` under an ascending comparison, and it is what an unestimated
    // issue sorts as under both of the keys that read the estimate.
    const rank = issue.estimate === null ? Infinity : EFFORTS.indexOf(issue.estimate.effort);
    const confidence = issue.estimate === null ? Infinity : -issue.estimate.confidence;

    switch (sort) {
      case "effort":
        return [rank, confidence];
      case "confidence":
        return [confidence];
      case "updated":
        // `gh_updated_at desc` is *fewest minutes ago first*, and the column is not nullable.
        return [issue.updatedMinutesAgo];
      case "number":
        return [-issue.number];
    }
  };

  return [...rows].sort((left, right) => {
    const [a, b] = [keys(left), keys(right)];

    for (let key = 0; key < a.length; key += 1) {
      if (a[key] !== b[key]) return a[key] - b[key];
    }

    return right.number - left.number;
  });
}

/**
 * The chip set a scope should publish.
 *
 * Every distinct label across the rows, ascending — and **not** narrowed by the row filters,
 * which is the rule `listing.resources.ts` argues for: a chip set that shrank as chips were
 * selected would leave a person unable to turn one back on.
 *
 * **Sorted with JavaScript's `<` rather than a collator, which is safe only because no two
 * label names in this file's vocabulary differ purely in punctuation**: `tech-debt` sorts before
 * `telemetry` on the `c`/`l` under every collation, and every other pair is separated by its
 * first letter. A vocabulary that added `motorcontrol` beside `motor-control` would make this
 * function's answer depend on the database's collation, and the assertion would start failing on
 * somebody's machine rather than in CI.
 *
 * @param population - Every row in scope — the workspace's, or one repository's.
 * @returns The names, ascending.
 */
export function volumeFacets(population: readonly VolumeIssue[]): readonly string[] {
  return [...new Set(population.flatMap((issue) => issue.labels))].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

/**
 * The page head's two figures for a scope.
 *
 * Open issues, and how many of those are `sized` — ignoring every row filter, which is the
 * other half of the same argument: the head describes the backlog and the table describes the
 * filter.
 *
 * @param population - Every row in scope.
 * @returns The two counts.
 */
export function volumeCounts(population: readonly VolumeIssue[]): {
  openCount: number;
  sizedCount: number;
} {
  const open = population.filter((issue) => issue.state === "open");

  return {
    openCount: open.length,
    sizedCount: open.filter((issue) => issue.sizingStatus === "sized").length,
  };
}
