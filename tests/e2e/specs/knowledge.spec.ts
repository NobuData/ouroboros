/**
 * Leg 21 — the knowledge page's states, and the chain that makes it a knowledge *layer*
 * ([#422](https://github.com/NobuData/ouroboros/issues/422), BG.6), against the BE.5 seed
 * ([#409](https://github.com/NobuData/ouroboros/issues/409)). The Knowledge roadmap's MVP gate.
 *
 * Mockup 14 draws a mature org. This leg draws what a new one sees, and then proves the sentence
 * on the facts card — *confirmed facts are injected into every run's context* — by following one
 * fact from a rules file to the estimator's request.
 *
 * * **A new org** — `acme-onboarding`, which has no knowledge at all: five cards that teach
 *   rather than apologise, in both palettes; a `repo-map` *pending its first generation*; and,
 *   after a generation the host really refuses, one that *failed* — drawn apart.
 * * **Parity** — the seeded `acme-robotics` page in both palettes, before anything touches it.
 * * **Who is reading** — a member's page, and each write they may not make refused when it is
 *   made past the page.
 * * **The shell** — header and sidebar fixed while the pane scrolls, **Knowledge** lit, and the
 *   page correct at the 125 % font-scale step.
 * * **The chain** — import the fixture rules files → preview → apply → drafts in the table,
 *   candidates in the card → confirm one → the manifest preview shows it → **the estimator's
 *   request carries it** → switch a skill off and the preview says so → a playbook from a
 *   finished run → run it on an issue → the queue holds the issue under that playbook, with
 *   the fact in the context it attaches.
 *
 * ## Two workspaces, and why
 *
 * `support/knowledge.ts` says it in full: no seeded workspace is both cold and able to run a
 * loop — `acme-onboarding` has no workflow, route or provider, by its seed's own assertion — so
 * what a new org *sees* is asserted where a new org is, and the chain runs in the one workspace
 * with an estimator route, a published workflow and a finished, pinned run.
 *
 * ## Two tests write, and they run last
 *
 * An import has no un-import, a confirmed fact's audit is append-only, the queue has no remove,
 * and every repo-map generation — a refused one included — is recorded for good. So the refused
 * generation and the chain are the last two tests in this file, in a block of their own after
 * every test that reads a page as the seed left it, and the leg takes the planning leg's
 * position: **it is green from a cold volume and does not pretend to clean up.** A second run
 * against a `--keep` stack finds the drafts already imported and the parity test red by design —
 * `docker compose down -v` is the fix, and CI never meets it. The first block's `beforeAll` says
 * so once, in words; the two writers sit outside that guard and state their own preconditions,
 * because Playwright starts a new worker after a failed test and runs the guard again — by which
 * time one of them may have written. What *can* be put back is: the sandbox issue is closed on
 * its host, the workspace's GitHub token is removed, and the skill the chain switched off is
 * switched on again.
 *
 * ## What is asserted beneath the browser, and why that is this leg's to do
 *
 * Two things, each after the browser has done its half (`support/knowledge.ts` § *The assertions
 * made beneath the browser*): **what the estimator was sent**, read from `fixtures/engine-tap` —
 * the wire between `rest` and the engine, because that request is the gate and nothing else can
 * see it — and **what the queue holds**, the playbook the row names and the context it attaches.
 * Nothing here is intercepted or rewritten: every state on these pages is the service's own.
 */

import { type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  COLD,
  COLD_TENANT,
  CONFIRMED_FACT,
  IMPORT,
  IMPORT_REPO,
  KNOWLEDGE_PATH,
  MEMBER_REFUSED,
  PLAYBOOK_NAME,
  PROFILE_REPO,
  SANDBOX_ISSUE,
  SEEDED,
  SOURCE_RUN,
  TOGGLED_SKILL,
  answerFor,
  backlogRow,
  closeSandboxIssue,
  connectSeededSource,
  estimateRequestsFor,
  facts,
  fileSandboxIssue,
  playbookContext,
  playbooks,
  queuedItem,
  resetTap,
  setSkillEnabled,
} from "../support/knowledge";
import { clearGithubToken, setGithubToken, syncIntakeMirror } from "../support/planning";
import { quietly, requestAs } from "../support/rest";
import { SEED_MEMBER, SEED_OWNER, SEED_TENANT } from "../support/seed";
import { signIn } from "../support/session";
import { expectFontScale, restoreFontScale, setFontScale } from "../support/settings";
import { chromeBoxes, expectNoPaneHorizontalScroll, scrollPaneTo } from "../support/shell";
import { THEMES, pinTheme } from "../support/theme";
import { selectWorkspace } from "../support/workspace";

/** A window wide enough for the two columns and tall enough for the page whole. */
const PARITY_WINDOW = { width: 1920, height: 3200 };

