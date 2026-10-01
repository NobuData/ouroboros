/**
 * What the knowledge leg (`specs/knowledge.spec.ts`) knows about the stack it runs against, and
 * the few things it does beneath the browser
 * ([#422](https://github.com/NobuData/ouroboros/issues/422), BG.6).
 *
 * ## Two workspaces, because no seeded one is both cold and able to run a loop
 *
 * The issue's chain opens *cold org → import …* and closes *… → run on issue → queue*. No seeded
 * workspace can do both, and the seed is right not to be able to:
 *
 * | Workspace | Knowledge | Workflow, routes, runs |
 * |---|---|---|
 * | `acme-onboarding` ({@link COLD_TENANT}) | none — it is mockup 13's wizard, mid-flight | none: `R__dev_seed_onboarding.sql` seeds no workflow, route or provider, and `tests/seed.sql` holds it to that |
 * | `acme-robotics` (`SEED_TENANT`) | mockup 14's six skills, five facts and three recipes | all of it — the workspace every other mockup is drawn in |
 *
 * So the leg is split along that line. **What a new org sees** is asserted where a new org is —
 * `acme-onboarding`, every empty and cold state, in both palettes. **The chain** runs in
 * `acme-robotics`, the one workspace with an estimator route to size an issue, a published
 * workflow to pin and a finished run to learn a playbook from; it imports from a repository the
 * seed holds no knowledge for ({@link IMPORT_REPO}), so what it imports is all that repository has.
 *
 * ## What this leg writes, and why it is green from a cold volume only
 *
 * The planning leg's position (`support/planning.ts`), for its reason: these are writes the
 * product has no undo for, so the leg does not pretend to clean up.
 *
 * | Write | Undone by | Why not |
 * |---|---|---|
 * | a credential on the seeded GitHub source | nothing | a credential is write-only; the seed's is a placeholder that cannot be opened, and an import reads the host with the source's |
 * | three skill drafts, five fact candidates, one confirmed | nothing | an import has no un-import, and a confirmed fact's audit is append-only |
 * | a sandbox issue, its estimate, a queue row | the issue is **closed** in teardown | estimates are append-only and the queue has no remove |
 * | a playbook | nothing | deliberately left: its queue row names it |
 * | the workspace's GitHub token | **removed** in teardown | — the intake leg asserts the page a workspace with none is shown |
 * | `pr-etiquette` switched off | **switched back on** in the test, and again in teardown | — |
 * | a refused repo-map generation in `acme-onboarding` | nothing | every generation is audited, and the audit is append-only |
 *
 * `docker compose down -v` is the fix for a stack that has already run it, and the spec's
 * `beforeAll` says so in words. CI always starts cold.
 *
 * ## The assertions made beneath the browser, and why this leg makes them
 *
 * `support/rest.ts` says reading in order to *assert* is the browser's job in this directory,
 * and it is — a leg that checked a payload would pass while the page drew nothing. This leg
 * makes two such reads anyway, because the issue asks for exactly them and no page can show
 * either:
 *
 *   * **what the estimator was sent** — read from `fixtures/engine-tap`, the wire between `rest`
 *     and the engine ({@link estimateRequestFor}). The page's claim is *confirmed facts are
 *     injected into every run's context*; this is where it is true or not.
 *   * **what the queue holds** — `GET /api/v1/queue`, the playbook the row names and the pin it
 *     will run under ({@link queuedItem}), and the context that playbook attaches.
 *
 * Both are read *after* the browser has done the thing — confirmed the fact, pressed Queue — so
 * each is the other half of a browser assertion and never a substitute for one.
 */

import type { APIRequestContext, BrowserContext } from "@playwright/test";

import { SANDBOX_GITHUB_TOKEN, SEEDED_GITHUB_SOURCE_ID } from "./planning";
import { requestAs } from "./rest";
import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL, TAP_URL, TRACKER_URL } from "./stack";

/** The page. */
export const KNOWLEDGE_PATH = "/knowledge";

/* ------------------------------------------------------------------ the cold workspace */

/**
 * The workspace with no knowledge at all — `R__dev_seed_onboarding.sql`'s, mockup 13's wizard at
 * step 3 for a new owner. Ken is its owner and its only member.
 */
export const COLD_TENANT = {
  /** The handle the tenant chip draws. */
  slug: "acme-onboarding",
  /** Its two enabled repositories, as the repo-map status spells them — lower-case, by name. */
  repos: ["acme-robotics/helios-console", "acme-robotics/helios-firmware"],
  /**
   * The repository the leg asks the generator to map. Its source's credential is the seed's
   * placeholder, which cannot be opened — so the host is never reached and the generation is
   * refused, for real, with nothing arranged.
   */
  generated: "acme-robotics/helios-firmware",
} as const;

