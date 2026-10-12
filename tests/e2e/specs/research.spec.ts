/**
 * Leg 28 — the Research page, and the chains that certify the Research roadmap
 * ([#634](https://github.com/NobuData/ouroboros/issues/634), CN.8 — the MVP gate), over the frame
 * and cards of #627–#633 and the CK seeds (#613).
 *
 * Every claim mockup 22 makes spans layers that pass their own tests (#626). This leg is where
 * they are asked to compose:
 *
 * * **Parity** — the seven regions, screenshot-diffed in both themes.
 * * **Citations** — every superscript of the featured brief resolves to the source row it names,
 *   the row the service's ledger holds under that marker, and lights it.
 * * **Export** — the downloaded artifact is the brief: its claims with their markers, the matrix,
 *   the proposal, and the whole ledger.
 * * **The pipeline** — `ROADMAP.md` as projected and the tracker's issue rows say the same thing,
 *   item for item.
 * * **Guards** — the page without the invocation gateway (which is every stack today), a member's
 *   read-only page and the service's refusals behind it.
 * * **The shell** — fixed chrome, *Research* lit, and the 125 % step.
 * * **Tool enable** — a tool connected through the schema-driven sheet, and its dot changing.
 * * **Gaps → Planning** — *Draft epic from gaps* opens a batch in Planning carrying each gap and
 *   its citations, and files nothing.
 * * **The watch** — a planted baseline, a real nightly comparison, the drift's row on the card,
 *   the scheduler's pass resting it at *needs repro*, and an owner dismissing it.
 *
 * ## What is parked, and on what
 *
 * Four chains the issue lists cannot run on any stack today, for reasons that are other issues'.
 * Each is written down here under `test.fixme` naming the issue that un-parks it, and each has
 * its failure-mode pair registered as parked (`scripts/verify-failure-modes.sh`). The user
 * settled this on the ticket (2026-10-11).
 *
 * * **Investigate → brief** and **cancel mid-run** — an investigation's every step asks a model
 *   through `POST /internal/llm/invoke`, which answers `501` until the invocation gateway (AF.2,
 *   [#235](https://github.com/NobuData/ouroboros/issues/235)); the page says so and switches its
 *   start controls off, which is what the gateway test asserts instead.
 * * **Apply → re-run → new version** and **create-issues → writeback** — both skills are model
 *   calls, #235 again. What the stack *can* show is asserted: the refusal in the service's words
 *   with the document untouched, and document ≡ tracker on the roadmap the seed filed.
 * * **Drift → bisected → forensics → fix draft** — a bisect step is a farm build of a clone of
 *   the repository, and the compose stack has neither: no runner can check a commit out
 *   ([#991](https://github.com/NobuData/ouroboros/issues/991)) and the engine has no host to clone
 *   from. So a *replayable* metric is deliberately not planted — its bisect would ask the real
 *   host for a clone on every pass. The seeded rows carry those states on the parity screenshot.
 *
 * ## What this leg writes
 *
 * The read-only tests come first and leave nothing. Of the writers, the tool and the watch take
 * back what they add (`support/research.ts`); *Draft epic from gaps* leaves one draft batch in
 * Planning each time it runs, which no later leg counts.
 */

import { readFile } from "node:fs/promises";

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import { tracker } from "../support/planning";
import {
  APPLY_BROKE,
  type Brief,
  CHAIN_BROKE,
  CITATION_BROKE,
  COPY,
  DRIFT,
  DRIFT_BROKE,
  FILED_BROKE,
  FIXTURE_TOOL,
  REGIONS,
  RESEARCH_PATH,
  SEEDED,
  SIDEBAR_ENTRY,
  TOOL_BROKE,
  WRITEBACK_BROKE,
  briefOf,
  disableTool,
  expectInert,
  openResearch,
  plantDrift,
  plantedItem,
  region,
  removeDrift,
} from "../support/research";
import { quietly, requestAs } from "../support/rest";
import { SEED_MEMBER, SEED_OWNER, SEED_PERSONAL_TENANT, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { chromeBoxes, expectNoPaneHorizontalScroll, scrollPaneTo } from "../support/shell";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** A window wide enough for mockup 22's two columns at their drawn widths. */
const PARITY_WINDOW = { width: 1440, height: 1100 };

/** The watch card re-reads every 30 s (`HEALTH_CYCLE_SECONDS`); the scheduler passes every 10 s. */
const WATCH_MS = 45 * 1000;

/** Planning, opened on one batch — where *Draft epic from gaps* lands. */
const BATCH_ADDRESS = /\/planning\?batch=[0-9a-f-]{36}$/;

/** Sign the seeded owner into the seeded workspace. */
async function signInAs(context: BrowserContext, userId: string = SEED_OWNER.id): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, SEED_TENANT.slug);
}

