/**
 * Leg 10 — *mockup 07, and the credential lifecycle no unit test can hold end to end*
 * ([#233](https://github.com/NobuData/ouroboros/issues/233), amending
 * [#56](https://github.com/NobuData/ouroboros/issues/56)). The MVP gate for epic AE.
 *
 * `/models/providers` is covered thoroughly on both sides of every boundary it crosses.
 * `ouroboros-rest` proves each adapter against recorded fixtures and the vault against its
 * own key material; `ouroboros-ui` proves every card, dialog and state against a payload;
 * `ouroboros-db` proves the seed adds up. All of that can be green while the page does
 * something dangerous, because the interesting failures here live exactly at the seams — a
 * rotation that "succeeds" in the browser while the vault kept the old ciphertext, a test note
 * that shows green from a cached result, an audit event that is never written.
 *
 * ## The assertion this leg exists for
 *
 * It is the **rotate-failure** path, and it is `a refused rotation leaves the old key working`
 * below. A rotation is a verify-then-retire across four layers: the browser sends a candidate,
 * the service asks the provider, the vault swaps a ciphertext only if the provider said yes,
 * and the card has to say which of those happened. Get any layer wrong and a person believes
 * they rotated a key they did not — and the working key is either gone or not the one they
 * think it is. Nothing on either side of the boundary can see that: the UI's suite proves the
 * *dialog* renders a failure, the service's proves the *vault* was not written, and neither can
 * prove that the key still in the vault is one the provider will accept. This leg proves it the
 * only way it can be proved — by rotating to a key the provider refuses and then **testing the
 * connection**, which passes only if the stored ciphertext still decrypts to a key that works.
 *
 * The other legs are the same argument at lower stakes:
 *
 *   * **parity** — five cards and the security strip, against the seed and against the mockup,
 *     in both palettes. Three of the figures are *computed* (`$412.80` is a calendar-month sum
 *     across three seeds, and each meter's tone is that sum against a cap in another column),
 *     so drawing them is the whole chain from `token_usage` to a bar;
 *   * **add** — catalog → the adapter's own form → live validation → a card; and the negative
 *     case, which is the one that matters: a key the provider refuses must leave **no card**,
 *     because a connection stored before it was validated is a card that lies from birth;
 *   * **test-connection truth** — a provider that really goes away, and a note and a pill that
 *     both change to say so;
 *   * **reveal** — a value shown in place, recorded, and masked again by the two mechanisms the
 *     ticket names;
 *   * **pull** — progress from start to done *through a page reload*, which is what makes the
 *     bar the service's record rather than this browser's animation;
 *   * **caps** — a value saved, a meter that moves with it, and decision P7's sentence in both
 *     of the places it is owed;
 *   * **audit** — four operations performed on one card in one test, and all four in the trail;
 *   * **member read-only** — a session, not a fixture;
 *   * **the shell** — the chrome, the sidebar's answer to *where am I*, and 125%.
 *
 * ## Where the provider comes from
 *
 * `docker-compose.e2e.yml` grew a fourth service for this leg, and its header argues the case:
 * the seeded five keep their unreachable fixture addresses and their undecryptable envelopes,
 * and the leg connects **cards of its own** to `provider-stub` for everything the seed cannot
 * answer. A card only exists if an adapter reached something and it answered — so with no
 * reachable provider anywhere in the stack, this leg could assert the add flow's negative case
 * and nothing else at all.
 *
 * ## Three divergences from the ticket's own words, and why
 *
 * **The reveal is not preceded by a step-up challenge, and must not be.** The ticket asks for
 * *step-up → value shown*; what the product does — deliberately, in
 * `provider-connections/step-up.ts` — is accept a **session created within five minutes** as a
 * step-up in itself, because "somebody who signed in a minute ago has just re-authenticated by
 * whatever means their account uses, and asking them to do it twice would be theatre".
 * `support/session.ts` mints a session immediately before every browser leg, so the challenge
 * this leg could assert is one no reader of this product would ever meet on this path. The leg
 * therefore asserts the method that *did* satisfy it — the dialog's absence, named as the
 * `session` method rather than left as a silence — and the challenge itself stays where it can
 * be driven honestly, in `ouroboros-rest`'s own step-up coverage and `ouroboros-ui`'s
 * `step-up-dialog` suite. Reaching it here would cost a five-minute wait, which is twice this
 * leg's whole budget.
 *
 * **The auto-mask timer is asserted through an emulated clock.** `REVEAL_TTL_SECONDS` is sixty,
 * and the mask is the *browser's* behaviour driven by the *browser's* clock — the row derives
 * its remaining time from the service's `expiresAt` against `app/shell/clock.ts`'s shared
 * second. `page.clock` moves that clock, so the assertion is of the real mechanism at its real
 * boundary and costs a second rather than forty per cent of the leg's allowance. Nothing is
 * stubbed: the expiry is the service's instruction, unchanged.
 *
 * **The pulled model is not a real model.** AE.4's roadmap note handed this leg "the Playwright
 * leg that stops the real container and pulls a real model". The container is real and it is
 * really stopped; the model is four gigabytes of nothing, because the `ollama` image is over a
 * gigabyte before it holds anything and a genuine transfer comes off the network. What the
 * ticket's criterion is actually about — *the pull leg fails if progress is client-side only* —
 * is unaffected, and the mid-pull reload is what asserts it.
 *
 * ## Four reveals, against a limit of ten
 *
 * `REVEAL_ATTEMPTS_PER_USER` is ten in five minutes, counted per **person** in the service's
 * own memory — and every browser leg in this suite signs the same seeded owner in. This leg
 * reveals four times (three in the reveal group, once for the trail), so one run is
 * comfortable and two back to back still are; a **third inside the same five minutes** is not,
 * and it presents as three reveal tests failing together with the masked value still on the
 * card. That is the limiter working, not the leg flaking. Wait out the window, or restart
 * `rest` — the counter is a `Map` in the process.
 *
 * It is written down rather than designed around because the alternative is worse: revealing
 * fewer times means asserting fewer of the mechanisms the ticket names, and asking the service
 * for a larger limit means shipping a switch that weakens a rate limit for a test.
 *
 * ## What this leg leaves alone, and what it puts back
 *
 * Every write is either to a row this leg created or to one seeded value it restores. The
 * connections it connects are deleted in teardown — a leftover is a **sixth card** in a grid
 * whose parity baselines are five, so the next run would fail on an image rather than here —
 * and the one seeded cap it edits is put back to the figure written down in
 * `support/providers.ts`, never one read off the page. The seeded five are never tested,
 * never rotated and never revealed: a **Test connection** on one would rewrite its `status`
 * and its health snapshot, and take the parity screenshots and mockup 06's strip with it.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import { startProviderStub, stopProviderStub } from "../support/compose";
import {
  ACCEPTED_KEY,
  ACCEPTED_KEY_MASK,
  ADDED_TITLE,
  ADD_PROVIDER_LABEL,
  API_KEY_LABEL,
  AUDIT_LOG_LABEL,
  AUDIT_SENTENCES,
  AUDIT_SHEET_TITLE,
  BASE_URL_LABEL,
  CAPPED_CONNECTION,
  CAP_LABEL,
  CAP_WARNING_ONLY,
  CATALOG_LIST_LABEL,
  CONNECT,
  DETECTED_LABEL,
  DONE,
  GRID_LABEL,
  MASK_NOW,
  METER_WARN_CLASS,
  NAME_LABEL,
  NO_MODELS,
  NOTHING_STORED,
  OLD_KEY_ACTIVE,
  OPENAI_TILE_LABEL,
  PROVIDERS_PATH,
  PROVIDERS_TITLE,
  PULLED,
  PULL_LATEST,
  REFRESH_MODELS,
  REJECTED_KEY,
  REVEAL,
  REVEAL_RECORDED,
  ROTATE,
  ROTATED_KEY,
  ROTATED_KEY_MASK,
  ROUTING_PATH,
  SECURITY_MODEL_LINK,
  SECURITY_STRIP_EMPHASIS,
  SECURITY_STRIP_LABEL,
  SECURITY_STRIP_TAG,
  SEEDED_CARDS,
  STUB_CARDS,
  STUB_CHIPS,
  STUB_OPENAI_BASE_URL,
  STUB_PULL_MODEL,
  TEST_CONNECTION,
  UNCAPPED_READ_ONLY,
  WARN_CAP_METER_NOTE,
  WARN_CAP_TEXT,
  WITHDRAWN_BADGES,
  auditStamp,
  connectStubOllama,
  connectStubVllm,
  disconnectStubCards,
  restoreCap,
  seededCard,
  setCap,
} from "../support/providers";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import {
  FONT_SCALE_ATTRIBUTE,
  restoreFontScale,
  rootFontSize,
  setFontScale,
} from "../support/settings";
import { PANE_SELECTOR } from "../support/shell";
import { pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** How long a stopped provider's card is given to change what it says. */
const FLIP_TIMEOUT_MS = 20_000;

