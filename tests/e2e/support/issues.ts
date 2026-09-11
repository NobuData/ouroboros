/**
 * Mockup 03's issues screen, as this suite asserts against it
 * ([#121](https://github.com/NobuData/ouroboros/issues/121)).
 *
 * `support/seed.ts` is *who exists* and `support/dashboard.ts` is *what the loop has done*;
 * this is **the backlog Ouroboros has an opinion about** — the nine issues
 * [`R__dev_seed_intake.sql`](../../../ouroboros-db/migrations/R__dev_seed_intake.sql)
 * mirrors into `acme-robotics / helios-firmware`, the estimates in force over eight of them,
 * and the words `ouroboros-ui/app/issues/` renders each with. Every value below is a join of
 * two things this suite does not own — a row the seed writes and a formatter the page owns —
 * and it is **written down rather than derived**, for the reason `support/seed.ts` argues at
 * length: a suite that computed *7 already sized* by counting the seed's `sized` rows would
 * agree with a broken count as happily as with a working one.
 *
 * ## Three things the seed decides that a reader of the mockup would not expect
 *
 * They are all in the seed's own header, and each is the kind of fact a leg has to know
 * before it can be right about the page:
 *
 *   * **The head reads `9 open issues. 7 already sized.`**, not the mockup's 42 and 38. Nine
 *     rows, of which seven are `sized`, one `estimating` (`#483`, which has no estimate row
 *     at all — that is what mid-flight means) and one `needs_human` (`#490`).
 *   * **More rows are `queued` than the mockup draws.** `R__dev_seed_dashboard.sql` already
 *     queues `#485`, `#486`, `#488`, `#490` and `#491` in this repository, and the intake seed
 *     cross-references rather than duplicates — so five pills read `queued`, including the
 *     mockup's `#485`, and `queued` wins over `needs human` on `#490` because *where the loop
 *     will pick it up* is the more recent fact.
 *   * **Only one issue can be queued.** `#487` and `#489` are sized and unqueued, but the
 *     dashboard seed queues a `#487` in `helios-telemetry` and a `#489` in `helios-console`,
 *     and `queue_items` is unique on `(organization_id, issue_number)` — deliberately
 *     over-reaching across repositories (V009). So a selection of the three free issues is
 *     refused naming two of them, and `#484` is the one the queue will take. The seed calls
 *     this *the fixture that shows it*; the queue leg is where it is shown.
 *
 * ## What is deliberately not written down
 *
 * Every instant in the seed is relative to `now()` at *migration* time, so `#485`'s panel
 * reads *opened 2d ago* and its trace *sized by heuristic-v0 · 2m ago* — and the second of
 * those is a minute older every minute. Those are asserted as shapes ({@link SEEDED_DETAIL}),
 * and the trace line is masked in the parity screenshots. The freshness tag is **not** among
 * them: `meta.syncedAt` is M.4's `github_repos.issues_synced_at`, which no seed stamps, so the
 * tag reads {@link NEVER_SYNCED} on every stack and is asserted as text.
 */

/* ------------------------------------------------------------------ the page's own words */

/** The issues screen's route — mockup 03, `app/(app)/issues/page.tsx`. */
export const ISSUES_PATH = "/issues";

/** The caption over the head, as the mockup writes it. */
export const ISSUES_EYEBROW = "Issue Intake";

/** The subline under the head, verbatim from the mockup. */
export const ISSUES_SUBLINE =
  "Ouroboros watches the GitHub backlog and continuously estimates effort, risk, and routing " +
  "for every open issue — before you ever ask it to work.";

/** The page head over the seeded workspace — the mockup's sentence, the seed's figures. */
export const SEEDED_HEADLINE = "9 open issues. 7 already sized.";

/** The page head over the personal workspace, which mirrors nothing. */
export const EMPTY_HEADLINE = "0 open issues. 0 already sized.";

/**
 * The head's shape on arrival in the seeded workspace — the open count pinned, the sized
 * count not.
 *
 * The spec's arrival barrier matches this rather than {@link SEEDED_HEADLINE}: the sized count
 * is the one figure the leg's own writes can move (a re-estimate that failed under a stopped
 * engine is one fewer *already sized*), and the exact sentence is the parity group's to assert.
 */
