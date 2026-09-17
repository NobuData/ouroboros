/**
 * What mockup 09 renders against the planning seed, what the sandbox tracker is asked, and
 * what the planning leg leaves behind ([#288](https://github.com/NobuData/ouroboros/issues/288),
 * AM.6).
 *
 * Three jobs, and they are here together because they are one subject — the longest chain in
 * the product, from an outline to real issues and back:
 *
 *   1. **The seed's figures**, copied on purpose the way `support/dashboard.ts` copies
 *      `R__dev_seed_dashboard.sql`'s. `R__dev_seed_ticket_planning.sql` (AK.4,
 *      [#275](https://github.com/NobuData/ouroboros/issues/275)) is mockup 09 as rows, and this
 *      is what those rows render as. Every number below is one the page *computes* — the seed
 *      file stores none of them and its own tests refuse them — so a figure that moved here is
 *      an aggregate that changed, which is the thing worth being told about.
 *   2. **The sandbox tracker**, as a client. `tests/e2e/fixtures/tracker-stub/server.mjs` is a
 *      GitHub that will really create issues; {@link tracker} is how the leg asks it what it
 *      holds, which is the acceptance criterion's *verified through the tracker API rather than
 *      the UI*.
 *   3. **What the leg writes**, and the one thing it can honestly put back.
 *
 * ## What this leg writes, and why only one of it is restorable
 *
 * The chain writes more than any leg in the suite, and almost none of it has an undo on the
 * API — by design rather than by omission:
 *
 * | Written | Undone by | Why not |
 * |---|---|---|
 * | issues, milestones, relations in the tracker | {@link resetTracker} | — |
 * | the workspace's GitHub token | {@link clearGithubToken} | — |
 * | `ticket_drafts.push_state`, the batch's status | *nothing* | a push is not reversible: the issues exist |
 * | canonical `tickets` + `ticket_dependencies` | *nothing* | a sync's mirror is not a thing a caller deletes |
 * | the intake mirror and its estimates | *nothing* | `github_issues` has no delete route, and estimates are append-only |
 * | one queue row | *nothing* | `POST /backlog/queue` is a write with no counterpart (decision K9) |
 *
 * So this leg takes leg 11's position, for leg 11's reason (`support/issues.ts`, and the
 * suite README's § *Refreshing them*): **it does not pretend to clean up**, and it is green
 * from a cold volume. A second run against the same stack finds the seeded batch already
 * pushed and the parity group red by design, which `docker compose down -v` fixes and CI never
 * meets, because CI always starts cold.
 *
 * The tracker is reset anyway, and that is not a contradiction: it is the suite's own fixture,
 * it is the one place a *duplicate* would hide, and a leg that asserts *exactly these issues
 * and not one more* has to know what was there before it started.
 */

import type { APIRequestContext, BrowserContext } from "@playwright/test";

import { requestAs } from "./rest";
import { TRACKER_URL } from "./stack";

/* ------------------------------------------------------------------ the page */

/** Where the planning page is. */
export const PLANNING_PATH = "/planning";

/**
 * The planning page, opened on one batch.
 *
 * @param batchId - The batch to open — `?batch=` is AM.2's address for the generator card's
 *   open batch, so a leg can arrive at the seeded one instead of pressing **Draft tickets**.
 * @returns The path with its query.
 */
export function planningPathFor(batchId: string): string {
  return `${PLANNING_PATH}?batch=${batchId}`;
}

/** The page's eyebrow, heading and subline, verbatim from `docs/mockups/09-planning.html`. */
export const PLANNING_HEAD = {
  eyebrow: "Planning",
  title: "Describe the work. Ouroboros writes the tickets.",
  subline:
    "Draft epics and tickets straight into GitHub Issues, Jira, or Linear — sized by the " +
    "estimator, wired with dependencies, and queued for the loop the moment you approve them.",
} as const;

/* ------------------------------------------------------------------ the four cards */

/**
 * The *Tracker sync* card, as the seed's two sources and one absent kind render it.
 *
 * The cadence tag is `pollIntervalSeconds` spelled in the largest unit that divides evenly, and
 * `DEFAULT_BACKLOG_SYNC_INTERVAL_SECONDS` is 300 — so `every 5m` is *the deployment's real
 * configuration reaching the page*, which is the only thing about this tag worth asserting. The
 * compose override deliberately does not move it; `docker-compose.e2e.yml` says why.
 *
 * The Jira row is the file's point, as it is the seed's: a connected source of a kind this build
 * registers **no provider for**, which is `not syncing · 0 issues` beside an `idle` ring rather
 * than an error. Linear is connected by nobody, so it is the row with **connect ↗**.
 */
