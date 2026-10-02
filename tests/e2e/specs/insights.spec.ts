/**
 * Leg 22 — **the Insights MVP gate** ([#447](https://github.com/NobuData/ouroboros/issues/447),
 * amending [#56](https://github.com/NobuData/ouroboros/issues/56)).
 *
 * Mockup 15 against `R__dev_seed_workspace_metrics.sql` (#436). Not because the leg renders the
 * page — the UI's own suites do that against fixtures — but because it verifies the two chains
 * that make the page real, and the negative claims that rot silently if nothing tests them:
 *
 *   * **Seeded parity** — every visual, screenshot in both palettes.
 *   * **Range coherence** — one press of the segment moves every consumer to the same window: no
 *     card left drawing `30d` beside another's `7d`, and the page agreeing with the API.
 *   * **Popovers** — the DORA strip's proxies wear the tag, and their popovers print the
 *     registry's formula and caveat; deploy frequency's says what stands in for a deploy.
 *   * **Re-categorize round trip** — a correction made in the card moves the bars at once.
 *   * **The digest** — subscribe in the sheet, the scheduler's real tick sends at the slot, and
 *     **the mail in mailpit carries the page's own numbers**; the preview's subject is the sent one.
 *   * **Honesty variants** — the routing suggestion and the cost alerts claim are absent, from the
 *     payload and from the page.
 *   * **States** — a cold workspace says *not enough data* and draws no curve; rollups held back
 *     raise the lag banner with the real last-filled time.
 *   * **The shell** — fixed chrome under a pane scroll, Insights lit in the sidebar, the 125% step.
 *
 * The viewer's refusal is not here: the seed has no viewer, and the refusal is the REST
 * integration suite's (`interventions.integration-spec.ts`) and the UI's (`scoreboard-cards`).
 */
import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  COPY,
  INSIGHTS_PATH,
  KPI_LABELS,
  VISUALS,
  clearInbox,
  digestSchedule,
  holdRollupsBack,
  inboxOf,
  insightsPayload,
  messageText,
  moveDigestSlot,
  slotAt,
} from "../support/insights";
import { COLD_TENANT } from "../support/knowledge";
import { requestAs } from "../support/rest";
import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { chromeBoxes, expectNoPaneHorizontalScroll, scrollPaneTo } from "../support/shell";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** The window the parity screenshots are taken at — wide enough for the twelve-column grid. */
const PARITY_WINDOW = { width: 1440, height: 1000 } as const;

/** How long the digest scheduler's real tick is given to send — its cadence is 5 s in e2e. */
const DIGEST_SEND_TIMEOUT_MS = 60_000;

/**
 * Sign a seeded person into a workspace.
 *
 * @param context The browser context.
 * @param slug Which workspace. Defaults to the one mockup 15 is seeded in.
 */
async function signInAs(context: BrowserContext, slug: string = SEED_TENANT.slug): Promise<void> {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, slug);
}

/**
 * The page's `<main>` — visible only, as the other legs read it.
 *
 * @param page The page.
 * @returns The landmark.
 */
function main(page: Page): Locator {
  return page.locator("main.insights").filter({ visible: true });
}

/**
 * Open the page on a range, and wait until the grid holds that range's figures.
 *
 * @param page The page.
 * @param range The window.
 */
async function openInsights(page: Page, range = "30d"): Promise<void> {
  await page.goto(`${INSIGHTS_PATH}?range=${range}`);
  await expect(main(page).locator(".insights__grid")).toHaveAttribute("aria-busy", "false");
}

/**
 * A visual's region.
 *
 * @param page The page.
 * @param name Its name's pattern.
 * @returns The region.
 */
function visual(page: Page, name: RegExp): Locator {
  return main(page).getByRole("region", { name });
}

/**
 * A DORA cell.
 *
 * @param page The page.
 * @param metric Its metric id.
 * @returns The cell.
 */
function doraCell(page: Page, metric: string): Locator {
  return visual(page, /^Delivery health/).locator(`[data-metric="${metric}"]`);
}

/**
 * What moves with the calendar rather than with the data: each card's window tag and the
 * charts' day axes. Masked so a baseline is a picture of the figures, not of today's date.
 *
 * @param page The page.
 * @returns The locators to mask.
 */
function dated(page: Page): Locator[] {
  return [
    main(page).locator(".ou-tag:not(.insights-proxy)"),
    main(page).locator("[class*='axis']"),
  ];
}