/** How long a pull is given to reach `pulled` — the stub's transfer is eight seconds. */
const PULL_TIMEOUT_MS = 30_000;

/**
 * Sign in, enter the workspace, and land on the providers screen.
 *
 * The hydration barrier at the end is the routing leg's, for the same reason:
 * `app/(app)/models/providers/loading.tsx` puts this segment behind a Suspense boundary, so the
 * server streams the screen into a hidden `<div>` that React relocates on hydration — and that
 * copy outlives `readyState: "complete"`, which is all `page.goto` waits for. Until then the
 * document holds two complete copies of `<main class="models">`, one of them out of the
 * accessibility tree, and `getByText` sees both while role locators see one. Waiting for the
 * page to be **one page** is both the guard and the barrier every interactive assertion needs.
 *
 * @param context - The browser context, which receives the session.
 * @param page - The page to drive.
 * @param options.as - Whose session, as `support/seed.ts` names them. The owner by default.
 * @returns When the screen has rendered and hydrated.
 */
async function enterProviders(
  context: BrowserContext,
  page: Page,
  options: { readonly as?: string } = {},
): Promise<void> {
  await enterWorkspace(context, options.as);
  await openProviders(page);
}

/**
 * Put a session into the context and point it at the seeded workspace.
 *
 * Split from {@link enterProviders} because the legs that connect a provider of their own have
 * to do it **with the browser's session**, before the page is opened: `support/rest.ts` writes
 * as whoever the context is signed in as, and a context with no cookie in it has nobody to
 * write as. Getting that order wrong fails loudly rather than silently, which is the whole
 * reason `sessionTokenOf` refuses instead of sending an unauthenticated request.
 *
 * @param context - The context to sign in.
 * @param as - Whose session. The owner by default.
 * @returns When the session is acting in {@link SEED_TENANT}.
 */
async function enterWorkspace(context: BrowserContext, as: string = SEED_OWNER.id): Promise<void> {
  await signIn(context, as);
  await selectWorkspace(context, SEED_TENANT.slug);
}

/**
 * Open the providers screen and wait for it to be one page.
 *
 * @param page - The page to drive.
 * @returns When the screen has rendered and hydrated.
 */
async function openProviders(page: Page): Promise<void> {
  await page.goto(PROVIDERS_PATH);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(PROVIDERS_TITLE);
  await expect(page.locator("main.models")).toHaveCount(1);
}

/** The providers screen, as a landmark — everything asserted on is inside it. */
function screen(page: Page): Locator {
  return page.getByRole("main");
}

/** The card grid. */
function grid(page: Page): Locator {
  return page.getByRole("region", { name: GRID_LABEL });
}

/**
 * One card, by its heading.
 *
 * A `region` because `provider-card.tsx` draws a `<section aria-labelledby>` named by its `<h2>`
 * — so this locator is itself an assertion that the card is a landmark a reader can jump to,
 * and a card that lost its heading fails here rather than three assertions later.
 *
 * @param page - The page.
 * @param name - The card's heading.
 * @returns The section.
 */
function card(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/** The security strip at the foot of the page. */
function securityStrip(page: Page): Locator {
  return page.getByRole("complementary", { name: SECURITY_STRIP_LABEL });
}

/** The add-provider dialog, whichever of the page's two openers opened it. */
function addDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add a provider" });
}

/** The audit sheet. */
function auditSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: AUDIT_SHEET_TITLE });
}

/** A card's key row field — labelled by the adapter's own field title. */
function keyField(page: Page, name: string): Locator {
  return card(page, name).getByLabel(API_KEY_LABEL);
}

/** A card's **Test connection** note — the live region beside the button. */
function testNote(page: Page, name: string): Locator {
  return card(page, name).locator(".providers-card__test-note");
}