export const SEEDED_SYNC = {
  title: "Tracker sync",
  cadence: "every 5m",
  rows: [
    { name: "GitHub · acme-robotics", sub: "two-way sync · 42 issues", state: "ok" },
    { name: "Jira · PROJ", sub: "not syncing · 0 issues", state: "idle" },
    { name: "Linear", sub: "not connected", state: "idle" },
  ],
  connect: "connect ↗",
} as const;

/**
 * The *Backlog health* card's tag and three meters.
 *
 * Every one of the four figures is an aggregate the seed shaped a near-miss into, and the seed's
 * own header names each: `count(*)` over the dependency edges reads 6 where *Blocked* is 4, a
 * stale count that forgot `state = 'open'` reads 14 where it is 6, and a sized count that forgot
 * it reads 48/52 where it is 38/42. A leg asserting these four is asserting that four `where`
 * clauses are still what they were.
 */
export const SEEDED_HEALTH = {
  title: "Backlog health",
  open: "42 open",
  meters: [
    { label: "Sized", value: "38/42" },
    { label: "Blocked", value: "4" },
    { label: "Stale > 30d", value: "6" },
  ],
  footnote: "Estimator re-runs nightly on unsized issues.",
} as const;

/**
 * The *Roadmap* card's title and its five lanes, in `sort_order`.
 *
 * The chips are `planning_epic_progress` over `epic_tickets`, and the seed links contiguous
 * number ranges so each is a different count — a chip computed over the *source* rather than
 * through the link table would be 42 on every lane, which is the mistake the fifth lane also
 * catches: Zephyr has no tickets and no months, so it is `unscoped` and carries its `proposed`
 * status in its accessible name.
 *
 * The window tag is not here. `roadmap_window` is computed from `now()` at migration time
 * (`Q3–Q4 2026`), so it is a *fact about when the volume was seeded* rather than about the
 * fixture — the leg asserts its shape instead.
 */
export const SEEDED_ROADMAP = {
  title: "Roadmap — Helios 2.1",
  windowPattern: /^Q[1-4](?: \d{4})?–Q[1-4] \d{4}$/,
  lanes: [
    { name: "OTA hardening", chip: "12 issues · 8 done" },
    { name: "BLE provisioning v2", chip: "9 issues · 2 done" },
    { name: "Motor control refactor", chip: "14 issues · 0 done" },
    { name: "Fleet telemetry dashboard", chip: "7 issues · 0 done" },
    { name: "Zephyr 4.2 migration", chip: "unscoped" },
  ],
  footnote: "Bars are epics; Ouroboros keeps them in sync with the trackers.",
} as const;

/* ------------------------------------------------------------------ the seeded batch */

/**
 * The OTA batch — one press of *Generate tickets*, as the seed froze it.
 *
 * This is the **parity group's** batch, opened by its `?batch=` address, and it is where every
 * figure the generator card prints is asserted: the six rows in the mockup's order, the four
 * dependency notes the seed's edges become, the effort chips its six estimate rows carry, the
 * `✓ all sized` pill and the push button's count. It is deliberately not the batch the chain
 * pushes — see {@link PUSH_CHAIN}, and the spec's header for the argument.
 *
 * Efforts are the mockup's chips as `EffortChip` writes them: lower case in the markup, and upper
 * case only because the stylesheet says so. Asserting the letters is asserting that six
 * `issue_estimates` rows reached a page through `draft_id`, which is decision N3's *one sizer,
 * one table* seen from the outside.
 */