/** A service call that must be refused, and with what. */
async function refusal(call: Promise<unknown>): Promise<string> {
  return call.then(
    () => "accepted",
    (error: Error) => error.message,
  );
}

/** Each roadmap line of the projected document: `- [x] #742 Title `MVP` `L``. */
function documentItems(markdown: string) {
  return [...markdown.matchAll(/^- \[([ x])\] (#\d+) (.+?)((?: `[^`]+`)*)$/gm)].map((line) => ({
    done: line[1] === "x",
    number: line[2],
    title: line[3],
    effort: [...line[4].matchAll(/`([^`]+)`/g)]
      .map((tag) => tag[1])
      .filter((tag) => tag !== "MVP")[0],
  }));
}

test.describe("research — the seeded page (#627–#633)", () => {
  test.use({ viewport: PARITY_WINDOW });

  test.beforeEach(async ({ context }) => {
    await signInAs(context);
  });

  test("parity: the seven regions in both themes, against mockup 22", async ({ page }) => {
    await openResearch(page);

    // ---- The seed, in the page's own words, before a pixel is compared.
    await expect(region(page, "tools").getByRole("listitem")).toHaveCount(6);
    for (const [index, row] of SEEDED.watchRows.entries())
      await expect(region(page, "watch").getByRole("listitem").nth(index)).toContainText(row);
    await expect(region(page, "brief")).toContainText(`${String(SEEDED.brief.sources)} sources`);
    await expect(region(page, "pipeline")).toContainText(
      `${String(SEEDED.roadmap.issues)} issues · 2 milestones · synced`,
    );
    await expect(region(page, "investigations").getByRole("listitem")).toHaveCount(4);

    for (const theme of THEMES) {
      await pinTheme(page, theme);

      for (const { slug } of REGIONS)
        await expect(region(page, slug)).toHaveScreenshot(`research-${slug}-${theme}.png`);
    }
  });

  test("citations: every superscript resolves to the source row the ledger holds, and lights it", async ({
    context,
    page,
  }) => {
    await openResearch(page);

    const brief = region(page, "brief");
    const ledger: Brief = await briefOf(context, SEEDED.brief.id);
    const markers = brief.locator(".research__brief-text .research__ref");

    await expect(markers).toHaveCount(ledger.sources.panel.length);

    for (const marker of await markers.all()) {
      const label = (await marker.textContent())!;
      const record = ledger.sources.panel.find((source) => source.label === label);

      expect(record, `${CITATION_BROKE}: no ledger record is labelled ${label}`).toBeDefined();

      // ---- The marker addresses a row of the panel, and the row is that record.
      const row = brief.locator(
        `.research__cites [id="${(await marker.getAttribute("href"))!.slice(1)}"]`,
      );
      await expect(row, `${CITATION_BROKE}: ${label} addresses no row`).toHaveCount(1);
      await expect(row.locator(".research__cite-n"), CITATION_BROKE).toHaveText(label);
      await expect(row.locator(".research__cite-t"), CITATION_BROKE).toHaveText(record!.title);

      // ---- Pressing it lights that row, and only that row.
      await marker.click();
      await expect(row, `${CITATION_BROKE}: ${label} did not light its row`).toHaveClass(
        /research__cite--lit/,
      );
      await expect(brief.locator(".research__cite--lit")).toHaveCount(1);
    }

    // ---- The panel is a selection; *all* opens the whole ledger, the heading's own count.
    await brief.getByRole("button", { name: "all ↗" }).click();
    const sheet = page.getByRole("dialog", {
      name: new RegExp(`^${SEEDED.brief.displayId} — every source`),
    });
    await expect(sheet.getByRole("listitem")).toHaveCount(ledger.sources.cited);
  });

  test("export: the downloaded artifact is the brief — claims, matrix, proposal and ledger", async ({
    context,
    page,
  }) => {
    await openResearch(page);

    const brief = region(page, "brief");
    const ledger = await briefOf(context, SEEDED.brief.id);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      brief.getByRole("link", { name: "Export brief ↗" }).click(),
    ]);

    expect(download.suggestedFilename()).toBe(`${SEEDED.brief.displayId}-brief.md`);

    const artifact = await readFile(await download.path(), "utf8");

    expect(artifact).toMatch(new RegExp(`^# ${SEEDED.brief.displayId} — `));
    for (const section of [
      "## Brief",
      "## Capability matrix",
      "## Proposed from gaps",
      "## Sources",
    ])
      expect(artifact, `the export has no ${section}`).toContain(section);

    // ---- Every marker the page draws is in the exported claims, and its record in the ledger.
    const claims = artifact.slice(
      artifact.indexOf("## Brief"),
      artifact.indexOf("## Capability matrix"),
    );
    const sources = artifact.slice(artifact.indexOf("## Sources"));

    for (const source of ledger.sources.panel) {
      expect(claims, `the exported brief lost the marker ${source.label}`).toContain(source.label);
      expect(sources, `the exported ledger lost ${source.label}`).toContain(
        `- ${source.label} ${source.title}`,
      );
    }
    expect(sources.match(/^- \[/gm)).toHaveLength(ledger.sources.cited);

    // ---- The matrix and the proposal are the page's.
    for (const row of await brief
      .getByRole("table")
      .locator("tbody tr > :first-child")
      .allTextContents())
      expect(artifact).toContain(`| ${row} |`);
    for (const draft of SEEDED.gapDrafts) expect(artifact).toContain(draft);
  });

  test("pipeline: ROADMAP.md as projected and the tracker's rows agree, item for item", async ({
    page,
  }) => {
    await openResearch(page);

    const pipeline = region(page, "pipeline");

    await pipeline.getByText("Raw .md", { exact: true }).click();
    const raw = pipeline.locator("pre.research__md-raw");
    await expect(raw).toBeVisible();

    const written = documentItems(await raw.innerText());
    const filed = pipeline
      .getByRole("group", { name: "Issues by milestone" })
      .getByRole("listitem");

    expect(written, WRITEBACK_BROKE).toHaveLength(SEEDED.roadmap.issues);
    await expect(filed, WRITEBACK_BROKE).toHaveCount(written.length);

    for (const [index, item] of written.entries()) {
      const row = filed.nth(index);

      // The same issue, in the same place, under the same title and size …
      await expect(row.getByRole("link"), WRITEBACK_BROKE).toHaveText(item.number);
      await expect(row, WRITEBACK_BROKE).toContainText(item.title);
      await expect(row.getByText(item.effort, { exact: true }), WRITEBACK_BROKE).toHaveCount(1);
      // … and ticked in the file exactly when the tracker has closed it.
      await expect(row.getByText("✓ closed"), WRITEBACK_BROKE).toHaveCount(item.done ? 1 : 0);
    }
  });

  test("no gateway: the page says so once, starts nothing, and refuses a re-run in the service's words", async ({
    page,
  }) => {
    await openResearch(page);

    // ---- Said once, above the grid, with what still works.
    const notice = page.locator(".research__notice");
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText(COPY.gatewayTitle);
    await expect(notice).toContainText(COPY.gatewayStill);
    await expect(notice.getByRole("link", { name: "See Providers" })).toHaveAttribute(
      "href",
      "/models/providers",
    );

    // ---- Both start controls are inert, with the reason.
    await expectInert(page.getByRole("button", { name: "New investigation" }), COPY.gatewayReason);
    await expectInert(
      page.getByRole("button", { name: "Start investigation ⟳" }),
      COPY.gatewayReason,
    );

    // ---- What needs no model is all still here.
    await expect(region(page, "watch").getByRole("listitem")).toHaveCount(SEEDED.watchRows.length);
    await expect(region(page, "tools").locator(".research__dot--ok")).not.toHaveCount(0);
    await expect(region(page, "brief").locator(".research__ref")).not.toHaveCount(0);

    // ---- An owner's Apply reaches the engine, which has no model to ask: refused, nothing changed.
    const pipeline = region(page, "pipeline");
    const open = pipeline.getByRole("heading", { name: /^Suggested changes — \d+ open$/ });
    const before = await open.textContent();

    await pipeline.getByRole("button", { name: /^Apply ⟳: Pull #744/ }).click();
    await page
      .getByRole("dialog", { name: "Apply this suggestion?" })
      .getByRole("button", { name: "Re-run create-roadmap" })
      .click();

    const refused = pipeline.getByRole("alert");
    await expect(refused, APPLY_BROKE).toContainText(COPY.applyRefused);
    await expect(refused).toContainText(COPY.nothingChanged);
    await expect(open).toHaveText(before!);
    await expect(pipeline.getByRole("button", { name: /^Apply ⟳: Pull #744/ })).toBeVisible();
    await expect(pipeline.getByText(SEEDED.roadmap.version, { exact: true })).toBeVisible();
  });

  test("a member reads the whole page; what is an administrator's is inert, and refused past the page", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: PARITY_WINDOW });

    try {
      await signInAs(context, SEED_MEMBER.id);
      const page = await context.newPage();
      await openResearch(page);

      // ---- Everything is drawn …
      for (const { slug } of REGIONS) await expect(region(page, slug)).toBeVisible();

      // ---- … and an administrator's controls say whose they are.
      for (const dismiss of await region(page, "watch")
        .getByRole("button", { name: /^Dismiss / })
        .all())
        await expectInert(dismiss, COPY.dismissReadOnly);
      for (const action of await region(page, "pipeline")
        .getByRole("button", { name: /^(Apply ⟳|Dismiss): / })
        .all())
        await expectInert(action, COPY.suggestionReadOnly);

      // ---- Past the page, the service refuses a member the writes that are not theirs.
      const item = "5eed0096-0000-4000-8000-000000000102";

      expect(
        await refusal(
          requestAs(
            context,
            "POST",
            `/api/v1/research/regression-watch/items/${item}/dismiss`,
            { reason: "e2e" },
            "a member dismissing",
          ),
        ),
      ).toContain("answered 403");
      expect(
        await refusal(
          requestAs(
            context,
            "PUT",
            `/api/v1/research/tools/${FIXTURE_TOOL.slug}`,
            { config: {} },
            "a member enabling",
          ),
        ),
      ).toContain("answered 403");
      expect(
        await refusal(
          requestAs(
            context,
            "POST",
            "/api/v1/research/regression-watch/comparisons",
            null,
            "a member comparing",
          ),
        ),
      ).toContain("answered 403");
    } finally {
      await context.close();
    }
  });

  test("shell: fixed chrome, Research lit, and the 125% step", async ({ context, page }) => {
    try {
      await setFontScale(context, "125");
      await openResearch(page);
      await expectFontScale(page, "125");

      const sidebar = page.getByRole("navigation", { name: "Primary" });
      await expect(sidebar.getByRole("link", { name: SIDEBAR_ENTRY, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);

      // ---- The page at the scale still draws all seven regions.
      for (const { slug } of REGIONS) await expect(region(page, slug)).toBeVisible();

      for (const theme of THEMES) {
        await pinTheme(page, theme);

        // ---- Header and sidebar hold still while the content pane scrolls.
        await scrollPaneTo(page, 0);
        const before = await chromeBoxes(page);
        expect(before.header, "the header must be on the page to be measured").not.toBeNull();
        expect(before.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();
        await scrollPaneTo(page, 400);
        expect(await chromeBoxes(page)).toEqual(before);

        // ---- At 125%, nothing on the page pushes the pane sideways.
        await expectNoPaneHorizontalScroll(page);
      }
    } finally {
      await restoreFontScale(context);
    }
  });
});

test.describe("research — the flows that write (#634)", () => {
  test.use({ viewport: PARITY_WINDOW });

  test("tool enable: the schema-driven sheet connects a tool, and its dot changes", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: PARITY_WINDOW });

    try {
      // The personal workspace has enabled nothing (#633's empty-state fixture).
      await signIn(context, SEED_OWNER.id);
      await selectWorkspace(context, SEED_PERSONAL_TENANT.slug);
      await disableTool(SEED_PERSONAL_TENANT.id, FIXTURE_TOOL.slug);

      const page = await context.newPage();
      await openResearch(page);

      const tools = region(page, "tools");
      const row = tools.getByRole("listitem").filter({ hasText: FIXTURE_TOOL.name });
      const enable = row.getByRole("button", { name: `Enable ${FIXTURE_TOOL.name}` });

      await expect(tools).toContainText("0 connected");
      await expect(row.getByRole("img")).toHaveAccessibleName(/^Not enabled/);

      // ---- The sheet is drawn from the tool's own schema, defaults included.
      await enable.click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByLabel(FIXTURE_TOOL.field.label)).toHaveValue(
        FIXTURE_TOOL.field.value,
      );
      await sheet.getByRole("button", { name: "Enable tool" }).click();
      await expect(sheet).toHaveCount(0);

      // ---- The row is enabled for good: the offer is gone, and the dot is the adapter's answer.
      await expect(enable).toHaveCount(0);
      await expect(row.getByRole("img"), TOOL_BROKE).toHaveAccessibleName(FIXTURE_TOOL.healthy);
      await expect(tools).toContainText("1 connected");

      await page.reload();
      await expect(row.getByRole("img")).toHaveAccessibleName(FIXTURE_TOOL.healthy);
    } finally {
      await quietly(
        () => disableTool(SEED_PERSONAL_TENANT.id, FIXTURE_TOOL.slug),
        "switching the fixture tool back off",
      );
      await context.close();
    }
  });

  test("gaps → Planning: the batch carries each gap and its citations, and nothing is filed", async ({
    context,
    page,
    request,
  }) => {
    await signInAs(context);
    await openResearch(page);

    const filedBefore = (await tracker(request).issues()).length;
    const ledger = await briefOf(context, SEEDED.brief.id);

    // ---- Three trackers are connected, so the service asks which — and says nothing is filed.
    // A second hand-off of the same gaps reopens the batch the first made, without asking.
    await region(page, "brief").getByRole("button", { name: "Draft epic from gaps →" }).click();
    const dialog = page.getByRole("dialog", { name: COPY.trackerDialog });
    const asked = await Promise.race([
      dialog.waitFor().then(
        () => true,
        () => false,
      ),
      page.waitForURL(BATCH_ADDRESS).then(
        () => false,
        () => false,
      ),
    ]);

    if (asked) {
      await expect(dialog).toContainText("Nothing is filed");
      await dialog.getByRole("radio", { name: /^GitHub · acme-robotics/ }).check();
      await dialog.getByRole("button", { name: "Draft here" }).click();
    }

    // ---- The batch opens in Planning, one draft per proposed ticket.
    await page.waitForURL(BATCH_ADDRESS);
    const batchId = new URL(page.url()).searchParams.get("batch")!;
    const drafts = page.getByRole("list", { name: /^Draft — 5 tickets$/ }).getByRole("listitem");

    await expect(drafts).toHaveCount(SEEDED.gapDrafts.length);
    for (const [index, key] of SEEDED.gapDrafts.entries())
      await expect(drafts.nth(index)).toContainText(key);

    // ---- Each draft names the gap it closes and cites the records the brief cited for it.
    const batch = (await requestAs<{
      drafts: {
        localKey: string;
        body: string;
        pushState: string;
        pushedTicketId: string | null;
      }[];
    }>(context, "GET", `/api/v1/planning/batches/${batchId}`, null, "reading the gap batch"))!;

    expect(batch.drafts.map((draft) => draft.localKey).sort()).toEqual([...SEEDED.gapDrafts]);
    for (const draft of batch.drafts) {
      expect(draft.body, `${draft.localKey} does not name its gap`).toMatch(
        new RegExp(
          `^Closes the \\*\\*.+\\*\\* gap \\((HIGH|MED)\\) found by ${SEEDED.brief.displayId}\\.`,
        ),
      );
      const cited = [...draft.body.matchAll(/^- (\[[^\]]+\]) /gm)].map((line) => line[1]);

      expect(cited.length, `${draft.localKey} cites nothing`).toBeGreaterThan(0);
      // A cited marker is one of the brief's — the panel's, or a ledger record's two digits.
      for (const label of cited) expect(label).toMatch(/^\[(\d{2}|git)\]$/);
      expect(draft.pushedTicketId, FILED_BROKE).toBeNull();
    }
    expect(ledger.sources.cited).toBe(SEEDED.brief.sources);

    // ---- Nothing was filed: the tracker holds what it held.
    expect((await tracker(request).issues()).length, FILED_BROKE).toBe(filedBefore);
    await expect(page.getByRole("button", { name: /^Push 5 tickets to GitHub →$/ })).toBeVisible();
  });

  test("the watch: a planted drift is detected, rests at needs repro, and an owner dismisses it", async ({
    context,
    page,
  }) => {
    test.slow();
    await signInAs(context);

    try {
      await removeDrift(context);

      // ---- The comparison is the product's: the telemetry tool reads the seeded measurements.
      expect(await plantDrift(context), DRIFT_BROKE).toBe("opened");

      // ---- The row is on the card, on the page's own poll or the first read.
      await openResearch(page);
      const watch = region(page, "watch");
      const row = watch.getByRole("listitem").filter({ hasText: DRIFT.row });

      await expect(row, DRIFT_BROKE).toHaveCount(1);
      await expect(watch.getByRole("listitem")).toHaveCount(SEEDED.watchRows.length + 1);

      // ---- The scheduler's next pass finds no replayable test and says so — it invents no culprit.
      await expect
        .poll(async () => (await plantedItem(context))?.note ?? null, {
          message: CHAIN_BROKE,
          timeout: WATCH_MS,
        })
        .toBe(COPY.noRepro);
      expect((await plantedItem(context))!.status).toBe("detected");
      await expect(row, CHAIN_BROKE).toContainText("needs repro", { timeout: WATCH_MS });
      await expect(row.getByRole("link")).toHaveCount(0);

      // ---- An owner dismisses it, with a reason, and it leaves the card.
      await row.getByRole("button", { name: /^Dismiss / }).click();
      const dialog = page.getByRole("dialog", { name: "Dismiss this drift" });
      await dialog.getByRole("textbox", { name: "Reason" }).fill("Planted by the e2e leg.");
      await dialog.getByRole("button", { name: "Dismiss item" }).click();
      await expect(row).toHaveCount(0);
      await expect(watch.getByRole("listitem")).toHaveCount(SEEDED.watchRows.length);
    } finally {
      await quietly(() => removeDrift(context), "taking the planted drift back out");
    }
  });
});

test.describe("research — the chains that wait on other issues (#634)", () => {
  test.use({ viewport: PARITY_WINDOW });

  /** Start an investigation from the composer and hand back its progress line. */
  async function start(page: Page, question: string) {
    const composer = region(page, "composer");

    await composer
      .getByRole("textbox", { name: "Ask like you'd ask a principal engineer" })
      .fill(question);
    await composer.getByRole("button", { name: "Start investigation ⟳" }).click();

    return composer.getByRole("status");
  }

  test("investigate → brief: the source count ticks, the brief is ready, cited and exportable", async ({
    context,
    page,
  }) => {
    // PARKED — see this file's header, § *What is parked, and on what*.
    test.fixme(true, "an investigation needs the invocation gateway — AF.2, #235");

    await signInAs(context);
    await openResearch(page);

    const progress = await start(page, "Why do dockings above 8 m/s fail?");
    const counted = async () =>
      Number(/(\d+) sources?/.exec((await progress.textContent()) ?? "")?.[1] ?? 0);

    await expect.poll(counted, { timeout: 60 * 1000 }).toBeGreaterThan(0);
    const first = await counted();
    await expect.poll(counted, { timeout: 60 * 1000 }).toBeGreaterThan(first);

    // A finished run lands on the Featured brief seat (#628), with its markers resolving.
    const brief = region(page, "brief");
    await expect(brief).toContainText("✓ brief ready", { timeout: 120 * 1000 });
    const marker = brief.locator(".research__brief-text .research__ref").first();
    await marker.click();
    await expect(brief.locator(".research__cite--lit .research__cite-n")).toHaveText(
      (await marker.textContent())!,
    );
    await expect(brief.getByRole("link", { name: "Export brief ↗" })).toBeVisible();
  });

  test("cancel: a run stopped mid-way keeps what it had read", async ({ context, page }) => {
    // PARKED — see this file's header, § *What is parked, and on what*.
    test.fixme(true, "an investigation needs the invocation gateway — AF.2, #235");

    await signInAs(context);
    await openResearch(page);

    const progress = await start(page, "Which rivals ship beaconless docking?");

    await expect(progress).toContainText(/\d+ sources?/, { timeout: 60 * 1000 });
    await region(page, "composer").getByRole("button", { name: "Cancel" }).click();
    await expect(progress).toContainText(/cancelled/i);

    // The stopped view keeps the ledger: the sources reached are still listed.
    await openResearch(page, `${RESEARCH_PATH}?view=library&status=cancelled`);
    await region(page, "investigations")
      .getByRole("button", { name: /^Open RS-/ })
      .first()
      .click();
    await expect(region(page, "investigations")).toContainText(/\d+ sources reached/);
  });

  test("pipeline: apply → re-run → a new version, then create-issues → writeback ≡ tracker", async ({
    context,
    page,
  }) => {
    // PARKED — see this file's header, § *What is parked, and on what*.
    test.fixme(true, "create-roadmap and create-issues are model calls — AF.2, #235");

    await signInAs(context);
    await openResearch(page);

    const pipeline = region(page, "pipeline");

    await pipeline.getByRole("button", { name: /^Apply ⟳: Pull #744/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Re-run create-roadmap" }).click();
    await expect(pipeline.getByText("v2", { exact: true })).toBeVisible({ timeout: 60 * 1000 });
    await expect(
      pipeline.getByRole("heading", { name: "Suggested changes — 1 open" }),
    ).toBeVisible();

    // The re-run's document and the tracker, after create-issues, by the seeded test's own rule.
    await pipeline.getByText("Raw .md", { exact: true }).click();
    const written = documentItems(await pipeline.locator("pre.research__md-raw").innerText());
    const filed = pipeline
      .getByRole("group", { name: "Issues by milestone" })
      .getByRole("listitem");

    await expect(filed, WRITEBACK_BROKE).toHaveCount(written.length);
    for (const [index, item] of written.entries())
      await expect(filed.nth(index).getByRole("link"), WRITEBACK_BROKE).toHaveText(item.number);
  });

  test("the watch chain: drift → bisected with its culprit → forensics opened → a fix draft", async ({
    context,
    page,
  }) => {
    // PARKED — see this file's header, § *What is parked, and on what*.
    test.fixme(true, "a bisect step is a farm build of a real checkout — AG.7, #991");

    await signInAs(context);
    await plantDrift(context);
    await openResearch(page);

    const row = region(page, "watch").getByRole("listitem").filter({ hasText: DRIFT.row });

    await expect(row).toContainText(/bisected → [0-9a-f]{7}/, { timeout: 120 * 1000 });
    await expect.poll(async () => (await plantedItem(context))?.status).toBe("fix_drafted");
    await expect(row).toContainText("fix ticket drafted");
  });
});