/**
 * Press **Test connection** on a card and wait for it to have answered.
 *
 * The wait is on the note wearing a **tone**, which only a result gives it — and *not* on the
 * note losing `aria-busy`, which is the version of this that quietly asserts nothing. A click
 * resolves when the event has been dispatched, not when React has committed the state it set,
 * so a leg that waited for *not busy* could read the frame before the press and carry on into
 * assertions about the previous answer. A tone is a positive fact about a result that has
 * arrived.
 *
 * The `aria-busy` check follows it rather than replacing it, for the one case where a tone is
 * not the end: an `upstream` result earns one automatic re-test, and while that is pending the
 * note keeps its tone *and* stays busy. Nothing the stub can answer takes that path — it is
 * either `200` or a closed socket — but a leg that would silently race if it ever did is a leg
 * that will race the day the fixture grows a third answer.
 *
 * @param page - The page.
 * @param name - The card's heading.
 * @returns When the note carries a settled result.
 */
async function runTest(page: Page, name: string): Promise<void> {
  await card(page, name).getByRole("button", { name: TEST_CONNECTION }).click();

  await expect(testNote(page, name)).toHaveClass(/providers-card__test-note--(ok|warn|err)/, {
    timeout: FLIP_TIMEOUT_MS,
  });
  await expect(testNote(page, name)).not.toHaveAttribute("aria-busy", "true", {
    timeout: FLIP_TIMEOUT_MS,
  });
}

/* ------------------------------------------------------------------ parity */

test.describe("the providers screen draws the seeded workspace", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterProviders(context, page);
  });

  test("the grid holds the five seeded cards, in the order the service lists them", async ({
    page,
  }) => {
    // Five, and the dashed add card — which is a `div` rather than a landmark, because one
    // action with a line of prose over it is not a region.
    const cards = grid(page).getByRole("region");

    await expect(cards).toHaveCount(SEEDED_CARDS.length);
    await expect(cards.locator("h2")).toHaveText(SEEDED_CARDS.map((one) => one.name));

    // The pill and the capability note, per card. **GitHub Copilot** is the one that is not
    // simply healthy, and it is the combination this grid has to draw carefully: enabled and
    // unhealthy, full ink and a solid frame, carrying an error pill — the opposite treatment
    // from a connection somebody switched off.
    for (const seeded of SEEDED_CARDS) {
      const subject = card(page, seeded.name);

      await expect(subject.getByText(seeded.pill, { exact: true })).toBeVisible();
      await expect(subject).toContainText(seeded.note);
      await expect(subject).not.toHaveClass(/providers-card--off/);
    }
  });

  test("each card draws the address, the key row and the meta the seed wrote", async ({ page }) => {
    for (const seeded of SEEDED_CARDS) {
      const subject = card(page, seeded.name);

      if (seeded.address === null) {
        // A cloud connection has no address of its own — the hostnames on the Anthropic and
        // Cursor cards are part of their capability line, not a proxy somebody configured.
        await expect(subject.getByLabel(BASE_URL_LABEL)).toHaveCount(0);
      } else {
        await expect(subject.getByRole("textbox", { name: /Base URL|Host/ })).toHaveValue(
          seeded.address,
        );
      }

      // The key row, in whichever of its three states the seed leaves it, under the label its
      // own adapter gave it — Copilot's says **GitHub token**. Every seeded card is `empty`:
      // the seed's envelopes were never sealed by anything, so the vault cannot open them and
      // there is no suffix to publish. `support/providers.ts` says why that is the seed's
      // property rather than the page's, and what the leg does about it instead.
      if (seeded.keyLabel === null) {
        // Not *an empty key row* — no row. The Ollama adapter declares no credential, so the
        // card has nothing to draw rather than something to leave blank.
        await expect(subject.locator(".providers-card__key-row")).toHaveCount(0);
      } else {
        const key = subject.getByLabel(seeded.keyLabel);

        await expect(key).toHaveValue(seeded.key === "empty" ? "" : /^••••.{4}$/);

        // Whatever state it is in, the row never holds anything that could be a credential: the
        // mask is computed server-side from bytes the browser is never sent, so a value longer
        // than eight characters here is a value that escaped the vault.
        expect((await key.inputValue()).length).toBeLessThanOrEqual(8);
      }

      // The stable half of the meta row. The trailing *last used …* is measured from the
      // stack's clock and is deliberately not asserted — see `support/providers.ts`.
      await expect(subject.locator(".providers-card__meta")).toContainText(seeded.meta);
    }
  });

  test("the models region is what discovery found, card by card", async ({ page }) => {
    for (const seeded of SEEDED_CARDS) {
      const subject = card(page, seeded.name);

      await expect(subject.locator(".providers-card__models-label")).toHaveText(
        seeded.models.label,
      );

      // The Ollama card is a pull-list rather than chips, and that is a *capability* rather
      // than a branch on a kind: its adapter is the only one of the five declaring `pull`.
      // The chips list holds the tier pill too (decision P8's, asserted on its own below), and
      // the models are the **monospaced** ones — the design's own distinction between a
      // provider's spelling of a model and a word about it.
      const rows =
        seeded.models.label === DETECTED_LABEL
          ? subject.locator(".providers-card__pull-model")
          : subject.locator(".providers-card__chip .ou-chip--mono");

      await expect(rows).toHaveText(seeded.models.entries.map((entry) => new RegExp(entry)));
    }

    // The Anthropic card's `priority tier` pill is the one entitlement signal in the workspace,
    // and it is real: it comes from `provider_models.meta.tier`, which its adapter reports
    // because Anthropic really sends it. Decision P8 is that nothing invents one — so no other
    // card may carry a tier at all.
    await expect(card(page, "Anthropic Claude").getByText("priority tier")).toBeVisible();
    await expect(grid(page).getByText(/ tier$/)).toHaveCount(1);
  });

  test("the meters are this month's spend against each card's cap", async ({ page }) => {
    for (const seeded of SEEDED_CARDS) {
      const subject = card(page, seeded.name);
      const meter = subject.locator(".providers-card__meter-line");

      await expect(meter).toContainText(seeded.meter.figure);

      if (seeded.meter.note !== null) {
        await expect(meter).toContainText(seeded.meter.note);
      }

      await expect(subject.getByLabel(CAP_LABEL)).toHaveValue(seeded.cap);
    }

    // Copilot is at exactly `WARN_AT` — $76.00 of a $95 cap — so the seed already draws one
    // warn meter, and it is the only one. That is the assertion: a tone is computed from two
    // columns, and a page that drew every capped meter the same would pass every check above.
    await expect(grid(page).locator(`.${METER_WARN_CLASS}`)).toHaveCount(1);
    await expect(card(page, "GitHub Copilot").locator(`.${METER_WARN_CLASS}`)).toBeVisible();
  });

  test("the security strip is the document's, and carries no badge it has not earned", async ({
    page,
  }) => {
    const strip = securityStrip(page);

    await expect(strip).toBeVisible();
    await expect(strip.locator("strong")).toHaveText(SECURITY_STRIP_EMPHASIS);
    await expect(strip.getByText(SECURITY_STRIP_TAG, { exact: true })).toBeVisible();
    await expect(strip.getByRole("link", { name: SECURITY_MODEL_LINK })).toBeVisible();

    // § 7.3 withdrew the mockup's two compliance badges: they are certifications this product
    // has not undergone, and displaying one is a false compliance claim rather than an
    // optimistic label. Asserted **absent**, because a badge nobody looks for is a badge
    // somebody pastes back in from the artwork.
    for (const badge of WITHDRAWN_BADGES) {
      await expect(screen(page).getByText(badge)).toHaveCount(0);
    }
  });
});