export const SEEDED_BATCH = {
  /** `draft_batches.id` — the address the page is opened on. */
  id: "5eed0021-0000-4000-8000-000000000001",
  /** Its six drafts, in local-key order, with the effort each carries an estimate for. */
  drafts: [
    { key: "OTA-1", title: "Partition table & bootloader slot flag for A/B scheme", effort: "l" },
    { key: "OTA-2", title: "SHA-256 checksum verification before slot swap", effort: "m" },
    { key: "OTA-3", title: "Rollback state machine on failed boot confirmation", effort: "l" },
    { key: "OTA-4", title: "BLE recovery beacon when both slots fail checksum", effort: "m" },
    {
      key: "OTA-5",
      title: "Power-loss integration tests on HIL rig (kill power mid-flash)",
      effort: "m",
    },
    { key: "OTA-6", title: "Operator docs: recovery procedure & beacon pairing", effort: "xs" },
  ],
  /** The draft edges, blocker to blocked — what the push turns into native dependencies. */
  edges: [
    { blocker: "OTA-1", blocked: "OTA-3" },
    { blocker: "OTA-2", blocked: "OTA-3" },
    { blocker: "OTA-3", blocked: "OTA-5" },
    { blocker: "OTA-4", blocked: "OTA-5" },
  ],
  /** The heading over the rows. */
  heading: "6 drafts",
  /**
   * The pill beside it once every draft has an estimate.
   *
   * The chain asserts this too, on its *own* batch — which is why it is here rather than in the
   * spec: it is what the card says when six `issue_estimates` rows have reached it, and both
   * batches have to be able to say it.
   */
  allSized: "✓ all sized",
} as const;

/* ------------------------------------------------------------------ the push chain */

/**
 * The chain's one number, and the argument for it.
 *
 * The chain drives a batch the *card* made — the spec's own `CHAIN` outline, six bullets with
 * `blocks:` annotations — rather than the seeded OTA batch, because the seeded one carries
 * **Queue XS/S** off (as the mockup's toggles do) and no route turns a stored batch's toggle on.
 * Everything else about the batch is therefore the spec's, and only this is here, because it is
 * a fact about `push.service.ts` rather than about the outline.
 *
 * **{@link refuseAfter} is 4.** A push creates the epic's parent issue first and then the drafts
 * in `pushOrder`'s order — blockers first, smallest local key among the ready — which for the
 * five selected drafts is `OTA-1`, `OTA-2`, `OTA-3`, `OTA-5`, `OTA-6`. Letting four creations
 * through therefore refuses **`OTA-5`**, and the walk carries on to `OTA-6`, because a refusal is
 * about one draft and does not stop the walk (`push.service.ts` § *Why a throttle stops the walk
 * and a refusal does not*). That is what leaves the sync between the two pushes something small
 * and already-filed to size — which is what queue-small needs on the resume, and the whole reason
 * the ticket's *main chain* and its *push-resume* leg are one traversal here.
 *
 * Refusing later would refuse `OTA-6`, the batch's smallest draft, and the resume would then
 * create it and find it — correctly — not yet mirrored; refusing earlier would refuse a blocker
 * and take its dependents with it. Four is the only position that leaves both halves of the
 * chain something to assert.
 */
export const PUSH_CHAIN = {
  /** How many creations the sandbox lets through before it refuses one — see the note above. */
  refuseAfter: 4,
} as const;

/**
 * The efforts **Queue XS/S tickets immediately** queues, as the effort chip spells them.
 *
 * Restated rather than imported — nothing in this directory may import a module's source — and
 * lower case because that is what is in the markup: `EffortChip` writes the effort the service
 * sent, and the upper case on screen is the stylesheet's.
 */
export const SMALL_EFFORTS: readonly string[] = ["xs", "s"];

/** Where a push into the seeded GitHub source lands — `pushTarget` takes the first enabled repo. */
export const PUSH_TARGET = { owner: "acme-robotics", repo: "helios-firmware" } as const;

/** `R__dev_seed_sources.sql`'s GitHub row — the source the batch targets and the leg syncs. */
export const SEEDED_GITHUB_SOURCE_ID = "5eed001a-0000-4000-8000-000000000001";

/**
 * A GitHub token the workspace's settings surface will accept.
 *
 * `github.token.ts` refuses anything that is not shaped like one, and it is right to: the value
 * it protects against is a paste error, not a forgery. This is a legal `ghp_` classic token of
 * the right length and it is not a credential — the sandbox tracker accepts any token at all
 * and there is no account behind this one anywhere.
 *
 * It is needed because the **intake** mirror (K.4) authenticates as the workspace rather than as
 * a source: the canonical mirror uses the source's own sealed credential, which the seed already
 * writes, and the two are deliberately different chains.
 */
export const SANDBOX_GITHUB_TOKEN = `ghp_${"e2e288planningsandboxtoken".padEnd(36, "0")}`;

/* ------------------------------------------------------------------ asking the tracker */

