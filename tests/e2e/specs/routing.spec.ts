/**
 * Leg 9 — *mockup 06, and the three promises on it that no unit test can hold at once*
 * ([#206](https://github.com/NobuData/ouroboros/issues/206), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * `/models` has thorough coverage on both sides of every boundary it crosses.
 * `ouroboros-rest` proves `resolve()` against a matrix of inputs; `ouroboros-ui` proves each
 * card against a payload; `ouroboros-db` proves the seed adds up. All of that can be green
 * while the page does the wrong thing, because every interesting behaviour here **is** a
 * boundary: a reorder is UI → REST → PostgreSQL → back through resolution, and a rule's
 * switch only *means* anything if the next simulation changes.
 *
 * ## The assertion this leg exists for
 *
 * It is the negative one, and it is `a rule's switch changes what the simulator answers`
 * below: **toggling a rule off must change the simulate output.** If it does not, the
 * switches are decoration, escalation is not a feature, and nothing else in the repository
 * can see it — the rules are a table in one service, the switch is a control in another, and
 * the only place the two meet is a running stack.
 *
 * The other legs are the same argument at lower stakes:
 *
 *   * **parity** — the strip, the matrix, the inspector, the rules card and the spend card,
 *     against the seed and against the mockup, in both palettes. Three of the figures on this
 *     page are *computed* — `$0.87` is an average over fifteen ledger rows, `41.0s` a median,
 *     `31%` a ratio — so drawing them is the whole chain from `token_usage` to the cell
 *     (decision **M7**, and `support/routing.ts` says which numbers are which);
 *   * **reorder → save → re-render** — a chain moved, committed and *re-read*, with the
 *     matrix's resolution lines redrawn from what the server now holds rather than from what
 *     this browser sent, and the change still there after a reload;
 *   * **floor + fail_run** — the page's sharpest promise. A route whose primary is genuinely
 *     unreachable, a floor that forbids the fallback, and a run that **stops and says so** —
 *     rendered as a designed outcome under the same heading a resolved chain gets, never as
 *     an error toast;
 *   * **member read-only** — a session, not a fixture. What a member is served is what the
 *     service and `mayAdminister` between them decided to serve;
 *   * **the guidance path** — a workspace with no routing foundations at all, guided rather
 *     than blanked, with the spend card's zero-state carrying no em-dash.
 *
 * ## Two deliberate divergences from the ticket's own words, and why
 *
 * **The rule-toggle context carries a diff kind as well as an effort.** The ticket says
 * *simulate `implement` at effort L, toggle the escalation rule off, simulate again, assert
 * the resolved primary and the applied-rules list both changed*. At effort L alone the
 * applied-rules list changes and **the resolved primary does not**: the rule the seed writes
 * for `effort ≥ L` names `coder-max`, which is already `implement`'s hop 1, so the rule
 * merges params over a primary it does not move (`RULE_CODES.paramsMerged` — the service's own
 * near-case, and the mockup's). Asserting a changed primary there would be asserting
 * something the seeded workspace cannot produce.
 *
 * So the context is *effort L **and** a docs-only diff*, which matches two rules — and the
 * second one, `route_local`, is the rule the leg switches. Then both halves of the ticket's
 * assertion are real at once: the resolved primary moves from `coder-max` to `local-docs` and
 * back, and the applied-rules list loses a sentence and regains it. Effort L stays in the
 * context, doing exactly what the ticket asked it to do — its rule is the one that must keep
 * applying while the other is switched off, which is what makes this a test of *that* switch
 * rather than of any switch.
 *
 * **The reorder is made with the move buttons, not with a drag.** The ticket says *drag (or
 * the keyboard equivalent)*, and the equivalence is a property of the code rather than a
 * hope: `app/models/chain-editor.tsx` routes a drop and a button press into the same
 * `editor.move(kind, from, to)`, and `ouroboros-ui`'s own suite drives the drag events
 * directly. What is left for a browser to add is whether the *handles ship* — that a member
 * has none and an owner has one per hop, marked `draggable` — which this leg asserts, and
 * that the reorder survives the round trip, which the buttons exercise identically. Native
 * HTML5 drag-and-drop through a synthetic pointer is the one mechanism here that fails
 * intermittently, and this suite runs with `retries: 0` on purpose.
 *
 * ## What this leg leaves alone, and what it puts back
 *
 * Two tests **write**: the reorder commits a chain and the floor commits a policy, both to
 * rows keyed on the workspace; a third switches a rule off. None is scoped to a browser, and
 * this suite runs against a stack that is not always torn down between runs. Each therefore
 * has a teardown that puts the seed's own value back — the value written down in
 * `support/routing.ts`, never one read back from the page, because a restore that re-sent
 * whatever it found would put back a broken route just as faithfully as a good one.
 *
 * The **guidance path** is here too, though the ticket's scope does not name it: AA.6
 * ([#205](https://github.com/NobuData/ouroboros/issues/205)) hands it to this leg twice in the
 * roadmap, and it costs a second. `kensuenobu` — the personal workspace #704 gives everybody
 * at first sign-in — carries no connection, no alias, no task kind and no usage row, and that
 * absence is a *fixture*: the empty states below are a workspace rather than a mocked payload.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  DOCS_ONLY,
  DOCS_ONLY_RULE,
  EFFORT_RULE,
  EM_DASH,
  IMPLEMENT_MAX_COST,
  LOCAL_SHARE_NOTE,
  NO_PROVIDERS_TITLE,
  NO_SPEND_TITLE,
  ROUTING_PATH,
  SECURITY_RULE,
  SEEDED_IMPLEMENT_CHAIN,
  SEEDED_MATRIX,
  SEEDED_PROVIDERS,
  SEEDED_RULES,
  SEEDED_SPEND,
  SPEND_TITLE,
  restoreRoute,
  restoreRule,
  routingPathFor,
  seededRow,
} from "../support/routing";
import { SEED_MEMBER, SEED_OWNER, SEED_PERSONAL_TENANT, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import { PANE_SELECTOR } from "../support/shell";
import { pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** The page's `<h1>` — mockup 06's promise, verbatim. */
const ROUTING_TITLE = "Route every kind of work to the model that earns it.";

