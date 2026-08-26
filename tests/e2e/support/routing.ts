/**
 * Mockup 06's routing screen, as this suite asserts against it
 * ([#206](https://github.com/NobuData/ouroboros/issues/206)).
 *
 * Every value below is what `R__dev_seed_routing.sql`
 * ([#192](https://github.com/NobuData/ouroboros/issues/192)) plus
 * `R__dev_seed_providers.sql` ([#221](https://github.com/NobuData/ouroboros/issues/221))
 * make of `/models` in `acme-robotics`, written down rather than read back — the rule
 * `support/seed.ts` states at length. A suite that derived its expectations from the payload
 * it is checking would agree with a matrix that had lost a column just as happily.
 *
 * ## Three of these are computed by the product, and that is why they are written here
 *
 * The seed stores no figure this page prints. `$0.87` is `avg(cost_cents)` over fifteen
 * ledger rows, `41.0s` is their `percentile_cont(0.5)`, `$412.80` is a sum and *31%* is a
 * ratio — decision **M7**, which the seed's own header argues for at length. So the numbers
 * below are the ones the *arithmetic* has to land on, and a leg asserting them is asserting
 * the whole chain from `token_usage` to the cell: nothing on this page is a value the seed
 * could have been made to say by writing it into a column.
 *
 * The resolution lines are the same claim one level down. `claude-fable-5 · Anthropic Claude`
 * is a hop's alias joined to the model the *registry* binds it to and the connection that
 * model runs on — three tables — and decision **M1** is what makes the model id appear in
 * exactly one of them.
 *
 * ## What is deliberately not here
 *
 * **The mockup's `$96.40` and `$54.10`.** Y.4's header shows why neither is reachable by any
 * seed — a thirty-day total cannot be smaller than the month-to-date total inside it — and
 * settles the design at the figures below. Asserting the artwork would make this leg red for
 * a discrepancy the roadmap has already recorded and resolved.
 *
 * **Anything measured from the stack's own clock.** Every `checkedAt` is `now() - interval`,
 * so a provider chip's hover carries a timestamp that differs between two runs an hour apart.
 * The hover is asserted by its *shape* — the state word, then the last-checked clause — and
 * the screenshots mask nothing for it, because a `title` is not drawn.
 */

import type { BrowserContext } from "@playwright/test";

import { quietly, writeAs } from "./rest";

/* ------------------------------------------------------------------ where the page lives */

/** The routing screen's route — mockup 06, `app/(app)/models/(routing)/page.tsx`. */
export const ROUTING_PATH = "/models";

/**
 * The routing screen with one row already selected.
 *
 * The parameter is read on the **server** (`?route=`), so a page opened this way arrives with
 * the row selected and the inspector's seat filled in its very first paint — which is what
 * lets the parity screenshots photograph the inspector without first driving the table, and
 * what makes *a selected route survives a reload* a property of the URL rather than of this
 * browser.
 *
 * @param kind - The task kind to select.
 * @returns The path.
 */
export function routingPathFor(kind: string): string {
  return `${ROUTING_PATH}?route=${kind}`;
}

/* ------------------------------------------------------------------ the health strip */

/** One chip of the provider health strip, as the strip draws it. */
export interface SeededProviderChip {
  /** The connection's display name — the chip's first line of text. */
  readonly name: string;
  /**
   * The state in a word. Visible for every state but the healthy one, where mockup 06 draws
   * a bare `Anthropic ●` and the word is left to the accessibility tree — so this is asserted
   * through the chip's text content, which includes the `sr-only` span.
   */
  readonly state: string;
  /** What the last check measured, as the service composes it, or `null` for a chip with none. */
  readonly meta: string | null;
}

/**
 * The five chips, in the order `GET /api/v1/routing/providers` sends them.
 *
 * `GitHub Copilot` is the one that is not healthy, and it is the combination a strip has to
 * draw carefully: **enabled and unhealthy**. Its word is `error` rather than the mockup's
 * *degraded* — `degraded` is a traffic-derived state AB.2 (#208) introduces and no check this
 * product performs today can produce, so a strip printing it would be naming a state the
 * database does not have. `app/models/view.ts` argues that at length; this is where the leg
 * holds the page to it.
 */