/** One issue, as the sandbox tracker answers it. */
export interface TrackerIssue {
  /** GitHub's database id — what the relation routes take. */
  readonly id: number;
  /** The number a person and a `#key` use. */
  readonly number: number;
  /** The title, as filed. */
  readonly title: string;
  /** The body, including the provenance footer and the push-key marker. */
  readonly body: string | null;
  /** `open` or `closed`. */
  readonly state: string;
}

/**
 * Ask the sandbox tracker something, as any client of a GitHub would.
 *
 * Playwright's request context rather than `fetch`, for `support/api.ts`'s reason: one runner
 * owns the suite, so a failure here is annotated beside the browser assertions rather than
 * being a bare rejection.
 *
 * @param request - Playwright's request context.
 * @param path - The path, beginning with a slash.
 * @returns The parsed answer.
 * @throws When the tracker refused, with its own message.
 */
async function askTracker<Answer>(request: APIRequestContext, path: string): Promise<Answer> {
  // Any credential is accepted and none is a secret; what matters is that one is sent, because
  // the tracker refuses an anonymous caller exactly as GitHub does.
  const response = await request
    .get(`${TRACKER_URL}${path}`, { headers: { authorization: `Bearer ${SANDBOX_GITHUB_TOKEN}` } })
    .catch((reason: unknown) => {
      throw new Error(`the sandbox tracker is not answering at ${TRACKER_URL}: ${String(reason)}`);
    });

  if (!response.ok()) {
    throw new Error(`the sandbox tracker answered ${response.status().toString()} for ${path}`);
  }

  return (await response.json()) as Answer;
}

/**
 * The sandbox tracker, as the leg talks to it.
 *
 * @param request - Playwright's request context.
 * @returns The four questions and the two controls the leg needs.
 */
export function tracker(request: APIRequestContext) {
  const repo = `/repos/${PUSH_TARGET.owner}/${PUSH_TARGET.repo}`;

  return {
    /**
     * Every issue the push target holds, newest first.
     *
     * @returns The issues. `per_page=100` because *exactly six and not one more* is a claim
     *   about the whole repository rather than about its first page.
     */
    issues: (): Promise<TrackerIssue[]> =>
      askTracker(request, `${repo}/issues?state=all&sort=created&direction=asc&per_page=100`),

    /**
     * What one issue is blocked by, natively.
     *
     * @param issueNumber - The blocked issue.
     * @returns Its blockers.
     */
    blockedBy: (issueNumber: number): Promise<TrackerIssue[]> =>
      askTracker(request, `${repo}/issues/${String(issueNumber)}/dependencies/blocked_by`),

    /**
     * An epic parent's sub-issues.
     *
     * @param issueNumber - The parent.
     * @returns Its children.
     */
    subIssues: (issueNumber: number): Promise<TrackerIssue[]> =>
      askTracker(request, `${repo}/issues/${String(issueNumber)}/sub_issues`),

    /**
     * The repository's open milestones.
     *
     * @returns Each milestone's title.
     */
    milestones: (): Promise<{ title: string }[]> =>
      askTracker(request, `${repo}/milestones?state=all`),
  };
}

/**
 * Empty the sandbox tracker back to its four repositories.
 *
 * @param request - Playwright's request context.
 * @returns When it is empty.
 */
export async function resetTracker(request: APIRequestContext): Promise<void> {
  await control(request, "reset", {});
}

/**
 * Arm the sandbox to refuse one issue creation, after letting `after` of them through.
 *
 * @param request - Playwright's request context.
 * @param after - How many creations succeed first. See {@link PUSH_CHAIN}'s note on why it is
 *   a count rather than a draft key.
 * @returns When it is armed.
 */
export async function refuseOneCreate(request: APIRequestContext, after: number): Promise<void> {
  await control(request, "refuse-creates", { after });
}

/**
 * Press one of the sandbox's own two controls.
 *
 * The failure message is the reason this is a function rather than two call sites: a tracker
 * that is not running throws at the socket, and `scripts/verify-failure-modes.sh` requires the
 * broken layer to be **named** in the output rather than left as a connection error against a
 * port number. So both ways of not working — no answer, and a refusal — say *the sandbox
 * tracker*, which is the layer a person reading a CI log needs to be told about.
 *
 * @param request - Playwright's request context.
 * @param control - `reset` or `refuse-creates`.
 * @param body - What to send.
 * @returns When it has been pressed.
 * @throws When the tracker is not answering, or refused.
 */