/** The matrix table's accessible name — its `<caption>`, which is visually hidden. */
const MATRIX_CAPTION = "Task kinds and the routes they resolve through";

/** The row the mockup opens the inspector on, and the chain every editing leg edits. */
const IMPLEMENT = seededRow("implement");

/** The two-hop route the floor leg turns into a designed failure. */
const TEST_GEN = seededRow("test-gen");

/** The floor switch's sentence on a two-hop chain — the deepest floor that still refuses. */
const TEST_GEN_FLOOR = "Fail run instead of degrading below fallback 1";

/**
 * Sign in, enter the workspace, and land on the routing screen.
 *
 * A `?route=` may be asked for, and it is the **server** that reads it: the row arrives
 * selected in the first paint, so a test whose subject is the inspector does not have to drive
 * the table to reach it. What that does *not* prove is that React has hydrated — this page is
 * a Server Component and its `<h1>` is on the first byte. So this waits for hydration too, in
 * the shape the page's own Suspense boundary gives it — see below.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param options.as - Whose session, as `support/seed.ts` names them. The owner by default.
 * @param options.route - Which row to arrive with selected, or `null` for none.
 * @param options.workspace - Which workspace to act in. The seeded demo one by default; the
 *   guidance leg names the personal one, which has no routing rows of any kind.
 * @returns When the page head has rendered.
 */
async function enterRouting(
  context: BrowserContext,
  page: Page,
  options: {
    readonly as?: string;
    readonly route?: string | null;
    readonly workspace?: string;
  } = {},
): Promise<void> {
  const { as = SEED_OWNER.id, route = null, workspace = SEED_TENANT.slug } = options;

  await signIn(context, as);
  await selectWorkspace(context, workspace);
  await page.goto(route === null ? ROUTING_PATH : routingPathFor(route));

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ROUTING_TITLE);

  // …and then wait for the page to be **one** page, which is this file's hydration barrier.
  //
  // `app/(app)/models/(routing)/loading.tsx` puts this segment behind a Suspense boundary, so
  // the server streams the screen into a hidden `<div>` and React relocates it on hydration.
  // Until that happens the document holds two complete copies of `<main class="models">` — one
  // of them out of the accessibility tree — and the copy outlives `readyState: "complete"`,
  // which is what `page.goto` waits for. Role locators ignore the hidden one and `getByText`
  // does not, and that is not a difference a reader of a leg should have to keep in mind.
  //
  // Waiting on the count rather than on a React-internal id: *the page is one page* is the
  // observable fact, and it is reclaimed by exactly the hydration every interactive assertion
  // below needs anyway.
  await expect(page.locator("main.models")).toHaveCount(1);
}

/** The routing screen, as a landmark — everything asserted on is inside it. */
function screen(page: Page): Locator {
  return page.getByRole("main");
}

/**
 * The matrix, as a grid.
 *
 * A `grid` rather than a `table`: `app/ui/table.tsx` declares the role only when it is given a
 * selection, because `aria-selected` on a `<tr>` means nothing in a plain table. So the role
 * this locator asks for is itself an assertion that the matrix is the selectable one.
 *
 * @param page - The page.
 * @returns The grid.
 */
function matrix(page: Page): Locator {
  return page.getByRole("grid", { name: MATRIX_CAPTION });
}

/**
 * One row of the matrix, by its task kind.
 *
 * By the kind's cell rather than by index, so a failure names the row a reader would name and
 * a matrix that lost a row fails on the row rather than on the one that took its place.
 *
 * @param page - The page.
 * @param kind - The task kind.
 * @returns The `<tr>`.
 */
function row(page: Page, kind: string): Locator {
  return matrix(page)
    .locator("tbody tr")
    .filter({ has: page.getByText(kind, { exact: true }) });
}

/** The inspector's card for the selected route — `ROUTE — implement-primary`. */
function inspector(page: Page, tag: string): Locator {
  return page.getByRole("region", { name: `Route — ${tag}` });
}

/** The escalation-rules card. */
function rulesCard(page: Page): Locator {
  return page.getByRole("region", { name: "Escalation rules" });
}

/** The spend card. */
function spendCard(page: Page): Locator {
  return page.getByRole("region", { name: SPEND_TITLE });
}

/** The simulate panel, whichever of the page's two buttons opened it. */
function sheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Simulate routing" });
}

/**
 * The page head's **Save routes** — the mockup's primary action.
 *
 * `.first()` because there are two: the head's, and the dirty bar's own, which appears under
 * the tab set while there is something to decide. The frame draws the head above the bar, so
 * the first in the document is the one the mockup means.
 *
 * @param page - The page.
 * @returns The button.
 */
function saveRoutes(page: Page): Locator {
  return page.getByRole("button", { name: "Save routes" }).first();
}

/**
 * Select a row the way a reader does, and wait for the page to say it happened.
 *
 * The selection is reflected into `?route=` with `history.replaceState` rather than through the
 * router, so that arrowing down eight rows costs no round trip and leaves no back-stack entry.
 * Asserting the address bar here is therefore AA.2's *a selected route survives a reload* from
 * the writing side: this is the URL the reload will read.
 *
 * @param page - The page.
 * @param kind - The task kind to select.
 * @returns When the row is selected and the address bar says so.
 */