export const SEEDED_PROVIDERS: readonly SeededProviderChip[] = [
  { name: "Anthropic Claude", state: "healthy", meta: "42ms" },
  { name: "Cursor", state: "healthy", meta: null },
  { name: "GitHub Copilot", state: "error", meta: "elevated latency" },
  {
    name: "Ollama · workstation",
    state: "healthy",
    meta: "ken-station.local · 3 models · workstation",
  },
  { name: "OpenAI-compatible · local vLLM", state: "healthy", meta: "10.0.4.20 · vLLM local" },
];

/* ------------------------------------------------------------------ the matrix */

/** One of the two model columns, as the matrix draws it: the pill, and the line beneath. */
export interface SeededAliasCell {
  /** The alias the hop names — the pill. */
  readonly alias: string;
  /** What it currently resolves to — `claude-fable-5 · Anthropic Claude`. */
  readonly resolution: string;
}

/** One row of the routing matrix. */
export interface SeededMatrixRow {
  /** The task kind — the row's identity, and what `?route=` names. */
  readonly kind: string;
  /** The grey line under the kind. */
  readonly description: string;
  /** The route's own tag — never one composed from the kind: `test-gen` tags `testgen-primary`. */
  readonly tag: string;
  /** Hop 1. */
  readonly primary: SeededAliasCell;
  /** Hop 2 — the one fallback this table has a column for. */
  readonly fallback: SeededAliasCell;
  /**
   * The escalation cell's sentences — the database's generated `display` for every **enabled**
   * rule naming this kind, in evaluation order. Empty for a row no rule names, which draws
   * the em-dash.
   */
  readonly escalation: readonly string[];
  /** The `$/run avg` cell — `avg(cost_cents)`, formatted. */
  readonly cost: string;
  /** The `p50 latency` cell — `percentile_cont(0.5)`, formatted. */
  readonly latency: string;
}

/** What a cell prints when there is nothing to print — `app/models/matrix.ts`'s own. */
export const EM_DASH = "—";

/** The alias cells the seed's six routed aliases produce, so no resolution line is typed twice. */
const CELL = {
  coderMax: { alias: "coder-max", resolution: "claude-fable-5 · Anthropic Claude" },
  coderStd: { alias: "coder-std", resolution: "claude-sonnet-5 · Anthropic Claude" },
  sizer: { alias: "sizer", resolution: "claude-haiku-4-5 · Anthropic Claude" },
  coderFallback: { alias: "coder-fallback", resolution: "gpt-5-codex · GitHub Copilot" },
  localDocs: { alias: "local-docs", resolution: "qwen3-coder:32b · Ollama · workstation" },
  localFree: {
    alias: "local-free",
    resolution: "llama-4-maverick · OpenAI-compatible · local vLLM",
  },
} as const satisfies Record<string, SeededAliasCell>;

/** The sentence V018 generates for the `effort ≥ L` rule — the matrix's cell and the card's row. */
export const EFFORT_RULE = "effort ≥ L → implement uses coder-max (max thinking)";

/** …for the `security label` rule. */
export const SECURITY_RULE = "security label → review adds second-opinion vote";

/**
 * …and for the `docs-only diff` rule, which names **no** task kind.
 *
 * `route_local` modifies every kind, and *everything* is exactly the absence of a task kind in
 * the document — so this sentence appears on the rules card and in **no** matrix row. That is
 * a property of the schema rather than a rendering choice, and the parity leg asserts both
 * halves of it.
 */
export const DOCS_ONLY_RULE = "docs-only diff → everything routes local";

/**
 * The eight rows, in `task_kinds.sort_order` — the loop's own order of operations: read the
 * issue, size it, plan it, write it, test it, review it, document it, commit it.
 *
 * The **escalation column disagrees with mockup 06 on two rows**, and the disagreement is
 * settled in the schema's favour. The artwork draws the first rule's summary on `plan` and the
 * second's on `review`, while its own rules card says the first rule modifies `implement`;
 * Y.3 (#191) made `implement` the stored answer, so the matrix computes it there and draws
 * the em-dash on `plan`. The card and the column print one string because there is one.
 */