export const SEEDED_ARRIVAL = /^9 open issues\. \d+ already sized\.$/;

/** The head's shape on arrival in the personal workspace. */
export const EMPTY_ARRIVAL = /^0 open issues\. 0 already sized\.$/;

/** The filter bar's accessible name — `FILTER_BAR_LABEL` in `app/issues/filter.ts`. */
export const FILTER_BAR_LABEL = "Filter the backlog";

/** The table card's heading, which is the region's name — `TABLE_TITLE` in `app/issues/table.ts`. */
export const TABLE_TITLE = "Backlog · as Ouroboros sees it";

/** The grid's own name — its visually hidden `<caption>`. */
export const TABLE_CAPTION = "The backlog, one issue per row";

/** The detail card's heading, which is the region's name. */
export const PANEL_TITLE = "Issue detail";

/** What the freshness tag reads over a backlog no sync has stamped — every seeded stack. */
export const NEVER_SYNCED = "never synced";

/**
 * The banner over the seeded rows.
 *
 * No seed writes a GitHub token, so M.4 answers `not_configured` for every workspace and the
 * table card says so over the rows it did mirror — once, with the way to ask again. In the
 * personal workspace the empty state *is* that explanation, so the banner stays away there.
 */
export const SYNC_PAUSED_NO_TOKEN = "Sync paused — no GitHub token is connected.";

/** The banner's one control. */
export const CHECK_AGAIN_LABEL = "Check again";

/** What the effort cell says for an issue with no estimate — verbatim from the mockup. */
export const SIZING = "sizing…";

/** What the workflow and model cells say for the same issue — the design system's em dash. */
export const UNESTIMATED = "—";

/** The five pills, as the contract's words with the mockup's punctuation. */
export const PILL = {
  queued: "queued",
  sized: "sized",
  estimating: "estimating…",
  needsHuman: "needs human",
} as const;

/* ------------------------------------------------------------------ the nine rows */

/** One row of the backlog table, as the table draws it. */
export interface SeededIssue {
  /** GitHub's number — the mono `#485` the cell prints, without the hash. */
  readonly number: number;
  /** The title as the seed copied it from GitHub. */
  readonly title: string;
  /** GitHub's labels, in the order the seed stores them — the tags under the title. */
  readonly labels: readonly string[];
  /** The effort chip, or `null` for the mid-flight row, which prints {@link SIZING}. */
  readonly effort: string | null;
  /** The mono figure beside the chip — `92%` — or `null` with it. */
  readonly confidence: string | null;
  /** The suggested-workflow tag, or `null` — drawn as {@link UNESTIMATED}. */
  readonly workflow: string | null;
  /** The routed-model pill, or `null` — drawn as {@link UNESTIMATED}. */
  readonly model: string | null;
  /** The status pill's word. */
  readonly status: (typeof PILL)[keyof typeof PILL];
}

/**
 * The backlog, in the order the default view draws it.
 *
 * **The order is M.1's `sort=effort`** — chip order ascending, confidence descending within a
 * chip, the unsized row last — and the seed's own header promises it is *total*: no two issues
 * share an `(effort, confidence)` pair, so this is the one order the rows can arrive in and
 * asserting position by position asserts the sort rather than the planner's mood.
 *
 * The `queued` pills are the dashboard seed's doing (see this file's header); the two `sized`
 * rows and `#484` are the three issues no queue row names, and `#490` reads `queued` over its
 * `needs_human` because the pill prefers the more recent fact.
 */