/* ------------------------------------------------------------------ the add flow */

test.describe("a provider is connected through the catalog, and a refused key connects nothing", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterProviders(context, page);
  });

  // By name rather than by an id this test wrote down: the teardown that matters most is the
  // one after a failure *between* connecting and remembering. See `support/providers.ts`.
  test.afterEach(async ({ context }) => {
    await disconnectStubCards(context);
  });

  test("the catalog leads to the adapter's own form, and a validated key puts a card in the grid", async ({
    page,
  }) => {
    await screen(page).getByRole("button", { name: ADD_PROVIDER_LABEL }).click();

    const dialog = addDialog(page);
    const catalog = dialog.getByRole("list", { name: CATALOG_LIST_LABEL });

    // The tiles are the *service's*, read when the dialog opened. A promised kind is a plain
    // list item and not a disabled button — the honest rendering of *not yet* is something
    // nothing focuses and nothing presses — so the live kinds are exactly the buttons.
    await expect(catalog.getByRole("button")).toHaveCount(5);
    await expect(catalog.getByText("coming soon")).toHaveCount(3);

    await catalog.getByRole("button", { name: new RegExp(OPENAI_TILE_LABEL) }).click();

    // The form is composed from the adapter's `configSchema()` and nothing in the browser
    // knows this kind: the heading is the schema's `title`, and the three fields are its
    // properties in its own order.
    await expect(dialog.getByRole("heading", { level: 2 })).toHaveText(
      "Connect an OpenAI-compatible endpoint",
    );

    await dialog.getByLabel(NAME_LABEL).fill(STUB_CARDS.vllm);
    await dialog.getByLabel(BASE_URL_LABEL).fill(STUB_OPENAI_BASE_URL);
    await dialog.getByLabel(API_KEY_LABEL).fill(ACCEPTED_KEY);
    await dialog.getByRole("button", { name: CONNECT, exact: true }).click();

    // The done step is a step rather than a closed dialog because somebody has just handed
    // over a key and deserves a sentence saying it took.
    await expect(dialog.getByRole("heading", { name: ADDED_TITLE })).toBeVisible();
    await dialog.getByRole("button", { name: DONE }).click();

    // …and the card is on the page behind it, drawn from a re-read rather than from what this
    // browser sent: its chips are what *discovery* found at the endpoint, which nothing in the
    // form mentioned.
    const added = card(page, STUB_CARDS.vllm);

    await expect(added).toBeVisible();
    await expect(added.getByText("connected", { exact: true })).toBeVisible();

    // The mask is the service's, computed from bytes it sealed a moment ago — so a card that
    // draws this suffix is a card whose credential really reached the vault.
    await expect(added.getByLabel(API_KEY_LABEL)).toHaveValue(ACCEPTED_KEY_MASK);

    // And it arrives with **no models**, which is the product being honest rather than slow:
    // `add` validates, seals and inserts, and discovery is a live call of its own. A card that
    // listed models here would be listing something nobody asked the provider for.
    await expect(added).toContainText(NO_MODELS);

    await added.getByRole("button", { name: REFRESH_MODELS }).click();
    await expect(added.locator(".providers-card__chip .ou-chip--mono")).toHaveText(
      STUB_CHIPS.map((chip) => new RegExp(chip)),
    );

    await expect(grid(page).getByRole("region")).toHaveCount(SEEDED_CARDS.length + 1);
  });

  test("a key the provider refuses leaves the grid exactly as it was", async ({ page }) => {
    await screen(page).getByRole("button", { name: ADD_PROVIDER_LABEL }).click();

    const dialog = addDialog(page);

    await dialog
      .getByRole("list", { name: CATALOG_LIST_LABEL })
      .getByRole("button", { name: new RegExp(OPENAI_TILE_LABEL) })
      .click();

    await dialog.getByLabel(NAME_LABEL).fill("this card must never exist");
    await dialog.getByLabel(BASE_URL_LABEL).fill(STUB_OPENAI_BASE_URL);
    await dialog.getByLabel(API_KEY_LABEL).fill(REJECTED_KEY);
    await dialog.getByRole("button", { name: CONNECT, exact: true }).click();

    // The provider's own refusal, carried whole, with the half that matters standing in it:
    // **nothing was stored**. The form stays open with every value where it was left, because
    // the inputs are uncontrolled and a refusal is not a reason to retype an address.
    // The form-level sentence rather than the field-level one beside it: both are alerts, and
    // both are correct — the adapter's reason is put under the field it is about *and* said
    // once for the submission, which is where the half that matters lives.
    const failure = dialog.locator(".providers-add__failure");

    await expect(failure).toContainText(NOTHING_STORED);
    await expect(dialog.getByText("key rejected (401)").first()).toBeVisible();
    await expect(dialog.getByLabel(BASE_URL_LABEL)).toHaveValue(STUB_OPENAI_BASE_URL);

    // The assertion this test exists for. A connection stored before it was validated is a card
    // that lies from birth — it draws `connected` about a key the provider has already refused
    // — so the grid must be untouched, on the page and after a reload, which is where a row
    // written and hidden would surface.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(grid(page).getByRole("region")).toHaveCount(SEEDED_CARDS.length);

    await page.reload();
    await expect(page.locator("main.models")).toHaveCount(1);
    await expect(grid(page).getByRole("region")).toHaveCount(SEEDED_CARDS.length);
  });
});

