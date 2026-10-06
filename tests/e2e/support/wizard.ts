/**
 * The Get Started wizard's leg ([#395](https://github.com/NobuData/ouroboros/issues/395), BC.6 —
 * the onboarding roadmap's MVP gate): what it names, and the questions it asks beneath the browser.
 *
 * ## Two workspaces, and why
 *
 * The states mockup 13 draws — steps 1–2 done, step 3 active — are the onboarding seed's, in
 * `acme-onboarding` (`R__dev_seed_onboarding.sql`): that is where the standalone chrome, the fixed
 * head, rail and bar, the 125 % step and both palettes are asserted, because they are facts about
 * the frame and the seed is the page the mockup shows.
 *
 * The chain — every step **undone**, then done for real — cannot run there, and cannot run in a
 * workspace the leg creates either. The issue's "cold org" needs a sized backlog to launch from,
 * and sizing resolves a model through routing (`estimation.context.ts`); `task_kinds` and `routes`
 * are written only by the dev seed — no route creates them, and the routing roadmap names the
 * bootstrap write as epic Z's to file — so **only `acme-robotics` can size an issue**. The chain
 * therefore runs in `acme-robotics` on a repository it has never onboarded: the sandbox tracker's
 * fifth repository, {@link CHAIN}'s `helios-bootloader`. For that repository the rail is genuinely
 * cold — no source covers it, the mirror does not hold it, nothing has scanned it, `quick-fixes` has
 * never been instantiated there, nothing is picked, and dry-run is the seed's *never set* — which is
 * what the wizard is for. The user settled this on the ticket (2026-10-05).
 *
 * ## What is asserted beneath the browser
 *
 * The leg reads four things no page shows whole: the sources listing (which source the dialog
 * made, by name), the GitHub mirror (that the repository was *not* recorded before the switch and
 * *is* after it, with its id for the driver), the queue (`GET /api/v1/queue` — the total the
 * dashboard's card cannot show past its five rows, and the pin on the row the launch wrote), and
 * the dry-run policy (`GET /api/v1/policies/dry-run`, which the launch flips from *never set* to
 * on). Nothing is intercepted or rewritten: every state on the page is the service's own.
 *
 * ## Failure messages
 *
 * Each constant below names the layer whose break it reports, because
 * `scripts/verify-failure-modes.sh` requires the output to say which service was stopped rather
 * than leave a timeout against a locator. The two it greps for are {@link CONNECT_BROKE} (the
 * sandbox tracker — the add-source dialog's validation probes the host) and {@link SIZE_BROKE}
 * (the engine — the estimator).
 */

import {
  type BrowserContext,
  type Locator,
  type Page,
  type APIRequestContext,
  expect,
} from "@playwright/test";

import { SANDBOX_GITHUB_TOKEN } from "./planning";
import { quietly, requestAs } from "./rest";
import { SEED_OWNER, SEED_TENANT, ephemeralSlug } from "./seed";
import { AUTH_BASE_PATH, SESSION_COOKIE, sessionTokenOf, signIn } from "./session";
import { REST_URL, TRACKER_URL } from "./stack";
import { selectWorkspace } from "./workspace";

export { queuedItem } from "./knowledge";

/** The page. */
export const WIZARD_PATH = "/get-started";

/**
 * The wizard for one repository.
 *
 * @param repo - `owner/name`.
 * @returns `/get-started?repo=owner%2Fname`.
 */
export function wizardPathFor(repo: string): string {
  return `${WIZARD_PATH}?repo=${encodeURIComponent(repo)}`;
}

/** The head's `<h1>`, verbatim from mockup 13. */
export const WIZARD_TITLE = "Your first loop in about 4 minutes.";

/** The seeded wizard — mockup 13's states, in the onboarding seed's workspace. */
export const SEEDED_WIZARD = {
  slug: "acme-onboarding",
  repo: "acme-robotics/helios-firmware",
} as const;

/**
 * The chain's subject: a repository `acme-robotics` has never onboarded.
 *
 * `helios-bootloader` is the sandbox tracker's fifth repository
 * (`fixtures/tracker-stub/repos/acme-robotics/helios-bootloader/`) — a whole small Zephyr project,
 * so detection has real files to read — and it is named by no seeded source, recorded in no seeded
 * mirror, and queued in no seeded queue. Its issue numbers begin at 11000, clear of every other
 * leg's.
 */