test.describe("insights (#447)", () => {
  test("parity: every visual of the seeded page, in both palettes", async ({ context, page }) => {
    await signInAs(context);
    await page.setViewportSize(PARITY_WINDOW);
    await openInsights(page);

    await expect(visual(page, /^Delivery health/)).toContainText(COPY.doraCaption);

    for (const theme of THEMES) {
      await pinTheme(page, theme);

      for (const { slug, name } of VISUALS) {
        await expect(visual(page, name)).toHaveScreenshot(`insights-${slug}-${theme}.png`, {
          mask: dated(page),
        });
      }
    }
  });

  test("range coherence: one press moves every consumer to the same window, as the API reads it", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openInsights(page);

    for (const range of ["7d", "90d"] as const) {
      await main(page)
        .getByRole("group", { name: "Time range" })
        .getByRole("button", { name: range })
        .click();
      await expect(page).toHaveURL(new RegExp(`range=${range}`));
      await expect(main(page).locator(".insights__grid")).toHaveAttribute("aria-busy", "false");

      // ---- Every card that names its window names this one, and no card names another.
      const grid = main(page).locator(".insights__grid");
      const other = range === "7d" ? "90d" : "7d";

      await expect(visual(page, /^Merged PRs per day/)).toContainText(`· ${range}`);
      await expect(visual(page, /^Test failures by suite/)).toContainText(`· ${range}`);
      await expect(visual(page, /^Tokens by stage/)).toContainText(`· ${range}`);
      await expect(visual(page, /^Build & test performance/)).toContainText(`· ${range}`);
      await expect(grid).not.toContainText("prior 30d");
      await expect(grid).not.toContainText(`prior ${other}`);

      // ---- The window tags agree with one another and with the payload's window.
      const payload = await insightsPayload(context, range);
      const tags = await main(page).locator(".insights-series .ou-tag").allTextContents();

      expect(new Set(tags).size, `every card's window tag at ${range}`).toBe(1);
      expect(payload.range).toBe(range);
      for (const cell of payload.dora) await expect(doraCell(page, cell.key)).toBeVisible();
    }
  });

  test("popovers: the proxies wear the tag, and say their formula and caveat", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openInsights(page);

    const payload = await insightsPayload(context, "30d");

    for (const cell of payload.dora) {
      const region = doraCell(page, cell.key);
      const tag = region.locator(".insights-proxy");

      await expect(tag).toHaveCount(cell.proxy ? 1 : 0);
      await region.locator(".insights-kpi__label").click();

      const popover = region.getByRole("group");

      await expect(popover).toContainText(cell.methodology.formula);
      await expect(popover).toContainText(cell.methodology.caveats);
      if (cell.proxy) await expect(popover).toContainText(COPY.proxy);

      await page.keyboard.press("Escape");
    }

    // ---- The two the ticket names, by name.
    expect(payload.dora.filter((cell) => cell.proxy).map((cell) => cell.key)).toEqual([
      "change_failure_rate",
      "mttr",
    ]);
    expect(
      payload.dora.find((cell) => cell.key === "deploy_frequency")?.methodology.caveats,
    ).toMatch(/stands in for a deploy/);
  });

  test("honesty variants: the suggestion slot and the alerts claim are absent", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openInsights(page);

    const payload = await insightsPayload(context, "30d");

    expect(Object.keys(payload.scoreboard)).not.toContain("suggestion");
    expect(Object.keys(payload.series.cost)).not.toContain("alertsClaim");
    await expect(main(page).getByRole("link", { name: COPY.apply })).toHaveCount(0);
    await expect(visual(page, /^Daily cost/)).not.toContainText(/alerts? fire/i);
  });

  test("re-categorize round trip: a correction in the card moves the bars at once", async ({
    context,
    page,
  }) => {
    await signInAs(context);
    await openInsights(page);

    const card = visual(page, /^Where loops still need humans/);
    const before = await requestAs<{ total: number }>(
      context,
      "GET",
      "/api/v1/insights/interventions?range=30d&cause=other",
      null,
      "other",
    );

    await card.getByRole("button", { name: COPY.recategorize }).click();
    await card.getByLabel(COPY.panel.target).selectOption({ label: "Other" });
    await card.getByLabel(COPY.panel.reason).fill("e2e: checking the round trip (#447)");

    const event = await card.getByLabel(COPY.panel.event).inputValue();

    await card.getByRole("button", { name: COPY.panel.submit, exact: true }).click();
    await expect(card).toContainText("Other");

    const after = await requestAs<{ total: number }>(
      context,
      "GET",
      "/api/v1/insights/interventions?range=30d&cause=other",
      null,
      "other",
    );

    expect(after?.total).toBe((before?.total ?? 0) + 1);

    // ---- Put it back, through the same route, so the seed is the seed for the next leg.
    const list = await requestAs<{
      interventions: { id: string; override: { fromCause: string } | null }[];
    }>(context, "GET", "/api/v1/insights/interventions?range=30d&cause=other", null, "other");
    const moved = list?.interventions.find((each) => each.id === event);

    if (moved?.override !== null && moved?.override !== undefined) {
      await requestAs(
        context,
        "POST",
        `/api/v1/insights/interventions/${event}/recategorize`,
        { cause: moved.override.fromCause, reason: "e2e: restoring the seed (#447)" },
        "restore",
      );
    }
  });

  test("digest: subscribe in the sheet, the slot comes due, and mailpit holds the page's numbers", async ({
    context,
    page,
  }) => {
    test.setTimeout(DIGEST_SEND_TIMEOUT_MS + 60_000);
    await signInAs(context);
    await openInsights(page, "7d");

    // ---- What the page says for the digest's seven days.
    const headline = (await main(page).locator("h1").textContent())?.trim() ?? "";
    const mergeRate = (
      await main(page)
        .getByRole("region", { name: KPI_LABELS[0] })
        .locator(".ou-stat__value")
        .textContent()
    )?.trim();

    expect(headline).toMatch(/PRs? merged this week/);

    const original = await digestSchedule(context);

    await clearInbox();

    try {
      // ---- Subscribe in the sheet; its preview is the service's render.
      await main(page).getByRole("button", { name: COPY.digestTitle }).click();

      const sheet = page.getByRole("dialog", { name: COPY.digestTitle });
      const toggle = sheet.getByRole("switch", { name: COPY.digestToggle });

      await expect(sheet.getByTitle(COPY.previewFrame)).toBeVisible();

      const previewSubject = ((await sheet.getByText(/^Subject: /).textContent()) ?? "").replace(
        /^Subject: /,
        "",
      );

      if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");

      // ---- Move the slot to now; the scheduler's real tick sends.
      await moveDigestSlot(context, slotAt(new Date()));

      await expect
        .poll(async () => (await inboxOf(SEED_OWNER.email)).length, {
          message:
            "a precondition: no digest went out this week on this stack (a --keep stack may have sent one)",
          timeout: DIGEST_SEND_TIMEOUT_MS,
        })
        .toBeGreaterThan(0);

      const [mail] = await inboxOf(SEED_OWNER.email);
      const text = await messageText(mail.ID);

      // ---- The mail says what the page says.
      expect(mail.Subject).toBe(previewSubject);
      expect(text).toContain(headline);
      expect(text).toContain(`Autonomous merge rate: ${mergeRate}`);

      // ---- And the way back out: the toggle stops it.
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
    } finally {
      await moveDigestSlot(context, original);
      await requestAs(
        context,
        "PUT",
        "/api/v1/insights/digest/subscription",
        { subscribed: false },
        "unsubscribe",
      );
    }
  });

  test("a cold workspace: every card says not enough data, and no chart draws a curve", async ({
    context,
    page,
  }) => {
    await signInAs(context, COLD_TENANT.slug);
    await openInsights(page);

    // The build & test strip is figures, not a chart: its cells say `—`, which the UI suite holds.
    for (const { name } of VISUALS.filter((each) => each.slug !== "performance")) {
      await expect(visual(page, name)).toContainText(COPY.coldTitle);
    }

    await expect(
      main(page).locator(".chart-spark, .chart-vbars, .chart-hbars, .chart-scroll"),
    ).toHaveCount(0);
    await expect(main(page).getByText(COPY.lagHeadline)).toHaveCount(0);
  });

  test("rollup lag: the banner names the real last-filled time while the rollups are behind", async ({
    context,
    page,
  }) => {
    await signInAs(context);

    const restore = await holdRollupsBack(SEED_TENANT.slug, 3);

    try {
      await openInsights(page);

      const payload = await insightsPayload(context, "30d");
      const banner = main(page).getByRole("status").filter({ hasText: COPY.lagHeadline });

      expect(payload.freshness.behind).toBe(true);
      await expect(banner).toContainText("last filled 3d ago");
    } finally {
      await restore();
    }

    await openInsights(page);
    await expect(main(page).getByText(COPY.lagHeadline)).toHaveCount(0);
  });

  test("shell: fixed chrome, Insights lit, and the 125% step", async ({ context, page }) => {
    await signInAs(context);

    try {
      await setFontScale(context, "125");
      await openInsights(page);
      await expectFontScale(page, "125");

      await expect(
        page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Insights/ }),
      ).toHaveAttribute("aria-current", "page");

      for (const { name } of VISUALS) await expect(visual(page, name)).toBeVisible();

      for (const theme of THEMES) {
        await pinTheme(page, theme);

        await scrollPaneTo(page, 0);
        const before = await chromeBoxes(page);
        expect(before.header, "the header must be on the page to be measured").not.toBeNull();
        expect(before.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();
        await scrollPaneTo(page, 800);
        expect(await chromeBoxes(page)).toEqual(before);

        await expectNoPaneHorizontalScroll(page);
      }
    } finally {
      await restoreFontScale(context);
    }
  });
});
