/**
 * Leg 30 — Chat Ops: the seeded page, and the states the mockup does not draw
 * ([#545](https://github.com/NobuData/ouroboros/issues/545), CA.5).
 *
 * `docs/mockups/19-chatops.html` is a photograph of one good moment: Slack connected, three
 * channels bound, a reader whose identity is linked. This file holds the page to that picture on
 * the seeded workspace, in both palettes, and then to the two things about it that depend on
 * **who is reading**:
 *
 * * **Parity** — the seeded page, whole, screenshot-diffed in both palettes.
 * * **The shell** — the header and the sidebar hold still while the pane scrolls; Chat Ops adds no
 *   sidebar entry, so none is lit on it and the one the reader left is lit again on the way
 *   back; and the page survives the 125% type step.
 * * **The unlinked reader** — Jorge, a member with no linked Slack identity, is told so once, in
 *   the mirror, with the command that links and the way out to Slack; Ken, who is linked, is told
 *   nothing. Jorge also reads the page's owner-only controls as what they are for him: absent,
 *   or explained.
 *
 * **Nothing here writes.** The states that need something to go wrong — a publish Slack refuses,
 * an app revoked, a bot removed from a channel — and the chain that certifies the integration
 * are `specs/slack.spec.ts`, which runs late in the suite on purpose: it answers decisions in the
 * seeded workspace, and the legs that count the seed's own run before it.
 */

import { type Locator, type Page, expect, test } from "@playwright/test";

import {
  CHATOPS_COPY,
  CHATOPS_PATH,
  SEEDED_CHANNELS,
  connectionOf,
  drawnChatOps,
  openChatOps,
} from "../support/chatops";
import { SEED_MEMBER, SEED_TENANT } from "../support/seed";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { PANE_SELECTOR, chromeBoxes, expectNoPaneHorizontalScroll } from "../support/shell";
import { THEMES, pinTheme } from "../support/theme";

/** The window the pair is photographed in: wide enough for both columns, tall enough for all of it. */
const PARITY_WINDOW = { width: 1440, height: 2200 } as const;

/**
 * The mirror's stream scrolls inside its own box, and Playwright paints a mask at an element's
 * layout box even where a scroller clips it — so a masked timestamp scrolled out of view lands
 * its mask on whatever is drawn there instead. For the photograph the box is let grow to its
 * content: every entry is in the picture, and every mask is on the thing it names.
 */
const WHOLE_STREAM =
  ".chatops-mirror__stream { max-height: none !important; overflow: visible !important; }";

/**
 * What changes from one run to the next without the page being any different: when the token
 * was verified, how fresh the mirror is, the seed's clock times (it is written relative to
 * *now*) and how long the open question has waited.
 *
 * @param page - The page.
 * @returns The regions to leave out of the comparison.
 */
function volatile(page: Page): Locator[] {
  return [
    page.getByRole("region", { name: CHATOPS_COPY.health }).getByRole("listitem").last(),
    page.locator(".chatops-mirror__fresh"),
    page.locator(".chatops-mirror__ts"),
    page.locator(".chatops-mirror__day-rule"),
    page.locator(".chatops-mirror__footnote"),
    // "resolved: … — Maya Chen (08:11)": the answer's clock time, as relative as the rest.
    page.locator(".chatops-mirror__resolution"),
  ];
}

/** The seeded loops channel's mirror. */
function mirror(page: Page): Locator {
  return page.getByRole("region", { name: `Mirror of #${SEEDED_CHANNELS.loops.name}` });
}