export const CHAIN = {
  slug: SEED_TENANT.slug,
  tenantId: SEED_TENANT.id,
  owner: "acme-robotics",
  name: "helios-bootloader",
  repo: "acme-robotics/helios-bootloader",
  /** What the embedded dialog names the source — unique in the workspace, and the row's heading. */
  sourceName: "GitHub · helios-bootloader",
  /** The template the chain picks, and the workflow its tile creates. */
  workflow: { slug: "quick-fixes", version: 1, name: "Quick fixes" },
} as const;

/** The dashboard queue card draws this many rows — `QUEUE_HEAD_LIMIT` in `dashboard.repository.ts`. */
export const QUEUE_HEAD = 5;

/**
 * The issue the chain files on the sandbox — the mockup's typo sweep: a documentation label and
 * a short body, which the heuristic estimator sizes `xs` and classifies for `docs-loop`, so the
 * picker's safety score clears its bar.
 */
export const PICK_ISSUE = {
  title: "Typo sweep in the operator manual and pairing guide",
  body:
    "The operator manual spells *receive* and *separate* wrong and the pairing guide has *until* " +
    "and *address* misspelled. Docs only — nothing under src/, boot/ or keys/ changes.",
  labels: ["documentation"],
} as const;

/**
 * What detection concludes from the fixture repository's own files, row by row — written down
 * from the rule packs (`ouroboros-rest/src/modules/detection/packs/`) rather than read back off
 * the card, so a pack that changed its mind turns this leg red instead of being followed by it.
 */
export const DETECTION_ROWS: readonly { readonly label: string; readonly value: RegExp }[] = [
  // language.pack.ts: the top language's share, then `west.yml`'s Zephyr version as major.minor.
  { label: "Language", value: /^C \d+% · Zephyr RTOS 4\.1$/ },
  // build.pack.ts: the manifest table's first hit is `west.yml`.
  { label: "Build", value: /^west \+ twister \(found west\.yml\)$/ },
  // devcontainer.pack.ts: the spec's second location, its image and the feature's own name.
  {
    label: "Devcontainer",
    value:
      /^found \.devcontainer\/devcontainer\.json → image ghcr\.io\/zephyrproject-rtos\/ci:v0\.27\.4 · features: python$/,
  },
  // tests.pack.ts: one `testcase.yaml` directory, four `ZTEST(` cases, every file read.
  { label: "Tests", value: /^1 suite, 4 tests/ },
  // protected-paths.pack.ts: `boot` and `keys` at depth ≤ 2, nothing else in the table — the
  // card appends its inline *edit* affordance to this row's value.
  { label: "Protected paths", value: /^boot\/, keys\/ suggested/ },
  // conventions.pack.ts: no CONTRIBUTING anywhere it looks.
  { label: "Conventions", value: /^No CONTRIBUTING\.md/ },
];

/** The words the page uses, restated — the leg finds things by the names a reader would. */
export const WIZARD = {
  rail: "Get Started steps",
  bar: "Wizard actions",
  connect: "Connect GitHub",
  picker: "Pick a repo",
  detection: "We already figured this out",
  tiles: "Choose a starting workflow",
  pick: "Your first issue",
  receipt: "Your first loop is queued",
  regress: "A step that was done is not any more",
  launch: "Run my first loop →",
  /** Step 1's evidence for a token source (INTAKE-O.1's App is v2). */
  connected: `${CHAIN.owner} · token`,
} as const;

/** The dashboard's words the leg reads. */
export const DASHBOARD = {
  offer: "Get started",
  offerLink: "Get started →",
  dismiss: "Dismiss",
  queue: "Up next in queue",
} as const;

/** Settings → Policies' dry-run row, as `app/policies/view.ts` says it. */
export const DRY_RUN = {
  group: "Dry-run",
  on: "On — pull requests open as drafts and nothing merges.",
} as const;

/* ------------------------------------------------------------------ failing meaningfully */

/** The head never drew: the route's reads, or the route itself. */
export const PAGE_BROKE =
  "the Get Started page must draw its head — the route reads the wizard, the detection card, the tiles, the first issue and the right column";

/** acme-robotics already onboarded the repository: this stack has run the chain. */
export const NOT_COLD =
  "acme-robotics must not have a source named for helios-bootloader nor the repository in its mirror — this leg is green from a cold volume; `docker compose down -v` a stack that has already run it";

/** The source was not added, or step 1 did not become done. */
export const CONNECT_BROKE =
  "the add-source dialog must accept the sandbox source and step 1 must read done — the service validates it against the sandbox tracker and derives the rail from the sources";

