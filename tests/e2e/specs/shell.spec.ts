/**
 * Leg 1 — *the UI loads with the correct title and favicon; the theme toggle flips
 * palettes*.
 *
 * The leg that says the thing a browser reaches is the product, rather than some other
 * Next.js application that happens to answer on 3000. Three assertions, and each is about
 * an artefact somebody could break without any test in `ouroboros-ui` going red:
 *
 *   * the **title**, which comes from the route's own metadata,
 *   * the **favicon**, which is not rendered by React at all — it is a file in `public/`
 *     that the *image* has to have copied, and a Dockerfile that stopped copying it would
 *     leave every unit test green,
 *   * the **palette**, which is `data-theme` on `<html>` plus a stylesheet, and is the one
 *     thing in the product that is only true if the CSS actually shipped.
 *
 * CP.4 ([#646](https://github.com/NobuData/ouroboros/issues/646)) adds the pane-memory
 * group at the foot of the file: scroll restoration, the anchor offset and the sticky
 * stack, driven against the workshop's long fixture. Session-gated like the toggle, and
 * parked with it.
 */

import { expect, test } from "@playwright/test";

import { describe } from "../support/api";
import { SEED_OWNER, SEED_TENANT } from "../support/seed";
import { SESSION_PARKED, signIn } from "../support/session";
import { UI_URL } from "../support/stack";
import { selectWorkspace } from "../support/workspace";

/** `--ground` in the light palette — `ouroboros-ui/app/tokens.css`, `:root`. */
const LIGHT_GROUND = "rgb(245, 248, 250)";

/** `--ground` in the dark palette — the same file, `:root[data-theme="dark"]`. */
const DARK_GROUND = "rgb(18, 24, 29)";

test.describe("the UI is the product", () => {
  test("the login screen carries its own title", async ({ page }) => {
    await page.goto("/login");

    // From `app/(auth)/login/page.tsx`'s metadata. Asserted on the signed-out route
    // because it is the one page a stranger reaches, and a wrong title there is what a
    // search engine and a bookmark record.
    await expect(page).toHaveTitle("Sign in · Ouroboros");
  });

  test("the favicon served is the one in the checkout", async ({ request }) => {
    // Not `page.goto` and a `<link>` assertion: this application has no icon link tags
    // yet — wiring the Metadata API is issue #15, and `ouroboros-ui/README.md` §
    // "What is still to wire" says so. `/favicon.ico` resolves by convention, which every
    // browser probes on its own, so the honest assertion is that the origin serves it and
    // that it is the right bytes rather than some framework's placeholder.
    const response = await request.get(`${UI_URL}/favicon.ico`);

    expect(response.status(), await describe(response)).toBe(200);

    const body = await response.body();

    // An .ico begins with a 6-byte ICONDIR: reserved 0, type 1, then the image count.
    // Checking the header rather than a byte length is what makes this an assertion about
    // the format instead of about the size of whatever happened to be served.
    expect(body.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x00, 0x01, 0x00]));
    expect(body.byteLength, "an empty or truncated icon is a broken image copy").toBeGreaterThan(
      1024,
    );
  });

  test("the web manifest is served and names the product", async ({ request }) => {
    const response = await request.get(`${UI_URL}/manifest.webmanifest`);

    expect(response.status(), await describe(response)).toBe(200);

    const manifest = (await response.json()) as { name?: string; icons?: unknown[] };

    expect(manifest.name).toBe("Ouroboros — Infinity in Autonomy");
    expect(manifest.icons ?? []).toHaveLength(2);
  });
});

test.describe("the theme toggle flips palettes", () => {
  // The toggle lives in the app shell's header (`app/shell/shell-header.tsx`), so this
  // needs a signed-in request in a workspace. The login screen has no toggle — mockup 01
  // does not draw one. Which is why the whole group is parked: see `support/session.ts`.
  test.fixme(true, SESSION_PARKED);

  test.beforeEach(async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await page.goto("/dashboard");
  });

  test("pressing it moves light → dark and repaints the page", async ({ page }) => {
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    const html = page.locator("html");
    const body = page.locator("body");

    await expect(toggle).toBeVisible();

    // The cycle is light → dark → system (`app/shell/theme-toggle.tsx`), and a fresh
    // context has stored no choice, so it starts at *system* — where the attribute is
    // deliberately absent and CSS alone decides. The first press stamps `light`.
    await expect(html).not.toHaveAttribute("data-theme");

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    // The palette, not just the attribute. An attribute that flips while the page keeps
    // its colours is a stylesheet that did not ship — which is exactly the failure a unit
    // test cannot see, and the reason this leg is in the smoke suite at all.
    await expect(body).toHaveCSS("background-color", LIGHT_GROUND);

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(body).toHaveCSS("background-color", DARK_GROUND);

    // Third press returns to *system*: the absence of the attribute, which is how the OS
    // preference is tracked with no JavaScript involved (`app/theme.ts`).
    await toggle.click();
    await expect(html).not.toHaveAttribute("data-theme");
  });

  test("the choice survives a reload without a flash of the wrong palette", async ({ page }) => {
    const toggle = page.getByRole("button", { name: /^Theme:/ });

    await toggle.click();
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();

    // The inline `<head>` script (#17) stamps the stored choice while the browser parses
    // the document — before first paint and before React loads. Asserting on the very
    // first commit of the new document is what distinguishes "restored before paint" from
    // "corrected after hydration", which is the whole point of that script.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).toHaveCSS("background-color", DARK_GROUND);
  });
});

