/**
 * Leg 14 — *mockup 21, and the registry's promises certified together*
 * ([#597](https://github.com/NobuData/ouroboros/issues/597), CI.7, amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * The claims mockup 21 makes are cross-layer by construction. *Swap the provider behind it and
 * nothing else changes* spans the inspector, the alias API, the reference index and the routing
 * matrix — a different page. *Deleting one is blocked while any route references it* spans a
 * view, a transaction and a dialog. *Raw model strings are rejected at publish time* spans a
 * JSON Schema, the publish gate and the workflow studio, which is not this roadmap's surface at
 * all. `ouroboros-rest`'s registry integration tests (#590) prove each layer; only this leg
 * proves they still mean the same thing composed.
 *
 * ## The assertion this leg exists for
 *
 * It is the rebind in `create → edit params → rebind → …` below: **after the inspector moves an
 * alias to another provider, the routing matrix — on `/models`, not on this page — must draw the
 * new binding in that alias's resolution line.** The line is read before the rebind too, so a
 * matrix that stopped re-reading bindings and a matrix that always happened to draw the new one
 * both go red. That is the BYOK story end to end, and nothing else in the repository can see it:
 * the binding is a column in one table, the line is a join three tables deep in another service's
 * read, and they meet only on a running stack.
 *
 * The other tests are the same argument at lower stakes:
 *
 *   * **parity** — the eight seeded rows, the inspector, the why-card and the chain card, against
 *     the seed and against the mockup, and screenshot-diffed in both palettes;
 *   * **the delete guard, from both sides** — the presentation's blocked **Remove**, and the
 *     service's `409` reached through a page drawn *before* a route was pointed at the alias. The
 *     second is the one that matters: a blocked button proves the table read the index, and only
 *     a refused delete proves the transaction did;
 *   * **import** — the head's dropdown, CH.4's candidates and a batch create that lands a row;
 *   * **the unbound path** — *bind later*, the orphan row it makes, and **Fix in Providers →**;
 *   * **the disable guard** — the confirm naming what will lose a hop, and a simulation on the
 *     routing page that drops it;
 *   * **governance** — a draft pinning a raw model id, refused at **Publish** with CH.6's sentence;
 *   * **a member's page** — a session, not a fixture;
 *   * **the shell** — fixed chrome over a scrolling pane, the Models entry lit, the subnav stuck
 *     to the pane's top, and the page at the 125% font scale.
 *
 * ## One deliberate divergence from the ticket's own words, and why
 *
 * **The `409` is reached through a second tab.** The ticket says *attempt delete on the referenced
 * original (409 dialog naming referrers)*, and on a page that has read the alias's references
 * there is no delete to attempt: **Remove** is inert with *blocked — 1 route references this
 * alias* before anybody presses it (CI.3's design, and asserted below). A `409` can only reach a
 * reader whose page was drawn before the reference existed — two people, or two tabs — so that is
 * the arrangement: a second page is opened on the alias while nothing references it, the route is
 * pointed at it, and that page's **Remove** is pressed. What comes back names the referrers the
 * service counted, which is the ticket's *naming referrers*; the chips naming each one by its tag
 * are asserted on the fresh page beside it.
 *
 * The **personal workspace's guidance** is here too, though the ticket's scope does not name it:
 * CI.6 (#596) hands *the personal-org seed* to this leg in the roadmap, and it costs a second.
 *
 * ## What this leg writes, and what it puts back
 *
 * Every test past parity writes: aliases of its own (removed by prefix, whether or not the test
 * reached the end), the `docs` route (restored to the seed's chain), `local-free`'s switch
 * (switched back on) and `standard-fix`'s draft (restored to the committed fixture). Each restore
 * is a teardown rather than a last step, so an assertion that fails halfway does not hand the next
 * run — and the parity pair — a workspace nobody seeded. `support/registry.ts` holds the values
 * put back and argues each.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  CHAIN_TITLE,
  CODER_MAX_CHAIN,
  CODER_MAX_REFERRERS,
  DISABLE_TARGET,
  EM_DASH,
  FINDINGS_MESSAGE,
  FIX_IN_PROVIDERS,
  IMPORT_SOURCE,
  LIFECYCLE_BINDING,
  LIFECYCLE_ROUTE,
  NO_KEY,
  RAW_PIN,
  REGISTRY_PATH,
  REGISTRY_TITLE,
  SEEDED_REGISTRY,
  STANDARD_FIX,
  TABLE_CAPTION,
  TABLE_NOTE,
  WHY_ROWS,
  WHY_TITLE,
  copyName,
  inspectorName,
  pinRawModel,
  registryPathFor,
  removeRunAliases,
  restoreAliasEnabled,
  restoreStandardFixDraft,
  routeThrough,
  runAliasName,
  seededAlias,
  switchName,
} from "../support/registry";
import { writeAs } from "../support/rest";
import { restoreRoute, routingPathFor } from "../support/routing";
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

/** The routing screen's `<h1>`, for the two tests that cross onto it. */
const ROUTING_TITLE = "Route every kind of work to the model that earns it.";

