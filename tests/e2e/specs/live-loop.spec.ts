/**
 * Leg 34 — **the live loop, an issue to a draft pull request** — the MVP gate (DI.6,
 * [#1321](https://github.com/NobuData/ouroboros/issues/1321)).
 *
 * Every earlier leg proved one segment against a stand-in. This one runs the product's own path
 * from cold compose, with nothing faked above the provider's socket:
 *
 *   queue `helios-greeter#1` → admission → the engine claims it → a run opens, origin **live** →
 *   `plan` and `implement` call the recorded provider through the harness and the facade, each on
 *   its own route → `implement` edits the run's working tree, cloned over TLS → the branch is
 *   pushed to the git host → `build` runs `sh tests/check.sh` on the **enrolled runner**, which
 *   checks out that exact commit → the gate passes → a **draft** pull request opens with the
 *   run's id → the dashboard, the run console, the farm and the pull-request page agree, and the
 *   run's usage reconciles to a cost.
 *
 * The provider is `provider-fixture`, replaying a recorded Claude Agent exchange (DI.5, #1314).
 * Everything else is the product: the engine image, `rest`, the Go runner, the TLS gateway, the
 * git host's real refs and the tracker's recorded pull request.
 *
 * **The negative legs** run first, in this order, because each leaves the next its state — there
 * is no route that takes an issue back out of the queue:
 *
 *   1. a subscription-shaped credential cannot be saved (DH.4, #1304);
 *   2. with the deployment switch off, a confirmed item is admitted to nothing (DG.2, L10);
 *   3. with the switch on and the repository not under dry-run, still nothing (DI.4, L7);
 *   4. with dry-run back on, the same item runs the whole loop — the chain;
 *   5. the run simulator's secret cannot open a run that renders as live (DJ.1, R4).
 *
 * Not here yet, and why: a build that **fails once by design** and a gate that returns to
 * `implement` (a retry is not told why it was returned — #1816 — and the recording has one
 * `implement` attempt), and a **planted write outside the tree** (it needs a recorded attempt that
 * makes one). Both need a new recording (#1817).
 *
 * **Warm or cold.** It notes the slice issue's runs before it starts and asserts only on runs it
 * caused, so a failure-mode pair (scripts/verify-failure-modes.sh) can run it again on the stack
 * the last pair left.
 */

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

import {
  awaitRunnerBack,
  openTheCeiling,
  queueSliceIssue,
  QUIET_MS,
  RUN_MS,
  SLICE_ISSUE,
  SLICE_SOURCE_ID,
  SLICE_WORKSPACE,
  SUBSCRIPTION_SHAPED_TOKEN,
  type RunRow,
  prepareSliceWorkspace,
  readAs,
  setDeploymentSwitch,
  sliceQueueItem,
  sliceRuns,
} from "../support/live-loop";
import {
  FIXTURE_CONNECTION_ID,
  LIVE_SLICE_REPOSITORY,
  fixtureRequests,
  readRecording,
  resetProviderFixture,
  setFixtureProviderKey,
} from "../support/live-slice";
import { requestAs } from "../support/rest";
import { SEED_OWNER } from "../support/seed";
import { SESSION_COOKIE, sessionTokenOf, signIn } from "../support/session";
import { REST_URL, TRACKER_URL } from "../support/stack";
import { selectWorkspace } from "../support/workspace";

/** The git host's published port (docker-compose.e2e.yml). */
const GIT_HOST_URL = "http://127.0.0.1:4500";

/** The run simulator's secret on this stack (docker-compose.e2e.yml). */
const SIMULATOR_SECRET = "e2e-run-simulator-secret";

/** The slice repository's id (R__dev_seed_live_slice.sql). */
const SLICE_REPOSITORY_ID = "5eed00a1-0000-4000-8000-000000000001";

/** The slice issue's runs before this leg started — only a run not in here is this leg's. */
let before = new Set<string>();

/**
 * The slice issue's runs this leg caused.
 *
 * @param context - Signed in.
 * @returns The new runs, newest first.
 */
async function newRuns(context: BrowserContext): Promise<RunRow[]> {
  return (await sliceRuns(context)).filter((run) => !before.has(run.id));
}

/** The run console's payload, as far as this leg reads it. */
interface RunConsole {
  readonly run: RunRow & { readonly finishedAt: string | null; readonly stageLabel: string };
  readonly resources: {
    readonly tokens: { readonly used: number };
    readonly cost: { readonly costCents: string | null; readonly unpricedEvents: number };
    readonly farm: {
      readonly buildJobId: string | null;
      readonly jobNumber: number | null;
      readonly jobStatus: string | null;
      readonly runnerName: string | null;
    } | null;
  };
}

/**
 * Sign the seeded owner in, acting in the slice workspace.
 *
 * @param context - The test's context.
 */
async function enterSlice(context: BrowserContext): Promise<void> {
  await signIn(context, SEED_OWNER.id);
  await selectWorkspace(context, SLICE_WORKSPACE);
}

