/**
 * What mockup 02 renders against the development seed — the dashboard leg's expectations.
 *
 * `support/seed.ts` is *who exists*; this is **what the dashboard says about them**, and it
 * is a second file for the same reason the seed migration is
 * ([`R__dev_seed_dashboard.sql`](../../../ouroboros-db/migrations/R__dev_seed_dashboard.sql)
 * is *what the loop has done*, and it changes on different days from *who exists*).
 *
 * Every figure below is a **join of two things this suite does not own**: a row the seed
 * writes, and the words `ouroboros-ui/app/dashboard/view.ts` renders it with. `3` is the
 * three non-terminal `runs`; `1 coding · 1 building · 1 in review` is what `loopsLiveStat`
 * composes from their statuses; `9h 40m` is `durationOfMinutes` over a `sum(est_minutes)`
 * of 580. Between the row and the string sit the aggregate endpoint's arithmetic
 * ([#70](https://github.com/NobuData/ouroboros/issues/70)) and nine cards' worth of
 * formatting — which is the whole of what the dashboard leg is for, and none of which any
 * module's own tests can see end to end.
 *
 * **It is written down rather than derived, exactly as `support/seed.ts` argues.** A suite
 * that computed `27` by counting the seed's `merged` rows would agree with a broken
 * aggregate as happily as with a working one; a suite that read the figures off the page
 * would agree with anything at all. These are literals, so a seed that changes and a
 * formatter that changes both break this file, and somebody has to look at both.
 *
 * ### Where each block comes from
 *
 * | Block | Rows | Rendered by |
 * |---|---|---|
 * | {@link SEEDED_STATS} | `runs`, `queue_items`, `token_usage_daily` | `view.ts` `statRow` |
 * | {@link SEEDED_ACTIVE_LOOPS} | the three non-terminal `runs` | `active-loops-card.tsx` |
 * | {@link SEEDED_PULSE} | rates over `runs` | `view.ts` `pulseMeters` |
 * | {@link SEEDED_QUEUE} | `queue_items` positions 1–5 | `queue-card.tsx` |
 * | {@link EMPTY_STATES} | *no rows at all* | every card's zero state (#86) |
 *
 * ### What is deliberately absent
 *
 * Three things the page draws are **not** here, because they are not reproducible from a
 * seed whose timestamps are relative to `now()`:
 *
 *   * the greeting's daypart, which is the reader's own clock (decision F7);
 *   * the *Elapsed* column, which counts from `started_at` and is a second older by the time
 *     it is read;
 *   * the subline's *"merged N since midnight UTC"*, whose N depends on the hour the stack
 *     came up — the seed's own header says the same of the mockup's "this morning".
 *
 * The leg asserts the *shape* of each of those instead, which is the honest assertion: see
 * `specs/dashboard.spec.ts`.
 */

/** One tile of the stat row, as {@link SEEDED_STATS} names it. */
interface SeededStat {
  /** The tile's caption — its accessible name, and how a spec addresses it. */
  readonly label: string;
  /** The figure, exactly as drawn. */
  readonly value: string;
  /** The line under the figure. */
  readonly detail: string;
}

/**
 * The four tiles of the stat row, in the order the mockup's columns take them.
 *
 * The captions are the mockup's copy and the figures are the seed's; the pairing is what a
 * reader actually sees, so it is written as one table rather than as two lists that have to
 * be zipped by eye.
 */
export const SEEDED_STATS: readonly SeededStat[] = [
  {
    label: "Loops live",
    // The three non-terminal runs. The subline is the run table's own arithmetic rather than
    // the mockup's sentence — decision F.5 settled that disagreement in favour of the table,
    // so this reads `1 coding · 1 building · 1 in review` where the mockup drew `2 coding ·
    // 1 in review`.
    value: "3",
    detail: "1 coding · 1 building · 1 in review",
  },
  {
    label: "Queued issues",
    // Twelve `queue_items`, of which eleven carry an estimate summing to 580 minutes. The
    // twelfth (#496) is deliberately unestimated, so this figure also proves the `sum`
    // skipped a null instead of counting it as a zero.
    value: "12",
    detail: "est. 9h 40m of autonomous work",
  },
  {
    label: "PRs merged · 7d",
    // 27 in the trailing week against 19 in the one before it — the seed writes both windows
    // precisely so this delta is a comparison rather than a constant.
    value: "27",
    detail: "▲ 8 vs last week",
  },
  {
    label: "Token spend · today",
    // 4.2M tokens over twelve events and four providers, of which three (the local `ollama`
    // ones) carry no price — which is what the `≈` means and why the cost is a floor.
    value: "4.2M",
    detail: "≈ $18.60 across 4 providers",
  },
];