test.describe("leg 30: chat ops — the seeded page and who is reading it", () => {
  test("parity: the seeded Chat Ops page, in both palettes", async ({ context, page }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await openChatOps(context, page);

    // ---- The page the pair is of: connected, the loops mirror showing, every side card drawn.
    const strip = page.getByRole("region", { name: CHATOPS_COPY.health });

    await expect(strip).toContainText(SEED_TENANT.slug);
    await expect(strip).toContainText("active");
    await expect(mirror(page).getByRole("log", { name: CHATOPS_COPY.stream })).toContainText(
      "Loop #1839 finished — PR #512 merged",
    );
    await expect(page.getByRole("region", { name: CHATOPS_COPY.commandsTitle })).toBeVisible();
    await expect(page.getByRole("region", { name: CHATOPS_COPY.routingTitle })).toBeVisible();
    await expect(page.getByRole("region", { name: CHATOPS_COPY.boundTitle })).toBeVisible();

    // Nothing is wrong on the seed, so nothing says so.
    await expect(page.getByRole("status", { name: CHATOPS_COPY.deliveryLabel })).toHaveCount(0);
    await expect(page.getByRole("region", { name: CHATOPS_COPY.unlinkedLabel })).toHaveCount(0);

    await page.addStyleTag({ content: WHOLE_STREAM });

    expect(
      await page.locator(PANE_SELECTOR).evaluate((el) => el.scrollHeight - el.clientHeight),
      `the page must fit ${String(PARITY_WINDOW.height)}px whole, or the pair photographs bare ground`,
    ).toBe(0);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`chatops-${theme}.png`, { mask: volatile(page) });
    }
  });

  test("shell: fixed chrome under a pane scroll, no entry lit, and the 125% step", async ({
    context,
    page,
  }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    // ---- Where the reader came from is lit there…
    await openChatOps(context, page);
    await page.goto("/settings");
    await expect(sidebar.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // ---- …and Chat Ops, which adds no entry, lights none: an entry lit on somebody else's
    // route is what the shell's active rule exists to prevent. Settings links here by itself.
    await page.locator(`a[href='${CHATOPS_PATH}']`).first().click();
    await expect(page).toHaveURL(new RegExp(`${CHATOPS_PATH}$`));
    await drawnChatOps(page);
    await expect(sidebar.locator("[aria-current]")).toHaveCount(0);

    // ---- The chrome holds still while the pane scrolls under it.
    const pane = page.locator(PANE_SELECTOR);
    const before = await chromeBoxes(page);

    expect(before.header, "the header must be on the page to be measured").not.toBeNull();
    expect(before.sidebar, "the sidebar must be on the page to be measured").not.toBeNull();
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "Chat Ops must overflow its pane at the suite's window for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await chromeBoxes(page)).toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // ---- And back: the entry the reader left is the one lit again.
    await page.goBack();
    await expect(sidebar.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // ---- A fifth more type: nothing pushes the pane sideways, and the page is still Chat Ops.
    try {
      await setFontScale(context, "125");
      await page.goto(CHATOPS_PATH);
      await expectFontScale(page, "125");
      await drawnChatOps(page);
      await expectNoPaneHorizontalScroll(page);
      await expect(
        mirror(page).getByRole("combobox", { name: CHATOPS_COPY.composer }),
      ).toBeVisible();
      await expect(page.getByRole("region", { name: CHATOPS_COPY.routingTitle })).toBeVisible();
    } finally {
      await restoreFontScale(context);
    }
  });

  test("unlinked: a member with no Slack link is told once, with the way to link — a linked reader is not", async ({
    browser,
    context,
    page,
  }) => {
    // ---- Ken is linked: the service says so, and the page says nothing.
    await openChatOps(context, page);
    expect(
      (await connectionOf(context)).viewerLinked,
      "the seeded owner's Slack identity is linked",
    ).toBe(true);
    await expect(page.getByRole("region", { name: CHATOPS_COPY.unlinkedLabel })).toHaveCount(0);

    // ---- Jorge's link was revoked by the seed: he is a member of the workspace and of nothing
    // in Slack, as far as Ouroboros can tell.
    const member = await browser.newContext();

    try {
      const his = await member.newPage();

      await openChatOps(member, his, { userId: SEED_MEMBER.id });
      expect(
        (await connectionOf(member)).viewerLinked,
        "the banner appears only for viewers without a live link: the seeded member has none",
      ).toBe(false);

      const banner = mirror(his).getByRole("region", { name: CHATOPS_COPY.unlinkedLabel });

      await expect(banner).toContainText(CHATOPS_COPY.unlinkedTitle);
      await expect(banner.locator("code")).toHaveText(CHATOPS_COPY.linkCommand);
      await expect(banner.getByRole("link", { name: CHATOPS_COPY.openSlack })).toHaveAttribute(
        "href",
        `https://app.slack.com/client/T024AB/${SEEDED_CHANNELS.loops.slack}`,
      );

      // Nothing in the app is taken from him: the composer is his to run commands in.
      await expect(
        mirror(his).getByRole("combobox", { name: CHATOPS_COPY.composer }),
      ).toBeEnabled();

      // ---- And what is an owner's or an admin's reads as that, not as broken.
      await expect(
        his
          .getByRole("region", { name: CHATOPS_COPY.health })
          .getByRole("button", { name: CHATOPS_COPY.verify }),
      ).toHaveCount(0);
      await expect(his.getByRole("button", { name: CHATOPS_COPY.addChannel })).toBeDisabled();

      const routing = his.getByRole("region", { name: CHATOPS_COPY.routingTitle });

      await expect(routing).toContainText(CHATOPS_COPY.routingRoleNote);
      await expect(routing.getByRole("combobox")).toHaveCount(0);
      await expect(
        his
          .getByRole("region", { name: CHATOPS_COPY.boundTitle })
          .getByRole("button", { name: /^Unbind/ }),
      ).toHaveCount(0);
    } finally {
      await member.close();
    }
  });
});