async function selectRow(page: Page, kind: string): Promise<void> {
  await row(page, kind).click();

  await expect(row(page, kind)).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(new RegExp(`[?&]route=${kind}(&|$)`));
}

/**
 * Run one simulation in the open sheet, and return the answer's section.
 *
 * The context is re-applied on every call rather than only on the first: the sheet keeps its
 * draft across a close and a re-open — it is the same mounted component — and a leg that
 * assumed either way would be relying on a detail of how the panel is mounted.
 *
 * @param page - The page, with the sheet open.
 * @param context.effort - The effort to size the work at, or `null` for *Not sized*.
 * @param context.diffKind - The diff classification, or `null` for *Not classified*.
 * @returns The sheet, which is where the answer lands — so a caller asserts on one locator
 *   whether the resolution was drawn or the question was refused.
 */
async function runSimulation(
  page: Page,
  context: { readonly effort?: string | null; readonly diffKind?: string | null } = {},
): Promise<Locator> {
  const panel = sheet(page);

  await panel.getByLabel("Effort").selectOption(context.effort ?? "");
  await panel.getByLabel("Diff").selectOption(context.diffKind ?? "");
  await panel.getByRole("button", { name: "Run simulation" }).click();

  return panel;
}

/**
 * The aliases of the hops the resolution kept, in order — the chain an executor would walk.
 *
 * The filter the contract leaves to the client: dropped hops stay in the panel, struck
 * through with their reason, so *which alias would actually answer this* is a question about
 * the kept ones and this is how the leg asks it.
 *
 * @param answer - The answer section.
 * @returns The kept hops' pills, as a locator.
 */
function keptHops(answer: Locator): Locator {
  return answer.locator(".models-simulate__hop:not(.models-simulate__hop--dropped) .ou-chip");
}

/* ------------------------------------------------------------------ parity */