/** The routing matrix's accessible name — its visually hidden `<caption>`. */
const MATRIX_CAPTION = "Task kinds and the routes they resolve through";

/** The providers screen's `<h1>`, where **Fix in Providers →** must land. */
const PROVIDERS_TITLE = "Providers & keys";

/** Why every write affordance is inert for a member (`ownersAndAdmins`, CI.6). */
const READ_ONLY = {
  create: "Creating and importing aliases is for workspace owners and admins.",
  switch: "Switching an alias on or off is for workspace owners and admins.",
  edit: "Editing an alias is for workspace owners and admins.",
} as const;

/* ------------------------------------------------------------------ getting there */

/**
 * Sign in, enter a workspace, and land on the registry.
 *
 * Waits for hydration as well as for the head, for the reason `specs/routing.spec.ts` sets out:
 * the segment has a `loading.tsx`, so the server streams the screen into a hidden copy that React
 * relocates on hydration, and until then the document holds two `<main class="models">`.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param options.as - Whose session. The seeded owner by default.
 * @param options.alias - Which alias to arrive with selected, or `null` for none.
 * @param options.workspace - Which workspace. The seeded demo one by default.
 * @returns When the page is one page.
 */
async function enterRegistry(
  context: BrowserContext,
  page: Page,
  options: {
    readonly as?: string;
    readonly alias?: string | null;
    readonly workspace?: string;
  } = {},
): Promise<void> {
  const { as = SEED_OWNER.id, alias = null, workspace = SEED_TENANT.slug } = options;

  await signIn(context, as);
  await selectWorkspace(context, workspace);
  await openRegistry(page, alias);
}

/**
 * Navigate an already signed-in page to the registry, and wait for it to be one page.
 *
 * @param page - The page.
 * @param alias - Which alias to arrive with selected, or `null` for none.
 * @returns When the page has hydrated.
 */
async function openRegistry(page: Page, alias: string | null = null): Promise<void> {
  await page.goto(alias === null ? REGISTRY_PATH : registryPathFor(alias));

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(REGISTRY_TITLE);
  await expect(page.locator("main.models")).toHaveCount(1);
}

/**
 * Navigate an already signed-in page to the routing screen, with one route selected.
 *
 * @param page - The page.
 * @param kind - The task kind to select.
 * @returns When the page has hydrated.
 */
async function openRouting(page: Page, kind: string): Promise<void> {
  await page.goto(routingPathFor(kind));

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(ROUTING_TITLE);
  await expect(page.locator("main.models")).toHaveCount(1);
}

/* ------------------------------------------------------------------ the page, as a reader finds it */

/**
 * A pattern matching exactly this text, and nothing that merely contains it — so `coder-max` never
 * finds `coder-max-copy`.
 *
 * @param text - The text.
 * @returns The anchored, escaped pattern.
 */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/**
 * The allowed-models table, as a grid — the role is itself an assertion that it is the selectable
 * one (`app/ui/table.tsx` declares it only when given a selection).
 */
function grid(page: Page): Locator {
  return page.getByRole("grid", { name: TABLE_CAPTION });
}

/**
 * One row of the table, by its alias pill.
 *
 * @param page - The page.
 * @param alias - The alias.
 * @returns The `<tr>`.
 */
function row(page: Page, alias: string): Locator {
  return grid(page)
    .locator("tbody tr")
    .filter({ has: page.locator(".registry-table__alias", { hasText: exactly(alias) }) });
}

/** The inspector card for the selected alias. */
function inspector(page: Page, alias: string): Locator {
  return page.getByRole("region", { name: inspectorName(alias) });
}

/**
 * A select in a card, chosen by the text of one of its options.
 *
 * Provider options carry the connection's masked key after its name, and the mask is the service's
 * to compute — so the option is found by the name it begins with, and chosen by its value.
 *
 * @param select - The `<select>`.
 * @param text - Text the option contains.
 * @returns When the option is chosen.
 */