export const SEEDED_BACKLOG: readonly SeededIssue[] = [
  {
    number: 488,
    title: "Typo sweep in operator manual + pairing guide",
    labels: ["docs", "good-first-issue"],
    effort: "XS",
    confidence: "98%",
    workflow: "docs-loop",
    model: "ollama/qwen3-coder",
    status: PILL.queued,
  },
  {
    number: 491,
    title: "Add CRC32 to config persistence layer",
    labels: ["bug", "tech-debt"],
    effort: "S",
    confidence: "95%",
    workflow: "standard-fix",
    model: "copilot/gpt-5-codex",
    status: PILL.queued,
  },
  {
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    labels: ["bug", "i2c", "watchdog", "priority-high"],
    effort: "M",
    confidence: "92%",
    workflow: "standard-fix",
    model: "claude-fable-5",
    status: PILL.queued,
  },
  {
    number: 484,
    title: "Motor PID integral windup on wheel stall",
    labels: ["bug", "motor-control"],
    effort: "M",
    confidence: "88%",
    workflow: "standard-fix",
    model: "cursor/composer-2",
    status: PILL.sized,
  },
  {
    number: 489,
    title: "CAN arbitration-lost storm under full telemetry load",
    labels: ["bug", "can-bus"],
    effort: "M",
    confidence: "78%",
    workflow: "standard-fix",
    model: "claude-sonnet-5",
    status: PILL.sized,
  },
  {
    number: 486,
    title: "Expose battery health over BLE GATT service",
    labels: ["enhancement", "ble"],
    effort: "L",
    confidence: "84%",
    workflow: "feature-loop",
    model: "claude-sonnet-5",
    status: PILL.queued,
  },
  {
    number: 487,
    title: "Delta OTA updates for images larger than 1 MB",
    labels: ["enhancement", "ota"],
    effort: "L",
    confidence: "71%",
    workflow: "feature-loop",
    model: "claude-fable-5",
    status: PILL.sized,
  },
  {
    number: 490,
    title: "Migrate build system to Zephyr RTOS 4.2",
    labels: ["tech-debt", "zephyr"],
    effort: "XL",
    confidence: "61%",
    workflow: "deps-refresh",
    model: "claude-fable-5",
    status: PILL.queued,
  },
  {
    number: 483,
    title: "Telemetry frame drops when BLE and CAN both saturated",
    labels: ["bug", "telemetry"],
    effort: null,
    confidence: null,
    workflow: null,
    model: null,
    status: PILL.estimating,
  },
];

/**
 * Find a seeded row by its number.
 *
 * @param number - GitHub's number, as one of the rows above spells it.
 * @returns The row.
 * @throws {Error} If no seeded issue carries that number, which is a spec naming an issue
 *   the seed does not mirror. Failing here names the number; failing later names a cell.
 */
export function seededIssue(number: number): SeededIssue {
  const row = SEEDED_BACKLOG.find((candidate) => candidate.number === number);

  if (row === undefined) {
    throw new Error(
      `no seeded issue is #${String(number)} — support/issues.ts knows ` +
        SEEDED_BACKLOG.map((each) => `#${String(each.number)}`).join(", "),
    );
  }

  return row;
}

/**
 * The chip set at the default view — M.1's `labelFacets`: every label across the nine rows,
 * each once, ascending by name. Fourteen, where the mockup draws four: the chip set is a fact
 * about the scope rather than design copy.
 */
export const LABEL_FACETS: readonly string[] = [
  "ble",
  "bug",
  "can-bus",
  "docs",
  "enhancement",
  "good-first-issue",
  "i2c",
  "motor-control",
  "ota",
  "priority-high",
  "tech-debt",
  "telemetry",
  "watchdog",
  "zephyr",
];

/**
 * The repository select's options in the demo workspace — the four repositories
 * `R__dev_seed.sql` enables for `acme-robotics`, by name. Asserted as a set: the enablement
 * list is composed from `1 + n` reads and its order is the API's, not a fact this leg holds.
 */
export const SEEDED_REPOS: readonly string[] = [
  "helios-firmware",
  "helios-console",
  "helios-telemetry",
  "atlas-scheduler",
];

/* ------------------------------------------------------------------ the #485 panel */

/**
 * The mockup's open panel — `#485`, field for field, as the seed stores it and the panel
 * spells it.
 *
 * The excerpt's curly quotes are the panel's (`quoted` in `app/issues/panel.ts`), not
 * GitHub's; the body itself is under the cut, so it is drawn whole with no **Read more**. The
 * two relative ages are shapes rather than strings, for the reason this file's header gives:
 * *opened 2d ago* is measured from a stamp two days before migration and *sized … ago* from
 * one two minutes before it, and only the first of those is still true an hour later.
 */