test.describe("the routing screen draws the seeded workspace", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRouting(context, page, { route: IMPLEMENT.kind });
  });

  test("the health strip carries every connection, and names the one that is not healthy", async ({
    page,
  }) => {
    const strip = page.getByRole("list", { name: "Provider health" });
    const chips = strip.getByRole("listitem");

    await expect(chips).toHaveCount(SEEDED_PROVIDERS.length);

    for (const [index, provider] of SEEDED_PROVIDERS.entries()) {
      const chip = chips.nth(index);

      // The order is the service's, so asserting position by position asserts it.
      await expect(chip, provider.name).toContainText(provider.name);

      // The state, in words. Visible for every state but the healthy one — where the mockup
      // draws a bare `Anthropic ●` and putting *healthy* on four chips would drown the one
      // that is not — and in the accessibility tree either way, which is where this reads it.
      await expect(chip, provider.name).toContainText(provider.state);

      if (provider.meta !== null) {
        await expect(chip.locator(".models-health__meta"), provider.name).toHaveText(provider.meta);
      }
    }

    // The hover: the state, then when it was last checked. The timestamp is measured from the
    // stack's own clock — every seeded `last_checked_at` is `now() - interval` — so its shape
    // is what is asserted and the clause that carries it is what matters.
    await expect(chips.first()).toHaveAttribute("title", /^Last checked \d{4}-\d{2}-\d{2} /);
  });

  test("the matrix draws the eight seeded kinds with their routes and their figures", async ({
    page,
  }) => {
    const rows = matrix(page).locator("tbody tr");

    await expect(rows).toHaveCount(SEEDED_MATRIX.length);
    await expect(page.getByRole("region", { name: "Routing matrix" })).toContainText(
      "8 task kinds",
    );

    for (const [index, expected] of SEEDED_MATRIX.entries()) {
      const cells = rows.nth(index);
      const where = `${expected.kind} (row ${index + 1})`;

      // Order is `task_kinds.sort_order` — the loop's own order of operations — so position
      // by position is the assertion.
      await expect(cells.locator(".models-matrix__kind"), where).toHaveText(expected.kind);
      await expect(cells.locator(".models-matrix__desc"), where).toHaveText(expected.description);

      // The route's own tag, never one composed from the kind: `test-gen` tags
      // `testgen-primary`, which is exactly the mistake a client that composed it would make.
      await expect(cells, where).toContainText(expected.tag);

      // The two model columns. The pill is what the route *names*; the line under it is what
      // that name currently *means* — three tables deep, and the only place a raw model id is
      // allowed to appear (decision M1).
      const aliases = cells.locator(".models-matrix__alias");

      await expect(aliases.nth(0), `${where} primary`).toContainText(expected.primary.alias);
      await expect(aliases.nth(0), `${where} primary`).toContainText(expected.primary.resolution);
      await expect(aliases.nth(1), `${where} fallback`).toContainText(expected.fallback.alias);
      await expect(aliases.nth(1), `${where} fallback`).toContainText(expected.fallback.resolution);

      // The computed columns — an average and a median over the ledger, not a stored figure.
      // `$0.00` on the two local rows is priced-at-nothing and is drawn; the em-dash is what
      // an unmeasurable row would draw, and no row here is one.
      await expect(cells.locator(".models-matrix__num").nth(0), `${where} cost`).toHaveText(
        expected.cost,
      );
      await expect(cells.locator(".models-matrix__num").nth(1), `${where} p50`).toHaveText(
        expected.latency,
      );
    }
  });

  test("the escalation column is the schema's answer, not the mockup's", async ({ page }) => {
    for (const expected of SEEDED_MATRIX) {
      const cell = row(page, expected.kind).locator(".models-matrix__escalation");

      if (expected.escalation.length === 0) {
        await expect(cell, expected.kind).toHaveText(EM_DASH);
        continue;
      }

      for (const sentence of expected.escalation) {
        await expect(cell, expected.kind).toContainText(sentence);
      }
    }

    // Two halves of one claim, and both are the schema's rather than the artwork's. The
    // mockup draws the effort rule on `plan`; Y.3 (#191) made its `then` name `implement`, so
    // the column computes it there — asserted row by row above. And `route_local` names no
    // task kind at all, because *everything* is exactly the absence of one, so its sentence
    // is on the card and on **no** row of this table.
    await expect(matrix(page)).not.toContainText(DOCS_ONLY_RULE);
  });

  test("the inspector holds the selected route's whole chain, with its health and its policy", async ({
    page,
  }) => {
    const card = inspector(page, IMPLEMENT.tag);
    const hops = card.getByRole("list", { name: "Chain" }).getByRole("listitem");

    await expect(hops).toHaveCount(SEEDED_IMPLEMENT_CHAIN.length);

    for (const [index, hop] of SEEDED_IMPLEMENT_CHAIN.entries()) {
      const rail = hops.nth(index);
      const where = `hop ${index + 1} (${hop.alias})`;

      await expect(rail, where).toContainText(hop.alias);
      await expect(rail.locator(".models-chain__resolution"), where).toHaveText(
        `→ ${hop.resolution}`,
      );

      // The line beneath: the operator's note where the seed wrote one, the hop's own health
      // line where it did not. Hop 1's `Primary · healthy · 42ms` is *composed* — the role
      // from the position, the word from the connection's status, the latency from the last
      // check — which is why the seed deliberately stores no sentence for it.
      await expect(rail.locator(".models-chain__meta"), where).toHaveText(hop.meta);

      // The dot is the strip's read, indexed — one decision drawn twice, so a hop cannot
      // disagree with the chip above the matrix about the connection it runs on.
      await expect(rail.getByRole("img"), where).toHaveAttribute(
        "aria-label",
        new RegExp(`^${hop.health} · Last checked `),
      );
    }

    // The policy, in its real position. `implement-primary` is the only route the seed gives
    // a cap, which is what keeps the field from looking like a display of a default.
    await expect(
      card.getByRole("switch", { name: "Allow fallback to local models" }),
    ).toBeChecked();
    await expect(
      card.getByRole("switch", { name: /^Fail run instead of degrading below fallback / }),
    ).not.toBeChecked();
    await expect(card.getByLabel("Max cost per run")).toHaveValue(IMPLEMENT_MAX_COST);
  });

  test("the rules card prints the database's own three sentences", async ({ page }) => {
    const card = rulesCard(page);
    const rules = card.getByRole("listitem");

    await expect(rules).toHaveCount(SEEDED_RULES.length);
    await expect(card.getByText("3 active")).toBeVisible();

    for (const [index, rule] of SEEDED_RULES.entries()) {
      // Evaluation order, which is `sort_order` and is what a reader has to be able to trust:
      // a rule that fires second may depend on what the first one did.
      //
      // The *sentence* rather than the row, and `toHaveText` rather than `toContainText`: the
      // card splits `display` into runs so the alias can take the model hue, and this is the
      // assertion that the runs concatenate back to it **exactly** — nothing added, nothing
      // dropped, nothing re-spelled. The row around it also holds the switch's name and its
      // delete, which are controls rather than the rule.
      await expect(rules.nth(index).locator(".models-rules__sentence"), rule.display).toHaveText(
        rule.display,
      );

      // Every rule is on, and the switch is the position rather than a second opinion about
      // it — the count above and these three are the same fact read twice.
      await expect(
        card.getByRole("switch", { name: `Apply ${rule.display}` }),
        rule.display,
      ).toBeChecked();
    }

    // The card and the matrix print one string because there is one: `display` is a stored
    // generated column, derived by PostgreSQL from the rule's two documents and impossible to
    // hand-write. These two rows are the ones the matrix also draws.
    await expect(card).toContainText(EFFORT_RULE);
    await expect(card).toContainText(SECURITY_RULE);
  });

  test("the spend card meters four providers and says what ran locally", async ({ page }) => {
    const card = spendCard(page);
    const rows = card.getByRole("listitem");

    await expect(rows).toHaveCount(SEEDED_SPEND.length);

    for (const [index, provider] of SEEDED_SPEND.entries()) {
      const line = rows.nth(index);

      // Largest first, which is the service's order — the meters are widths *relative to the
      // largest*, so a second opinion about order would put a wider bar under a narrower one.
      await expect(line.locator(".models-spend__name"), provider.name).toHaveText(provider.name);
      await expect(line.locator(".models-spend__amount"), provider.name).toHaveText(
        provider.amount,
      );

      // Both facts about the local row at once: a priced total of `$0.00`, and beside it the
      // count of calls that total does not include because nobody priced them. DASH-J.4's
      // distinction, and the one row in the product where both states exist together.
      if (provider.unpriced === null) {
        await expect(line.locator(".models-spend__partial"), provider.name).toHaveCount(0);
      } else {
        await expect(line.locator(".models-spend__partial"), provider.name).toHaveText(
          provider.unpriced,
        );
      }
    }

    // A ratio over the same window, and the seed is arranged so the arithmetic lands on a
    // whole number rather than near one.
    await expect(card).toContainText(LOCAL_SHARE_NOTE);

    // Nothing on this card is drawn as unmeasured: every figure above was computed.
    await expect(card.locator(".models-spend__unpriced")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ reorder → save → re-read */

test.describe("a reordered chain is committed and survives a reload", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRouting(context, page);
  });

  // The route is a row keyed on the workspace and outlives this browser. Restored in teardown
  // rather than at the end of the test, so that an assertion that fails halfway through the
  // round trip does not hand the next run — and the next run's screenshots — a chain nobody
  // wrote. The value put back is the seed's own, written down, never one read off the page.
  test.afterEach(async ({ context }) => {
    await restoreRoute(context, "implement");
  });

  test("hops 2 and 3 swap, commit, and the matrix redraws from what the server holds", async ({
    page,
  }) => {
    await selectRow(page, IMPLEMENT.kind);

    const card = inspector(page, IMPLEMENT.tag);
    const [, second, third] = SEEDED_IMPLEMENT_CHAIN;

    // The pointer's affordance shipped, which is the half a button press cannot show: one
    // handle per hop, each actually draggable. The reorder itself is made with the buttons —
    // the same `editor.move`, and the one mechanism here that a synthetic pointer drives
    // unreliably. See this file's header.
    const handles = card.locator(".models-chain__handle[draggable='true']");
    await expect(handles).toHaveCount(SEEDED_IMPLEMENT_CHAIN.length);

    await card.getByRole("button", { name: `Move ${second.alias} down` }).click();

    // Announced, with the position and the count — what a reader who cannot see the rail needs
    // in order to know whether the hop is now the primary or the last resort.
    await expect(card.getByRole("status")).toHaveText(
      `${second.alias} moved to hop 3 of ${SEEDED_IMPLEMENT_CHAIN.length}.`,
    );

    // Nothing has been saved yet, and the page says so in three places at once: the bar's
    // count, the mark on the row the bar is counting, and the mark in the inspector.
    const bar = screen(page).getByText("1 route changed");
    await expect(bar).toBeVisible();
    await expect(row(page, IMPLEMENT.kind)).toContainText("changed");

    // The matrix already draws the *draft* — the fallback column follows the editor rather
    // than the server, so a reader scanning the table sees what they are about to commit.
    await expect(row(page, IMPLEMENT.kind).locator(".models-matrix__alias").nth(1)).toContainText(
      third.alias,
    );

    // The head's **Save routes**, which is the mockup's primary action; the bar carries a
    // second one, and `.first()` is the head's because the frame draws it above the bar.
    await saveRoutes(page).click();

    // The bar leaves with the save, and the save says so.
    await expect(bar).toHaveCount(0);
    await expect(row(page, IMPLEMENT.kind)).not.toContainText("changed");

    // The half that matters, and the reason this leg exists. The edits are dropped and the
    // route re-read, so what the matrix draws now is what came back out of PostgreSQL through
    // resolution — including the resolution line, which is three tables deep and is not
    // anything this browser sent.
    const fallback = row(page, IMPLEMENT.kind).locator(".models-matrix__alias").nth(1);

    await expect(fallback).toContainText(third.alias);
    await expect(fallback).toContainText(third.resolution);

    // And it is not a client that is remembering. A fresh request, a fresh read, and the same
    // chain — which is the assertion an optimistic UI would pass everything above and fail.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ROUTING_TITLE);

    await expect(
      matrix(page)
        .locator("tbody tr")
        .filter({ has: page.getByText(IMPLEMENT.kind, { exact: true }) })
        .locator(".models-matrix__alias")
        .nth(1),
    ).toContainText(third.resolution);

    // The notes travelled with their hops rather than staying at their positions: a note is
    // the operator's sentence about *that hop*, and a reorder that left them behind would put
    // *"Fallback on 5xx / timeouts"* under a model that has nothing to do with it.
    await selectRow(page, IMPLEMENT.kind);
    const rail = inspector(page, IMPLEMENT.tag).getByRole("list", { name: "Chain" });

    await expect(rail.getByRole("listitem").nth(1).locator(".models-chain__meta")).toHaveText(
      third.meta,
    );
    await expect(rail.getByRole("listitem").nth(2).locator(".models-chain__meta")).toHaveText(
      second.meta,
    );
  });
});