async function chooseOption(select: Locator, text: string): Promise<void> {
  const option = select.locator("option", { hasText: text });

  await expect(option).toHaveCount(1);
  await select.selectOption((await option.getAttribute("value")) ?? "");
}

/**
 * The routing matrix's resolution line for one route's primary hop.
 *
 * @param page - The routing page.
 * @param kind - The task kind.
 * @returns The primary model cell — the alias pill and the line beneath it.
 */
function primaryCell(page: Page, kind: string): Locator {
  return page
    .getByRole("grid", { name: MATRIX_CAPTION })
    .locator("tbody tr")
    .filter({ has: page.getByText(kind, { exact: true }) })
    .locator(".models-matrix__alias")
    .nth(0);
}

/* ------------------------------------------------------------------ parity */

test.describe("the registry draws the seeded workspace", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRegistry(context, page, { alias: "coder-max" });
  });

  test("the table draws the eight seeded aliases, each cell another subsystem's answer", async ({
    page,
  }) => {
    const rows = grid(page).locator("tbody tr");

    await expect(rows).toHaveCount(SEEDED_REGISTRY.length);
    await expect(page.getByRole("region", { name: /^Allowed models/ })).toContainText("8 aliases");
    await expect(page.getByText(TABLE_NOTE)).toBeVisible();

    for (const [index, expected] of SEEDED_REGISTRY.entries()) {
      const cells = rows.nth(index);
      const where = `${expected.alias} (row ${index + 1})`;

      // Position by position, because the order is the service's and a second opinion about it
      // would be a table two surfaces could disagree on.
      await expect(cells.locator(".registry-table__alias"), where).toHaveText(expected.alias);
      await expect(cells.locator(".registry-table__model"), where).toHaveText(expected.model);

      if (expected.provider === null) {
        // The orphan row: no monogram, *no provider* in the faint ink, the row dimmed.
        await expect(cells.locator(".registry-table__none").first(), where).toBeVisible();
        await expect(cells, where).toHaveClass(/registry-table__row--dim/);
      } else {
        await expect(cells.locator(".registry-table__provider"), where).toContainText(
          expected.provider,
        );
      }

      // CH.2's chips, derived from structure the seed stored — none of these strings is in SQL.
      const params = cells.locator(".registry-table__params");
      if (expected.chips.length === 0) {
        await expect(params, where).toHaveText(EM_DASH);
      } else {
        for (const chip of expected.chips) await expect(params, where).toContainText(chip);
      }

      await expect(cells.locator(".registry-table__state"), where).toHaveText(expected.health);
      if (expected.healthDetail !== null) {
        await expect(cells.locator(".registry-table__detail"), where).toHaveText(
          expected.healthDetail,
        );
      }

      await expect(cells.locator(".registry-table__num").nth(0), `${where} price`).toHaveText(
        expected.price,
      );
      await expect(cells.locator(".registry-table__num").nth(1), `${where} used by`).toHaveText(
        expected.usedBy,
      );

      await expect(
        cells.getByRole("switch", { name: switchName(expected.alias) }),
        where,
      ).toHaveAttribute("aria-checked", String(expected.enabled));
    }
  });

  test("the unbound row carries its way out, and a switch that says why it cannot move", async ({
    page,
  }) => {
    const orphan = row(page, "gpt5-experiments");

    await expect(orphan.locator(".registry-table__state")).toHaveText(NO_KEY);
    await expect(orphan.getByRole("link", { name: FIX_IN_PROVIDERS })).toBeVisible();

    // Inert **with its reason**, never merely disabled: the reader who most needs the sentence is
    // the one a `disabled` control would drop from the tab order.
    const toggle = orphan.getByRole("switch", { name: switchName("gpt5-experiments") });
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect(toggle).toHaveAttribute("title", /stays switched off/);

    // No other row offers a fix: the server says where there is one.
    await expect(grid(page).getByRole("link", { name: FIX_IN_PROVIDERS })).toHaveCount(1);
  });

  test("the inspector opens on coder-max with its binding, its schema's fields and its guards", async ({
    page,
  }) => {
    const card = inspector(page, "coder-max");

    await expect(row(page, "coder-max")).toHaveAttribute("aria-selected", "true");

    await expect(card.getByLabel("Alias", { exact: true })).toHaveValue("coder-max");
    await expect(card.getByLabel("Provider", { exact: true })).toContainText(
      seededAlias("coder-max").provider ?? "",
    );

    // The model list is live from discovery, and the fields are CH.2's schema for this model —
    // the card names neither, so a *Thinking* select holding `max` is the round trip.
    await expect(card.getByLabel("Model", { exact: true })).toHaveValue("claude-fable-5");
    await expect(card.getByLabel("Thinking", { exact: true })).toHaveValue("max");
    await expect(card.getByLabel("Token budget", { exact: true })).toHaveValue("400000");

    // What references it, each by the label the reference index composed.
    const chips = card.getByRole("list", { name: "Routes and rules that reference this alias" });
    await expect(chips.getByRole("listitem")).toHaveCount(CODER_MAX_REFERRERS.length);
    for (const label of CODER_MAX_REFERRERS) await expect(chips).toContainText(label);

    // Both guards, said before anything is pressed — mockup 21's mono why-line, and the rename
    // note — with the count the index answered.
    await expect(card.getByRole("button", { name: "Remove" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(card).toContainText("blocked — 4 routes reference this alias");
    await expect(card).toContainText("referenced — rename is blocked while 4 references exist");
  });

  test("the why-card makes three claims, and the chain card proves the first from run #482", async ({
    page,
  }) => {
    const why = page.getByRole("region", { name: WHY_TITLE });

    for (const title of WHY_ROWS) await expect(why).toContainText(title);

    const chain = page.getByRole("region", { name: CHAIN_TITLE });
    const rail = chain.getByRole("list", { name: CHAIN_TITLE });

    // A stored run, never a simulation: the tag is the honesty, and it never names a run the
    // snapshot table does not hold.
    await expect(chain.getByRole("button", { name: CODER_MAX_CHAIN.tag })).toBeVisible();
    await expect(chain).not.toContainText("simulated");

    const hops = rail.getByRole("listitem");
    await expect(hops).toHaveCount(CODER_MAX_CHAIN.hops.length);
    for (const [index, hop] of CODER_MAX_CHAIN.hops.entries()) {
      await expect(hops.nth(index)).toContainText(hop);
    }

    await expect(hops.last()).toContainText(CODER_MAX_CHAIN.status);
    await expect(chain).toContainText(CODER_MAX_CHAIN.caption);
  });
});

/* ------------------------------------------------------------------ the lifecycle, and the BYOK proof */

test.describe("an alias is created, tuned, rebound, copied and guarded", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRegistry(context, page);
  });

  // The route first: a route still pointing at the alias would refuse the alias's delete.
  test.afterEach(async ({ context }) => {
    await restoreRoute(context, "docs");
    await removeRunAliases(context);
  });

  test("a rebind in the inspector redraws the routing matrix's resolution line", async ({
    context,
    page,
  }) => {
    const name = runAliasName("coder");
    const { from, to } = LIFECYCLE_BINDING;

    /* create — bound now, from the head's primary action */

    await page.getByRole("button", { name: "+ New alias" }).click();

    const dialog = page.getByRole("dialog", { name: "New alias" });
    await dialog.getByLabel("Alias", { exact: true }).fill(name);
    await chooseOption(dialog.getByLabel("Provider", { exact: true }), from.connection);

    // The model list is read live when the provider is chosen, so the option is the barrier.
    const model = dialog.getByLabel("Model", { exact: true });
    await expect(model.locator(`option[value="${from.model}"]`)).toHaveCount(1);
    await model.selectOption(from.model);

    await dialog.getByRole("button", { name: "Create alias" }).click();
    await expect(dialog).toBeHidden();

    // The confirmation is the row itself, selected, with the inspector already open on it.
    await expect(page).toHaveURL(new RegExp(`[?&]alias=${name}(&|$)`));
    await expect(row(page, name)).toHaveAttribute("aria-selected", "true");
    await expect(row(page, name).locator(".registry-table__model")).toHaveText(from.model);

    /* edit params — the schema's field, saved, and the chip the server derives from it */

    const card = inspector(page, name);
    await card.getByLabel("Thinking", { exact: true }).selectOption("max");
    await card.getByRole("button", { name: "Save alias" }).click();

    await expect(row(page, name).locator(".registry-table__params")).toContainText("max thinking");

    /* a second reader, drawn while nothing references the alias */

    const stale = await context.newPage();
    await openRegistry(stale, name);
    await expect(
      inspector(stale, name).getByRole("button", { name: "Remove" }),
    ).not.toHaveAttribute("aria-disabled", "true");

    /* a route points at it — and the matrix draws the binding it has now */

    await writeAs(
      context,
      "PUT",
      `/api/v1/routing/routes/${LIFECYCLE_ROUTE.kind}`,
      routeThrough(name),
      `pointing the ${LIFECYCLE_ROUTE.kind} route at ${name}`,
    );

    await openRouting(page, LIFECYCLE_ROUTE.kind);
    await expect(primaryCell(page, LIFECYCLE_ROUTE.kind)).toContainText(name);
    await expect(primaryCell(page, LIFECYCLE_ROUTE.kind)).toContainText(
      `${from.model} · ${from.connection}`,
    );

    /* rebind — one select, one press */

    await openRegistry(page, name);

    const rebinding = inspector(page, name);
    await chooseOption(rebinding.getByLabel("Provider", { exact: true }), to.connection);

    const rebound = rebinding.getByLabel("Model", { exact: true });
    await expect(rebound.locator(`option[value="${to.model}"]`)).toHaveCount(1);
    await rebound.selectOption(to.model);
    await rebinding.getByRole("button", { name: "Save alias" }).click();

    await expect(row(page, name).locator(".registry-table__provider")).toContainText(to.connection);
    await expect(row(page, name).locator(".registry-table__model")).toHaveText(to.model);

    /* **the assertion this leg exists for** — another page, another service's read */

    await openRouting(page, LIFECYCLE_ROUTE.kind);

    const line = primaryCell(page, LIFECYCLE_ROUTE.kind);
    await expect(line).toContainText(name);
    await expect(line).toContainText(`${to.model} · ${to.connection}`);
    await expect(line).not.toContainText(from.model);

    /* duplicate — the copy, switched off, selected */

    await openRegistry(page, name);
    await inspector(page, name).getByRole("button", { name: "Duplicate" }).click();

    const copy = copyName(name);
    await expect(page).toHaveURL(new RegExp(`[?&]alias=${copy}(&|$)`));
    await expect(row(page, copy)).toHaveAttribute("aria-selected", "true");
    await expect(row(page, copy).getByRole("switch", { name: switchName(copy) })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(row(page, copy).locator(".registry-table__model")).toHaveText(to.model);

    /* the delete guard, as this page draws it — inert before a press, naming the route */

    await row(page, name).click();

    const original = inspector(page, name);
    await expect(original.getByRole("button", { name: "Remove" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(original).toContainText("blocked — 1 route references this alias");
    await expect(
      original.getByRole("list", { name: "Routes and rules that reference this alias" }),
    ).toContainText(LIFECYCLE_ROUTE.tag);

    /* …and as the service enforces it, to the reader whose page predates the route */

    const staleCard = inspector(stale, name);
    await staleCard.getByRole("button", { name: "Remove" }).click();

    const confirm = stale.getByRole("dialog", { name: `Remove ${name}?` });
    await confirm.getByRole("button", { name: "Remove alias" }).click();

    await expect(staleCard.getByRole("alert")).toHaveText(
      "Something references this alias, so it was not removed. Repoint the 1 route that use it " +
        "first. Nothing was changed.",
    );

    // Refused means refused: a fresh read still has the row.
    await stale.reload();
    await expect(row(stale, name)).toHaveCount(1);
    await stale.close();

    /* delete the copy — nothing references it, so nothing stops it */

    await row(page, copy).click();
    await inspector(page, copy).getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("dialog", { name: `Remove ${copy}?` })
      .getByRole("button", { name: "Remove alias" })
      .click();

    await expect(page).toHaveURL(/\/models\/registry$/);
    await expect(row(page, copy)).toHaveCount(0);
    await expect(row(page, name)).toHaveCount(1);
  });
});

/* ------------------------------------------------------------------ import */

test.describe("an import creates only what discovery reported, under the operator's name", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRegistry(context, page);
  });

  test.afterEach(async ({ context }) => {
    await removeRunAliases(context);
  });

  test("the head's dropdown opens the wizard on a connection, and the row lands", async ({
    page,
  }) => {
    const name = runAliasName("opus");

    await page.getByRole("button", { name: "Import from provider" }).click();
    await page
      .getByRole("menu", { name: "Import from a connected provider" })
      .getByRole("menuitem", { name: IMPORT_SOURCE.connection })
      .click();

    const wizard = page.getByRole("dialog", { name: `Import from ${IMPORT_SOURCE.connection}` });
    const candidates = wizard.getByRole("table", {
      name: "Discovered models, their prices, and the name each will take",
    });

    // Discovery's truth: the connection's four models, three of them already named and marked so,
    // their ticks unavailable — re-entry is idempotent because the read is.
    await expect(candidates.locator("tbody tr")).toHaveCount(4);
    await expect(candidates).toContainText("aliased: coder-max");
    await expect(wizard.getByRole("checkbox", { name: "Import claude-fable-5" })).toBeDisabled();

    // Nothing but the one model, under a name this run owns.
    await wizard
      .getByRole("checkbox", { name: "Select every model that is not already named" })
      .uncheck();
    await wizard.getByRole("checkbox", { name: `Import ${IMPORT_SOURCE.model}` }).check();
    await wizard.getByLabel(`Alias for ${IMPORT_SOURCE.model}`).fill(name);

    await wizard.getByRole("button", { name: "Review" }).click();

    const preview = wizard.getByRole("list", { name: "Aliases this import will create" });
    await expect(preview.getByRole("listitem")).toHaveCount(1);
    await expect(preview).toContainText(name);

    await wizard.getByRole("button", { name: "Create aliases" }).click();
    await expect(wizard.getByRole("status")).toHaveText("1 alias created.");

    await wizard.getByRole("button", { name: "Done" }).click();
    await expect(wizard).toBeHidden();

    // The row, from a fresh read of the registry — bound to the connection it came from.
    await expect(row(page, name)).toHaveCount(1);
    await expect(row(page, name).locator(".registry-table__model")).toHaveText(IMPORT_SOURCE.model);
    await expect(row(page, name).locator(".registry-table__provider")).toContainText(
      IMPORT_SOURCE.connection,
    );
    await expect(page.getByRole("region", { name: /^Allowed models/ })).toContainText(
      `${SEEDED_REGISTRY.length + 1} aliases`,
    );
  });
});