/** The repository did not become recorded and enabled through the switch. */
export const ENABLE_BROKE =
  "the enablement switch must record the repository under its account and switch both on — the tenancy API's upsert, which step 2 is derived from";

/** The scan produced no rows, or the wrong ones. */
export const SCAN_BROKE =
  "detection must scan the repository through the connected source and conclude the fixture's rows — the probes read languages, the tree and files from the sandbox tracker";

/** The issue was never sized, so the picker had nothing to pick. */
export const SIZE_BROKE =
  "the sandbox issue must be sized and picked — the intake mirror syncs it from the tracker and the estimator sizes it through the engine";

/** The tile did not create the workflow, or the Studio does not hold it. */
export const TEMPLATE_BROKE =
  "selecting the tile must publish a real workflow through the studio's own gate and the Studio must open it";

/** The launch did not queue the issue, or the receipt did not say so. */
export const LAUNCH_BROKE =
  "Run my first loop must queue the picked issue under the instantiated workflow and answer its receipt";

/** The queue the dashboard reads does not hold what the receipt claimed. */
export const DASHBOARD_BROKE =
  "the dashboard's queue must hold one more issue than before the launch, pinned to quick-fixes v1 explicitly — the receipt is the service's claim and the queue is the fact";

/** Dry-run did not turn on. */
export const POLICY_BROKE =
  "completing the wizard must turn dry-run on when the workspace never answered — the first-run promise, read back from the policy";

/** The driver opened no run, or the run did not reach its terminal. */
export const DRIVER_BROKE =
  "the simulated driver must open a watermarked run of the queued issue under the wizard's workflow and walk it to Open PR & auto-merge";

/** Pausing the source did not un-tick step 1, or resuming did not tick it again. */
export const REGRESSION_BROKE =
  "a paused source must regress step 1 on the rail's poll with the service's reason, and Resume must put it back — the visible payoff of derived state";

/** The fresh workspace's offer did not behave. */
export const OFFER_BROKE =
  "a fresh workspace's dashboard must offer the wizard once, stop for good when dismissed, and leave the wizard reachable";

/* ------------------------------------------------------------------ the page */

/**
 * Sign in as the seeded owner, enter a workspace, and open its wizard for one repository.
 *
 * @param context - The context to act for.
 * @param page - The page.
 * @param slug - The workspace.
 * @param repo - The repository, `owner/name`.
 * @returns When the head has drawn.
 */
export async function enterWizard(
  context: BrowserContext,
  page: Page,
  slug: string,
  repo: string,
): Promise<void> {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, slug);
  await page.goto(wizardPathFor(repo));
  await expect(page.getByRole("heading", { level: 1 }), PAGE_BROKE).toHaveText(WIZARD_TITLE);
  // The route's loading state draws the same head over an `aria-hidden` rail; the real rail is
  // the navigation landmark, so its presence is what says the reads have landed.
  await expect(page.getByRole("navigation", { name: WIZARD.rail }), PAGE_BROKE).toBeVisible();
  await expect(page.locator(".wizard-skeleton"), PAGE_BROKE).toHaveCount(0);
}

/**
 * The rail's step, by number.
 *
 * @param page - The page.
 * @param step - 1–4.
 * @returns The list item.
 */
export function railStep(page: Page, step: number): Locator {
  return page
    .getByRole("navigation", { name: WIZARD.rail })
    .getByRole("listitem")
    .nth(step - 1);
}

/**
 * A card of the step content, by its heading.
 *
 * @param page - The page.
 * @param name - The card's accessible name.
 * @returns The region.
 */
export function card(page: Page, name: string): Locator {
  return page.getByRole("region", { name });
}

/** The action bar. */
export function bar(page: Page): Locator {
  return page.getByRole("group", { name: WIZARD.bar });
}

/* ------------------------------------------------------------------ the sandbox tracker */

/** One issue, as the sandbox tracker answers it. */
export interface ChainIssue {
  readonly number: number;
  readonly title: string;
}

/**
 * Talk to the sandbox tracker about the chain repository's issues, as a person filing one would.
 *
 * @param request - Playwright's request context.
 * @param method - `POST` to file, `PATCH` to change.
 * @param path - Under the repository's issues, beginning with a slash, or empty.
 * @param data - The document.
 * @returns The issue the tracker answered with.
 * @throws When the tracker did not answer, or refused — saying which.
 */