/** How long the estimator may take to size one issue: a sync, a queue hop and an engine call. */
const ESTIMATE_MS = 45 * 1000;

/*
 * What a test says when the layer under it broke — the "fails meaningfully" half of the gate.
 * Each is printed with the assertion that went red, so the log names the layer rather than only
 * a timeout.
 */

/** The head never drew: the page's reads, or the route itself. */
const PAGE_BROKE =
  "the knowledge page must draw its head — the route reads the skills, facts, playbooks, repositories and repo-map status";

/** The workspace is not as the seed left it: this stack has already run the chain. */
const NOT_COLD =
  "the seeded workspace must hold mockup 14's six skills and the roadmap pipeline's two, five facts and three playbooks, and no map may have been attempted in the cold one — this leg is green from a cold volume; `docker compose down -v` a stack that has already run it";

/** The refused generation was not recorded as one, or the status read did not say so. */
const GENERATION_BROKE =
  "the refused generation must leave the map failed, not pending — every generation is recorded, and the status reads the newest";

/** The preview found no rules files: the import could not read the repository. */
const IMPORT_BROKE =
  "the preview must find the fixture's CLAUDE.md and .cursorrules — the import reads the repository on its host through the connected source";

/** The drafts or the candidates never appeared: the apply wrote nothing, or the page did not re-read. */
const APPLY_BROKE =
  "the apply must leave three skill drafts in the table and five candidates in the card — the import writes what it previewed";

/** The fact did not become confirmed. */
const CONFIRM_BROKE =
  "the fact must be confirmed — the fact lifecycle records the session's person and moves the row out of awaiting";

/** The manifest does not hold the confirmed fact: context assembly did not resolve it. */
const ASSEMBLY_BROKE =
  "the manifest preview must list the confirmed fact — context assembly resolves the confirmed facts of the repository";

/** The issue was never sized: the mirror did not bring it, or the estimator did not run. */
const ESTIMATE_BROKE =
  "the sandbox issue must be sized — the intake mirror syncs it from the tracker and the estimator sizes it through the engine";

/** Nothing reached the engine for the issue. */
const NOTHING_SENT =
  "the estimator must have asked the engine about the sandbox issue — the engine tap saw no estimate request for it";

/** The request went, and the fact was not in it: the hop this leg exists for. */
const PAYLOAD_BROKE =
  "the estimator's request must carry the confirmed fact in context.facts — estimation builds its context from the estimator manifest";

/** The preview did not follow the switch. */
const TOGGLE_BROKE =
  "the manifest preview must follow the skill's switch at once — the switch is recorded and the next preview resolves without it";

/** The playbook was not created from the run. */
const PLAYBOOK_BROKE =
  "the playbook must be saved from the finished run under its workflow pin — create-from-run captures a terminal run's pin";

/** The launch did not queue. */
const LAUNCH_BROKE =
  "the issue must be queued under the playbook's pin — run-on-issue is the queue write with the playbook's workflow at its pinned version";

/** The queue row does not name its playbook, or the context it attaches lost the fact. */
const QUEUE_BROKE =
  "the queue entry must name its playbook, and that playbook's context must carry the confirmed fact — the launch attaches the recipe and its manifest";

/**
 * Sign a seeded person into a workspace.
 *
 * @param context The browser context.
 * @param userId Who. Defaults to the owner.
 * @param slug Which workspace. Defaults to the one every mockup is drawn in.
 * @returns When the session is acting there.
 */
async function signInAs(
  context: BrowserContext,
  userId: string = SEED_OWNER.id,
  slug: string = SEED_TENANT.slug,
): Promise<void> {
  await signIn(context, userId);
  await selectWorkspace(context, slug);
}

/**
 * The page's `<main>` — visible only, because while the page streams React keeps a hidden copy
 * of the segment in the DOM (leg 17's note).
 *
 * @param page The knowledge page.
 * @returns The landmark.
 */
function main(page: Page): Locator {
  return page.locator("main.knowledge").filter({ visible: true });
}

/**
 * A card, by its title.
 *
 * @param page The knowledge page.
 * @param title The card's title, or a pattern for the profile's, which names its repository.
 * @returns The region.
 */
function card(page: Page, title: string | RegExp): Locator {
  return main(page).getByRole("region", { name: title });
}

/** The repo profile's card — its title names the repository it draws. */
const PROFILE = /^Repo profile/;

/**
 * The toast under the head.
 *
 * @param page The knowledge page.
 * @returns The toast.
 */
function toast(page: Page): Locator {
  return main(page).locator(".knowledge-toast");
}

/**
 * The rows of the maps list — the repositories whose `repo-map` has no row in the table.
 *
 * @param page The knowledge page.
 * @returns The rows.
 */