/** One row of the *Active loops* table, as {@link SEEDED_ACTIVE_LOOPS} names it. */
interface SeededLoop {
  /** The issue cell's number, with its hash — as the cell draws it. */
  readonly issue: string;
  /** The issue's title, beside the number in the same cell. */
  readonly title: string;
  /** The *Workflow* tag. */
  readonly workflowTag: string;
  /** The *Model* chip, which is an opaque identifier and is drawn, never parsed. */
  readonly model: string;
  /** The caption over the stage meter — the workflow's own word, then its position. */
  readonly stage: string;
  /**
   * How full the stage meter is drawn, as the `--ou-meter-fill` percentage.
   *
   * `stagePercent` rounds **down** (`app/dashboard/view.ts`), so `4/6` is `66%` and not
   * `67%`: a bar is a claim about work that has finished. `6/6` is the only one of the three
   * that reaches `100%`, which is the property that rounding exists to protect.
   */
  readonly meter: string;
  /** The *Status* pill's word. */
  readonly status: string;
}

/**
 * The three runs in flight, in the order the endpoint sorts them.
 *
 * **Lifecycle order** — coding, building, review — which is `array_position` over
 * `ACTIVE_RUN_STATUSES` in `ouroboros-rest`'s dashboard repository rather than the order the
 * seed happens to insert them in. Asserting the order is therefore asserting the sort, which
 * is a property no fixture-based test of the card can see.
 */
export const SEEDED_ACTIVE_LOOPS: readonly SeededLoop[] = [
  {
    issue: "#482",
    title: "Fix flaky CAN-bus telemetry test",
    workflowTag: "standard-fix",
    model: "claude-fable-5",
    stage: "Implementing · 4/6",
    meter: "66%",
    status: "coding",
  },
  {
    issue: "#479",
    title: "Add OTA rollback on failed checksum",
    workflowTag: "feature-loop",
    model: "claude-sonnet-5",
    stage: "Build farm · 5/7",
    meter: "71%",
    status: "building",
  },
  {
    issue: "#476",
    title: "Bump MQTT client, migrate deprecated API",
    workflowTag: "deps-refresh",
    model: "ollama/qwen3-coder",
    stage: "Self-review · 6/6",
    meter: "100%",
    status: "review",
  },
];

/** One meter of the *Loop pulse* card, as {@link SEEDED_PULSE} names it. */
interface SeededPulseMeter {
  /** The row's caption, which is also the bar's accessible name. */
  readonly label: string;
  /** The window it was measured over, printed beside the caption. */
  readonly window: string;
  /** The figure, as the mono treatment draws it. */
  readonly value: string;
  /** How full the bar is, as `aria-valuenow` reports it — a whole percentage of the track. */
  readonly fill: number;
}

/**
 * The three pulse meters, in the mockup's order.
 *
 * **Two windows, and only one of them is the card's head tag.** The merge rate is published
 * over fourteen days because the mockup's own figures cannot all be true of one seven-day
 * window; over fourteen the seed gives 46 merged of 50 closed, which is `0.92` exactly. The
 * other two are the seven-day window the tag names.
 *
 * The fills of the second and third are ratios against denominators **this product chose**
 * rather than figures the service reports — `CYCLE_TIME_TARGET_SECONDS` (30 minutes) and
 * `INTERVENTION_BUDGET_7D` (25), both exported from `app/dashboard/view.ts` for exactly this
 * reason. `860 / 1800` is 48% and `2 / 25` is 8%.
 */
export const SEEDED_PULSE: readonly SeededPulseMeter[] = [
  { label: "Autonomous merge rate", window: "14 days", value: "92%", fill: 92 },
  { label: "Avg. cycle time", window: "7 days", value: "14m 20s", fill: 48 },
  { label: "Human interventions", window: "7 days", value: "2 this week", fill: 8 },
];

/** One row of the *Up next in queue* card, as {@link SEEDED_QUEUE} names it. */
interface SeededQueueRow {
  /** The issue's number, with its hash. */
  readonly issue: string;
  /** Its title. */
  readonly title: string;
  /** The effort chip, in the design system's own vocabulary. */
  readonly effort: string;
  /** The workflow that will run it. */
  readonly workflowTag: string;
}

/**
 * The head of the queue — positions 1–5, which is `QUEUE_HEAD_LIMIT` in the aggregate.
 *
 * **All five effort chips appear across these five rows**, which is not a coincidence: the
 * seed's own header names it as the criterion the `CHECK` on `queue_items.effort` exists
 * for, and it is what makes this leg's assertion — that the queue draws every size the
 * design system publishes — an assertion about the whole scale rather than about one chip.
 *
 * The estimates are deliberately *not* a function of the chip (two `S` items sit at 30 and
 * 25 minutes), so the *Queued issues* tile's `9h 40m` is a second fact rather than a
 * restatement of these five.
 */
