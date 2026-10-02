/**
 * The weekly Insights email under client profiles
 * ([#440](https://github.com/NobuData/ouroboros/issues/440), BJ.4).
 *
 * *"Email rendering is its own discipline — clients strip CSS unpredictably, so the template is
 * verified by fixture screenshots rather than assumed."* This config is that verification, and
 * it is honest about what it is: **Chromium emulating four things a mail client does to a
 * message**, not Outlook, Gmail or Apple Mail themselves.
 *
 * | Project | What it emulates |
 * | ------- | ---------------- |
 * | `desktop-600` | a desktop client's reading pane, 600 px wide |
 * | `mobile-360` | a phone, 360 px wide |
 * | `dark-scheme` | a client in dark mode — the mail declares itself light and must stay as drawn |
 * | `style-stripped` | a client that removes `<style>` blocks, leaving only inline styles |
 *
 * **It needs no stack.** The page under test is a string: the HTML part ouroboros-rest's
 * renderer produced, committed as its golden file
 * (`ouroboros-rest/src/modules/insights/digest/digest.golden.json`) and loaded with
 * `page.setContent`. So this config stands alone rather than spreading `playwright.config.ts`,
 * whose base URL, suite budget and single worker all exist for a compose stack this run never
 * starts — and its spec lives in `email/`, outside the smoke suite's `specs/`, so each spec runs
 * under exactly one config.
 *
 * ```bash
 * yarn email                      # compare against the committed baselines
 * yarn email --update-snapshots   # record, then read the diff before committing
 * ```
 */
import { defineConfig } from "@playwright/test";

/** The options a client profile sets beyond Playwright's own. */
export interface ClientProfile {
  /** Remove every `<style>` block before rendering, as some clients do. */
  stripStyles: boolean;
}

export default defineConfig<ClientProfile>({
  testDir: "./email",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{projectName}-{platform}{ext}",

  // A profile is one static document; nothing here waits on a network.
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,

  // The smoke suite's own tolerance: anti-aliasing may move, a layout may not.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },

  outputDir: "./test-results/email",
  reporter:
    process.env.CI === undefined
      ? [["list"], ["html", { outputFolder: "playwright-report/email", open: "never" }]]
      : [
          ["github"],
          ["list"],
          ["html", { outputFolder: "playwright-report/email", open: "never" }],
        ],

  use: {
    browserName: "chromium",
    colorScheme: "light",
    stripStyles: false,
    trace: "retain-on-failure",
  },

  projects: [
    { name: "desktop-600", use: { viewport: { width: 600, height: 900 } } },
    { name: "mobile-360", use: { viewport: { width: 360, height: 780 } } },
    { name: "dark-scheme", use: { viewport: { width: 600, height: 900 }, colorScheme: "dark" } },
    { name: "style-stripped", use: { viewport: { width: 600, height: 900 }, stripStyles: true } },
  ],
});