/** What each card of a workspace with no knowledge says — `ouroboros-ui/app/knowledge`'s own sentences. */
export const COLD = {
  skills: {
    title: "No skills yet.",
    /** The sentence that says what a skill is, before any action is offered. */
    explainer:
      "A skill is a page of instructions in markdown — conventions, safety rules, how this repository " +
      "is built — that the loop is handed at the start of every run in its scope.",
    actions: "Add the first skill",
  },
  facts: {
    title: "Nothing learned yet.",
    /** The issue's own words: the state explains the model. */
    lead: "The loop proposes facts as it works",
  },
  playbooks: { title: "No playbooks yet.", create: "+ New playbook from a past run…" },
  recipe: { title: "No environment recipe yet.", add: "Add environment recipe" },
  scope: "No skills yet. Each step counts up as skills are written or imported and switched on.",
  maps: {
    name: "Repository maps not generated yet",
    pending: "pending first generation",
    failed: "generation failed",
    /** What pending means — said once, under the rows it is true of. */
    pendingNote:
      "Pending is not broken: the nightly job has not come round to that repository yet.",
    /** Why the leg's generation is refused: the placeholder credential cannot reach the host. */
    failedNote: "The host refused the read on a run on request",
  },
} as const;

/* ------------------------------------------------------------------ the import */

/**
 * The repository the chain imports from — `fixtures/tracker-stub/repos/acme-robotics/helios-console`,
 * a `CLAUDE.md` and a `.cursorrules`. Enabled in `acme-robotics`, and the seed holds no skill or
 * fact for it, so what the import writes is everything it has.
 */
export const IMPORT_REPO = "acme-robotics/helios-console";

/**
 * What the fixture files parse to — written down rather than computed, because a parser that
 * changed its mind should turn this leg red, not be followed by it. BF.4's rules
 * (`rule-import.parse.ts`): a skill draft per repeated-level section, or per file with no
 * headings; a fact candidate per imperative bullet.
 */
export const IMPORT = {
  /** The preview's files table, one line per file probed, in the service's order. */
  files: [
    ["CLAUDE.md", "2 skill drafts · 3 fact candidates"],
    ["AGENTS.md", "not found"],
    [".cursorrules", "1 skill draft · 2 fact candidates"],
    [".github/copilot-instructions.md", "not found"],
  ],
  /** The preview's totals line. */
  totals: "3 skill drafts · 5 fact candidates",
  /** The toast an apply leaves. */
  toast: `Imported 3 skill drafts and 5 fact candidates from ${IMPORT_REPO}. Nothing is enabled yet.`,
  /** The drafts, by slug — two sections of `CLAUDE.md`, and `.cursorrules` whole. */
  drafts: ["pairing-flow", "telemetry-charts", "cursorrules"],
  /** The candidates, in the files' order. */
  facts: [
    "Always debounce pairing requests by 300 ms.",
    "Never store a pairing key in localStorage.",
    "Use the useSeries hook for every chart.",
    "Write a Playwright test for every new screen.",
    "Keep components under 200 lines.",
  ],
} as const;

/** The candidate the leg confirms, and then follows to the estimator. */
export const CONFIRMED_FACT = "Never store a pairing key in localStorage.";

/* ------------------------------------------------------------------ the seeded page */

/**
 * The repository mockup 14's profile card draws — the one the seed wrote an environment recipe
 * for. The card draws the first enabled repository unless the address names one, and
 * alphabetically that is `atlas-scheduler`, which has none.
 */
export const PROFILE_REPO = "acme-robotics/helios-firmware";

/** What mockup 14's page draws for the seeded workspace before the chain touches it. */
export const SEEDED = {
  /** The skills table's six rows, in the service's order — by slug. */
  skills: [
    "commit-style",
    "hil-safety",
    "power-budget-checks",
    "pr-etiquette",
    "repo-map",
    "zephyr-conventions",
  ],
  /** The head's count: five, because a draft is never active. */
  active: "5 active",
  /** The facts card's chip. */
  awaiting: "2 awaiting review",
  /** The playbooks card's chip. */
  recipes: "3 recipes",
  /**
   * The three enabled repositories whose `repo-map` has not generated — the seed generates
   * `helios-firmware`'s and nobody has asked for the others'.
   */
  pendingMaps: [
    "acme-robotics/atlas-scheduler",
    "acme-robotics/helios-console",
    "acme-robotics/helios-telemetry",
  ],
} as const;