export const SEEDED_QUEUE: readonly SeededQueueRow[] = [
  {
    issue: "#485",
    title: "Watchdog reset on I²C bus lockup",
    effort: "M",
    workflowTag: "standard-fix",
  },
  {
    issue: "#486",
    title: "Expose battery health over BLE GATT",
    effort: "L",
    workflowTag: "feature-loop",
  },
  {
    issue: "#488",
    title: "Typo sweep in operator manual",
    effort: "XS",
    workflowTag: "docs-loop",
  },
  {
    issue: "#490",
    title: "Migrate build to Zephyr 4.2",
    effort: "XL",
    workflowTag: "deps-refresh",
  },
  {
    issue: "#491",
    title: "Add CRC to config persistence layer",
    effort: "S",
    workflowTag: "standard-fix",
  },
];

/**
 * What the queue card's footer says it is not showing — twelve queued less the five drawn.
 *
 * A separate figure from the count on the tile, and separately true: the card draws a slice
 * and the stat counts the whole, so a footer that agreed with the tile by construction would
 * be one number rendered twice.
 */
export const SEEDED_QUEUE_BEYOND_HEAD = "+7 queued →";

/**
 * The first sentence of the page head's subline, which is the half that is reproducible.
 *
 * Three in flight and twelve queued, from the aggregate's `activity` — the same two counts
 * the *Loops live* and *Queued issues* tiles draw, arriving on the page by a second route.
 * The sentence that follows it counts what merged *since midnight UTC*, which depends on the
 * hour the stack came up; the leg asserts that one's shape rather than its number.
 */
export const SEEDED_FLIGHT_SENTENCE = "3 issues in flight, 12 queued behind them.";

/**
 * Where the seed leaves the **Auto-merge when checks pass** switch — on.
 *
 * `workspace_settings` carries exactly one row, and it is this workspace's: the demo
 * workspace has said yes, which is the position mockup 02 draws. The other two organizations
 * get no row at all, because V011 makes row creation lazy and absence is what lets a
 * *chosen* `false` be told apart from a default one.
 *
 * The dashboard leg flips it and flips it back; this is what "back" means, and what the leg
 * restores in teardown so a failed run does not leave the next one starting from the wrong
 * position.
 */
export const SEEDED_AUTO_MERGE = true;

/**
 * Every zero state the empty workspace has to draw, and the words each of them uses.
 *
 * This is [#86](https://github.com/NobuData/ouroboros/issues/86)'s design asserted against a
 * *workspace* rather than against a payload: `kensuenobu` has no row in any of the four
 * read-model tables, so what the page draws here is what a real workspace looks like on its
 * first day. Every sentence says what would fill the surface — none of them apologises, and
 * **none of them is a zero standing in for an absence**, which is the half of the criterion
 * this leg exists to hold.
 *
 * The em dash is the other half, and it is the one string that must *not* appear: `—` is
 * what a tile draws when a figure **could not be read**, and a page that drew it for a
 * workspace that has simply never run anything would be reporting a failure that has not
 * happened. `specs/dashboard.spec.ts` asserts its absence for that reason.
 */
export const EMPTY_STATES = {
  /** The page head, when nothing has run, nothing is queued and nothing has merged. */
  subline: "Nothing is running yet — the loop starts when an issue reaches the queue.",
  /** The greeting's closing clause — a fact about the loop, not a flourish. */
  greetingClause: "the loop is idle",
  /** The four tiles: a real zero, and a sentence rather than an em dash under it. */
  stats: [
    { label: "Loops live", value: "0", detail: "Nothing is running right now." },
    { label: "Queued issues", value: "0", detail: "Nothing is waiting for a loop." },
    { label: "PRs merged · 7d", value: "0", detail: "Level with last week" },
    { label: "Token spend · today", value: "0", detail: "No usage recorded today." },
  ],
  /** *Active loops*, which has been asked and has an answer. */
  activeLoops: "Nothing is running right now",
  /** *Recently closed by the loop*. */
  recentlyClosed: "Nothing closed yet",
  /** *Up next in queue*. */
  queue: "Nothing is queued",
  /** *Loop pulse* — three meters that have nothing to measure, said once and in words. */
  pulse: "No runs have finished yet, so these three have nothing to measure.",
} as const;

/**
 * The em dash a card draws in place of a figure it **could not read**.
 *
 * `NO_VALUE` in `app/dashboard/view.ts`. Named here because the empty-workspace leg asserts
 * that the page does not contain it: *nothing has happened* and *nobody could ask* are
 * different facts, and the whole of #86's rule is that they must not render alike.
 */
export const NOT_READ_DASH = "—";