/* ------------------------------------------------------------------ the unbound path */

test.describe("a name reserved ahead of its key is an orphan with a way out", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRegistry(context, page);
  });

  test.afterEach(async ({ context }) => {
    await removeRunAliases(context);
  });

  test("bind later draws the orphan row, and Fix in Providers → goes to Providers & keys", async ({
    page,
  }) => {
    const name = runAliasName("later");

    await page.getByRole("button", { name: "+ New alias" }).click();

    const dialog = page.getByRole("dialog", { name: "New alias" });
    await dialog.getByLabel("Alias", { exact: true }).fill(name);
    await dialog.getByLabel("Bind later").check();
    await dialog.getByLabel("Model id", { exact: true }).fill("gpt-6-preview");

    // The honest half, said before the create: what the row will look like.
    await expect(dialog).toContainText("This alias will appear in the table with no provider");

    await dialog.getByRole("button", { name: "Create alias" }).click();
    await expect(dialog).toBeHidden();

    const orphan = row(page, name);

    await expect(orphan).toHaveAttribute("aria-selected", "true");
    await expect(orphan).toHaveClass(/registry-table__row--dim/);
    await expect(orphan.locator(".registry-table__state")).toHaveText(NO_KEY);
    await expect(orphan.getByRole("switch", { name: switchName(name) })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // The inspector says the same story in the place a reader who selected the row is looking.
    await expect(inspector(page, name)).toContainText("Bind it to a connection below");

    await orphan.getByRole("link", { name: FIX_IN_PROVIDERS }).click();

    await expect(page).toHaveURL(/\/models\/providers$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PROVIDERS_TITLE);
  });
});