function mapRows(page: Page): Locator {
  return card(page, "Skills").getByRole("list", { name: COLD.maps.name }).getByRole("listitem");
}

/**
 * What prints an age the seed decided: when the volume was seeded is not the design's to fix.
 *
 * @param page The knowledge page.
 * @returns The table's Updated cells, the facts' source lines, and the recipe's version line.
 */
function ages(page: Page): Locator[] {
  return [
    // Only the cells that print an age — the required and the generated rows' tags stay in view.
    card(page, "Skills")
      .locator("tbody td:nth-child(4)")
      .filter({ hasText: /\bago$/ }),
    card(page, "Learned by the loop").locator(".knowledge-facts__src"),
    card(page, PROFILE).locator(".knowledge-profile__env-version"),
  ];
}

/**
 * Open the page and wait for its head.
 *
 * @param page The page.
 * @param profileRepo The repository the profile card draws, as `owner/name` — the address's
 *   `?repo=`. Omitted, the card draws the first enabled one.
 * @returns When the head has drawn.
 */
async function openKnowledge(page: Page, profileRepo?: string): Promise<void> {
  await page.goto(
    profileRepo === undefined
      ? KNOWLEDGE_PATH
      : `${KNOWLEDGE_PATH}?repo=${encodeURIComponent(profileRepo)}`,
  );
  await expect(page.getByRole("heading", { level: 1 }), PAGE_BROKE).toHaveText(
    "Teach the loop once. Every run remembers.",
  );
  await expect(main(page)).toBeVisible();
}

/**
 * Open *Preview injection* for a repository.
 *
 * @param page The knowledge page.
 * @param repo `owner/name`.
 * @returns The dialog, with the manifest for that repository drawn.
 */
async function openPreview(page: Page, repo: string): Promise<Locator> {
  await card(page, "Scope").getByRole("button", { name: "Preview injection ▾" }).click();

  const dialog = page.getByRole("dialog", { name: "What would be injected" });

  await dialog.getByLabel("Repository").selectOption(repo);
  await expect(dialog.locator(".knowledge-preview__manifest")).toBeVisible();
  // The choice re-asks the service; the summary is the last thing a manifest draws.
  await expect(dialog.getByText("Assembling…")).toHaveCount(0);

  return dialog;
}

/**
 * One section of the preview, by its heading.
 *
 * @param dialog The preview dialog.
 * @param heading The heading's lead — `Skills`, `Confirmed facts`, `Not in this manifest`.
 * @returns The section.
 */
function previewSection(dialog: Locator, heading: string): Locator {
  return dialog.locator(".knowledge-preview__section").filter({
    has: dialog.page().getByRole("heading", { name: new RegExp(`^${heading}`) }),
  });
}