test.describe("the pane remembers where the reader was", () => {
  // The scroll rule moved with the scrollbar (#646): the browser restores the *document*
  // on back/forward and the document no longer scrolls, so the pane keeps its own memory
  // (`app/shell/pane-restoration.tsx`). The workshop's chrome story is the fixture — the
  // one route with every layer of sticky chrome over enough rows to scroll, and, with the
  // dashboard, the pair a push and a traversal can walk between. Signed in like
  // everything in-shell, so parked with the rest: see `support/session.ts`.
  test.fixme(true, SESSION_PARKED);

  // The pane's own marker (`ouroboros-ui/app/shell/regions.ts`), restated rather than
  // imported — the ESLint fence around service source says why.
  const PANE = "[data-shell-pane]";

  test.beforeEach(async ({ context, page }) => {
    await signIn(context, SEED_OWNER.id);
    await selectWorkspace(context, SEED_TENANT.slug);
    await page.goto("/workshop/chrome");
    // Doubles as the hydration wait: restoration is an effect, and driving the pane
    // before React is up would race it.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("In-pane chrome");
  });

  test("a push starts at the top; back and forward restore what each side left", async ({
    page,
  }) => {
    const pane = page.locator(PANE);

    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the story must overflow its pane by more than the scroll under test",
    ).toBeGreaterThan(800);

    await pane.evaluate((el) => el.scrollTo(0, 800));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(800);

    // The story's one live control — a client-side push, which is the case the browser
    // handles for a scrolling body and nobody handles for a pane.
    await page.getByRole("link", { name: "push to the dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect.poll(() => page.locator(PANE).evaluate((el) => el.scrollTop)).toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/workshop\/chrome$/);
    await expect.poll(() => page.locator(PANE).evaluate((el) => el.scrollTop)).toBe(800);

    // Forward returns to the top the push left — the dashboard was never scrolled, and a
    // memory that answered 800 here would be the wrong route's.
    await page.goForward();
    await expect.poll(() => page.locator(PANE).evaluate((el) => el.scrollTop)).toBe(0);
  });

  test("an anchor tab scrolls the pane, and lands its target clear of the chrome", async ({
    page,
  }) => {
    const pane = page.locator(PANE);

    await page
      .getByRole("navigation", { name: "In-pane chrome story" })
      .getByRole("link", { name: "Restoration" })
      .click();

    await expect(page).toHaveURL(/#restoration$/);
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // The pane, not the body: § 1.3's sentence, literally.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // And the target arrives *below* the stuck chrome — the scroll-padding offset — not
    // underneath it, which is what an unoffset scrollIntoView would do.
    const heading = await page.locator("#restoration").boundingBox();
    const bar = await page.locator(".ou-sticky-bar").boundingBox();

    expect(heading!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
  });

  test("the chrome stacks in the documented order while the fixture scrolls", async ({ page }) => {
    const pane = page.locator(PANE);

    // Deep enough that rows are passing under the chrome, shallow enough that the sticky
    // head has not run out of table to stick within.
    await pane.evaluate((el) => el.scrollTo(0, 600));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(600);

    const paneBox = await pane.boundingBox();
    const subnav = await page
      .getByRole("navigation", { name: "In-pane chrome story" })
      .boundingBox();
    const bar = await page.locator(".ou-sticky-bar").boundingBox();
    const head = (await page.getByRole("columnheader").first().boundingBox())!;

    // Layer 1 owns the pane's top edge; layer 2 starts where layer 1 ends; layer 3 clears
    // both. Rounded because the three are measured across subpixel layout, and the
    // contract is about coverage, not about a half-pixel.
    expect(Math.round(subnav!.y)).toBe(Math.round(paneBox!.y));
    expect(Math.round(bar!.y)).toBe(Math.round(subnav!.y + subnav!.height));
    expect(head.y).toBeGreaterThanOrEqual(Math.floor(bar!.y + bar!.height));
  });
});