/**
 * Wait until the queue says why the slice item is not starting, then hold still long enough to
 * prove nothing was admitted.
 *
 * @param context - Signed in.
 * @param reason - The admission reason the item must wait for.
 */
async function expectHeld(context: BrowserContext, reason: string): Promise<void> {
  await expect
    .poll(async () => (await sliceQueueItem(context))?.waiting?.reason, {
      message: `the slice item should wait for ${reason}`,
      timeout: 20_000,
    })
    .toBe(reason);
  await new Promise((settle) => setTimeout(settle, QUIET_MS));
  expect(await newRuns(context), `nothing may be admitted while ${reason} holds`).toEqual([]);
}

/**
 * The newest system or gate entry of a run's transcript — why a run that stopped, stopped.
 *
 * @param context - Signed in.
 * @param runId - The run.
 * @returns The entry's body, or an empty string.
 */
async function lastWord(context: BrowserContext, runId: string): Promise<string> {
  const page = await readAs<{ entries: { actor: string; body: string }[] }>(
    context,
    `/api/v1/runs/${runId}/events?limit=200`,
  );
  const said = page.entries.filter((entry) => entry.actor === "system" || entry.actor === "gate");

  return said.at(-1)?.body ?? "";
}

/**
 * Open a page and wait for it to have drawn the run's issue.
 *
 * @param page - The page.
 * @param path - Where.
 * @param text - What it must show.
 */
async function expectDrawn(page: Page, path: string, text: string | RegExp): Promise<void> {
  await page.goto(path);
  // The run console nests a second `<main>` for its stage pane; the page's own is the first.
  await expect(page.locator("main").first(), `${path} must show ${String(text)}`).toContainText(
    text,
    {
      timeout: 20_000,
    },
  );
}

