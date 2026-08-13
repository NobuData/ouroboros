/**
 * Leg 2 — *login → tenant select → dashboard shows the seeded tenant*.
 *
 * The longest browser chain in the base suite, and the one that touches every service:
 * the UI renders, `ouroboros-rest` authenticates the session and answers with the person's
 * memberships, PostgreSQL holds the rows the seed put there, and the dashboard reads the
 * engine's status on the way past.
 *
 * ## About the session
 *
 * **The signed-in half of this leg is parked, but no longer for want of a mechanism.**
 * [#705](https://github.com/NobuData/ouroboros/issues/705) landed the development
 * email/password sign-in, and `support/session.ts`'s {@link signIn} is now a real call to a
 * real route — the "one function" that file spent two issues predicting. What is still
 * missing is the data and the deployment: the seed does not yet write BetterAuth's `account`
 * rows ([#709](https://github.com/NobuData/ouroboros/issues/709)), and the compose stack
 * runs `ouroboros-rest`'s production image, which is exactly what #705 gates the password
 * routes off on. `support/session.ts` sets both out. Those tests carry `test.fixme` and say
 * so in the report.
 *
 * **The signed-*out* half still runs**, and it is the half that was keeping the other one
 * honest: a visitor with no session is sent to the login screen, and a cookie naming no
 * session is worth exactly as little. Without those, a suite that minted its own credential
 * would pass just as happily against a service that had stopped checking credentials at
 * all.
 */

import { type Page, expect, test } from "@playwright/test";

import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { SESSION_COOKIE, SESSION_PARKED, signIn } from "../support/session";
import { UI_URL } from "../support/stack";

test.describe("the session is really checked", () => {
  test("a signed-out visitor gets the sign-in step, not the dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    // `app/api/access.ts`'s guard sends an unauthenticated request to the login screen.
    await expect(page).toHaveURL(new RegExp("/login"));
    await expect(page.getByRole("heading", { name: /sign in|continue/i }).first()).toBeVisible();
  });

  test("a session token naming nothing authenticates nobody", async ({ context, page }) => {
    // The post-#703 form of "a forged credential is refused". The cookie no longer carries
    // a signed payload to tamper with — it names a row in `ouroboros.session` — so the way
    // to be somebody you are not is to invent a token, and this is that request. It needs
    // no session to have been minted, which is why it still runs.
    await context.addCookies([
      {
        name: SESSION_COOKIE,
        value: "a-token-no-session-was-ever-issued-with",
        domain: new URL(UI_URL).hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/dashboard");

    await expect(page).toHaveURL(new RegExp("/login"));
  });

  test("#33's cookie is worth nothing, and is taken away", async ({ context, page }) => {
    // The cut-over invalidated every live session, and a browser that goes on sending
    // `ouro_session` has to be refused cleanly rather than trusted or crashed into. This is
    // that browser: it is sent to the login screen, and the service tells it to drop the
    // cookie on the way past.
    await context.addCookies([
      {
        name: "ouro_session",
        value: "left-over-from-33",
        domain: new URL(UI_URL).hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/dashboard");

    await expect(page).toHaveURL(new RegExp("/login"));
  });
});

test.describe("login → tenant select → dashboard", () => {
  test.fixme(true, SESSION_PARKED);

  /**
   * Sign in and walk step 2 the way a person does.
   *
   * **Step 2 is one card since
   * [#719](https://github.com/NobuData/ouroboros/issues/719)** — the mockup's own: every
   * workspace as a row, and one **Enter mission control →** under them. It was two steps
   * before, a picker that wrote `ouro_tenant` and then an enablement list reached by
   * `?workspace=<slug>`, and the flow below is the same journey through the card that
   * replaced both.
   *
   * @param page - The page to drive.
   * @param slug - Which workspace to enter.
   */
  async function enterWorkspace(page: Page, slug: string): Promise<void> {
    // A session whose browser has not been through step 2 is `loginView`'s `choose`
    // outcome (`app/login/view.ts`). Arriving here at all proves the session read —
    // `GET /api/auth/get-session` plus `GET /api/v1/orgs`, the row model
    // [#714](https://github.com/NobuData/ouroboros/issues/714) added — answered with the
    // seed's membership rows.
    await page.goto("/login");

    // The row prints the handle, which is what the mockup prints and what tells two
    // similarly named workspaces apart. The radio is labelled by the whole row, so this
    // finds the choice and the name in one.
    const choice = page.getByRole("radio", { name: new RegExp(slug) });

    await expect(choice, "the seeded workspace must be offered to its owner").toBeVisible();
    await choice.check();

    // A submit button rather than the link this used to be: the press is what writes
    // `session."activeOrganizationId"` (`app/login/actions.ts`), and the navigation is that
    // action's redirect.
    await page.getByRole("button", { name: /Enter mission control/ }).click();

    await expect(page).toHaveURL(new RegExp("/dashboard"));
  }

  test("the seeded owner reaches their workspace", async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);

    await enterWorkspace(page, SEED_TENANT.slug);

    // The dashboard's `<h1>` is the workspace's name
    // (`app/dashboard/dashboard-screen.tsx`), so this is the seeded tenant arriving
    // through five services and being rendered — which is what "shows the seeded tenant"
    // means. It is also the acceptance criterion #719 names: the CTA lands on the `(app)`
    // dashboard **with the tenant context resolved**, and the context it resolves from is
    // the session pointer the press just wrote
    // ([#713](https://github.com/NobuData/ouroboros/issues/713)) rather than a cookie this
    // browser was carrying.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEED_TENANT.displayName);
  });

  test("the mockup's rows are what the seed put there", async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);

    await page.goto("/login");

    // Step 2's first acceptance criterion, against the running stack: three rows, the
    // counts the seed's enablement rows produce, and the `personal` pill on the one
    // workspace #704 creates at first sign-in.
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByRole("switch")).toHaveCount(3);
    await expect(page.getByText("personal")).toBeVisible();
    await expect(page.getByText(/4 repos enabled · incl\. helios-firmware/)).toBeVisible();
  });

  test("the dashboard reports the signed-in person", async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);

    await enterWorkspace(page, SEED_TENANT.slug);

    // The subline is built from the user the *service* reported, not from anything this
    // suite sent — so a session that authenticated the wrong person would show here and
    // nowhere else in the run.
    await expect(page.locator("body")).toContainText(SEED_OWNER.displayName);
  });
});