export const SEEDED_MATRIX: readonly SeededMatrixRow[] = [
  {
    kind: "analyze",
    description: "Read the issue, map the affected code paths",
    tag: "analyze-primary",
    primary: CELL.coderStd,
    fallback: CELL.localDocs,
    escalation: [],
    cost: "$0.04",
    latency: "3.1s",
  },
  {
    kind: "estimate",
    description: "Size effort XS–XL before queueing",
    tag: "estimate-primary",
    primary: CELL.sizer,
    fallback: CELL.localFree,
    escalation: [],
    cost: "$0.01",
    latency: "1.2s",
  },
  {
    kind: "plan",
    description: "Decompose into steps, pick a workflow",
    tag: "plan-primary",
    primary: CELL.coderMax,
    fallback: CELL.coderStd,
    escalation: [],
    cost: "$0.31",
    latency: "9.8s",
  },
  {
    kind: "implement",
    description: "Write the change, run tests, iterate to green",
    tag: "implement-primary",
    primary: CELL.coderMax,
    fallback: CELL.coderFallback,
    escalation: [EFFORT_RULE],
    cost: "$0.87",
    latency: "41.0s",
  },
  {
    kind: "test-gen",
    description: "Generate unit and regression tests for the diff",
    tag: "testgen-primary",
    primary: CELL.coderFallback,
    fallback: CELL.coderStd,
    escalation: [],
    cost: "$0.12",
    latency: "17.4s",
  },
  {
    kind: "review",
    description: "Self-review the PR against the acceptance criteria",
    tag: "review-primary",
    primary: CELL.coderMax,
    fallback: CELL.coderStd,
    escalation: [SECURITY_RULE],
    cost: "$0.22",
    latency: "12.6s",
  },
  {
    kind: "docs",
    description: "Update READMEs, changelogs, operator manual",
    tag: "docs-primary",
    primary: CELL.localDocs,
    fallback: CELL.sizer,
    escalation: [],
    // Priced, at nothing — not unpriced. `$0.00` beside the matrix's em-dash is DASH-J.4's
    // whole distinction, and this workspace holds both states so the leg can tell them apart.
    cost: "$0.00",
    latency: "6.3s",
  },
  {
    kind: "commit-msg",
    description: "Conventional-commit message from the staged diff",
    tag: "commitmsg-primary",
    primary: CELL.localFree,
    fallback: CELL.sizer,
    escalation: [],
    cost: "$0.00",
    latency: "0.8s",
  },
];

/**
 * One seeded row, by its task kind.
 *
 * A lookup rather than an index into {@link SEEDED_MATRIX}, because a spec naming
 * `SEEDED_MATRIX[3]` is a spec that quietly starts asserting against `test-gen` the day a
 * kind is added above it — and the row this leg edits, reorders and floors is chosen for what
 * it *is*, not for where it sits.
 *
 * @param kind - The task kind.
 * @returns The row.
 * @throws {Error} If the matrix has no such kind, naming the ones it has. Failing here names
 *   the row; failing later names a missing cell.
 */
export function seededRow(kind: string): SeededMatrixRow {
  const found = SEEDED_MATRIX.find((row) => row.kind === kind);

  if (found === undefined) {
    throw new Error(
      `the seeded matrix has no ${kind} row — it has ` +
        SEEDED_MATRIX.map((row) => row.kind).join(", "),
    );
  }

  return found;
}

/* ------------------------------------------------------------------ the inspector */

/** One hop of a route's chain, as the inspector's rail draws it. */
export interface SeededHop {
  /** The alias — the pill. */
  readonly alias: string;
  /** What it resolves to, after the arrow. */
  readonly resolution: string;
  /**
   * The line under the hop: the operator's note where the seed wrote one, and the hop's own
   * health line where it did not. Both are drawn in the same place, which is why they are one
   * field here — `app/models/inspector.ts`'s `hopMetaLine` is the decision.
   */
  readonly meta: string;
  /** The health dot's state word — the first part of its accessible name. */
  readonly health: string;
}

/**
 * `implement-primary`'s three hops — the chain mockup 06 opens the inspector on.
 *
 * Hop 1 carries **no** stored note and prints `Primary · healthy · 42ms`, which is the seed's
 * deliberate refusal to store the mockup's own sentence: *Primary* is position 1, *healthy* is
 * the connection's status and `42ms` is a latency measured minutes ago, so a note holding that
 * sentence would freeze a measurement into prose the first time a check ran. Hops 2 and 3
 * carry the operator's sentences, which are prose and are stored.
 */
export const SEEDED_IMPLEMENT_CHAIN: readonly SeededHop[] = [
  {
    alias: "coder-max",
    resolution: "claude-fable-5 · Anthropic Claude",
    meta: "Primary · healthy · 42ms",
    health: "healthy",
  },
  {
    alias: "coder-fallback",
    resolution: "gpt-5-codex · GitHub Copilot",
    meta: "Fallback on 5xx / timeouts",
    health: "error",
  },
  {
    alias: "local-docs",
    resolution: "qwen3-coder:32b · Ollama · workstation",
    meta: "Offline mode — keeps the loop turning without a network",
    health: "healthy",
  },
];

