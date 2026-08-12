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

import { expect, test } from "@playwright/test";

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

  test("the seeded owner reaches their workspace", async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);

    // ---- Step: the workspace chooser -------------------------------------------------
    //
    // A session with memberships and no `ouro_tenant` cookie is `loginView`'s `choose`
    // outcome (`app/login/view.ts`). Arriving here at all proves `GET /api/v1/auth/me`
    // answered with the seed's membership rows.
    await page.goto("/login");

    const workspaceRow = page.getByRole("button", { name: new RegExp(SEED_TENANT.displayName) });

    await expect(workspaceRow, "the seeded workspace must be offered to its owner").toBeVisible();

    // Scoped to the row rather than to the page: the signed-in identity block renders
    // `ken@acme-robotics.dev`, so a page-wide search for the slug matches the email as
    // well and asserts nothing about the row. It is the row's own detail line that has to
    // carry the handle — that is what tells two similarly named workspaces apart.
    await expect(workspaceRow.getByText(SEED_TENANT.slug, { exact: true })).toBeVisible();

    // ---- Step: choosing it ------------------------------------------------------------
    //
    // Each row is a submit button in a form of one hidden field
    // (`app/login/workspace-card.tsx`); pressing it runs the Server Action that writes the
    // cookie and redirects to `?workspace=<slug>`, which is the enablement step.
    await workspaceRow.click();

    await expect(page).toHaveURL(new RegExp(`workspace=${SEED_TENANT.slug}`));

    // ---- Step: entering ---------------------------------------------------------------
    const enter = page.getByRole("link", { name: /Enter mission control/ });

    await expect(enter).toBeVisible();
    await enter.click();

    // ---- The assertion the leg exists for ---------------------------------------------
    await expect(page).toHaveURL(new RegExp("/dashboard"));

    // The dashboard's `<h1>` is the workspace's display name
    // (`app/dashboard/dashboard-screen.tsx`), so this is the seeded tenant arriving
    // through five services and being rendered — which is what "shows the seeded tenant"
    // means.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SEED_TENANT.displayName);
  });

  test("the dashboard reports the signed-in person", async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);

    await page.goto("/login");
    await page.getByRole("button", { name: new RegExp(SEED_TENANT.displayName) }).click();
    await page.getByRole("link", { name: /Enter mission control/ }).click();

    await expect(page).toHaveURL(new RegExp("/dashboard"));

    // The subline is built from the user the *service* reported, not from anything this
    // suite sent — so a session that authenticated the wrong person would show here and
    // nowhere else in the run.
    await expect(page.locator("body")).toContainText(SEED_OWNER.displayName);
  });
});