/* ------------------------------------------------------------------ the rule switch */

test.describe("a rule's switch changes what the simulator answers", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRouting(context, page);
  });

  test.afterEach(async ({ context }) => {
    await restoreRule(context, DOCS_ONLY.id);
  });

  test("switching the local-routing rule off moves the resolved primary back", async ({ page }) => {
    await selectRow(page, IMPLEMENT.kind);

    await inspector(page, IMPLEMENT.tag)
      .getByRole("button", { name: "Simulate this route" })
      .click();

    // Effort L and a docs-only diff: two rules match, and only one of them is switched below.
    // See this file's header on why the ticket's *effort L* alone cannot move a primary.
    let answer = await runSimulation(page, { effort: "l", diffKind: "docs_only" });

    await expect(answer.getByText("Resolved")).toBeVisible();

    // `route_local` filtered the chain, so the run answers on the one local hop — and the two
    // cloud hops are still in the chain, struck through, each carrying the reason it was not
    // used. That is the panel's whole job: the reasoning, not the answer.
    await expect(keptHops(answer)).toHaveText([SEEDED_IMPLEMENT_CHAIN[2].alias]);
    await expect(answer).toContainText("an escalation rule routes this run to local providers");

    // Both rules matched, and both applied.
    const matched = answer.getByRole("list", { name: "Rules that matched" });
    await expect(matched.getByRole("listitem")).toHaveCount(2);
    await expect(matched).toContainText(EFFORT_RULE);
    await expect(matched).toContainText(DOCS_ONLY_RULE);

    await sheet(page).getByRole("button", { name: "Close" }).click();

    // The switch, and the count that follows the **read** rather than the press: the card
    // re-reads after the write, so `2 active` is the server's answer about the workspace and
    // not this browser's memory of what was clicked.
    const card = rulesCard(page);
    await card.getByRole("switch", { name: `Apply ${DOCS_ONLY_RULE}` }).click();

    await expect(card.getByText("2 active")).toBeVisible();
    await expect(card.getByRole("switch", { name: `Apply ${DOCS_ONLY_RULE}` })).not.toBeChecked();

    await inspector(page, IMPLEMENT.tag)
      .getByRole("button", { name: "Simulate this route" })
      .click();

    answer = await runSimulation(page, { effort: "l", diffKind: "docs_only" });

    // **The assertion this leg exists for.** Same question, same context, one switch moved —
    // and the resolved primary is a different model. A rules table nothing evaluated would
    // answer `local-docs` here exactly as it did above, and every other test in this file
    // would still be green.
    //
    // Asserted before the rules list below because it is also the barrier: the panel clears
    // the previous answer while the new question travels, so a rules-list assertion made
    // first could pass against an empty panel.
    await expect(keptHops(answer)).toHaveText([
      SEEDED_IMPLEMENT_CHAIN[0].alias,
      SEEDED_IMPLEMENT_CHAIN[2].alias,
    ]);

    // …and the applied-rules list lost exactly the sentence whose switch moved. The other rule
    // is still there and still applying, which is what makes this a test of *that* switch.
    const after = answer.getByRole("list", { name: "Rules that matched" });
    await expect(after.getByRole("listitem")).toHaveCount(1);
    await expect(after).toContainText(EFFORT_RULE);
    await expect(answer).not.toContainText(DOCS_ONLY_RULE);
  });
});