/** `implement-primary`'s cost cap — the only route the seed gives one. */
export const IMPLEMENT_MAX_COST = "$2.50";

/* ------------------------------------------------------------------ the rules card */

/** One row of the escalation-rules card. */
export interface SeededRule {
  /** `escalation_rules.id` — literal in the migration, and what a restore addresses. */
  readonly id: string;
  /** The database's generated sentence — the row's text, and its switch's accessible name. */
  readonly display: string;
}

/**
 * The `route_local` rule — the one whose effect the simulate leg switches off and on.
 *
 * Named rather than reached for by index into {@link SEEDED_RULES}, because *which* rule this
 * is matters: it is the only one of the three that names **no** task kind, so it is the one
 * whose absence moves a resolved primary rather than only a params document.
 */
export const DOCS_ONLY: SeededRule = {
  id: "5eed0013-0000-4000-8000-000000000003",
  display: DOCS_ONLY_RULE,
};

/**
 * The three rules, in `sort_order` — the card's `3 active`.
 *
 * Their sentences are **generated columns** (V018): PostgreSQL derives each from the rule's
 * `when` and `then` and refuses a hand-written one, so the seed spells none of them. That is
 * what makes them safe to write down here — the strings below are the schema's output, and a
 * change to the derivation turns this leg red rather than silently re-wording a card.
 */
export const SEEDED_RULES: readonly SeededRule[] = [
  { id: "5eed0013-0000-4000-8000-000000000001", display: EFFORT_RULE },
  { id: "5eed0013-0000-4000-8000-000000000002", display: SECURITY_RULE },
  DOCS_ONLY,
];

/* ------------------------------------------------------------------ the spend card */

/** One metered row of the spend card. */
export interface SeededSpendRow {
  /** The provider's name — `Local (…)` names every kind the local row sums. */
  readonly name: string;
  /** The amount, as the card prints it. */
  readonly amount: string;
  /** The note beside a priced total that does not cover every call, or `null`. */
  readonly unpriced: string | null;
}

/**
 * The four rows of *Spend by provider · 30d*, largest first — the order the service sends.
 *
 * The local row is the interesting one and holds two facts at once: `$0.00`, because the calls
 * behind it were **priced at nothing** (`cost_cents = 0`, a recorded fact about a call that
 * cost nothing), and *5 unpriced calls*, because five rows in the window carry `null` instead
 * — *nobody priced this*. DASH-J.4 (#92) is the rule that the two must not render alike, and
 * `acme-robotics` is the one workspace holding both states, so it is the only place the
 * distinction can be observed end to end rather than argued about.
 */
export const SEEDED_SPEND: readonly SeededSpendRow[] = [
  { name: "Anthropic", amount: "$412.80", unpriced: null },
  { name: "GitHub Copilot", amount: "$76.00", unpriced: null },
  { name: "Cursor", amount: "$64.10", unpriced: null },
  { name: "Local (Ollama + OpenAI-compatible)", amount: "$0.00", unpriced: "5 unpriced calls" },
];

/** The card's title, composed from the window it was measured over. */
export const SPEND_TITLE = "Spend by provider · 30d";

/** The footnote — a ratio over the same window, and the seed is built to land it exactly. */
export const LOCAL_SHARE_NOTE = "Local models served 31% of all tokens.";

/* ------------------------------------------------------------------ the empty workspace */

/**
 * The guidance card's title in a workspace that has connected no provider.
 *
 * AA.6's ([#205](https://github.com/NobuData/ouroboros/issues/205)) first guidance state, and
 * the one `kensuenobu` is in: an empty strip is an *answer*, so the matrix's seat carries the
 * path out of the state rather than the refusal's banner. The two must not look alike.
 */
export const NO_PROVIDERS_TITLE = "Routing needs a provider connection";

/**
 * The spend card's zero-state title.
 *
 * **Not an em-dash**, and the distinction is decision M7 read from the other side: `—` is what
 * a figure that *could not be read* draws, and a workspace that has never routed anything has
 * no figure to draw at all. The card says the second thing in words.
 */
export const NO_SPEND_TITLE = "No spend recorded";