export const SEEDED_DETAIL = {
  number: 485,
  /** The mono meta line. `opened 2d ago` holds for a day after the seed was applied. */
  meta: /^#485 · opened 2d ago by field-support$/,
  excerpt:
    "“Unit 07 in the Fremont pilot rebooted 14 times overnight. Logs show the IMU holding SDA " +
    "low after a burst read; the bus never recovers and the hardware watchdog fires ~2 s " +
    "later. We need a bus-recovery sequence (9 clock pulses + re-init) before the watchdog " +
    "trips.”",
  /** The mockup's three paths — the one estimate in the seed that names the artwork's files. */
  files: ["drivers/i2c_recovery.c", "drivers/imu_bmi270.c", "tests/unit/test_i2c_lockup.c"],
  tokens: "~180k",
  cycle: "12–18 min",
  effort: "M",
  confidence: "conf 92%",
  risk: "low",
  riskNote: "Isolated to the I²C driver path; full HIL coverage exists for bus recovery.",
  workflow: "standard-fix",
  model: "claude-fable-5",
  /** Composed by the seed from the joined rows rather than written out — see its header. */
  githubUrl: "https://github.com/acme-robotics/helios-firmware/issues/485",
  /** The trace's first line: the estimator's own name, then an age this suite cannot pin. */
  provenance: /^sized by heuristic-v0 · \d+[smhd] ago$/,
  /** The trace's second line — the rule engine's honest answer about what it consulted. */
  signals: "signals: none recorded by this estimator",
  /** Why **Queue for loop** is inert on the mockup's own row: the dashboard seed queued it. */
  queueReason: "This issue is already in the queue.",
} as const;

/* ------------------------------------------------------------------ the mid-flight row */

/**
 * `#483` — the mockup's `estimating…` row, held still by the seed.
 *
 * The seed writes it a `sizing_status` and **no estimate**, which is exactly what an answer
 * in flight is, and the compose override keeps L.3's recovery sweep from re-queuing it
 * (`docker-compose.e2e.yml`, the fourth line). That makes it the one place the transient
 * state can be asserted at leisure: the table's `sizing…` cell and two em dashes, the panel's
 * *Sizing now* skeleton, and both actions inert with the reason. `specs/issues.spec.ts`'s
 * header says why the *live* transition is asserted on what it leaves behind instead.
 */
export const ESTIMATING_ISSUE = {
  number: 483,
  /** What the panel says while the estimator is working, and the note under it. */
  sizingNow: "Sizing now",
  sizingNote: "The breakdown lands here when the estimator answers — no reload needed.",
  /** Why **Re-estimate** is inert while an estimate is already in flight. */
  reestimateReason: "This issue is being estimated now — the panel follows it.",
  /** Why **Queue for loop** is inert on an issue nothing has sized yet. */
  queueReason: "This issue is still being sized — the loop takes sized issues only.",
} as const;

/* ------------------------------------------------------------------ the filter round trip */

/**
 * The view the filter leg builds through the bar, and the address it lives at.
 *
 * Four of the bar's five controls, in the order the URL spells them (decision K8: keys in
 * `repo, labels, state, sort, q` order, defaults left out). The repository is the seed's own
 * `github_repos.id` — literal in `R__dev_seed.sql`, and the one value here a pasted link
 * carries that a person would never type. `bug` ANDs down to five rows, `CAN` is an `ilike`
 * over the title that keeps two of them, and `number` puts those two in GitHub's order —
 * newest first.
 */
export const ROUND_TRIP = {
  /** `helios-firmware` — `5eed0006…01`, and the option's label is the repository's name. */
  repo: { id: "5eed0006-0000-4000-8000-000000000001", name: "helios-firmware" },
  label: "bug",
  sort: "number",
  q: "CAN",
  /** The address the bar writes, and the one the leg reloads. */
  search: "?repo=5eed0006-0000-4000-8000-000000000001&labels=bug&sort=number&q=CAN",
  /**
   * The two rows that view holds, in the order `sort=number` draws them — **descending**, as
   * GitHub lists a backlog: the newest number first (`listing.repository.ts`).
   */
  rows: [489, 483],
} as const;