/* ------------------------------------------------------------------ the disable guard */

test.describe("switching off a referenced alias asks first, and resolution drops its hop", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRegistry(context, page);
  });

  test.afterEach(async ({ context }) => {
    await restoreAliasEnabled(context, DISABLE_TARGET.alias);
  });

  test("the confirm names what will lose a hop, and the routing simulation drops it", async ({
    page,
  }) => {
    const { alias, referrers, kind, tag, fallback } = DISABLE_TARGET;
    const toggle = row(page, alias).getByRole("switch", { name: switchName(alias) });

    await toggle.click();

    const confirm = page.getByRole("dialog", { name: `Switch off ${alias}?` });
    await expect(confirm).toContainText(
      `${referrers.length} routes reference this alias — their hops through it will be dropped`,
    );

    const named = confirm.getByRole("list", { name: "Routes and rules that reference this alias" });
    await expect(named.getByRole("listitem")).toHaveCount(referrers.length);
    for (const referrer of referrers) await expect(named).toContainText(referrer);

    // Cancelling writes nothing, so the switch has not moved.
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await toggle.click();
    await confirm.getByRole("button", { name: "Switch off" }).click();

    // The position the server holds, read back rather than remembered.
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(row(page, alias).getByRole("switch", { name: switchName(alias) })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    // The chain card re-asks for a switched-off alias and draws its hop dropped.
    await row(page, alias).click();
    await expect(page.getByRole("region", { name: CHAIN_TITLE })).toContainText("dropped");

    /* the routing page, simulating the route the alias heads */

    await openRouting(page, kind);
    await page
      .getByRole("region", { name: `Route — ${tag}` })
      .getByRole("button", { name: "Simulate this route" })
      .click();

    const sheet = page.getByRole("dialog", { name: "Simulate routing" });
    await sheet.getByLabel("Effort").selectOption("");
    await sheet.getByLabel("Diff").selectOption("");
    await sheet.getByRole("button", { name: "Run simulation" }).click();

    const kept = sheet.locator(
      ".models-simulate__hop:not(.models-simulate__hop--dropped) .ou-chip",
    );

    // Asserted first because it is also the barrier: the answer replaces an empty panel.
    await expect(kept).toHaveText([fallback]);

    // The hop is still in the chain, struck through, carrying CH.6's reason with who and when.
    const hops = sheet.getByRole("list", { name: "Chain" }).getByRole("listitem");
    await expect(hops).toHaveCount(2);
    await expect(hops.nth(0)).toContainText(
      new RegExp(`Primary dropped — ${alias}: alias disabled by .+ \\d{4}-\\d{2}-\\d{2}\\.`),
    );
  });
});