test.describe("the knowledge page's states (#422)", () => {
  // Every test in this block reads a page as the seed left it, and the block after it changes
  // both workspaces for good — see this file's header. A stack that has already run the leg is
  // told so once, at the start and in words, rather than by a parity screenshot three hundred
  // pixels off. The guard is this block's alone: the two tests that write are outside it, so a
  // worker restarted after one of them failed does not report the other as *not cold*.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();

    try {
      await signInAs(context);

      const seeded = {
        skills: (
          await requestAs<{ skills: { slug: string }[] }>(
            context,
            "GET",
            "/api/v1/skills",
            null,
            "reading the seeded skills",
          )
        )?.skills
          .map((skill) => skill.slug)
          .sort(),
        facts: (await facts(context)).length,
        playbooks: (await playbooks(context)).length,
      };

      expect(seeded, NOT_COLD).toEqual({
        skills: [...SEEDED.skills].sort(),
        facts: 5,
        playbooks: 3,
      });

      await selectWorkspace(context, COLD_TENANT.slug);

      const maps = await requestAs<{ items: { repo: string; state: string }[] }>(
        context,
        "GET",
        "/api/v1/knowledge/repo-map",
        null,
        "reading the cold workspace's repo-map status",
      );

      expect(
        maps?.items.map((status) => [status.repo, status.state]),
        NOT_COLD,
      ).toEqual(COLD_TENANT.repos.map((repo) => [repo, "pending"]));
    } finally {
      await context.close();
    }
  });

  test("a new org: five cards that teach, and a repo-map that is pending — not broken", async ({
    context,
    page,
  }) => {
    await signInAs(context, SEED_OWNER.id, COLD_TENANT.slug);
    await page.setViewportSize(PARITY_WINDOW);
    await openKnowledge(page);

    // ---- No skills: what a skill is, and the head's two actions where the reader is looking.
    const skills = card(page, "Skills");

    await expect(skills.getByText(COLD.skills.title)).toBeVisible();
    await expect(skills).toContainText(COLD.skills.explainer);

    const first = skills.getByRole("group", { name: COLD.skills.actions });

    await expect(first.getByRole("button")).toHaveText([
      "+ New skill",
      "Import CLAUDE.md / .cursorrules",
    ]);
    await expect(skills.getByRole("table")).toHaveCount(0);

    // ---- No facts: the model, explained, with the manual add in the state — once, and not as
    // a ghost in the head above it.
    const learned = card(page, "Learned by the loop");

    await expect(learned.getByText(COLD.facts.title)).toBeVisible();
    await expect(learned).toContainText(COLD.facts.lead);
    await expect(learned.getByRole("button", { name: "+ Add fact" })).toHaveCount(1);
    await expect(
      learned.locator(".ou-empty").getByRole("button", { name: "+ Add fact" }),
    ).toBeVisible();

    // ---- No playbooks: the create-from-a-past-run path, primary.
    const recipes = card(page, "Playbooks");

    await expect(recipes.getByText(COLD.playbooks.title)).toBeVisible();
    await expect(recipes.getByRole("button", { name: COLD.playbooks.create })).not.toHaveAttribute(
      "aria-disabled",
    );

    // ---- No environment recipe: the add, in the state.
    const profile = card(page, PROFILE);

    await expect(profile.getByText(COLD.recipe.title)).toBeVisible();
    await expect(
      profile.locator(".ou-empty").getByRole("button", { name: COLD.recipe.add }),
    ).toBeVisible();
    await expect(profile).not.toContainText(/\d+s \(vs/);

    // ---- One accent-filled action per card at most: the head's, the empty table's copy of it,
    // and the playbooks tile. A cold page does not open on five competing calls to action.
    await expect(main(page).locator(".ou-btn--primary")).toHaveText([
      "+ New skill",
      "+ New skill",
      COLD.playbooks.create,
    ]);

    // ---- The ladder says it counts up, rather than three unexplained zeroes.
    await expect(card(page, "Scope")).toContainText(COLD.scope);

    // ---- repo-map: pending for both repositories. Nothing was attempted, so nothing failed.
    await expect(mapRows(page)).toHaveCount(COLD_TENANT.repos.length);

    for (const [index, repo] of COLD_TENANT.repos.entries()) {
      const row = mapRows(page).nth(index);

      await expect(row).toContainText(repo);
      await expect(row.locator(".ou-chip")).toHaveText(COLD.maps.pending);
      await expect(row).not.toHaveClass(/knowledge-maps__row--failed/);
    }

    // What pending means, said once under the rows: not broken, and what writes the first one.
    await expect(skills.getByText(COLD.maps.pendingNote, { exact: false })).toHaveCount(1);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main(page)).toHaveScreenshot(`knowledge-cold-${theme}.png`, {
        mask: ages(page),
      });
    }
  });

  test("parity: the seeded page in both palettes", async ({ context, page }) => {
    await signInAs(context);
    await page.setViewportSize(PARITY_WINDOW);
    await openKnowledge(page, PROFILE_REPO);

    // ---- Mockup 14's six rows, five facts and three recipes.
    const skills = card(page, "Skills");

    await expect(skills.getByText(SEEDED.active, { exact: true }), NOT_COLD).toBeVisible();
    await expect(skills.locator("tbody tr")).toHaveCount(SEEDED.skills.length);
    await expect(
      card(page, "Learned by the loop").getByText(SEEDED.awaiting, { exact: true }),
    ).toBeVisible();
    await expect(card(page, "Learned by the loop").locator(".knowledge-facts__row")).toHaveCount(5);
    await expect(card(page, "Playbooks").getByText(SEEDED.recipes, { exact: true })).toBeVisible();

    // ---- The profile is the repository mockup 14 draws: its environment recipe at v3, and —
    // honestly — not scanned, because detection's scan is the onboarding workspace's and this
    // workspace has never run the wizard.
    await expect(card(page, PROFILE).getByText("not scanned", { exact: true })).toBeVisible();
    await expect(card(page, PROFILE).locator(".knowledge-profile__env-version")).toContainText(
      "v3",
    );

    // ---- The one thing the mockup does not say: three of the four repositories have no map
    // yet. Pending, not broken — nobody has asked.
    await expect(mapRows(page)).toHaveCount(SEEDED.pendingMaps.length);
    await expect(mapRows(page).locator(".ou-chip")).toHaveText(
      SEEDED.pendingMaps.map(() => COLD.maps.pending),
    );

    for (const [index, repo] of SEEDED.pendingMaps.entries())
      await expect(mapRows(page).nth(index)).toContainText(repo);

    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(main(page)).toHaveScreenshot(`knowledge-${theme}.png`, { mask: ages(page) });
    }
  });

  test("a member: every write they may not make is inert with its reason, and refused past the page", async ({
    context,
    page,
  }) => {
    await signInAs(context, SEED_MEMBER.id);
    await openKnowledge(page, PROFILE_REPO);

    // ---- The head: neither action, and a note saying why it is short.
    await expect(main(page).getByRole("button", { name: "+ New skill" })).toHaveCount(0);
    await expect(
      main(page).getByRole("button", { name: "Import CLAUDE.md / .cursorrules" }),
    ).toHaveCount(0);
    await expect(main(page).getByRole("note").first()).toContainText(
      "Viewing knowledge as a member.",
    );

    // ---- Skills: every switch in its real state, read-only; the regenerates inert.
    const skills = card(page, "Skills");

    await expect(skills.getByRole("switch")).toHaveCount(SEEDED.skills.length);

    for (const toggle of await skills.getByRole("switch").all()) {
      await expect(toggle).toHaveAttribute("aria-disabled", "true");
    }

    await expect(skills.getByRole("button", { name: "Regenerate repo-map now" })).toHaveAttribute(
      "title",
      "Only an owner or an admin can regenerate a skill.",
    );
    await expect(mapRows(page).first().getByRole("button")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // ---- Facts: deciding is a member's, by the service's own rule.
    await expect(
      card(page, "Learned by the loop")
        .getByRole("button", { name: /^Confirm/ })
        .first(),
    ).not.toHaveAttribute("aria-disabled");

    // ---- Playbooks: launching is a member's; creating is an administrator's.
    await expect(
      card(page, "Playbooks")
        .getByRole("button", { name: /^Run on issue:/ })
        .first(),
    ).not.toHaveAttribute("aria-disabled");
    await expect(
      card(page, "Playbooks").getByRole("button", { name: "+ New playbook from a past run…" }),
    ).toHaveAttribute("aria-disabled", "true");

    // ---- Profile: the recipe's edit is an administrator's. Scope: the preview is everyone's.
    await expect(
      card(page, PROFILE).getByRole("button", { name: "Edit", exact: true }),
    ).toHaveAttribute("title", "Only an owner or an admin can edit the environment recipe.");
    await expect(
      card(page, "Scope").getByRole("button", { name: "Preview injection ▾" }),
    ).not.toHaveAttribute("aria-disabled");

    // ---- And past the page: each of those writes, made by hand with the member's session, is
    // the service's to refuse. The page's inertness is presentation; this is the gate.
    for (const [what, method, path, body] of MEMBER_REFUSED) {
      expect(
        await answerFor(context, method, path, body),
        `${what} must be refused for a member`,
      ).toEqual({
        status: 403,
        code: "forbidden",
      });
    }
  });

  test("shell: fixed chrome, Knowledge lit, and the 125% step", async ({ context, page }) => {
    await signInAs(context);

    try {
      await setFontScale(context, "125");
      await openKnowledge(page, PROFILE_REPO);
      await expectFontScale(page, "125");

      // ---- The sidebar's own entry is the lit one.
      await expect(
        page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /Knowledge/ }),
      ).toHaveAttribute("aria-current", "page");

      // ---- The page at the scale still draws every card and the maps under the table.
      await expect(main(page).locator(".knowledge__seat")).toHaveCount(5);
      await expect(mapRows(page)).toHaveCount(SEEDED.pendingMaps.length);

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

test.describe("the knowledge chain (#422)", () => {
  // The two tests that write. Each states its own precondition where it needs it, in words, so
  // neither depends on a guard the other can invalidate.

  test("a refused generation: the repo-map that failed is drawn apart from the one still pending", async ({
    context,
    page,
  }) => {
    await signInAs(context, SEED_OWNER.id, COLD_TENANT.slug);
    await page.setViewportSize(PARITY_WINDOW);
    await openKnowledge(page);

    await expect(mapRows(page).locator(".ou-chip"), NOT_COLD).toHaveText(
      COLD_TENANT.repos.map(() => COLD.maps.pending),
    );

    // ---- A generation the host really refuses: this workspace's source holds the seed's
    // placeholder credential, which cannot be opened, so the read never reaches the host. The
    // row must say *failed*, with why — and the repository nobody asked about must still say
    // *pending*.
    await mapRows(page)
      .filter({ hasText: COLD_TENANT.generated })
      .getByRole("button", { name: `Generate repo-map for ${COLD_TENANT.generated} now` })
      .click();

    await expect(toast(page), GENERATION_BROKE).toContainText(
      `repo-map was not regenerated for ${COLD_TENANT.generated}`,
    );

    const failed = mapRows(page).filter({ hasText: COLD_TENANT.generated });
    const pending = mapRows(page).filter({ hasNotText: COLD_TENANT.generated });

    await expect(failed.locator(".ou-chip"), GENERATION_BROKE).toHaveText(COLD.maps.failed);
    await expect(failed).toHaveClass(/knowledge-maps__row--failed/);
    await expect(failed).toContainText(COLD.maps.failedNote);
    await expect(pending.locator(".ou-chip")).toHaveText(COLD.maps.pending);
    await expect(pending).not.toHaveClass(/knowledge-maps__row--failed/);
    // The failure's sentence is the failed row's own; the pending row carries none.
    await expect(pending.locator(".knowledge-maps__detail")).toHaveCount(0);

    // It is the service's state and not the press's: a reload draws the same two rows.
    await page.reload();
    await expect(mapRows(page).locator(".ou-chip"), GENERATION_BROKE).toHaveText([
      COLD.maps.pending,
      COLD.maps.failed,
    ]);

    // The two states side by side, which is the criterion: visually distinct. The failed row's
    // sentence carries how long ago it failed, which is not the design's to fix.
    for (const theme of THEMES) {
      await pinTheme(page, theme);
      await expect(
        card(page, "Skills").getByRole("list", { name: COLD.maps.name }),
      ).toHaveScreenshot(`knowledge-maps-${theme}.png`, {
        mask: [
          mapRows(page)
            .filter({ hasText: COLD_TENANT.generated })
            .locator(".knowledge-maps__detail"),
        ],
      });
    }
  });

  test("the chain: a rules file's fact reaches the estimator, and a playbook's launch reaches the queue", async ({
    context,
    page,
    request,
  }) => {
    // One test that waits on the tracker, the importer, the estimator and the engine in sequence.
    // `slow()` triples the per-test timeout rather than raising the suite's budget.
    test.slow();

    let sandboxIssue: number | undefined;

    await signInAs(context);

    try {
      // The seeded source's credential is a placeholder and the workspace has no token: the
      // honest state of a workspace nobody has connected. The chain needs both, as a person
      // importing from and syncing with their host would.
      await connectSeededSource(context);
      await setGithubToken(context);
      await resetTap(request);
      await openKnowledge(page);
      await expect(card(page, "Skills").locator("tbody tr"), NOT_COLD).toHaveCount(
        SEEDED.skills.length,
      );

      /* ------------------------------------------------ import → preview → apply */

      await main(page)
        .locator(".knowledge__actions")
        .getByRole("button", { name: "Import CLAUDE.md / .cursorrules" })
        .click();

      const sheet = page.getByRole("dialog", { name: "Import rules files" });

      await sheet.getByLabel("Repository").selectOption(IMPORT_REPO);
      await sheet.getByRole("button", { name: "Preview", exact: true }).click();

      // The four files as probed — two found, with what each would create.
      const files = sheet.getByRole("table", { name: "Rules files probed" }).locator("tbody tr");

      await expect(files, IMPORT_BROKE).toHaveCount(IMPORT.files.length);

      for (const [index, [path, line]] of IMPORT.files.entries()) {
        await expect(files.nth(index), IMPORT_BROKE).toContainText(path);
        await expect(files.nth(index), IMPORT_BROKE).toContainText(line);
      }

      await expect(sheet, IMPORT_BROKE).toContainText(IMPORT.totals);
      // The sentence that makes Apply an easy decision.
      await expect(sheet).toContainText("Nothing imported is enabled");

      await sheet.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(toast(page), APPLY_BROKE).toContainText(IMPORT.toast);

      /* ------------------------------------------------ drafts in the table, candidates in the card */

      const skills = card(page, "Skills");
      const learned = card(page, "Learned by the loop");

      for (const slug of IMPORT.drafts) {
        const row = skills
          .locator("tbody tr")
          .filter({ has: page.getByRole("button", { name: `Open ${slug} in the editor` }) });

        await expect(row, APPLY_BROKE).toHaveClass(/knowledge-skills__row--draft/);
        await expect(row.locator(".ou-chip").filter({ hasText: "draft" })).toBeVisible();
      }

      // Drafts are never active: the head's count has not moved.
      await expect(skills.getByText(SEEDED.active, { exact: true })).toBeVisible();

      for (const text of IMPORT.facts) {
        await expect(
          learned.locator(".knowledge-facts__row").filter({ hasText: text }),
          APPLY_BROKE,
        ).toContainText("awaiting review");
      }

      await expect(learned.getByText("7 awaiting review", { exact: true })).toBeVisible();

      /* ------------------------------------------------ confirm one fact */

      const fact = learned.locator(".knowledge-facts__row").filter({ hasText: CONFIRMED_FACT });

      await fact.getByRole("button", { name: /^Confirm/ }).click();
      await expect(fact.locator(".ou-chip"), CONFIRM_BROKE).toHaveText(/confirmed/);
      await expect(fact.getByRole("button", { name: /^Confirm/ })).toHaveCount(0);
      await expect(
        learned.getByText("6 awaiting review", { exact: true }),
        CONFIRM_BROKE,
      ).toBeVisible();
      await expect(fact, CONFIRM_BROKE).toContainText("confirmed by Ken");

      /* ------------------------------------------------ the manifest preview shows it */

      let preview = await openPreview(page, IMPORT_REPO);

      await expect(previewSection(preview, "Confirmed facts"), ASSEMBLY_BROKE).toContainText(
        CONFIRMED_FACT,
      );
      // A candidate nobody confirmed is not injected — the page's own promise.
      await expect(previewSection(preview, "Confirmed facts")).not.toContainText(IMPORT.facts[0]);
      // And a draft is not a skill a run carries.
      await expect(preview).not.toContainText(`${IMPORT.drafts[0]}@`);

      // The estimator's manifest — facts only — carries it too.
      await preview.getByLabel("Consumer").selectOption({ label: "Estimator" });
      await expect(previewSection(preview, "Confirmed facts"), ASSEMBLY_BROKE).toContainText(
        CONFIRMED_FACT,
      );
      await preview.getByRole("button", { name: "Close" }).click();

      /* ------------------------------------------------ the estimator's request carries it */

      // A person files an issue on the host; the intake mirror brings it home; the estimator
      // sizes it. Nothing here is asked of the estimator directly — it runs because an issue
      // arrived, which is how it runs.
      const issue = await fileSandboxIssue(request);

      sandboxIssue = issue.number;
      await syncIntakeMirror(context);

      await expect
        .poll(async () => (await backlogRow(context, issue.number))?.sizingStatus, {
          message: ESTIMATE_BROKE,
          timeout: ESTIMATE_MS,
        })
        .toBe("sized");

      const confirmed = (await facts(context)).find((one) => one.text === CONFIRMED_FACT);

      expect(confirmed?.status, CONFIRM_BROKE).toBe("confirmed");

      // **The gate.** What `rest` sent the engine for this issue, read off the wire.
      const sent = await estimateRequestsFor(request, issue.number);

      expect(sent.length, NOTHING_SENT).toBeGreaterThan(0);
      expect(sent.at(-1)?.issue, NOTHING_SENT).toMatchObject({
        repo: IMPORT_REPO,
        title: SANDBOX_ISSUE.title,
      });
      expect(sent.at(-1)?.context.facts, PAYLOAD_BROKE).toContainEqual({
        id: confirmed?.id,
        text: CONFIRMED_FACT,
      });
      // Only what was confirmed: the candidate beside it in the same file was not sent.
      expect(
        sent.at(-1)?.context.facts.map((one) => one.text),
        "a candidate nobody confirmed must not reach the estimator",
      ).not.toContain(IMPORT.facts[0]);

      // And the page counts the use: the fact's own figure moved, from the injection record.
      await page.reload();
      await expect(
        card(page, "Learned by the loop")
          .locator(".knowledge-facts__row")
          .filter({ hasText: CONFIRMED_FACT }),
        PAYLOAD_BROKE,
      ).toContainText("used 1×");

      /* ------------------------------------------------ toggle a skill → the preview updates */

      const toggled = card(page, "Skills").getByRole("switch", {
        name: `Disable ${TOGGLED_SKILL.slug}`,
      });

      preview = await openPreview(page, IMPORT_REPO);
      await expect(previewSection(preview, "Skills")).toContainText(TOGGLED_SKILL.inForce);
      await preview.getByRole("button", { name: "Close" }).click();

      await toggled.click();
      await expect(
        card(page, "Skills").getByRole("switch", { name: `Enable ${TOGGLED_SKILL.slug}` }),
      ).toHaveAttribute("aria-checked", "false");

      // No reload: the next preview is asked of the service, which no longer resolves the skill.
      preview = await openPreview(page, IMPORT_REPO);
      await expect(previewSection(preview, "Skills"), TOGGLE_BROKE).not.toContainText(
        TOGGLED_SKILL.inForce,
      );
      await expect(previewSection(preview, "Not in this manifest"), TOGGLE_BROKE).toContainText(
        TOGGLED_SKILL.slug,
      );
      await expect(previewSection(preview, "Not in this manifest"), TOGGLE_BROKE).toContainText(
        "switched off",
      );
      await preview.getByRole("button", { name: "Close" }).click();

      await card(page, "Skills")
        .getByRole("switch", { name: `Enable ${TOGGLED_SKILL.slug}` })
        .click();
      await expect(
        card(page, "Skills").getByRole("switch", { name: `Disable ${TOGGLED_SKILL.slug}` }),
      ).toHaveAttribute("aria-checked", "true");

      preview = await openPreview(page, IMPORT_REPO);
      await expect(previewSection(preview, "Skills"), TOGGLE_BROKE).toContainText(
        TOGGLED_SKILL.inForce,
      );
      await preview.getByRole("button", { name: "Close" }).click();

      /* ------------------------------------------------ a playbook from a finished run */

      const recipes = card(page, "Playbooks");

      await recipes.getByRole("button", { name: "+ New playbook from a past run…" }).click();

      const create = page.getByRole("dialog", { name: "New playbook from a past run" });

      // The newest finished run carries no pin, and says so rather than capturing nothing.
      await create
        .getByRole("button", { name: `Use this run: #${String(SOURCE_RUN.unpinned.number)}` })
        .click();
      await expect(create.getByRole("alert")).toContainText(SOURCE_RUN.unpinned.refusal);

      await create
        .getByRole("button", { name: `Use this run: #${String(SOURCE_RUN.number)}` })
        .click();
      await expect(create.getByText("What the run captured"), PLAYBOOK_BROKE).toBeVisible();
      await expect(create.locator(".knowledge-new-playbook__facts"), PLAYBOOK_BROKE).toContainText(
        SOURCE_RUN.pin,
      );

      await create.getByLabel("Name", { exact: true }).fill(PLAYBOOK_NAME);
      await create.getByRole("button", { name: "Save playbook" }).click();

      await expect(toast(page), PLAYBOOK_BROKE).toContainText(
        `Saved ${PLAYBOOK_NAME} — ${SOURCE_RUN.pin}, run 0×.`,
      );
      await expect(recipes.getByText("4 recipes", { exact: true }), PLAYBOOK_BROKE).toBeVisible();

      /* ------------------------------------------------ run it on the issue */

      await recipes.getByRole("button", { name: `Run on issue: ${PLAYBOOK_NAME}` }).click();

      const picker = page.getByRole("dialog", { name: `Run ${PLAYBOOK_NAME} on an issue` });

      await picker.getByLabel("Find an issue").fill(String(issue.number));
      await picker.getByRole("button", { name: "Search" }).click();
      await picker.getByRole("button", { name: `Queue #${String(issue.number)}` }).click();

      await expect(picker.getByRole("status"), LAUNCH_BROKE).toContainText(
        `Queued #${String(issue.number)} — ${SANDBOX_ISSUE.title} — under ${PLAYBOOK_NAME} (${SOURCE_RUN.pin})`,
      );
      await picker.getByRole("button", { name: "Close" }).click();
      // The row says so beside a count it does not move: a queued launch is not yet a run.
      await expect(
        recipes.locator(".knowledge-playbooks__row").filter({ hasText: PLAYBOOK_NAME }),
      ).toContainText(`#${String(issue.number)} queued`);

      /* ------------------------------------------------ verified on the queue */

      const playbook = (await playbooks(context)).find((one) => one.name === PLAYBOOK_NAME);

      expect(playbook?.workflow, PLAYBOOK_BROKE).toEqual(
        expect.objectContaining(SOURCE_RUN.workflow),
      );

      // The queue's own entry: the issue, under the playbook's pin, naming the playbook.
      expect(await queuedItem(context, issue.number), QUEUE_BROKE).toMatchObject({
        issueNumber: issue.number,
        workflowTag: SOURCE_RUN.workflow.slug,
        workflowVersion: SOURCE_RUN.workflow.version,
        workflowPinReason: "explicit",
        playbookId: playbook?.id,
      });

      // And the context that playbook attaches for this repository — what the run will be given
      // — carries the fact the browser confirmed.
      const attached = await playbookContext(context, playbook?.id ?? "", IMPORT_REPO);

      expect(attached.factIds, QUEUE_BROKE).toContain(confirmed?.id);
      expect(attached.skills, QUEUE_BROKE).toContain(TOGGLED_SKILL.slug);
    } finally {
      // What can be put back, is. A failed restore complains rather than throws: the interesting
      // failure is the one the test has already reported.
      await quietly(
        () => setSkillEnabled(context, TOGGLED_SKILL.slug, true),
        `${TOGGLED_SKILL.slug} may still be switched off — every manifest assembled in this workspace would go without it.`,
      );
      await quietly(
        () => clearGithubToken(context),
        "the workspace still holds this leg's GitHub token — the intake leg's *sync paused* guidance would not draw.",
      );

      if (sandboxIssue !== undefined) {
        const filed = sandboxIssue;

        await quietly(
          () => closeSandboxIssue(request, filed),
          `sandbox issue #${String(filed)} is still open on the tracker — a later sync would adopt it as open work.`,
        );
      }
    }
  });
});