/* ------------------------------------------------------------------ test-connection truth */

test.describe("a provider that goes away changes what its card says", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterWorkspace(context);
    await connectStubVllm(context);
    await openProviders(page);
  });

  test.afterEach(async ({ context }) => {
    // The stub first, and unconditionally: the test may have failed *after* stopping it, and
    // every later leg in this file connects a provider.
    await startProviderStub();
    await disconnectStubCards(context);
  });

  test("the note and the status pill both flip when the provider stops answering", async ({
    page,
  }) => {
    const subject = card(page, STUB_CARDS.vllm);

    // The premise. A card that was already failing would make everything below vacuous.
    await runTest(page, STUB_CARDS.vllm);
    await expect(testNote(page, STUB_CARDS.vllm)).toContainText("200");
    await expect(subject.getByText("connected", { exact: true })).toBeVisible();

    await stopProviderStub();

    // Now the same button, against a provider that is gone. Both halves must move, and they
    // move by different routes: the note is what this request was told, and the pill is a
    // *column* the service wrote before it answered — so a pill that did not change is a page
    // rendering a stale read, and a note that did not change is a page rendering a cached one.
    await runTest(page, STUB_CARDS.vllm);

    await expect(testNote(page, STUB_CARDS.vllm)).toHaveClass(/providers-card__test-note--err/);
    await expect(subject.getByText("unreachable", { exact: true })).toBeVisible({
      timeout: FLIP_TIMEOUT_MS,
    });

    // `unreachable` rather than the coarse `error`: the pill is drawn from the taxonomy's error
    // *class*, which is `network` for a socket nobody accepted. A stub answering `503` on
    // request would have produced `degraded upstream` here, which is why the leg stops a
    // container instead of asking a provider to misbehave (`support/compose.ts`).
    await expect(subject.getByText("error", { exact: true })).toHaveCount(0);

    // And it survives a re-read, because it is a column rather than this island's state.
    await page.reload();
    await expect(page.locator("main.models")).toHaveCount(1);
    await expect(
      card(page, STUB_CARDS.vllm).getByText("unreachable", { exact: true }),
    ).toBeVisible();
  });
});

/* ------------------------------------------------------------------ reveal */

test.describe("a revealed key is shown in place, recorded, and masked again", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterWorkspace(context);
    await connectStubVllm(context);

    // Installed before the first navigation, because the mask is driven by the shell clock's
    // `setInterval` and only a clock that was fake when that interval was created can be moved.
    // Resumed straight away so the page runs at ordinary speed while it is being driven — the
    // jump is asked for explicitly, once, in the test that is about it.
    await page.clock.install();
    await page.clock.resume();

    await openProviders(page);
  });

  test.afterEach(async ({ context }) => {
    await disconnectStubCards(context);
  });

  test("the value is shown with its countdown and its audited notice", async ({ page }) => {
    const subject = card(page, STUB_CARDS.vllm);

    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY_MASK);
    await subject.getByRole("button", { name: REVEAL, exact: true }).click();

    // The whole chain: a ciphertext this deployment's vault sealed on the create, opened by
    // the service for the length of one call, and the plaintext on the page. Nothing on either
    // side of that boundary can assert it — the service's suite proves it decrypts what it
    // encrypted, and the browser's proves it renders what it is handed.
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY);

    // No challenge, and that is the `session` method being honoured rather than a step missing.
    // See this file's header: a session minted a moment ago *is* a re-authentication, and the
    // dialog's absence is asserted so that its later appearance would be a change somebody
    // decided rather than one nobody noticed.
    await expect(page.getByRole("dialog", { name: "Confirm it's you" })).toHaveCount(0);

    await expect(subject).toContainText(REVEAL_RECORDED);
    await expect(subject.locator(".providers-card__countdown")).toContainText(/^Masks in \d+s$/);

    // **Mask** puts it away before the countdown does, and the value leaves the page with it.
    await subject.getByRole("button", { name: MASK_NOW, exact: true }).click();
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY_MASK);
  });

  test("it masks itself when the countdown runs out", async ({ page }) => {
    const subject = card(page, STUB_CARDS.vllm);

    await subject.getByRole("button", { name: REVEAL, exact: true }).click();
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY);

    // Past the service's own `expiresAt`. The instruction is the service's and unchanged — what
    // moves is the browser's clock, which is the thing the row measures against, so this is the
    // real mechanism at its real boundary and not a shortened timer.
    await page.clock.fastForward("01:01");

    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY_MASK);
    await expect(subject.getByRole("button", { name: REVEAL, exact: true })).toBeVisible();
  });

  test("it masks when the reader navigates away, and is not there on the way back", async ({
    page,
  }) => {
    await card(page, STUB_CARDS.vllm).getByRole("button", { name: REVEAL, exact: true }).click();
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY);

    // Through the product's own navigation — the section's tab set — because that is the case
    // the row guards against with `usePathname()`: a client-side navigation that does not
    // unmount the card. A hard reload would assert the weaker thing, that a new document has no
    // secret in it, which is true of any page.
    await screen(page).getByRole("link", { name: "Routing" }).click();
    await expect(page).toHaveURL(new RegExp(`${ROUTING_PATH}$`));

    await page.goBack();
    await expect(page.locator("main.models")).toHaveCount(1);
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY_MASK);
  });
});

/* ------------------------------------------------------------------ rotate, both paths */