/* ------------------------------------------------------------------ governance */

test.describe("a workflow that names a raw model is refused at publish", () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await pinRawModel(context);
  });

  test.afterEach(async ({ context }) => {
    await restoreStandardFixDraft(context);
  });

  test("Publish answers CH.6's designed finding, and nothing is published", async ({ page }) => {
    await page.goto(STANDARD_FIX.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(STANDARD_FIX.title);

    const head = page.getByRole("button", { name: /^Publish v\d+$/ }).first();
    const label = (await head.textContent())?.trim() ?? "";

    await head.click();

    const dialog = page.getByRole("dialog", { name: label });
    await dialog.getByRole("button", { name: label }).click();

    // The refusal is a finding the studio can take a reader to — not an error toast.
    await expect(dialog.getByRole("alert")).toHaveText(FINDINGS_MESSAGE);

    const findings = dialog.getByRole("list", { name: "Validation findings" });
    await expect(findings).toContainText(RAW_PIN.message);
    await expect(findings).toContainText(`Select ${RAW_PIN.stageTitle}`);

    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Nothing was published: a fresh read still offers the same next version.
    await page.reload();
    await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  });
});

/* ------------------------------------------------------------------ the empty workspace */

test.describe("a registry with nothing in it is guided rather than blanked", () => {
  test("the personal workspace leads with connecting a provider", async ({ context, page }) => {
    // `kensuenobu` carries no connection and no alias: the absence is the fixture (CI.6).
    await enterRegistry(context, page, { workspace: SEED_PERSONAL_TENANT.slug });

    const card = page.getByRole("region", { name: "Name your first model" });

    await expect(card).toContainText("Connect a provider first");
    await expect(grid(page)).toHaveCount(0);

    const steps = card.getByRole("listitem");
    await expect(steps).toHaveCount(2);
    await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
    await expect(
      steps.nth(0).getByRole("link", { name: "Connect a provider first →" }),
    ).toBeVisible();

    // Nothing of the demo workspace's leaks into a workspace that has none of it. Scoped to the
    // table's seat rather than the page: the why-card's copy names `coder-max` in every
    // workspace, because it is the product's argument and not a row.
    await expect(card).toContainText("0 aliases");
    for (const seeded of SEEDED_REGISTRY) {
      await expect(card, seeded.alias).not.toContainText(seeded.alias);
    }
  });
});