/**
 * The same view narrowed to nothing, and the way out of it.
 *
 * `state=closed` over a backlog that is entirely open matches no row, and the card must say
 * *the filter did this* rather than *there is nothing here*: `openCount` is scoped by the
 * repository alone, so the table can tell a narrowed backlog from an empty one. **Clear
 * filters** asks the bar to do what its own **Clear all** does, which ends at `/issues`.
 */
export const NO_MATCHES = {
  state: "closed",
  search: "?repo=5eed0006-0000-4000-8000-000000000001&labels=bug&state=closed&sort=number&q=CAN",
  title: "No issues match this filter",
  clearLabel: "Clear filters",
} as const;

/* ------------------------------------------------------------------ select → queue → dashboard */

/**
 * The queue leg, step by step — the ticket's *select three → combined estimate → queue →
 * dashboard*, as the seed lets it happen.
 *
 * The three picked are the three `sized` issues no queue row names, ticked in table order.
 * Their combined estimate is 50 + 60 + 110 minutes — `est_minutes` the seed writes and the
 * chips do not imply (`#487`'s L is 110 where `#486`'s L is 90) — and the action reads
 * *suggested* because the three do not agree on a workflow. The press is then refused, for
 * the reason this file's header gives: the workspace's queue already holds a `#489` and a
 * `#487` from two other repositories, and the key is on the number. The dialog names them in
 * the order they were sent, the reader deselects exactly those two, and `#484` goes through
 * under its own suggested workflow.
 */
export const QUEUE_LEG = {
  /** The rows ticked, in the order they are ticked — which is the order the request lists. */
  picked: [484, 489, 487],
  summary: "3 issues selected",
  estimate: "· est. 3h 40m combined autonomous work",
  action: "Queue → suggested",
  refused: {
    title: "Nothing was queued",
    /** One sentence per offender, in the service's order — the request's. */
    lines: ["#489 is already in the queue.", "#487 is already in the queue."],
    note:
      "The queue takes a selection whole or not at all, so the other 1 issue was left out " +
      "with them.",
    deselect: "Deselect 2 issues",
  },
  queued: {
    number: 484,
    summary: "1 issue selected",
    estimate: "· est. 50m combined autonomous work",
    /** One issue, one suggestion, so the action names it. */
    action: "Queue → standard-fix",
    /** Counted and summed from the row the service created, never from the preview. */
    toast: "Queued 1 issue · est. 50m combined autonomous work.",
    link: "See them on the dashboard →",
  },
} as const;

/**
 * What the dashboard says once `#484` is in the queue — read from the dashboard *page*.
 *
 * The seed queues twelve items at 580 minutes, and the card draws the head of the queue
 * (positions 1–5, `support/dashboard.ts`'s {@link SEEDED_QUEUE}). A thirteenth item joins the
 * tail, so the honest *gained rows* is three figures moving by exactly one row's worth — the
 * *Queued issues* tile's count and its summed estimate, and the card's footer — while the five
 * head rows stay the seed's. 580 + 50 is 630 minutes, which `durationOfMinutes` spells
 * `10h 30m`; 13 less the 5 drawn is the footer's `+8`.
 */
export const DASHBOARD_AFTER_QUEUE = {
  /** Where the toast's link lands: the dashboard, at the queue card's heading. */
  path: "/dashboard#dash-up-next-title",
  tile: { label: "Queued issues", value: "13", detail: "est. 10h 30m of autonomous work" },
  beyondHead: "+8 queued →",
} as const;

/* ------------------------------------------------------------------ re-estimate */

/**
 * The re-estimate leg's subject, and what `heuristic-v0` writes for it.
 *
 * **`#487`, on purpose.** It already carries two versions — a superseded v1 and the mockup's
 * v2 in force — so a re-estimate is v3 and the trace prints it, which is the *new version* the
 * ticket asks to be observed. And it is the one sized, unqueued issue whose rule-engine answer
 * **reproduces its seeded row**: `enhancement` votes `l`, a short body votes `s`, one of two
 * agreeing across a spread of two is `68 + 15 − 12 = 71`, `enhancement` classifies as
 * `feature-loop`, and `feature-loop` resolves through the `default` key to `implement`'s
 * primary, `claude-fable-5`. Every figure the table draws for the row is therefore the same
 * after the press as before it — so the parity group above stays true of a stack this leg has
 * already run against, which is the property `support/seed.ts` calls being green twice.
 *
 * What *does* change is the panel, and it is asserted: a rule engine names no files, budgets
 * an `l` at 420k tokens over 30–80 minutes, and writes its own risk sentence.
 */
