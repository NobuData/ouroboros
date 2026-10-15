/**
 * Leg 29 — the Workflow Copilot page, and the chain that certifies the Workflow Copilot roadmap
 * ([#569](https://github.com/NobuData/ouroboros/issues/569), CE.5 — the MVP gate), over the frame
 * and cards of #565–#568 and the CC.4 seed (#558).
 *
 * `ouroboros-ui`'s suites prove each card on a fixture. This leg opens the seeded
 * `security-patch` in the product and asks the running stack the questions a fixture cannot
 * answer:
 *
 * * **The safety strip is derived** — the columns on the page are exactly the columns
 *   `GET …/dry-runs/safety` asserts (served and `holds`), in its order, and each ⓘ opens the
 *   mechanism the payload names: its words, the service's own sentence, its path. The leg compares
 *   the page to the payload, not to a list kept here, so a harness that stops backing a claim
 *   changes both sides together and a page that draws a claim from copy goes red.
 * * **The gateway-unavailable state** — decision W1's honest hard prerequisite: the notice that
 *   names it, the workspace's current provider status, the link to Providers, the conversation
 *   still readable and the composer inert with the reason. Asserted whenever the service's own
 *   readiness reports no gateway — which is every stack today.
 * * **The seeded dry run** — the verbatim pill, the result rows with their `how` labels, the
 *   simulated diff, the suggestions and their **Apply to draft**.
 * * **A reader who may not write** — the seeded member's page: the conversation readable, no
 *   composer, promote and discard inert with their reasons.
 * * **The shell** — fixed chrome over a scrolling pane, **Workflows** and **Copilot** lit, the
 *   surface segment sticky in the pane, and the 125 % step.
 * * **Both palettes** — the safety strip and the page head, screenshot-diffed.
 *
 * ## What is parked, and on what
 *
 * The issue's chain — brief → the draft builds → chips → dry run on `#489` → rows, diff,
 * suggestions → **Apply** → re-run honours the predicate → **promote** → v1 with guards →
 * tri-surface parity — cannot run on any stack today, for reasons that are other issues'. It is
 * written down here under `test.fixme` naming them, and its failure-mode pair is registered as
 * parked (`scripts/verify-failure-modes.sh`). The user settled this on the ticket (2026-10-12).
 *
 * * **Every reply and every model stage asks a model** through `POST /internal/llm/invoke`, which
 *   answers `501` until the invocation gateway (AF.2,
 *   [#235](https://github.com/NobuData/ouroboros/issues/235)). *Real models* is the claim under
 *   test, so this is the one dependency the chain cannot stub. (A draft built on a blank
 *   workflow can be dry-run and published since
 *   [#1744](https://github.com/NobuData/ouroboros/issues/1744).)
 *
 * The chain's body has therefore **never been run**. It is the issue's steps in the page's own
 * labels, to be corrected against a live stack by whoever un-parks it.
 *
 * ## What this leg writes
 *
 * Nothing. Every running test reads; the font scale is put back in teardown.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  APPLY_LABEL,
  APPLY_TITLE,
  COMPOSER_LABEL,
  COPILOT_PATH,
  COPILOT_TAB,
  COPILOT_TITLE,
  DIFF_HEADLINE,
  DISCARD_LABEL,
  DISCARD_MEMBER_REASON,
  DRY_RUN_ISSUE,
  GATEWAY_LINK,
  GATEWAY_NOTICE_TITLE,
  GATEWAY_REASON,
  HOW_LABELS,
  MECHANISM_WORDS,
  PICKER_LABEL,
  PICKER_PANEL_LABEL,
  PROMOTE_LABEL,
  PROMOTE_MEMBER_REASON,
  PROVIDER_STATUS,
  RERUN_LABEL,
  ROLE_TRANSCRIPT_NOTE,
  ROWS_LABEL,
  SAFETY_CLAIMS,
  SAFETY_TITLE,
  SEATS,
  SEND_LABEL,
  SIMULATED_PILL,
  SKIPPED_STAGE,
  SUGGESTIONS_LABEL,
  findWorkflowId,
  mechanismButton,
  readGuards,
  readReadiness,
  readSafety,
  readWorkflow,
  stageIds,
} from "../support/copilot";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import {
  PANE_SELECTOR,
  chromeBoxes,
  expectDocumentUnscrolled,
  expectNoPaneHorizontalScroll,
} from "../support/shell";
import { STUDIO_SUBNAV_LABEL } from "../support/studio";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** The window the leg runs in: the shell beside the page's two columns. */
const WINDOW = { width: 1440, height: 1000 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(WINDOW);
});