/* ------------------------------------------------------------------ the member's page */

test.describe("a member is served the registry read-only, with nothing hidden", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRegistry(context, page, { as: SEED_MEMBER.id, alias: "coder-max" });
  });

  test("every write affordance is in its place, inert, and says why", async ({ page }) => {
    await expect(page.getByRole("note").first()).toContainText(
      `Viewing the registry as a ${SEED_MEMBER.role}.`,
    );

    for (const name of ["+ New alias", "Import from provider"]) {
      const action = page.getByRole("button", { name });

      await expect(action, name).toHaveAttribute("aria-disabled", "true");
      await expect(action, name).toHaveAttribute("title", READ_ONLY.create);
    }

    // Every switch drawn in its real position, and none of them pressable.
    const switches = grid(page).getByRole("switch");
    await expect(switches).toHaveCount(SEEDED_REGISTRY.length);
    for (const expected of SEEDED_REGISTRY) {
      const toggle = grid(page).getByRole("switch", { name: switchName(expected.alias) });

      await expect(toggle, expected.alias).toHaveAttribute("aria-disabled", "true");
      await expect(toggle, expected.alias).toHaveAttribute(
        "aria-checked",
        String(expected.enabled),
      );
    }
    await expect(grid(page).getByRole("switch", { name: switchName("coder-max") })).toHaveAttribute(
      "title",
      READ_ONLY.switch,
    );

    // The inspector: readable, every input inert, every foot control carrying the reason.
    const card = inspector(page, "coder-max");

    await expect(card.getByLabel("Alias", { exact: true })).toBeDisabled();
    await expect(card.getByLabel("Alias", { exact: true })).toHaveValue("coder-max");
    await expect(card.getByLabel("Provider", { exact: true })).toBeDisabled();

    for (const name of ["Save alias", "Duplicate", "Remove"]) {
      await expect(card.getByRole("button", { name }), name).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    await expect(card.getByRole("button", { name: "Duplicate" })).toHaveAttribute(
      "title",
      READ_ONLY.edit,
    );

    // …and everything a member may read is still there, including the proof.
    await expect(grid(page).locator("tbody tr")).toHaveCount(SEEDED_REGISTRY.length);
    await expect(page.getByRole("region", { name: CHAIN_TITLE })).toContainText(
      CODER_MAX_CHAIN.status,
    );
  });
});