async function writeIssue(
  request: APIRequestContext,
  method: "POST" | "PATCH",
  path: string,
  data: Readonly<Record<string, unknown>>,
): Promise<ChainIssue> {
  const url = `${TRACKER_URL}/repos/${CHAIN.repo}/issues${path}`;
  const response = await request
    .fetch(url, { method, data, headers: { authorization: `Bearer ${SANDBOX_GITHUB_TOKEN}` } })
    .catch((reason: unknown) => {
      throw new Error(`the sandbox tracker is not answering at ${TRACKER_URL}: ${String(reason)}`);
    });

  if (!response.ok()) {
    throw new Error(
      `the sandbox tracker answered ${response.status().toString()} for ${method} ${url}`,
    );
  }

  return (await response.json()) as ChainIssue;
}

/**
 * File {@link PICK_ISSUE} on the host.
 *
 * @param request - Playwright's request context.
 * @returns The issue, with the number the tracker assigned.
 */
export function fileChainIssue(request: APIRequestContext): Promise<ChainIssue> {
  return writeIssue(request, "POST", "", PICK_ISSUE);
}

/**
 * Close the chain's issue on the host, so no later sync adopts it as open work.
 *
 * @param request - Playwright's request context.
 * @param issueNumber - The issue.
 * @returns When it is closed.
 */
export async function closeChainIssue(
  request: APIRequestContext,
  issueNumber: number,
): Promise<void> {
  await writeIssue(request, "PATCH", `/${String(issueNumber)}`, { state: "closed" });
}

/* ------------------------------------------------------------------ beneath the browser */

/**
 * Ask `ouroboros-rest` something with the context's session and hand back the status too —
 * for the one read whose `404` is an answer rather than a failure ({@link mirroredRepository}).
 *
 * @param context - A signed-in context.
 * @param path - The absolute path.
 * @returns The status and the parsed body.
 */