/* ------------------------------------------------------------------ getting there */

/**
 * Sign in as someone, enter the seeded workspace, and open the Copilot page on `security-patch`.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param userId - Who signs in.
 * @returns When the page's four cards are drawn.
 */
async function enterCopilot(context: BrowserContext, page: Page, userId: string): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, SEED_TENANT.slug);
  await page.goto(COPILOT_PATH);
  await drawnCopilot(page);
}

/**
 * Wait for an open Copilot page to have drawn its cards — after a navigation or a reload.
 *
 * @param page - The page, on {@link COPILOT_PATH}.
 * @returns When the head and the four seats are visible.
 */
async function drawnCopilot(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(COPILOT_TITLE);

  // While the route streams in, React holds the arriving cards in a hidden container beside the
  // ones it is about to replace, so for a moment a seat's id matches twice. Asked in one look
  // rather than card by card: every seat is there once, and none is still in that container.
  await page.waitForFunction(
    (seats) =>
      seats.every((seat) => {
        const found = document.querySelectorAll(seat);

        return found.length === 1 && found[0].closest("[hidden]") === null;
      }),
    Object.values(SEATS),
  );

  for (const seat of Object.values(SEATS)) await expect(page.locator(seat)).toBeVisible();
}

/**
 * The safety card.
 *
 * @param page - The page.
 * @returns The region named by mockup 20's heading.
 */
function safetyCard(page: Page): Locator {
  return page.getByRole("region", { name: SAFETY_TITLE });
}

/* ------------------------------------------------------------------ the safety strip */

test.describe("the safety strip is derived from the harness, not written", () => {
  test("draws exactly the claims the payload asserts, in its order, verbatim", async ({
    context,
    page,
  }) => {
    await enterCopilot(context, page, SEED_OWNER.id);

    const safety = await readSafety(context);
    const asserted = safety.columns.filter((column) => column.holds);
    const card = safetyCard(page);

    expect(
      asserted.length,
      "the installed harness backs no safety claim at all — the strip has nothing to derive from",
    ).toBeGreaterThan(0);

    const drawn = await card
      .locator("[data-claim]")
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-claim")));

    expect(
      drawn,
      "the strip's columns are not the ones GET …/dry-runs/safety asserts — a claim is drawn from copy, or one the harness backs is missing",
    ).toEqual(asserted.map((column) => column.id));

    for (const column of asserted) {
      const claim = SAFETY_CLAIMS[column.id];
      const item = card.locator(`[data-claim="${column.id}"]`);

      await expect(item).toContainText(claim.key);
      await expect(item).toContainText(claim.sentence);
    }

    // A claim the payload does not assert is absent — not greyed, and not said some other way.
    for (const column of safety.columns.filter((candidate) => !candidate.holds)) {
      await expect(
        card,
        `the strip makes the ${column.id} claim, which the harness does not back`,
      ).not.toContainText(SAFETY_CLAIMS[column.id].sentence);
    }

    await expect(card).toContainText(`harness: ${safety.harness}`);
  });

  test("traces every claim to the mechanism the payload names", async ({ context, page }) => {
    await enterCopilot(context, page, SEED_OWNER.id);

    const safety = await readSafety(context);
    const card = safetyCard(page);

    for (const column of safety.columns.filter((candidate) => candidate.holds)) {
      const info = card.getByRole("button", {
        name: mechanismButton(SAFETY_CLAIMS[column.id].key),
      });

      await expect(info).toHaveAttribute("aria-expanded", "false");
      await info.click();
      await expect(info).toHaveAttribute("aria-expanded", "true");

      const trace = card.getByRole("note");

      await expect(trace, `the ${column.id} popover does not name its mechanism`).toContainText(
        MECHANISM_WORDS[column.mechanism.kind],
      );
      await expect(
        trace,
        `the ${column.id} popover does not carry the service's own sentence`,
      ).toContainText(column.mechanism.detail);
      if (column.mechanism.path !== null) {
        await expect(trace).toContainText(column.mechanism.path);
      }
      for (const tool of column.mechanism.tools) await expect(trace).toContainText(tool);

      // Escape closes it and hands the focus back.
      await page.keyboard.press("Escape");
      await expect(info).toHaveAttribute("aria-expanded", "false");
      await expect(info).toBeFocused();
    }
  });
});