/* ------------------------------------------------------------------ putting a route back */

/**
 * One route as `PUT /api/v1/routing/routes/{taskKind}` takes it.
 *
 * The contract's `RoutePolicy`: the chain **is** the array — there are no positions in the
 * request and the server numbers them densely from 1 — and the three policy fields are
 * required, with `null` meaning *off* rather than *leave it alone*.
 */
export interface RouteBody {
  /** The chain, in order. A hop names an alias and never a raw model id. */
  readonly hops: readonly { readonly alias: string; readonly note: string | null }[];
  /** Whether local hops are permitted at all. */
  readonly allowLocalFallback: boolean;
  /** The deepest stored hop this route may run on, or `null` for no floor. */
  readonly floorHopIndex: number | null;
  /** The cap in whole cents, or `null` for no cap. */
  readonly maxCostCentsPerRun: number | null;
}

/**
 * The two routes this leg edits, exactly as the seed left them.
 *
 * Written out rather than read back before each test, for the reason the rest of this module
 * is written out: a restore that re-sent whatever it found would put back a *broken* route
 * just as faithfully as a good one, and the next run would inherit it. These are the rows
 * `R__dev_seed_routing.sql` writes, and a run that ends with the workspace holding anything
 * else has left a mess the next run can see.
 */
export const SEEDED_ROUTES = {
  /** The three-hop chain the reorder leg swaps hops 2 and 3 of. */
  implement: {
    hops: [
      { alias: "coder-max", note: null },
      { alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
      { alias: "local-docs", note: "Offline mode — keeps the loop turning without a network" },
    ],
    allowLocalFallback: true,
    floorHopIndex: null,
    maxCostCentsPerRun: 250,
  },
  /**
   * The two-hop chain the floor leg switches a floor on.
   *
   * Its primary is the **only** unhealthy provider in the workspace, which is what makes it
   * the route a floor can be observed on: with the floor at hop 1 the primary is unreachable
   * and the fallback is forbidden, so the run has nowhere to go and says so.
   */
  "test-gen": {
    hops: [
      { alias: "coder-fallback", note: null },
      { alias: "coder-std", note: null },
    ],
    allowLocalFallback: true,
    floorHopIndex: null,
    maxCostCentsPerRun: null,
  },
} as const satisfies Record<string, RouteBody>;

/** Which routes {@link restoreRoute} knows how to put back. */
export type SeededRouteKind = keyof typeof SEEDED_ROUTES;

/**
 * Put one route back exactly as the seed wrote it.
 *
 * @param context - The context to act for. Its person must be an `owner` or an `admin`; the
 *   API answers `403` to anybody else, which is the rule the read-only leg observes rather
 *   than enforces.
 * @param kind - Which route.
 * @returns When the restore has been attempted. It never throws — see `support/rest.ts`.
 */
export function restoreRoute(context: BrowserContext, kind: SeededRouteKind): Promise<void> {
  return quietly(
    () =>
      writeAs(
        context,
        "PUT",
        `/api/v1/routing/routes/${kind}`,
        SEEDED_ROUTES[kind],
        `restoring the ${kind} route`,
      ),
    `the ${kind} route was not restored — the next run's matrix, its screenshots and its ` +
      "simulations all start from a chain nobody wrote.",
  );
}

/* ------------------------------------------------------------------ putting a rule back */

/**
 * Put an escalation rule back where the seed left it — enabled.
 *
 * **The position is not a parameter.** All three seeded rules are enabled, which is the card's
 * `3 active`, and a rule left off would take the matrix's escalation column and the
 * simulator's answer with it — so there is one thing to restore a rule *to*, and a signature
 * that could ask for the other one would be a signature that could get it wrong.
 *
 * @param context - The context whose workspace to restore. Its person must be an `owner` or
 *   an `admin`; the API answers `403` to anybody else.
 * @param id - The rule, as {@link SEEDED_RULES} names it.
 * @returns When the restore has been attempted. It never throws — see `support/rest.ts`.
 */
export function restoreRule(context: BrowserContext, id: string): Promise<void> {
  return quietly(
    () =>
      writeAs(
        context,
        "PATCH",
        `/api/v1/routing/rules/${id}`,
        { enabled: true },
        `switching rule ${id} back on`,
      ),
    `escalation rule ${id} was not switched back on — the next run's matrix, rules card and ` +
      "simulations all see a workspace this one suspended a rule in.",
  );
}
