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
 * The issue asks for a *dev-auth login*. The compose stack cannot serve one — its
 * `ouroboros-rest` image pins `NODE_ENV=production`, which strips `OURO_AUTH_DEV_USER`
 * before the configuration schema sees it, by design and documented in `README.md`
 * § Signing in. `support/session.ts` explains what this suite does instead and why it is a
 * credential rather than a bypass; the short version is that the cookie is signed by
 * `ouroboros-rest`'s own `issueSession`, and every check the guard makes still runs.
 *
 * The first test in this file is what keeps that honest: it proves an *invalid* session is
 * refused. Without it, a suite that minted its own cookie would pass just as happily
 * against a service that had stopped checking cookies at all.
 */

import { expect, test } from "@playwright/test";

import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { mintSession, signIn } from "../support/session";
import { UI_URL } from "../support/stack";

/** A week and a day — past `SESSION_MAX_AGE_SECONDS`, which is seven days. */
const EXPIRED_AT = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

test.describe("the session is really checked", () => {
  test("a signed-out visitor gets the sign-in step, not the dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    // `app/api/access.ts`'s guard sends an unauthenticated request to the login screen.
    await expect(page).toHaveURL(new RegExp("/login"));
    await expect(page.getByRole("heading", { name: /sign in|continue/i }).first()).toBeVisible();
  });

  test("a forged signature authenticates nobody", async ({ context, page }) => {
    const { token } = mintSession(SEED_OWNER.id);

    // Flip the payload while keeping the signature: the HMAC no longer covers the bytes,
    // which is the one thing `signing.ts` promises to notice.
    const [body, signature] = token.split(".");
    const forged = `${body.slice(0, -2)}xx.${signature}`;

    await context.addCookies([
      {
        name: "ouro_session",
        value: forged,
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

  test("an expired session is refused however good its signature", async ({ context, page }) => {
    const expired = mintSession(SEED_OWNER.id, EXPIRED_AT);

    await context.addCookies([...expired.cookies]);
    await page.goto("/dashboard");

    // Age is part of verification rather than of reading (`signing.ts`), so this is the
    // same rejection a forged token gets — which is what the caller is meant to see.
    await expect(page).toHaveURL(new RegExp("/login"));
  });
});

test.describe("login → tenant select → dashboard", () => {
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