test.describe("leg 34: the live loop, an issue to a draft pull request (#1321)", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    // Whatever failed, the stack is left switched on for the next run of the suite.
    if (process.env.OURO_E2E_LIVE_EXECUTION === "false") {
      await setDeploymentSwitch(true);
    }
  });

  test("a subscription-shaped credential cannot be saved", async ({ context }) => {
    await enterSlice(context);

    before = new Set((await sliceRuns(context)).map((run) => run.id));

    const token = await sessionTokenOf(context, "rotating the fixture's credential");
    const response = await fetch(`${REST_URL}/api/v1/providers/${FIXTURE_CONNECTION_ID}/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ secret: SUBSCRIPTION_SHAPED_TOKEN }),
    });
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(422);
    expect(body.code).toBe("provider_credential_refused");
  });

  test("the deployment switch off admits nothing", async ({ context }) => {
    await setDeploymentSwitch(false);
    await enterSlice(context);

    const report = await readAs<{ deploymentEnabled: boolean }>(
      context,
      "/api/v1/loop/capabilities",
    );
    expect(report.deploymentEnabled).toBe(false);

    await setFixtureProviderKey(context);
    await prepareSliceWorkspace(context);
    await resetProviderFixture();
    await openTheCeiling(context);
    await queueSliceIssue(context);

    await expectHeld(context, "deployment_disabled");
  });

  test("a repository not under dry-run policy is refused", async ({ context }) => {
    await enterSlice(context);
    await requestAs(
      context,
      "PATCH",
      "/api/v1/policies/dry-run",
      { dryRun: false },
      "turning dry-run off for the workspace",
    );
    const restarted = new Date();
    await setDeploymentSwitch(true);
    await enterSlice(context);
    await awaitRunnerBack(context, restarted);

    await expectHeld(context, "policy_not_dry_run");
  });

  test("the chain: queued issue → live run → pushed branch → runner build → draft pull request", async ({
    context,
    page,
  }) => {
    test.setTimeout(RUN_MS + 2 * 60 * 1000);
    await enterSlice(context);
    await requestAs(
      context,
      "PATCH",
      "/api/v1/policies/dry-run",
      { dryRun: true },
      "turning dry-run back on",
    );

    // --- admission: the same confirmed item is claimed, and a live run opens -------------------
    let run: RunRow | undefined;
    await expect
      .poll(
        async () => {
          run = (await newRuns(context)).find((candidate) => candidate.origin === "live");
          if (run !== undefined) return run.origin;
          // Not admitted yet: what the queue says, so a run that never opens says why.
          const waiting = (await sliceQueueItem(context))?.waiting?.reason;
          return `not opened (${waiting ?? "admitted, no run yet"})`;
        },
        { message: "no run opened for the slice issue", timeout: 60_000 },
      )
      .toBe("live");
    const runId = run!.id;

    await page.goto(`/runs/${runId}?from=dashboard`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`#${SLICE_ISSUE.number}`);
    await expect(page.getByText("Simulated run.")).toHaveCount(0);
    await expect(page.locator(".origin-badge")).toHaveCount(0);

    // --- the run reaches review with its pull request, or says why it stopped -----------------
    let consoleRead: RunConsole | undefined;
    await expect
      .poll(
        async () => {
          consoleRead = await readAs<RunConsole>(context, `/api/v1/runs/${runId}`);
          const { status } = consoleRead.run;
          if (["failed", "canceled", "needs_human"].includes(status)) {
            return `${status}: ${await lastWord(context, runId)}`;
          }
          if (status === "review" && consoleRead.run.prNumber !== null) return "review";
          // Still moving: where, so a run that never gets further says which stage it is stuck in.
          return `${status} at ${consoleRead.run.stageLabel}`;
        },
        { message: "the live run did not reach review with a pull request", timeout: RUN_MS },
      )
      .toBe("review");
    const { resources } = consoleRead!;

    // --- plan and implement were served by their own recorded sessions, through the facade -----
    const recording = readRecording();
    const main = (await fixtureRequests()).filter((request) => request.main);
    for (const session of ["plan", "implement"]) {
      const served = main.filter((request) => request.session === session);
      expect(served.length, `the ${session} session was never asked`).toBeGreaterThan(0);
      expect(
        served.every((request) => request.status === 200 && request.mismatch === undefined),
      ).toBe(true);
      expect(served.every((request) => request.model === recording.sessions[session]?.model)).toBe(
        true,
      );
    }

    // --- the branch is a real ref on the git host -------------------------------------------
    const refs = await (
      await fetch(
        `${GIT_HOST_URL}/refs/${LIVE_SLICE_REPOSITORY.owner}/${LIVE_SLICE_REPOSITORY.name}`,
      )
    ).text();
    const branch = `ouro/run-${runId}-${String(SLICE_ISSUE.number)}`;
    const line = refs.split("\n").find((entry) => entry.startsWith(`${branch} `));
    expect(line, `the git host holds no ${branch}:\n${refs}`).toBeDefined();
    const sha = line!.split(" ")[1];
    const main_ = refs
      .split("\n")
      .find((entry) => entry.startsWith("main "))!
      .split(" ")[1];
    expect(sha, "the run branch must carry the loop's commit, not main's").not.toBe(main_);

    // --- the build ran on the enrolled runner, against that exact commit ---------------------
    expect(resources.farm?.jobStatus).toBe("succeeded");
    expect(resources.farm?.runnerName).toBe("forge-compose");
    const log = await readAs<{ bytes: string }>(
      context,
      `/api/v1/farm/jobs/${resources.farm!.buildJobId!}/log`,
    );
    expect(log.bytes).toContain(sha);
    expect(log.bytes).toContain("ok   greet World -> Hello, World!");

    // --- a draft pull request, with the run's id, recorded by the tracker ----------------------
    const pulls = await readAs<{
      items: { id: string; number: number; draft: boolean; origin: string }[];
    }>(context, `/api/v1/pull-requests?runId=${runId}`);
    expect(pulls.items).toHaveLength(1);
    const pull = pulls.items[0];
    expect(pull).toMatchObject({ number: consoleRead!.run.prNumber, draft: true, origin: "live" });
    const recorded = (await (
      await fetch(
        `${TRACKER_URL}/__sandbox/pulls/${LIVE_SLICE_REPOSITORY.owner}/${LIVE_SLICE_REPOSITORY.name}/${String(pull.number)}`,
      )
    ).json()) as { draft?: boolean; head?: { ref?: string } };
    expect(recorded.draft).toBe(true);
    expect(recorded.head?.ref).toBe(branch);

    // --- usage reconciles to a cost --------------------------------------------------------
    expect(resources.tokens.used).toBeGreaterThan(0);
    expect(Number(resources.cost.costCents)).toBeGreaterThan(0);
    expect(resources.cost.unpricedEvents).toBe(0);

    // --- the dashboard, the run console, the farm and the pull-request page agree -------------
    await expectDrawn(page, "/dashboard", SLICE_ISSUE.title);
    await expect(page.locator(".origin-strip")).toHaveCount(0);
    await expectDrawn(page, `/runs/${runId}?from=dashboard`, "review");
    await expectDrawn(page, "/build-farm", "forge-compose");
    await expectDrawn(page, `/prs/${pull.id}`, "Draft");
  });

  test("the simulator's secret cannot open a run that renders as live", async ({
    context,
    page,
  }) => {
    await enterSlice(context);

    const response = await fetch(`${REST_URL}/internal/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ouro-internal-key": SIMULATOR_SECRET },
      body: JSON.stringify({
        idempotencyKey: `e2e-live-loop-simulated-${Date.now().toString()}`,
        ticket: { source: SLICE_SOURCE_ID, externalKey: `#${String(SLICE_ISSUE.number)}` },
        repository: SLICE_REPOSITORY_ID,
        workflow: { tag: "live-slice", version: 1 },
        model: "slice-planner",
      }),
    });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    const opened = (await response.json()) as { id: string; simulated: boolean };
    expect(opened.simulated).toBe(true);

    const read = await readAs<RunConsole>(context, `/api/v1/runs/${opened.id}`);
    expect(read.run.origin).toBe("simulated");

    await page.goto(`/runs/${opened.id}?from=dashboard`);
    await expect(page.getByText("Simulated run.")).toBeVisible();
    await expect(page.locator(".origin-badge")).toContainText("Simulated");
  });
});