/* ------------------------------------------------------------------ the gateway (decision W1) */

test.describe("without the invocation gateway, the page says so honestly", () => {
  test("names the prerequisite, reports the provider status, links to Providers, and keeps the conversation readable", async ({
    context,
    page,
  }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);

    const readiness = await readReadiness(context);
    test.skip(
      readiness.gateway.available,
      "this stack has the invocation gateway, so the page has no unavailable state to show — the chain below is what runs instead",
    );

    await page.goto(COPILOT_PATH);
    await drawnCopilot(page);

    const conversation = page.locator(SEATS.conversation);
    const notice = conversation.getByRole("status").filter({ hasText: GATEWAY_NOTICE_TITLE });

    await expect(notice, "the page does not name the gateway as its prerequisite").toBeVisible();
    await expect(
      notice,
      "the gateway notice does not report the workspace's current provider status",
    ).toContainText(PROVIDER_STATUS);
    await expect(notice.getByRole("link", { name: GATEWAY_LINK.name })).toHaveAttribute(
      "href",
      GATEWAY_LINK.href,
    );

    // Read-only, not broken: what was said is there, and the box says why it cannot send.
    await expect(conversation.locator("[data-message-id]").first()).toBeVisible();

    const box = conversation.getByRole("textbox", { name: COMPOSER_LABEL });

    await expect(box).toHaveAccessibleDescription(GATEWAY_REASON);
    await expect(conversation.getByRole("button", { name: SEND_LABEL })).toBeDisabled();

    // Not a spinner: nothing on the page is still busy.
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);

    // The link is where providers are configured.
    await notice.getByRole("link", { name: GATEWAY_LINK.name }).click();
    await expect(page).toHaveURL(new RegExp(`${GATEWAY_LINK.href}$`));
  });
});

/* ------------------------------------------------------------------ the seeded dry run */