test.describe("a rotation verifies before it retires", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterWorkspace(context);
    await connectStubVllm(context);
    await openProviders(page);
  });

  test.afterEach(async ({ context }) => {
    await disconnectStubCards(context);
  });

  /**
   * Open the rotate dialog on a card and put a key into it.
   *
   * @param page - The page.
   * @param secret - The candidate key.
   * @returns The dialog, once the submission has been made.
   */
  async function rotateTo(page: Page, secret: string): Promise<Locator> {
    await card(page, STUB_CARDS.vllm).getByRole("button", { name: ROTATE, exact: true }).click();

    const dialog = page.getByRole("dialog", { name: `Rotate ${STUB_CARDS.vllm}'s key` });

    await dialog.getByLabel("New key").fill(secret);
    await dialog.getByRole("button", { name: "Check and swap" }).click();

    return dialog;
  }

  test("a refused rotation says so, and the old key still works", async ({ page }) => {
    const dialog = await rotateTo(page, REJECTED_KEY);

    // Three things at once, which is what the dialog exists for: it did not work, the old key
    // is still active, and nothing is broken. The way back is **Try again**, into the field.
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog).toContainText(OLD_KEY_ACTIVE);
    await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();

    // The masked suffix has not moved — the card is drawing the ciphertext that is still in the
    // vault, which is necessary and nowhere near sufficient.
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY_MASK);

    // **This is the assertion the leg exists for.** A mask is four characters of *something*; a
    // passing test is the provider accepting what is actually stored. If the vault swapped the
    // ciphertext for the refused key, or zeroed it, or kept an envelope that no longer opens,
    // the connection is broken and only a live call can tell — and the same four characters
    // would be on the card either way.
    await runTest(page, STUB_CARDS.vllm);
    await expect(testNote(page, STUB_CARDS.vllm)).toHaveClass(/providers-card__test-note--ok/);
    await expect(card(page, STUB_CARDS.vllm).getByText("connected", { exact: true })).toBeVisible();
  });

  test("an accepted rotation swaps the key and the card's suffix follows", async ({ page }) => {
    const dialog = await rotateTo(page, ROTATED_KEY);

    // The service's own answer, not this browser's arithmetic: the new mask is computed from
    // the bytes the vault sealed.
    await expect(dialog.getByRole("status")).toContainText(ROTATED_KEY_MASK);
    await dialog.getByRole("button", { name: "Done" }).click();

    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ROTATED_KEY_MASK);

    // And the swap really happened at the provider's end of it: the stored key still works, and
    // it is a different key from the one the connection was created with.
    await runTest(page, STUB_CARDS.vllm);
    await expect(testNote(page, STUB_CARDS.vllm)).toHaveClass(/providers-card__test-note--ok/);

    await page.reload();
    await expect(page.locator("main.models")).toHaveCount(1);
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ROTATED_KEY_MASK);
  });
});

/* ------------------------------------------------------------------ the pull */

test.describe("a pull reports the service's own progress", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterWorkspace(context);
    await connectStubOllama(context);
    await openProviders(page);
  });

  test.afterEach(async ({ context }) => {
    await disconnectStubCards(context);
  });

  test("a pull runs to done, and a reload in the middle of it still shows it running", async ({
    page,
  }) => {
    const subject = card(page, STUB_CARDS.ollama);
    const row = subject.locator(`.providers-card__pull-row[data-model="${STUB_PULL_MODEL}"]`);

    await expect(subject.locator(".providers-card__models-label")).toHaveText(DETECTED_LABEL);
    await row.getByRole("button", { name: PULL_LATEST }).click();

    // A determinate bar, because the host declared a size in its first progress line. It is the
    // row's only statement of the percentage, so it is a `progressbar` rather than decoration.
    const bar = row.getByRole("progressbar", { name: `Pulling ${STUB_PULL_MODEL}` });

    await expect(bar).toBeVisible();

    // **The assertion this leg is for.** A reload throws away every piece of client state — the
    // poll's timer, the optimistic record, the bar — and the new document is drawn from what the
    // *service* holds. A transfer whose progress lived only in this browser would come back as
    // an idle button, which is exactly what a client-side animation looks like from here.
    await page.reload();
    await expect(page.locator("main.models")).toHaveCount(1);

    const reloaded = card(page, STUB_CARDS.ollama).locator(
      `.providers-card__pull-row[data-model="${STUB_PULL_MODEL}"]`,
    );

    await expect(reloaded.getByRole("progressbar")).toBeVisible();

    // …and it finishes, from the same page. The list stops polling by itself when nothing is
    // moving, and the service re-runs discovery when a pull lands.
    await expect(reloaded.getByText(PULLED, { exact: false })).toBeVisible({
      timeout: PULL_TIMEOUT_MS,
    });
    await expect(reloaded.getByRole("progressbar")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ caps */

test.describe("a cap is edited and the meter moves with it", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterProviders(context, page);
  });

  test.afterEach(async ({ context }) => {
    await restoreCap(context);
  });

  test("the value saves, the warn meter renders, and P7's sentence is in both places", async ({
    page,
  }) => {
    const subject = card(page, CAPPED_CONNECTION.name);
    const field = subject.getByLabel(CAP_LABEL);
    const meter = subject.locator(".providers-card__meter");

    // The premise: this card's meter is not warning at the seed's cap. Without it, a warn meter
    // after the edit would be a warn meter that was there all along.
    await expect(meter.locator(`.${METER_WARN_CLASS}`)).toHaveCount(0);

    // The field commits the way a spreadsheet cell does — leave it, or press Enter — because a
    // save button beside a 92-pixel field would double its width.
    await field.fill("450");
    await field.press("Enter");

    await expect(subject.getByRole("status")).toContainText("Cap saved.");

    // Normalised in place from what the service stored: `450` becomes `$450`.
    await expect(field).toHaveValue(WARN_CAP_TEXT);

    // The meter moved with it, recomputed by the same function the server drew the first paint
    // with — $412.80 against $450 is 92%, which is over `WARN_AT`.
    await expect(meter.locator(`.${METER_WARN_CLASS}`)).toBeVisible();
    await expect(meter).toContainText(WARN_CAP_METER_NOTE);

    // Decision P7 in both of the places it is owed: as the tooltip on the `ⓘ` after a capped
    // meter's note, and as the field's own description — so a reader who *sets* a cap is told,
    // where they set it, that it warns and does not stop. Both are text in the accessibility
    // tree, so a screen reader meets them where a pointer would.
    await expect(meter.getByText(CAP_WARNING_ONLY)).toBeAttached();
    await expect(field).toHaveAttribute("title", CAP_WARNING_ONLY);

    // And it is a row rather than this island's state.
    await page.reload();
    await expect(page.locator("main.models")).toHaveCount(1);
    await expect(card(page, CAPPED_CONNECTION.name).getByLabel(CAP_LABEL)).toHaveValue(
      WARN_CAP_TEXT,
    );
  });
});