/**
 * The org-wide skill the chain switches off and on again. Org-wide, so it resolves for
 * {@link IMPORT_REPO}; not required, so the service lets it move.
 */
export const TOGGLED_SKILL = { slug: "pr-etiquette", inForce: "pr-etiquette@v4" } as const;

/**
 * The finished run a playbook is learned from — `#471`, the one terminal run the seed gives a
 * workflow pin (`R__dev_seed_workspace_knowledge.sql`, decision 8). `#474` is the newest finished
 * run and has none, which is what every run but this one says.
 */
export const SOURCE_RUN = {
  number: 471,
  title: "Unit tests for motor PID edge cases",
  pin: "standard-fix v14",
  workflow: { slug: "standard-fix", version: 14 },
  /** The newest finished run, which has no pin — the refusal the dialog draws for it. */
  unpinned: {
    number: 474,
    refusal: "This run has no published workflow version a playbook could pin.",
  },
} as const;

/** The playbook the chain creates. */
export const PLAYBOOK_NAME = "Pairing regression hunt";

/* ------------------------------------------------------------------ arranging */

/**
 * Give the seeded GitHub source a credential the vault can open, as a person connecting it under
 * Settings → Sources would.
 *
 * The seed's is a placeholder on purpose (`R__dev_seed_sources.sql`) and cannot be opened, so an
 * import — which reads the host as the source — is refused `knowledge_import_source_failed`
 * until one is stored. The sandbox tracker accepts any token; this is the planning leg's, which
 * is shaped like one and is not a credential.
 *
 * @param context - A context signed in as an owner of the seeded workspace.
 * @returns When it is stored.
 */
export async function connectSeededSource(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "POST",
    `/api/v1/sources/${SEEDED_GITHUB_SOURCE_ID}/credentials`,
    { secret: SANDBOX_GITHUB_TOKEN },
    "connecting the seeded GitHub source",
  );
}

/** One issue, as the sandbox tracker answers it. */
export interface SandboxIssue {
  /** The number a person and a `#key` use. */
  readonly number: number;
  /** The title, as filed. */
  readonly title: string;
}

/** The issue the chain files: something a person would report against the console's pairing screen. */
export const SANDBOX_ISSUE = {
  title: "Pairing screen stores the key before the device confirms",
  body:
    "The pairing screen writes the key as soon as the user taps Pair. If the device rejects the " +
    "pairing the key is left behind.\n\nSteps: start pairing, cancel on the device, reopen the console.",
  labels: ["bug"],
} as const;

/**
 * Talk to the sandbox tracker about {@link IMPORT_REPO}'s issues, as a person filing one on the
 * host would.
 *
 * @param request - Playwright's request context.
 * @param method - `POST` to file, `PATCH` to change.
 * @param path - The path under the repository's issues, beginning with a slash, or empty.
 * @param data - The document to send.
 * @returns The issue the tracker answered with.
 * @throws When the tracker did not answer, or refused — saying which.
 */
async function writeIssue(
  request: APIRequestContext,
  method: "POST" | "PATCH",
  path: string,
  data: Readonly<Record<string, unknown>>,
): Promise<SandboxIssue> {
  const url = `${TRACKER_URL}/repos/${IMPORT_REPO}/issues${path}`;
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

  return (await response.json()) as SandboxIssue;
}

/**
 * File {@link SANDBOX_ISSUE} on the host.
 *
 * In {@link IMPORT_REPO}, whose numbers begin at 9500 — clear of the planning leg's 9000s in
 * `helios-firmware`, because the queue is keyed by workspace and issue number
 * (`fixtures/tracker-stub/server.mjs` § *Each repository numbers from its own range*).
 *
 * @param request - Playwright's request context.
 * @returns The issue, with the number the tracker assigned.
 */
export function fileSandboxIssue(request: APIRequestContext): Promise<SandboxIssue> {
  return writeIssue(request, "POST", "", SANDBOX_ISSUE);
}

/**
 * Close the issue on the host, so no later sync of the tracker adopts it as open work.
 *
 * @param request - Playwright's request context.
 * @param issueNumber - The issue.
 * @returns When it is closed.
 */
export async function closeSandboxIssue(
  request: APIRequestContext,
  issueNumber: number,
): Promise<void> {
  await writeIssue(request, "PATCH", `/${String(issueNumber)}`, { state: "closed" });
}

/* ------------------------------------------------------------------ beneath the browser */

/** One backlog row, as far as this leg reads it. */
export interface BacklogRow {
  /** `github_issues.id` — what the playbook's picker and the queue address it by. */
  readonly id: string;
  readonly number: number;
  /** Where the issue is in the sizing pipeline. */
  readonly sizingStatus: string;
  readonly queued: boolean;
}