/* ------------------------------------------------------------------ the floor */

test.describe("a floor turns a degraded run into a designed failure", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRouting(context, page);
  });

  test.afterEach(async ({ context }) => {
    await restoreRoute(context, "test-gen");
  });

  test("with the floor on and the primary unreachable, the run fails and says why", async ({
    page,
  }) => {
    await selectRow(page, TEST_GEN.kind);

    const card = inspector(page, TEST_GEN.tag);

    // The route the floor can be observed on: its primary is `coder-fallback`, bound to the
    // one connection in the workspace whose last check failed. The hop says so before
    // anything is switched, which is what makes the failure below a consequence rather than a
    // coincidence.
    await expect(
      card.getByRole("list", { name: "Chain" }).getByRole("listitem").first(),
    ).toContainText(TEST_GEN.primary.alias);

    const floor = card.getByRole("switch", { name: TEST_GEN_FLOOR });
    await expect(floor).not.toBeChecked();

    await floor.click();

    // A policy edit joins the same batch a chain edit does — there is one batch, and nothing
    // on this page saves on change.
    await expect(screen(page).getByText("1 route changed")).toBeVisible();
    await saveRoutes(page).click();
    await expect(screen(page).getByText("1 route changed")).toHaveCount(0);

    // Read back from the server: the switch is on, and the sentence's number has become a
    // control over the chain's hops, so the floor can be moved without leaving the sentence.
    await expect(card.getByRole("switch", { name: TEST_GEN_FLOOR })).toBeChecked();
    await expect(card.getByLabel("Floor hop")).toHaveValue("1");

    await card.getByRole("button", { name: "Simulate this route" }).click();

    const answer = await runSimulation(page);

    // A `fail_run` is an **answer**. It arrives as a `200` with a reason, it is drawn under
    // the same heading a resolved chain gets, and the reason is the first thing said — the
    // whole point of the floor being that a run stops *and says so*.
    await expect(answer.getByText("The run fails")).toBeVisible();
    await expect(answer.locator(".models-simulate__failure")).toHaveText(
      "The floor is hop 1 — no hop at or above it is usable, so this run fails rather than " +
        "degrading below it.",
    );

    // Not an error's treatment. The panel keeps a separate, alert-toned place for a question
    // the service refused, and this must not be in it.
    await expect(answer.locator(".models-simulate__refused")).toHaveCount(0);

    // Both halves of the reason, on the hops they are about: the primary is out because its
    // provider is unreachable, and the fallback is out because the operator forbade it.
    // Neither hop is missing from the chain — a refusal is never a shorter chain.
    const hops = answer.getByRole("list", { name: "Chain" }).getByRole("listitem");

    await expect(hops).toHaveCount(2);
    await expect(hops.nth(0)).toContainText("GitHub Copilot is unreachable (elevated latency)");
    await expect(hops.nth(1)).toContainText("this route may not degrade below hop 1");
    await expect(keptHops(answer)).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ the empty workspace */

test.describe("a workspace with no routing foundations is guided rather than blanked", () => {
  test.beforeEach(async ({ context, page }) => {
    // `kensuenobu` is the personal workspace #704 gives everybody at first sign-in, and
    // `R__dev_seed_routing.sql` deliberately writes **no** row against it: no connection, no
    // alias, no task kind, no route and no usage. That absence is the fixture — every zero
    // state below is a *workspace* rather than a mocked payload, which is what lets this leg
    // assert AA.6's guidance path end to end.
    await enterRouting(context, page, { workspace: SEED_PERSONAL_TENANT.slug });
  });

  test("the matrix's seat holds the path out of the state, not a blank region", async ({
    page,
  }) => {
    // Two different facts wearing different clothes. A workspace with no providers has
    // *answered*, with an empty strip, and is a state the product guides out of — so the
    // strip's seat carries a sentence and a link rather than the refusal's banner.
    // The note by its class: it is a sentence rather than a control, so it has no role of its
    // own — and the tab set above carries a link of the same name, which is exactly the reason
    // to scope rather than to reach for the first match.
    const note = screen(page).locator(".models-health__note");

    await expect(note).toContainText("No providers are connected.");
    await expect(note.getByRole("link", { name: "Providers & keys" })).toBeVisible();
    await expect(note).not.toHaveClass(/models-health__note--failed/);
    await expect(screen(page)).not.toContainText("could not be read");

    // The guidance card stands where the matrix would, with the reader's place on the path
    // marked: connect a provider first, seed the routes second.
    const card = page.getByRole("region", { name: "Set up routing" });

    await expect(card).toContainText(NO_PROVIDERS_TITLE);

    const steps = card.getByRole("listitem");
    await expect(steps).toHaveCount(2);

    await expect(steps.nth(0)).toContainText("Connect a provider");
    await expect(steps.nth(1)).toContainText("Seed the default routes");

    // The reader's place on the path, twice over and never in colour alone: the step that is
    // next carries `aria-current="step"`, and both carry the word — *next*, *then* — beside
    // their titles.
    await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
    await expect(steps.nth(0)).toContainText("next");
    await expect(steps.nth(1)).not.toHaveAttribute("aria-current", "step");
    await expect(steps.nth(1)).toContainText("then");

    // …and only the step that is next carries an action, which is what makes *next* a fact
    // rather than a decoration. The route-seeding control belongs to the state after this one.
    await expect(steps.nth(0).getByRole("link", { name: "Providers & keys →" })).toBeVisible();
    await expect(steps.nth(1).getByRole("link")).toHaveCount(0);
    await expect(steps.nth(1).getByRole("button")).toHaveCount(0);

    // The card names the way to see the populated page rather than leaving a developer to
    // wonder whether the product is broken.
    await expect(card).toContainText("The development seed's acme-robotics workspace");

    // No matrix, and nothing fabricated in its place: not one of the demo workspace's eight
    // route tags appears here, which is the assertion that would catch a page falling back to
    // the artwork the way `app/models/` is drawn from it.
    await expect(matrix(page)).toHaveCount(0);
    for (const seeded of SEEDED_MATRIX) {
      await expect(screen(page), seeded.kind).not.toContainText(seeded.tag);
    }
  });

  test("the cards beside it are drawn in their zero states, not omitted", async ({ page }) => {
    // The guided workspace keeps its right column, and its spend card is the zero-state the
    // ticket asks for by name — which only exists on a card that is drawn at all.
    await expect(rulesCard(page)).toContainText("No escalation rules");
    await expect(rulesCard(page).getByText("0 active")).toBeVisible();

    await expect(spendCard(page)).toContainText(NO_SPEND_TITLE);

    // **Nothing here is an em-dash.** Decision M7's rule read from the other side: a figure
    // that could not be read draws `—`, and a workspace that has simply never routed anything
    // has no figure to draw at all. The two must not render alike, and this is the workspace
    // where the second one can be observed.
    await expect(spendCard(page)).not.toContainText(EM_DASH);
    await expect(spendCard(page)).not.toContainText("$0.00");
  });
});

/* ------------------------------------------------------------------ the member's page */

test.describe("a member is served the routing screen read-only", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRouting(context, page, { as: SEED_MEMBER.id, route: IMPLEMENT.kind });
  });

  test("nothing that would change a route is drawn, and the role is explained", async ({
    page,
  }) => {
    // The role, named once, near the top. A page that quietly draws less reads as broken
    // rather than as scoped, so the omission is explained rather than merely made.
    await expect(page.getByRole("note")).toContainText(`Viewing routing as a ${SEED_MEMBER.role}.`);

    // No handle, anywhere. The matrix's ⠿ is a shortcut into the editor and each hop's ⠿ is
    // the thing that reorders; both are drawn for a role that may edit and for nobody else,
    // and the card head's hint that explains them goes with them.
    await expect(screen(page)).not.toContainText("⠿");
    await expect(
      page.getByRole("button", { name: `Edit the ${IMPLEMENT.kind} chain` }),
    ).toHaveCount(0);

    // No commit, and nothing to commit with: a member's editor holds no edits by
    // construction, so there is no bar — and no **Save routes**, because a disabled save
    // button is an editing affordance.
    await expect(page.getByRole("button", { name: "Save routes" })).toHaveCount(0);
    await expect(screen(page)).not.toContainText("route changed");

    // No switch on a rule, no builder, no delete — **absent, not disabled**. A rule's position
    // is already in the count and in the sentence's own treatment, so a member is shown the
    // rules and nothing that looks like a control they cannot use.
    const card = rulesCard(page);

    await expect(card.getByRole("switch")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "+ Add rule" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: /^Delete rule: / })).toHaveCount(0);

    // …and the rules themselves are still there. Read-only is a rendering mode, not a page
    // with things missing.
    await expect(card.getByRole("listitem")).toHaveCount(SEEDED_RULES.length);
    await expect(card.getByText("3 active")).toBeVisible();
  });

  test("the route's policy is shown in its real positions, inert, with the reason", async ({
    page,
  }) => {
    // The deliberate other half, and the opposite decision from the rules card's — made on the
    // same page, on purpose. A route's policy is part of its story: a card that hid the
    // switches from a reader who may only read would look like a route with no policy at all,
    // so they render in their real positions and every one of them is inert *with its reason*
    // (design system § 3.3). The rules card's switches are absent because a rule's position is
    // legible without them; these are not.
    const card = inspector(page, IMPLEMENT.tag);
    const reason = "Only an owner or an admin can change a route's policy.";

    const local = card.getByRole("switch", { name: "Allow fallback to local models" });

    await expect(local).toBeChecked();
    await expect(local).toHaveAttribute("aria-disabled", "true");
    await expect(local).toHaveAttribute("title", reason);

    await expect(card.getByLabel("Max cost per run")).toBeDisabled();
    await expect(card.getByLabel("Max cost per run")).toHaveValue(IMPLEMENT_MAX_COST);
    await expect(card).toContainText(reason);

    // The chain is the same chain an owner is served, without the controls: the hops, their
    // resolutions and their health all draw.
    const hops = card.getByRole("list", { name: "Chain" }).getByRole("listitem");

    await expect(hops).toHaveCount(SEEDED_IMPLEMENT_CHAIN.length);
    await expect(hops.first()).toContainText(SEEDED_IMPLEMENT_CHAIN[0].resolution);
    await expect(card.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "+ Add hop" })).toHaveCount(0);

    // Simulating is not editing, and every member may do it: looking at which model would
    // answer a piece of work changes nothing.
    await expect(card.getByRole("button", { name: "Simulate this route" })).toBeEnabled();
  });
});