async function control(
  request: APIRequestContext,
  control: string,
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  const response = await request
    .post(`${TRACKER_URL}/__sandbox/${control}`, { data: body })
    .catch((reason: unknown) => {
      throw new Error(`the sandbox tracker is not answering at ${TRACKER_URL}: ${String(reason)}`);
    });

  if (!response.ok()) {
    throw new Error(`the sandbox tracker refused ${control}: ${response.status().toString()}`);
  }
}

/**
 * The epic's parent tracking issue — the one issue in the repository no draft made.
 *
 * `ensureEpicContainer` marks it `<!-- ouroboros:epic <id> -->` and titles it with the lane's
 * name, and that marker is what tells it apart from a pushed draft: a title match alone would
 * find a draft somebody happened to name after the epic.
 *
 * @param issues - What the tracker holds.
 * @returns The parent issue, or undefined.
 */
export function epicParentIssue(issues: readonly TrackerIssue[]): TrackerIssue | undefined {
  return issues.find((issue) => (issue.body ?? "").includes("<!-- ouroboros:epic "));
}

/* ------------------------------------------------------------------ driving the two syncs */

/**
 * Sync the canonical backlog from the tracker — WF-Q's own loop, asked to run now.
 *
 * M.4's *sync now* ([#113](https://github.com/NobuData/ouroboros/issues/113)) for a ticket
 * source. What it proves is the claim the ticket calls *sync-back*: an issue the push service
 * filed is not a special object, and an ordinary sync **adopts** the row rather than filing a
 * second one beside it.
 *
 * @param context - A signed-in context.
 * @returns When the cycle has finished.
 */
export async function syncCanonicalBacklog(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "POST",
    `/api/v1/sources/${SEEDED_GITHUB_SOURCE_ID}/sync`,
    {},
    "syncing the seeded GitHub source",
  );
}

/**
 * Sync the intake mirror from the tracker — K.4's loop, asked to run now.
 *
 * The *other* sync, and the leg needs both because they are two chains with two credentials:
 * this one authenticates as the workspace and fills `github_issues`, which is the backlog
 * mockup 03 draws and the only table INTAKE-M.3 will queue from.
 *
 * @param context - A signed-in context.
 * @returns When the cycle has finished.
 */
export async function syncIntakeMirror(context: BrowserContext): Promise<void> {
  await requestAs(context, "POST", "/api/v1/backlog/sync", {}, "syncing the intake mirror");
}

/**
 * Give the workspace a GitHub token, so the intake mirror has a credential to sync with.
 *
 * @param context - A signed-in context.
 * @returns When it is stored.
 */
export async function setGithubToken(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "PUT",
    "/api/v1/settings/github-token",
    { token: SANDBOX_GITHUB_TOKEN },
    "storing the sandbox GitHub token",
  );
}

/**
 * Take it away again — the seed's state, which is *no token at all*.
 *
 * The one write of this leg's that would be visible to another: `specs/issues.spec.ts` asserts
 * the intake page's *sync paused (unauthorized)* guidance, which is what a workspace with no
 * token is told.
 *
 * @param context - A signed-in context.
 * @returns When it is gone.
 */
export async function clearGithubToken(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "DELETE",
    "/api/v1/settings/github-token",
    null,
    "removing the sandbox GitHub token",
  );
}

/* ------------------------------------------------------------------ the member's page */

/**
 * What a `member` is told about the two things they may not do.
 *
 * The seeded member may **draft** and may not **push**, which is AM.5's split and the sharpest
 * thing about it: the two controls sit in the same card, so a guard that read *member* as *may
 * not act* would take both. The sentences are `generator.ts`'s.
 */
export const MEMBER_LIMITS = {
  /** Why **Push … to GitHub →** is inert — `generator.ts`'s `PUSH_ROLE_REASON`. */
  push: "Pushing to a tracker is for workspace owners and admins.",
  /** …and what the epic editor tells a member who opened a lane — `epic-draft.ts`'s note. */
  roadmap: "You can read this epic. Changing the roadmap is for workspace owners and admins.",
  /** …and why **New roadmap** is — `view.ts`'s `NEW_ROADMAP_ROLE_REASON`. */
  newRoadmap: "Planning a roadmap is for workspace owners and admins.",
} as const;