/* ------------------------------------------------------------------ the audit trail */

test.describe("the audit sheet lists this session's operations", () => {
  test.beforeEach(async ({ context }) => {
    await enterWorkspace(context);
  });

  test.afterEach(async ({ context }) => {
    await disconnectStubCards(context);
  });

  test("an add, a reveal, a rotation and a cap change are all in the trail", async ({
    context,
    page,
  }) => {
    // The minute this test began, in the column's own format. Everything below is asserted
    // against rows at or after it, and that is what makes this leg an assertion rather than a
    // word search: `audit_events` are not cleared between runs and are not this leg's to clear
    // — a trail a test could empty is not a trail — so *the sheet says `rotated` somewhere* is
    // satisfied by any previous run's rotation. Stubbing the interceptor to write nothing was
    // tried, and left all twenty-one tests green until this anchor existed.
    const started = auditStamp(new Date());

    // Performed here rather than relied on from the tests above, so that what the sheet is
    // asked about is **this test's** four operations against one connection.
    const connected = await connectStubVllm(context);

    // The cap change is made on this leg's own card rather than on a seeded one: the trail
    // records the action, not the figure, so there is nothing to be gained by disturbing the
    // seed for it.
    await setCap(context, connected, 25_000);

    await openProviders(page);

    await card(page, STUB_CARDS.vllm).getByRole("button", { name: REVEAL, exact: true }).click();
    await expect(keyField(page, STUB_CARDS.vllm)).toHaveValue(ACCEPTED_KEY);
    await card(page, STUB_CARDS.vllm).getByRole("button", { name: MASK_NOW, exact: true }).click();

    await card(page, STUB_CARDS.vllm).getByRole("button", { name: ROTATE, exact: true }).click();

    const rotate = page.getByRole("dialog", { name: `Rotate ${STUB_CARDS.vllm}'s key` });

    await rotate.getByLabel("New key").fill(ROTATED_KEY);
    await rotate.getByRole("button", { name: "Check and swap" }).click();
    await rotate.getByRole("button", { name: "Done" }).click();

    // The sheet reads on every open — a trail is a moving surface, and somebody opening it
    // twice in an incident wants the second read to include what happened in between.
    await screen(page).getByRole("button", { name: AUDIT_LOG_LABEL }).click();

    const sheet = auditSheet(page);

    await expect(sheet.getByRole("row").first()).toBeVisible();

    // What the sheet is showing for this minute onwards, read once. The rows are newest first
    // and the stamp sorts chronologically, so *at or after `started`* is *since this test
    // began* — and a run with the interceptor removed produces an empty list here rather than
    // a list of somebody else's operations.
    const rows = await sheet.getByRole("row").evaluateAll(
      (elements, since) =>
        elements
          .map((element) =>
            Array.from(element.querySelectorAll("td")).map((cell) => cell.textContent ?? ""),
          )
          .filter((cells) => cells.length > 0 && cells[0] >= since)
          .map((cells) => cells.join(" · ")),
      started,
    );

    expect(
      rows.length,
      "the trail has recorded nothing since this test began — the four operations above " +
        "either did not happen or were not audited",
    ).toBeGreaterThanOrEqual(Object.keys(AUDIT_SENTENCES).length);

    for (const sentence of Object.values(AUDIT_SENTENCES)) {
      expect(
        rows.some((row) => row.includes(sentence)),
        `the trail has no "${sentence}" row from this test. What it does have since ` +
          `${started}: ${rows.join(" | ")}`,
      ).toBe(true);
    }

    // Every row names who did it, and the four above were all this session's — which is what
    // makes the trail a record of a person rather than of a process.
    expect(rows.every((row) => row.includes(SEED_OWNER.displayName))).toBe(true);

    // And no entry ever holds a key. The sheet is the one surface in the product that lists
    // credential operations, so it is the one place a leaked value would be least noticed.
    await expect(sheet).not.toContainText(ACCEPTED_KEY);
    await expect(sheet).not.toContainText(ROTATED_KEY);
  });
});

/* ------------------------------------------------------------------ read-only */

test.describe("a member is served the providers screen read-only", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterProviders(context, page, { as: SEED_MEMBER.id });
  });

  test("every card is drawn, and nothing that would change a credential is", async ({ page }) => {
    // The role, named once, near the top. A page that quietly draws less reads as broken rather
    // than as scoped, so the omission is explained rather than merely made.
    await expect(page.getByRole("note")).toContainText(
      `Viewing providers as a ${SEED_MEMBER.role}.`,
    );

    // Read-only is a rendering mode, not a page with things missing: all five cards, with their
    // pills, their masked rows and their models.
    await expect(grid(page).getByRole("region")).toHaveCount(SEEDED_CARDS.length);
    await expect(keyField(page, "Anthropic Claude")).toHaveValue(
      seededCard("Anthropic Claude").key === "empty" ? "" : /^••••.{4}$/,
    );

    // No credential affordance anywhere — **absent**, not disabled. A disabled **Reveal** is
    // still an invitation to try to reveal a key, and the honest rendering of *this is not
    // yours to do* is a row with no action on it.
    for (const name of [REVEAL, ROTATE, "Save"]) {
      await expect(grid(page).getByRole("button", { name, exact: true })).toHaveCount(0);
    }

    // …and no overflow menu, which is where deleting a provider lives.
    await expect(grid(page).getByRole("button", { name: /^More actions for / })).toHaveCount(0);

    // The controls that *are* drawn are drawn with their reason (design system § 3.3), because
    // a card with no cap field at all would read as a card with no cap. The distinction is the
    // same one the routing screen makes between its rules card and its route policy.
    const copilot = card(page, "GitHub Copilot");

    await expect(copilot.getByRole("button", { name: TEST_CONNECTION })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(copilot.getByLabel(CAP_LABEL)).toHaveAttribute("readonly", "");
    await expect(copilot.getByLabel(CAP_LABEL)).toHaveValue(seededCard("GitHub Copilot").cap);

    // …and an uncapped card shows the em-dash rather than the empty field an administrator
    // gets: a read-only field with nothing in it would look like one that failed to load,
    // where an empty *editable* one is a prompt. Two spellings of *no cap*, one per role.
    await expect(card(page, "Ollama · workstation").getByLabel(CAP_LABEL)).toHaveValue(
      UNCAPPED_READ_ONLY,
    );

    // And the page's primary action is inert with the sentence that says who it is for.
    await expect(screen(page).getByRole("button", { name: ADD_PROVIDER_LABEL })).toHaveAttribute(
      "title",
      "Connecting a provider is for workspace owners and admins.",
    );
  });
});