/* ------------------------------------------------------------------ the shell */

test.describe("the shell holds the routing screen", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRouting(context, page, { route: IMPLEMENT.kind });
  });

  // The scale is a row keyed on the person and outlives this context. Restored after all three
  // tests rather than only the one that writes, because putting a preference back where it
  // already is costs one request and is the version of this hook nobody has to keep in step
  // with which test does what.
  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });

  test("the header and the sidebar do not move when the content pane scrolls", async ({ page }) => {
    const header = page.getByRole("banner");
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const pane = page.locator(PANE_SELECTOR);

    const before = { header: await header.boundingBox(), sidebar: await sidebar.boundingBox() };

    // The premise: a page that fitted the viewport would make everything below vacuously true.
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the routing screen must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Four regions of which exactly one scrolls (design system § 1, decision S2). Nothing in
    // the shell is `position: fixed` — the chrome is cells of a grid the height of the
    // viewport — so this asserts the grid survived a page with a subnav and a sticky bar of
    // its own stacked inside the pane.
    expect(await header.boundingBox()).toEqual(before.header);
    expect(await sidebar.boundingBox()).toEqual(before.sidebar);

    // And the document itself never scrolls, which is what makes the pane the only scroll
    // container rather than the second one.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the sidebar and the tab set both know where the reader is", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(sidebar.getByRole("link", { name: "Models" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Exactly one entry claims it. Two would make the sidebar's answer to *where am I* a
    // matter of which one the reader looked at first.
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

    // The section's own tab set says the same thing one level down, and the two must agree:
    // the sidebar names the section, the underline names the surface.
    await expect(screen(page).getByRole("link", { name: "Routing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the page still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();

    const html = page.locator("html");

    // The whole round trip: the preference is the *person's* and lives on the server, so the
    // attribute proves it was read and the root size proves one of the five
    // `:root[data-font-scale]` rules in `app/globals.css` shipped and acted on it.
    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    // The assertion a fifth more type is actually for, on the densest table in the product:
    // six columns, two levels of type in two of them, and a sentence in a third. Nothing may
    // make the pane scroll sideways — wide content scrolls inside its own wrapper (§ 1.3).
    const pane = page.locator(PANE_SELECTOR);
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // And the page is still the routing screen rather than a shell around a broken render.
    await expect(matrix(page).locator("tbody tr")).toHaveCount(SEEDED_MATRIX.length);
    await expect(row(page, IMPLEMENT.kind).locator(".models-matrix__num").nth(0)).toHaveText(
      IMPLEMENT.cost,
    );
  });
});

/* ------------------------------------------------------------------ both palettes */

/**
 * The window the parity pair is photographed through.
 *
 * **Taller than the suite's Desktop Chrome, because the page is.** The five surfaces the
 * ticket names are 1,900-odd pixels of screen, and the shell's pane is the only scroll
 * container — so an element screenshot of `<main>` cannot reveal what is below the fold the
 * way `fullPage` reveals a document, and Playwright renders the tail of it as bare ground.
 * That was recorded once before this constant existed: an image the right height with two
 * cards missing from it, which is worse than no baseline at all because it would have gone
 * on passing. Giving the window the page's own height makes the pane not scroll, so
 * everything paints and the ordinary viewport screenshot is the whole screen.
 *
 * **Wider than it, because the matrix is.** Six columns, two of them carrying two levels of
 * type, scroll inside the table's own wrapper at 1280 — which is § 1.3 working, and is
 * asserted as such at the 125% step above. It is not what a parity diff is for: a baseline
 * that clipped *Escalation*, `$/run avg` and `p50 latency` would be a baseline blind to
 * three of the columns whose figures this leg exists to hold the page to.
 */
const PARITY_WINDOW = { width: 1920, height: 2200 };

test.describe("the routing screen is drawn in both palettes", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await enterRouting(context, page, { route: IMPLEMENT.kind });
  });

  test("light and dark are both mockup 06", async ({ page }) => {
    // Nothing is masked, and that is a fact about the page rather than an omission. Every
    // figure on it is computed from rows that do not move — no clock, no elapsed column, no
    // greeting — and the one value the stack's own clock does produce, each connection's
    // last-checked time, lives in a `title` a screenshot cannot see.
    //
    // Which is only true because the health sweep is not running: it would rewrite the strip
    // about a minute into any stack, and with it the hop dots and the resolution lines.
    // `docker-compose.e2e.yml` is where that is arranged, and it argues the case at length.
    // The window must actually hold the page. If the pane scrolled, the shutter would record
    // the top of the screen and nothing would say so — the first thing to go would be the
    // spend card, which is one of the five surfaces the ticket asks to be diffed.
    expect(
      await page.locator(PANE_SELECTOR).evaluate((el) => el.scrollHeight - el.clientHeight),
      "the parity window must be tall enough to hold the whole screen without scrolling",
    ).toBe(0);

    await pinTheme(page, "light");
    await expect(page).toHaveScreenshot("routing-light.png");

    await pinTheme(page, "dark");
    await expect(page).toHaveScreenshot("routing-dark.png");
  });
});