/**
 * DASH-I.8's cadence — `DEFAULT_POLL_SECONDS` in `ouroboros-ui/app/poll.ts`, as milliseconds.
 *
 * Restated rather than imported, because nothing in this suite may import service source, and
 * named because the re-estimate leg's promise is the page's own: *`estimating…` rows flip to
 * `sized` within one poll of pipeline completion*. The refresh the panel asks for the moment
 * the press is accepted usually finds the row still claimed — the pipeline's context
 * resolution and engine call take longer than the browser's round trip back — and what it
 * draws then is `estimating…`, held until the **next** tick. A wait that outlasts one tick is
 * therefore the leg's whole allowance, and `EXPECT_TIMEOUT_MS` is exactly one tick long.
 */
export const ONE_POLL_MS = 15 * 1000;

export const REESTIMATE = {
  number: 487,
  /** The trace before the press: the seed's v2, an age this suite cannot pin. */
  before: /^sized by heuristic-v0 · \d+[smhd] ago · v2$/,
  /** The trace after it: the same estimator, an age in seconds, and the next version. */
  after: /^sized by heuristic-v0 · \d+s ago · v3$/,
  /** What stands where the file list would, for an estimate the rule engine wrote. */
  filesNote:
    "The file estimate arrives with the full estimator — heuristic-v0 sizes from the " +
    "issue's words and names no files.",
  tokens: "~420k",
  cycle: "30–80 min",
  effort: "L",
  confidence: "conf 71%",
  risk: "high",
  /** The rule engine's sentence — the level, and what it did not read before choosing it. */
  riskNote:
    "L-sized work starts at high regression risk. heuristic-v0 reads an issue's labels and " +
    "text only — not the code, its tests, or how much depends on it — so this is where a " +
    "reviewer starts rather than what the change measures.",
  workflow: "feature-loop",
  model: "claude-fable-5",
} as const;

/* ------------------------------------------------------------------ the personal workspace */

/**
 * What the personal workspace draws — N.6's guidance, in the state that is actually true.
 *
 * The ticket says *the no-repos state*, and N.6's shipped note corrected it: `kensuenobu` has
 * two enabled repositories and no token, and no seed writes a token, so M.4 answers
 * `not_configured` and the honest guidance is **no token**. The owner is drawn the control,
 * inert with the issue that unblocks it, because the settings surface it would open is
 * unbuilt (#141) and #49's rule is no dead links.
 */
export const GUIDANCE = {
  title: "Connect GitHub to watch your backlog",
  note:
    "This workspace has no GitHub token, so there is no backlog to watch yet. Once one is " +
    "connected, every enabled repository's issues are mirrored here and sized as they arrive.",
  control: "Open settings",
  controlReason:
    "The settings screen for ticket sources is not built yet — it arrives with #141. Until " +
    "then a GitHub token is set through the service's settings endpoint.",
  /** The two repositories `R__dev_seed.sql` enables for the personal workspace. */
  repos: ["dotfiles", "ouroboros-playground"],
  noLabels: "No labels in scope.",
  noIssueOpen: "No issue open",
  /** Why **Re-estimate all** is inert over a workspace that mirrors nothing. */
  reestimateReason: "There is nothing to re-estimate — this workspace mirrors no issues yet.",
  /** Why **Queue 0 selected ⟳** is inert with nothing to select. */
  queueReason:
    "Select issues in the backlog table to queue them — tick a row, or press Space on it.",
} as const;

/* ------------------------------------------------------------------ addresses */

/**
 * The issues screen's address, with a query string.
 *
 * @param search - The query string, `?` included, or nothing for the default view.
 * @returns `/issues`, or `/issues?…`.
 */
export function issuesPath(search = ""): string {
  return `${ISSUES_PATH}${search}`;
}