/**
 * The backlog's row for an issue number, or nothing while the mirror has not got it.
 *
 * @param context - A signed-in context.
 * @param issueNumber - The issue.
 * @returns The row, or `undefined`.
 */
export async function backlogRow(
  context: BrowserContext,
  issueNumber: number,
): Promise<BacklogRow | undefined> {
  const listing = await requestAs<{ items: BacklogRow[] }>(
    context,
    "GET",
    `/api/v1/backlog?q=${String(issueNumber)}`,
    null,
    `reading the backlog row of #${String(issueNumber)}`,
  );

  return listing?.items.find((row) => row.number === issueNumber);
}

/** One fact, as far as this leg reads it. */
export interface FactRow {
  readonly id: string;
  readonly text: string;
  readonly status: string;
  /** How many injection records name it. */
  readonly usedCount: number;
}

/**
 * The workspace's facts — read to learn the id of the fact the browser confirmed, which is what
 * the estimator's payload names it by.
 *
 * @param context - A signed-in context.
 * @returns Every fact.
 */
export async function facts(context: BrowserContext): Promise<FactRow[]> {
  const list = await requestAs<{ items: FactRow[] }>(
    context,
    "GET",
    "/api/v1/facts",
    null,
    "reading the facts",
  );

  return list?.items ?? [];
}

/** What the estimator sends the engine for one issue — `ouroboros-rest`'s `estimateRequestBody`. */
export interface EstimateRequest {
  readonly issue: { readonly number: number; readonly repo: string; readonly title: string };
  readonly context: {
    /** The confirmed facts the manifest resolved — what this leg is about. */
    readonly facts: readonly { readonly id: string; readonly text: string }[];
    readonly workflow_tags: readonly string[];
  };
}

/**
 * Ask the engine tap something.
 *
 * @param request - Playwright's request context.
 * @param method - The verb.
 * @param path - The control, beginning with a slash.
 * @returns The parsed answer.
 * @throws When the tap did not answer, or refused — saying which, because *the tap is down* and
 *   *the estimator sent nothing* are different findings.
 */
async function askTap<Answer>(
  request: APIRequestContext,
  method: "GET" | "POST",
  path: string,
): Promise<Answer> {
  const response = await request.fetch(`${TAP_URL}${path}`, { method }).catch((reason: unknown) => {
    throw new Error(`the engine tap is not answering at ${TAP_URL}: ${String(reason)}`);
  });

  if (!response.ok()) {
    throw new Error(`the engine tap answered ${response.status().toString()} for ${path}`);
  }

  return (await response.json()) as Answer;
}

/**
 * Forget every estimate request the tap has seen, so what the leg reads next is its own.
 *
 * @param request - Playwright's request context.
 * @returns When the tap has forgotten.
 */
export async function resetTap(request: APIRequestContext): Promise<void> {
  await askTap(request, "POST", "/__tap/reset");
}

/**
 * The estimate requests `rest` has sent the engine for one issue, oldest first — the real wire
 * payload, as `fixtures/engine-tap` recorded it on its way through.
 *
 * @param request - Playwright's request context.
 * @param issueNumber - The issue.
 * @returns Each request's body.
 */
export async function estimateRequestsFor(
  request: APIRequestContext,
  issueNumber: number,
): Promise<EstimateRequest[]> {
  const seen = await askTap<{ items: { path: string; body: EstimateRequest }[] }>(
    request,
    "GET",
    "/__tap/estimates",
  );

  return seen.items.map((item) => item.body).filter((body) => body.issue.number === issueNumber);
}

/** One queue item, as far as this leg reads it — `GET /api/v1/queue`'s `QueueItemSummary`. */
export interface QueuedItem {
  readonly issueNumber: number;
  readonly workflowTag: string;
  readonly workflowVersion: number | null;
  readonly workflowPinReason: string | null;
  /** The playbook the issue was queued under, or `null`. */
  readonly playbookId: string | null;
}

/**
 * The queue's item for an issue number.
 *
 * @param context - A signed-in context.
 * @param issueNumber - The issue.
 * @returns The item, or `undefined` when the queue does not hold it.
 */
export async function queuedItem(
  context: BrowserContext,
  issueNumber: number,
): Promise<QueuedItem | undefined> {
  const page = await requestAs<{ items: QueuedItem[] }>(
    context,
    "GET",
    "/api/v1/queue?limit=100",
    null,
    "reading the queue",
  );

  return page?.items.find((item) => item.issueNumber === issueNumber);
}