async function readAs<Answer>(
  context: BrowserContext,
  path: string,
): Promise<{ readonly status: number; readonly body: Answer | null }> {
  const token = await sessionTokenOf(context, `reading ${path}`);
  const response = await fetch(`${REST_URL}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  const text = await response.text();

  return { status: response.status, body: text === "" ? null : (JSON.parse(text) as Answer) };
}

/** One ticket source, as far as this leg reads it. */
export interface SourceRow {
  readonly id: string;
  readonly displayName: string;
  readonly status: "active" | "paused" | "error";
}

/**
 * The workspace's ticket source by name, or undefined when none is.
 *
 * @param context - A signed-in context.
 * @param displayName - The source's heading.
 * @returns The source.
 */
export async function sourceNamed(
  context: BrowserContext,
  displayName: string,
): Promise<SourceRow | undefined> {
  const page = await requestAs<{ items: SourceRow[] }>(
    context,
    "GET",
    "/api/v1/sources?limit=100",
    null,
    "listing the ticket sources",
  );

  return page?.items.find((source) => source.displayName === displayName);
}

/** One mirrored repository, as far as this leg reads it. */
export interface MirroredRepository {
  readonly id: string;
  readonly enabled: boolean;
}

/**
 * A repository of the workspace's GitHub mirror — or null when the mirror does not hold it,
 * which for the chain's repository is the cold state the guard asserts.
 *
 * @param context - A signed-in context.
 * @param tenantId - The workspace.
 * @param login - The account.
 * @param name - The repository.
 * @returns The row, or null.
 */
export async function mirroredRepository(
  context: BrowserContext,
  tenantId: string,
  login: string,
  name: string,
): Promise<MirroredRepository | null> {
  const { status, body } = await readAs<MirroredRepository>(
    context,
    `/api/v1/orgs/${tenantId}/github-orgs/${login}/repos/${name}`,
  );

  if (status === 404) return null;
  if (status !== 200 || body === null) {
    throw new Error(`reading the mirrored repository ${login}/${name} answered ${String(status)}`);
  }

  return body;
}

/**
 * Sync one ticket source now — the canonical backlog's chain, which is what gives the picked
 * issue the ticket the launch queues and the driver opens for.
 *
 * @param context - A signed-in context.
 * @param id - The source.
 * @returns When the cycle has finished.
 */
export async function syncSource(context: BrowserContext, id: string): Promise<void> {
  await requestAs(context, "POST", `/api/v1/sources/${id}/sync`, {}, `syncing the source ${id}`);
}

/**
 * How many issues the workspace's queue holds — the whole match, not the dashboard card's head.
 *
 * @param context - A signed-in context.
 * @returns The total.
 */
export async function queueTotal(context: BrowserContext): Promise<number> {
  const page = await requestAs<{ total: number }>(
    context,
    "GET",
    "/api/v1/queue?limit=1",
    null,
    "reading the queue's total",
  );

  return page?.total ?? 0;
}

/** The dry-run policy, as far as this leg reads it. */
export interface DryRunPolicy {
  readonly dryRun: boolean;
  readonly explicit: boolean;
  readonly reason: string | null;
}

/**
 * The workspace's dry-run policy.
 *
 * @param context - A signed-in context.
 * @returns The policy.
 */
export async function dryRunPolicy(context: BrowserContext): Promise<DryRunPolicy> {
  const policy = await requestAs<DryRunPolicy>(
    context,
    "GET",
    "/api/v1/policies/dry-run",
    null,
    "reading the dry-run policy",
  );

  if (policy === null) throw new Error("the dry-run policy answered no body");

  return policy;
}

/**
 * Put dry-run back where the merge legs need it — **off**.
 *
 * The seed's own state is *never set* (`org_policies.dry_run` null), which no route can write
 * back: the policy takes `true` or `false`. Off is what every leg that arms a merge needs, so it
 * is what a `--keep` stack gets; the one difference from the seed is that the wizard's safety
 * row would read *off — turn it on* rather than *running your first loop turns it on*.
 *
 * @param context - A signed-in context, an owner's or an admin's.
 * @returns When the restore has been attempted. It never throws — see `support/rest.ts`.
 */
export function restoreDryRun(context: BrowserContext): Promise<void> {
  return quietly(async () => {
    await requestAs(
      context,
      "PATCH",
      "/api/v1/policies/dry-run",
      { dryRun: false },
      "turning dry-run back off",
    );
  }, "dry-run was not turned back off — the PR verification and inbox legs' merges are refused while it is on.");
}

/**
 * Pause a ticket source — the chain's, in teardown, so the sync loop stops walking a repository
 * nothing else reads.
 *
 * @param context - A signed-in context.
 * @param id - The source.
 * @returns When the pause has been attempted. It never throws.
 */
export function pauseSource(context: BrowserContext, id: string): Promise<void> {
  return quietly(async () => {
    await requestAs(
      context,
      "PATCH",
      `/api/v1/sources/${id}`,
      { status: "paused" },
      "pausing the chain's source",
    );
  }, "the chain's source was not paused — the sync loop keeps reading helios-bootloader on this stack.");
}

/* ------------------------------------------------------------------ a fresh workspace */

/** What `POST /api/auth/organization/create` answers, as far as this leg reads it. */
interface CreatedOrganization {
  readonly id: string;
  readonly slug: string;
}

/**
 * Create a workspace of the leg's own and enter it — the one place the dashboard's offer can be
 * seen: BB.2's fresh-org rule offers the wizard only where no run has ever happened and no
 * repository's wizard was finished, which no seeded workspace is.
 *
 * @param context - The context to act for. Signed in here, as the seeded owner.
 * @param label - A short word for the slug.
 * @returns The workspace's id and slug.
 * @throws {Error} If the service refused the create, with what it answered.
 */
export async function enterFreshWorkspace(
  context: BrowserContext,
  label: string,
): Promise<CreatedOrganization> {
  await signIn(context, SEED_OWNER.id);

  const slug = ephemeralSlug(`wizard-${label}`);
  const created = await requestAs<CreatedOrganization>(
    context,
    "POST",
    `${AUTH_BASE_PATH}/organization/create`,
    { name: `E2E Wizard ${label}`, slug },
    `creating the fresh workspace ${slug}`,
  );

  if (created?.slug !== slug) {
    throw new Error(`creating ${slug} answered a workspace called ${String(created?.slug)}`);
  }

  await selectWorkspace(context, slug);

  return created;
}

/**
 * Record a GitHub account and one repository in a workspace's mirror, both enabled — the tenancy
 * API's own writes, so the fresh workspace has a repository for the offer to name.
 *
 * @param context - A signed-in context, an owner's.
 * @param tenantId - The workspace.
 * @param login - The account.
 * @param name - The repository.
 * @returns When both rows are stored.
 */
export async function recordRepository(
  context: BrowserContext,
  tenantId: string,
  login: string,
  name: string,
): Promise<void> {
  await requestAs(
    context,
    "POST",
    `/api/v1/orgs/${tenantId}/github-orgs`,
    { login, enabled: true },
    `recording the account ${login}`,
  );
  await requestAs(
    context,
    "PATCH",
    `/api/v1/orgs/${tenantId}/github-orgs/${login}/repos/${name}`,
    { enabled: true },
    `recording the repository ${login}/${name}`,
  );
}
