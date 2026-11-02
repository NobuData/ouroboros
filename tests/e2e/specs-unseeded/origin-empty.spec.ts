/**
 * A fresh deployment shows nothing invented (DJ.3, [#1316](https://github.com/NobuData/ouroboros/issues/1316)).
 *
 * The stack this runs against was migrated **without** the development seed
 * (`docker-compose.e2e-unseeded.yml`). A stranger signs up — and gets a personal workspace — and
 * every surface the data-origin labelling covers must draw its empty state: no figure invented as
 * `0`, no name, number or run from the demo tenant, and no **Demo data** label, because there is
 * no demo data to label.
 *
 * Run with `yarn unseeded` (or `scripts/run.sh --unseeded`); the seeded suite never collects it.
 */

import { type BrowserContext, expect, test } from "@playwright/test";

import { AUTH_BASE_PATH, SESSION_COOKIE, sessionTokenFrom } from "../support/session";
import { REST_URL, UI_URL } from "../support/stack";

/** The leg's one person — named an administrator by the overlay, so the account is approved. */
const PERSON = {
  name: "Unseeded Leg",
  email: "unseeded-leg@example.test",
  password: "unseeded-leg-password-1",
} as const;

/** Words only the demo tenant's rows carry: its workspace, repository, issues and models. */
const DEMO_WORDS = [
  "acme-robotics",
  "helios-firmware",
  "CAN-bus",
  "#482",
  "#474",
  "claude-fable-5",
  "Demo data",
] as const;

/** The surfaces DJ.3 labels, and what each one's empty state says. */
const SURFACES = [
  { route: "/dashboard", empty: /Nothing is running right now/ },
  { route: "/insights", empty: /No live loop/ },
  { route: "/build-farm", empty: /./ },
] as const;

/**
 * Sign the leg's person up (or in, on a re-run against a kept stack) and hand the session to the
 * browser.
 *
 * @param context The browser context.
 */
async function signUp(context: BrowserContext): Promise<void> {
  const signUpResponse = await fetch(`${REST_URL}${AUTH_BASE_PATH}/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: UI_URL },
    body: JSON.stringify(PERSON),
  });
  const response = signUpResponse.ok
    ? signUpResponse
    : await fetch(`${REST_URL}${AUTH_BASE_PATH}/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: UI_URL },
        body: JSON.stringify({ email: PERSON.email, password: PERSON.password }),
      });
  const token = sessionTokenFrom(response);

  expect(token, `sign-up answered ${String(response.status)}`).toBeDefined();
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token ?? "",
      domain: new URL(UI_URL).hostname,
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("a stack migrated without the seed", () => {
  test.beforeEach(async ({ context }) => {
    await signUp(context);
  });

  for (const surface of SURFACES) {
    test(`${surface.route} draws its empty state and nothing from the demo tenant`, async ({
      page,
    }) => {
      await page.goto(surface.route);
      await page.waitForLoadState("networkidle");

      const text = await page.locator("main").innerText();

      await expect(page.locator("main")).toContainText(surface.empty);

      for (const word of DEMO_WORDS) {
        expect(text, `${surface.route} shows "${word}"`).not.toContain(word);
      }

      // Nothing to label and nothing to explain: no strip on a deployment with no demo data.
      await expect(page.locator(".origin-strip")).toHaveCount(0);
      await expect(page.locator(".origin-badge")).toHaveCount(0);
    });
  }

  test("the dashboard's figures read no data, never an invented zero", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("PRs merged · 7d").locator("..")).not.toContainText(/\b0\b/);
  });
});