/** One playbook, as far as this leg reads it. */
export interface PlaybookRow {
  readonly id: string;
  readonly name: string;
  readonly workflow: { readonly slug: string; readonly version: number };
}

/**
 * The workspace's playbooks.
 *
 * @param context - A signed-in context.
 * @returns Every playbook.
 */
export async function playbooks(context: BrowserContext): Promise<PlaybookRow[]> {
  const list = await requestAs<{ items: PlaybookRow[] }>(
    context,
    "GET",
    "/api/v1/knowledge/playbooks",
    null,
    "reading the playbooks",
  );

  return list?.items ?? [];
}

/**
 * The context a playbook attaches to a launch in a repository — the manifest its run will be
 * given, with the playbook's overrides applied.
 *
 * @param context - A signed-in context.
 * @param playbookId - The playbook.
 * @param repo - `owner/name`.
 * @returns The ids of the facts the manifest carries, and the slugs of its skills.
 */
export async function playbookContext(
  context: BrowserContext,
  playbookId: string,
  repo: string,
): Promise<{ factIds: string[]; skills: string[] }> {
  const attached = await requestAs<{
    manifest: { facts: { id: string }[]; skillVersions: { slug: string }[] };
  }>(
    context,
    "GET",
    `/api/v1/knowledge/playbooks/${playbookId}/context?repo=${encodeURIComponent(repo)}`,
    null,
    "reading the playbook's context",
  );

  return {
    factIds: attached?.manifest.facts.map((fact) => fact.id) ?? [],
    skills: attached?.manifest.skillVersions.map((skill) => skill.slug) ?? [],
  };
}

/**
 * Move a skill's switch through the API — teardown's, for a switch a failed test left off.
 *
 * @param context - A signed-in context.
 * @param slug - The skill.
 * @param enabled - The position to leave it in.
 * @returns When it is stored.
 */
export async function setSkillEnabled(
  context: BrowserContext,
  slug: string,
  enabled: boolean,
): Promise<void> {
  await requestAs(
    context,
    "PATCH",
    `/api/v1/skills/${slug}`,
    { enabled },
    `switching ${slug} ${enabled ? "on" : "off"}`,
  );
}

/* ------------------------------------------------------------------ a member's direct calls */

/**
 * The writes a member may not make, as a hand-made call would make them — each one of the
 * page's inert affordances, addressed past the page. Bodies are valid, so the only reason any
 * of them can be refused is the role.
 */
export const MEMBER_REFUSED: readonly (readonly [
  string,
  "POST" | "PATCH" | "PUT",
  string,
  Readonly<Record<string, unknown>>,
])[] = [
  ["importing rules files", "POST", "/api/v1/knowledge/import/preview", { repo: IMPORT_REPO }],
  [
    "creating a skill",
    "POST",
    "/api/v1/skills",
    { text: "---\nname: Member skill\ndescription: Not allowed.\n---\nBody.\n", scope: "org" },
  ],
  ["switching a skill off", "PATCH", `/api/v1/skills/${TOGGLED_SKILL.slug}`, { enabled: false }],
  [
    "regenerating a repo-map",
    "POST",
    "/api/v1/knowledge/repo-map/regenerate",
    { repo: "acme-robotics/helios-firmware" },
  ],
  [
    "creating a playbook",
    "POST",
    "/api/v1/knowledge/playbooks/from-run",
    { runId: "5eed0009-0000-4000-8000-000000000471", name: "Member playbook" },
  ],
  [
    "saving the environment recipe",
    "PUT",
    "/api/v1/knowledge/env-recipe",
    { repo: "acme-robotics/helios-firmware", commands: [{ command: "true", comment: null }] },
  ],
];

/**
 * Make a call with this context's session and report what it answered.
 *
 * **Not a helper that insists**, unlike `support/rest.ts`'s, for `support/studio.ts`'s reason: the
 * member test calls it to observe a refusal, so the status is the result rather than a reason to
 * throw.
 *
 * @param context - The context to act for.
 * @param method - The verb.
 * @param path - The path, beginning with a slash.
 * @param body - The document to send.
 * @returns The status and the error code the service answered, if it answered one.
 */
export async function answerFor(
  context: BrowserContext,
  method: string,
  path: string,
  body: Readonly<Record<string, unknown>>,
): Promise<{ status: number; code: string | null }> {
  const token = await sessionTokenOf(context, `calling ${method} ${path}`);
  const response = await fetch(`${REST_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
    body: JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => null)) as { code?: unknown } | null;

  return { status: response.status, code: typeof answer?.code === "string" ? answer.code : null };
}