test.describe("the seeded dry run is drawn with the truth of how each row was produced", () => {
  test("the pill, the rows with their how labels, the simulated diff and the suggestions", async ({
    context,
    page,
  }) => {
    await enterCopilot(context, page, SEED_OWNER.id);

    const card = page.locator(SEATS.dryRun);

    await expect(card.getByRole("heading", { level: 2 })).toContainText(DRY_RUN_ISSUE);
    await expect(card).toContainText(SIMULATED_PILL);

    const rows = card.getByRole("list", { name: ROWS_LABEL }).getByRole("listitem");

    await expect(rows.first()).toBeVisible();

    const how = await card.locator(".copilot-dry__how").allTextContents();

    expect(how.length, "no result row says how it was produced").toBeGreaterThan(0);
    for (const label of how) {
      expect(HOW_LABELS.map((known) => `(${known})`)).toContain(label.trim());
    }

    // The stage the seeded run skipped is the one the first suggestion is about.
    await expect(rows.filter({ hasText: SKIPPED_STAGE })).toContainText("(skipped)");

    await expect(card).toContainText(DIFF_HEADLINE);

    const suggestions = card.getByRole("list", { name: SUGGESTIONS_LABEL });

    await expect(suggestions.getByRole("button", { name: APPLY_LABEL }).first()).toBeVisible();
    await expect(card.getByRole("button", { name: RERUN_LABEL })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ a reader who may not write */

test.describe("a member reads the page and is told why they cannot change it", () => {
  test("the conversation is visible and read-only; promote and discard are inert with reasons", async ({
    context,
    page,
  }) => {
    await enterCopilot(context, page, SEED_MEMBER.id);

    const conversation = page.locator(SEATS.conversation);

    await expect(conversation.locator("[data-message-id]").first()).toBeVisible();
    await expect(conversation).toContainText(ROLE_TRANSCRIPT_NOTE);
    await expect(conversation.getByRole("textbox")).toHaveCount(0);

    const promote = page.getByRole("button", { name: PROMOTE_LABEL });
    const discard = page.getByRole("button", { name: DISCARD_LABEL });

    await expect(promote).toHaveAttribute("aria-disabled", "true");
    await expect(promote).toHaveAttribute("title", PROMOTE_MEMBER_REASON);
    await expect(discard).toHaveAttribute("aria-disabled", "true");
    await expect(discard).toHaveAttribute("title", DISCARD_MEMBER_REASON);

    // The strip is the same strip: nothing in it is an action.
    await expect(safetyCard(page).locator("[data-claim]").first()).toBeVisible();
  });
});

/* ------------------------------------------------------------------ the shell */

test.describe("the shell holds the Copilot page", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterCopilot(context, page, SEED_OWNER.id);
  });

  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });

  test("the chrome holds still while the pane scrolls, and the surface segment stays in view", async ({
    page,
  }) => {
    const pane = page.locator(PANE_SELECTOR);
    const subnav = page.getByRole("navigation", { name: STUDIO_SUBNAV_LABEL, exact: true });
    const before = await chromeBoxes(page);

    expect(before.header, "the shell's header is laid out").not.toBeNull();
    expect(before.sidebar, "the shell's sidebar is laid out").not.toBeNull();
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the Copilot page must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect(await chromeBoxes(page)).toEqual(before);
    await expectDocumentUnscrolled(page);

    // Sticky in the pane: scrolled to the page's foot, the segment is still under the header.
    await expect(subnav, "the surface segment scrolled away with the pane").toBeInViewport();

    const paneBox = await pane.boundingBox();
    const subnavBox = await subnav.boundingBox();

    expect(
      Math.round(subnavBox?.y ?? -1),
      "the surface segment is not pinned to the pane's top edge",
    ).toBe(Math.round(paneBox?.y ?? -2));
  });

  test("the Workflows entry and the Copilot tab both know where the reader is", async ({
    page,
  }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    await expect(sidebar.getByRole("link", { name: "Workflows" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

    const subnav = page.getByRole("navigation", { name: STUDIO_SUBNAV_LABEL, exact: true });

    await expect(subnav.getByRole("link", { name: COPILOT_TAB, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(subnav.locator("[aria-current='page']")).toHaveCount(1);
  });

  test("the page still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();
    await drawnCopilot(page);

    const html = page.locator("html");

    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    await expectNoPaneHorizontalScroll(page);
    await expect(page.getByRole("banner")).toBeVisible();

    // The strip's sentences are whole at the larger type: none is clipped by its column.
    const clipped = await safetyCard(page)
      .locator("[data-claim]")
      .evaluateAll(
        (items) => items.filter((item) => item.scrollWidth > item.clientWidth + 1).length,
      );

    expect(clipped, "a safety claim overflows its column at 125%").toBe(0);
  });
});

/* ------------------------------------------------------------------ both palettes */

test.describe("the Copilot page is drawn in both palettes", () => {
  test("the safety strip, closed and with a mechanism open, is mockup 20's in light and dark", async ({
    context,
    page,
  }) => {
    await enterCopilot(context, page, SEED_OWNER.id);

    const card = safetyCard(page);

    await card.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(card).toHaveScreenshot(`copilot-safety-${theme}.png`);
    }

    await card
      .getByRole("button", { name: mechanismButton(SAFETY_CLAIMS.simulated_writes.key) })
      .click();
    await expect(card.getByRole("note")).toBeVisible();
    await page.mouse.move(0, 0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(card).toHaveScreenshot(`copilot-safety-mechanism-${theme}.png`);
    }
  });
});

/* ------------------------------------------------------------------ the chain (parked) */

test.describe("the conversational chain, end to end against a live gateway", () => {
  test("the chain: brief → draft → chips → dry run → apply → re-run → promote → tri-surface parity", async ({
    context,
    page,
  }) => {
    // PARKED — see this file's header, § *What is parked, and on what*. Never run: correct it
    // against a live stack when un-parking.
    test.fixme(true, "a reply and a model stage need the invocation gateway (AF.2, #235)");
    test.slow();

    const name = `e2e-copilot-${Date.now()}`;

    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);

    const readiness = await readReadiness(context);
    expect(
      readiness.gateway.available,
      "the chain needs a live invocation gateway — real models is the claim under test",
    ).toBe(true);

    /* ---- brief → the draft builds, stage rows appearing ---- */

    await page.goto("/workflows");
    await page.getByRole("button", { name: "+ New workflow" }).click();

    const create = page.getByRole("dialog", { name: "New workflow" });

    await create.getByRole("textbox", { name: "Name" }).fill(name);
    await create.getByRole("radio", { name: "Copilot" }).check();
    await create.getByRole("button", { name: "Create workflow" }).click();
    await expect(page).toHaveURL(new RegExp(`/workflows/${name}/copilot$`));

    const conversation = page.locator(SEATS.conversation);
    const stages = page.locator(SEATS.stages);
    const box = conversation.getByRole("textbox", { name: COMPOSER_LABEL });

    await box.fill(
      "Create a workflow for security patches: always get a second model's review, never auto-merge, and prove the CVE is actually fixed.",
    );
    await conversation.getByRole("button", { name: SEND_LABEL }).click();

    await expect(
      stages.locator(".copilot-stages__row").first(),
      "the operation applier did not put a stage row on the page",
    ).toBeVisible({ timeout: 120 * 1000 });

    /* ---- chips answered → operations applied ---- */

    const questions = conversation.locator(".copilot-chat__choice-row");

    await expect(questions.first()).toBeVisible({ timeout: 120 * 1000 });
    for (const question of await questions.all()) {
      await question.getByRole("button").first().click();
      await expect(question.locator("[aria-pressed='true']")).toHaveCount(1);
    }

    const built = await stages.locator(".copilot-stages__row").count();
    expect(built, "the draft has no stages after the chips were answered").toBeGreaterThan(0);

    /* ---- dry run on #489 → rows stream with their how labels → diff → suggestions ---- */

    const dryRun = page.locator(SEATS.dryRun);

    await dryRun.getByRole("button", { name: PICKER_LABEL }).click();
    await page
      .getByRole("group", { name: PICKER_PANEL_LABEL })
      .getByRole("button", { name: new RegExp(`^${DRY_RUN_ISSUE}\\b`) })
      .click();

    const rows = dryRun.getByRole("list", { name: ROWS_LABEL }).getByRole("listitem");

    await expect(rows.first(), "the dry run streamed no row").toBeVisible({ timeout: 120 * 1000 });
    await expect(dryRun.getByRole("button", { name: RERUN_LABEL })).toBeEnabled({
      timeout: 180 * 1000,
    });
    await expect(dryRun.locator(".copilot-dry__how").first()).toBeVisible();
    await expect(
      rows.filter({ hasText: SKIPPED_STAGE }),
      "the harness did not report the stage that had nothing to do as skipped",
    ).toContainText("(skipped)");
    await expect(dryRun, "the harness guards let a dry run end without its diff").toContainText(
      DIFF_HEADLINE,
    );

    const suggestions = dryRun.getByRole("list", { name: SUGGESTIONS_LABEL });

    await expect(
      suggestions.getByRole("button", { name: APPLY_LABEL }).first(),
      "the suggestion rules raised nothing for a run that skipped a stage",
    ).toBeVisible();

    /* ---- Apply → the rev bumps ---- */

    const revision = stages.locator(".ou-tag", { hasText: /^draft v/ });
    const before = (await revision.textContent())?.trim() ?? "";

    await suggestions.getByRole("button", { name: APPLY_LABEL }).first().click();

    const apply = page.getByRole("dialog", { name: APPLY_TITLE });

    await apply.getByRole("button", { name: APPLY_LABEL }).click();
    await expect(apply).toBeHidden();
    await expect(revision, "Apply did not move the draft's revision").not.toHaveText(before);

    /* ---- re-run → the stage now skips by configuration ---- */

    await dryRun.getByRole("button", { name: RERUN_LABEL }).click();
    await expect(dryRun.getByRole("button", { name: RERUN_LABEL })).toBeEnabled({
      timeout: 180 * 1000,
    });
    await expect(
      rows.filter({ hasText: SKIPPED_STAGE }),
      "the re-run does not honour the predicate Apply added — the stage did not skip by configuration",
    ).toContainText(/skipped.*condition|by configuration/i);

    /* ---- promote → v1 published, guards asserted at the enforcement planes ---- */

    // The slug the service gave the new workflow is the one in the address.
    const created = new URL(page.url()).pathname.split("/")[2] ?? "";
    const workflowId = await findWorkflowId(context, created);

    const promote = page.getByRole("button", {
      name: new RegExp(`^Promote draft → ${created} v1$`),
    });

    await promote.click();

    const publish = page.getByRole("dialog", { name: `Promote draft → ${created} v1` });

    await expect(publish).toContainText("What is being published");
    await publish.getByRole("button", { name: /^Promote draft/ }).click();
    await expect(
      page.getByRole("status").filter({ hasText: `Promoted the draft to ${created} v1.` }),
      "the promote gate did not publish v1",
    ).toBeVisible();

    const published = await readWorkflow(context, workflowId);

    expect(published.currentVersion, "promote did not publish v1").toBe(1);

    const guards = await readGuards(context, workflowId);

    expect(
      guards.find((guard) => /never auto-merge/i.test(guard.name))?.enforcement,
      "never auto-merge is not enforced by the published definition",
    ).toBe("enforced");

    /* ---- tri-surface parity: canvas ≡ code ≡ copilot ---- */

    const graph = stageIds(published.version?.definition ?? {});

    expect(graph.length, "the published version has no stages").toBeGreaterThan(0);

    await page.goto(`/workflows/${created}`);
    await expect(page.locator(".react-flow__node")).toHaveCount(graph.length);
    expect(
      (
        await page
          .locator(".react-flow__node")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-id")))
      ).sort(),
      "the canvas does not draw the published graph",
    ).toEqual([...graph].sort());

    await page.goto(`/workflows/${created}/code`);
    for (const id of graph) {
      await expect(
        page.locator(".code-editor"),
        `the code view does not name stage ${id}`,
      ).toContainText(id);
    }

    await page.goto(`/workflows/${created}/copilot`);
    for (const id of graph) {
      await expect(
        page.locator(`#stage-${id}`),
        `the copilot's stage list has no row for stage ${id}`,
      ).toBeAttached();
    }
  });
});