/* ------------------------------------------------------------------ the shell */

test.describe("the shell holds the registry", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterRegistry(context, page, { alias: "coder-max" });
  });

  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });

  test("the chrome holds still, and the subnav sticks to the pane, while the pane scrolls", async ({
    page,
  }) => {
    const header = page.getByRole("banner");
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const subnav = page.getByRole("navigation", { name: "Models" });
    const pane = page.locator(PANE_SELECTOR);

    const before = { header: await header.boundingBox(), sidebar: await sidebar.boundingBox() };

    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the registry must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect(await header.boundingBox()).toEqual(before.header);
    expect(await sidebar.boundingBox()).toEqual(before.sidebar);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // Layer 1 of the in-pane chrome owns the pane's top edge once the head has scrolled away.
    const paneBox = await pane.boundingBox();
    const subnavBox = await subnav.boundingBox();

    expect(Math.round(subnavBox!.y)).toBe(Math.round(paneBox!.y));
  });

  test("the Models entry and the Model registry tab both know where the reader is", async ({
    page,
  }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(sidebar.getByRole("link", { name: "Models" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

    await expect(
      page
        .getByRole("navigation", { name: "Models" })
        .getByRole("link", { name: "Model registry" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("the page still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();

    const html = page.locator("html");

    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    // Eight columns in the densest table of the section: wide content scrolls in its own
    // wrapper, never the pane (§ 1.3).
    const pane = page.locator(PANE_SELECTOR);
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(grid(page).locator("tbody tr")).toHaveCount(SEEDED_REGISTRY.length);
    await expect(row(page, "coder-max").locator(".registry-table__num").nth(0)).toHaveText(
      seededAlias("coder-max").price,
    );
  });
});

/* ------------------------------------------------------------------ both palettes */

/**
 * The window the parity pair is photographed through — taller and wider than Desktop Chrome
 * because the page is, for the reason `specs/routing.spec.ts`'s `PARITY_WINDOW` gives: the pane is
 * the only scroll container, so a screenshot of a page taller than the window records its tail as
 * bare ground. The test asserts the pane does not scroll, so a page that outgrows this goes red.
 */
const PARITY_WINDOW = { width: 1920, height: 2200 };

test.describe("the registry is drawn in both palettes", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await enterRegistry(context, page, { alias: "coder-max" });
  });

  test("light and dark are both mockup 21 — table, inspector, why-card and chain card", async ({
    page,
  }) => {
    // Every asynchronous read on the page has answered: the inspector's schema, and the chain.
    await expect(inspector(page, "coder-max").getByLabel("Thinking", { exact: true })).toHaveValue(
      "max",
    );
    await expect(page.getByRole("region", { name: CHAIN_TITLE })).toContainText(
      CODER_MAX_CHAIN.status,
    );

    expect(
      await page.locator(PANE_SELECTOR).evaluate((el) => el.scrollHeight - el.clientHeight),
      "the parity window must be tall enough to hold the whole registry without scrolling",
    ).toBe(0);

    // Nothing is masked: every figure is computed from rows that do not move while the health
    // sweep is held still (`docker-compose.e2e.yml`), and no cell prints the clock.
    await pinTheme(page, "light");
    await expect(page).toHaveScreenshot("registry-light.png");

    await pinTheme(page, "dark");
    await expect(page).toHaveScreenshot("registry-dark.png");
  });
});