/* ------------------------------------------------------------------ the shell */

test.describe("the shell holds the providers screen", () => {
  test.beforeEach(async ({ context, page }) => {
    await enterProviders(context, page);
  });

  // The scale is a row keyed on the person and outlives this context. Restored after all three
  // tests rather than only the one that writes, because putting a preference back where it
  // already is costs one request and is the version of this hook nobody has to keep in step
  // with which test does what.
  test.afterEach(async ({ context }) => {
    await restoreFontScale(context);
  });

  test("the header and the sidebar do not move when the content pane scrolls", async ({ page }) => {
    const header = page.getByRole("banner");
    const sidebar = page.getByRole("navigation", { name: "Primary" });
    const pane = page.locator(PANE_SELECTOR);

    const before = { header: await header.boundingBox(), sidebar: await sidebar.boundingBox() };

    // The premise: a page that fitted the viewport would make everything below vacuously true.
    expect(
      await pane.evaluate((el) => el.scrollHeight - el.clientHeight),
      "the providers screen must overflow its pane for this to mean anything",
    ).toBeGreaterThan(0);

    await pane.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // Four regions of which exactly one scrolls (design system § 1, decision S2). Nothing in the
    // shell is `position: fixed` — the chrome is cells of a grid the height of the viewport — so
    // this asserts the grid survived a page of six cards and a strip stacked inside the pane.
    expect(await header.boundingBox()).toEqual(before.header);
    expect(await sidebar.boundingBox()).toEqual(before.sidebar);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the sidebar and the tab set both know where the reader is", async ({ page }) => {
    const sidebar = page.getByRole("navigation", { name: "Primary" });

    // The ticket's *both directions* criterion, met by the URL rather than by a rule somebody
    // has to remember: the sidebar highlights the entry whose route the address is under, and
    // this segment lives under `/models` for exactly that reason.
    await expect(sidebar.getByRole("link", { name: "Models" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(sidebar.locator("[aria-current='page']")).toHaveCount(1);

    // The section's own tab set says the same thing one level down, and the two must agree: the
    // sidebar names the section, the underline names the surface.
    await expect(screen(page).getByRole("link", { name: "Providers & keys" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the page still holds at the 125% font scale", async ({ context, page }) => {
    await setFontScale(context, "125");
    await page.reload();

    const html = page.locator("html");

    // The whole round trip: the preference is the *person's* and lives on the server, so the
    // attribute proves it was read and the root size proves one of the five
    // `:root[data-font-scale]` rules in `app/globals.css` shipped and acted on it.
    await expect(html).toHaveAttribute(FONT_SCALE_ATTRIBUTE, "125");
    await expect(html).toHaveCSS("font-size", rootFontSize("125"));

    // What a fifth more type is actually for on this page: six cards in a responsive grid, each
    // holding a monospace key row, a chip list and a two-control foot. Nothing may make the pane
    // scroll sideways — wide content scrolls inside its own wrapper (§ 1.3).
    const pane = page.locator(PANE_SELECTOR);
    expect(await pane.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // And the page is still the providers screen rather than a shell around a broken render.
    await expect(grid(page).getByRole("region")).toHaveCount(SEEDED_CARDS.length);
    await expect(securityStrip(page)).toBeVisible();
  });
});

/* ------------------------------------------------------------------ both palettes */

/**
 * The window the parity pair is photographed through.
 *
 * **Taller than the suite's Desktop Chrome, because the page is.** Six cards and the strip are
 * well over a viewport, and the shell's pane is the only scroll container — so an element
 * screenshot cannot reveal what is below the fold the way `fullPage` reveals a document, and
 * Playwright renders the tail as bare ground. Giving the window the page's own height makes the
 * pane not scroll, so everything paints and the ordinary viewport screenshot is the whole
 * screen. The assertion below is what keeps that honest as cards are added.
 */
const PARITY_WINDOW = { width: 1920, height: 1800 };

test.describe("the providers screen is drawn in both palettes", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.setViewportSize(PARITY_WINDOW);
    await enterProviders(context, page);
  });

  test("light and dark are both mockup 07", async ({ page }) => {
    // One thing is masked, and it is the only thing on this page that a screenshot cannot hold
    // still: the meta row's trailing **last used …**.
    //
    // `R__dev_seed_providers.sql` writes `last_used_at` as `now() - interval`, and `now()` there
    // is *migration* time — so the card renders *3m ago* on a stack that has just come up and
    // *1h 13m ago* on the same stack an hour later. It is the seed being right (a relative time
    // is only true if it is measured from now) and a baseline being impossible, and the two are
    // reconciled by masking the row rather than by pinning a clock: the *stable* half of that
    // same line, `Added by Ken Suenobu · 2026-06-12`, is asserted as text three tests above,
    // where it belongs.
    //
    // Everything else is unmasked, and that is a fact about the page rather than an omission.
    // Every figure on it is computed from rows that do not move — the meters are a calendar
    // month's spend against a cap, the dates are literals, the models are a table.
    //
    // Which is only true because the health sweep is not running: it would rewrite every card's
    // pill about a minute into any stack. `docker-compose.e2e.yml` is where that is arranged.
    expect(
      await page.locator(PANE_SELECTOR).evaluate((el) => el.scrollHeight - el.clientHeight),
      "the parity window must be tall enough to hold the whole screen without scrolling",
    ).toBe(0);

    // The grid is the seed's five and nothing else — the assertion that every leg above put its
    // connections back, made where a leftover would otherwise be recorded as a baseline.
    await expect(grid(page).getByRole("region")).toHaveCount(SEEDED_CARDS.length);
    await expect(card(page, CAPPED_CONNECTION.name).getByLabel(CAP_LABEL)).toHaveValue(
      seededCard(CAPPED_CONNECTION.name).cap,
    );

    const drifting = [page.locator(".providers-card__meta")];

    await pinTheme(page, "light");
    await expect(page).toHaveScreenshot("providers-light.png", { mask: drifting });

    await pinTheme(page, "dark");
    await expect(page).toHaveScreenshot("providers-dark.png", { mask: drifting });
  });
});
