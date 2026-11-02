/**
 * What the live loop's leg (DI.6, [#1321](https://github.com/NobuData/ouroboros/issues/1321)) needs
 * that no other leg did: the slice workspace made ready the way a person makes it ready, a
 * deployment switch it can turn off and on, and reads of the run, its queue item, its build and
 * its pull request.
 *
 * Every write goes through a route a person or the product uses — the provider key through
 * *rotate*, the source's token through its credentials route, the runner by pasting the enroll
 * command into the build machine. Only the deployment switch is an environment variable, because
 * it is one: `OURO_LIVE_EXECUTION_ENABLED` is a deployment's setting, not a workspace's, and the
 * leg recreates `rest` to change it, as an operator would.
 */

import { type BrowserContext, expect } from "@playwright/test";

import { composeOutcome } from "./compose";
import { pasteIntoBuildMachine } from "./farm-runner";
import { requestAs } from "./rest";
import { SESSION_COOKIE, sessionTokenOf } from "./session";
import { REST_URL } from "./stack";

/** The slice workspace (R__dev_seed_live_slice.sql). */
export const SLICE_WORKSPACE = "acme-live-slice";

/** The repository the slice runs in. */
export const SLICE_REPOSITORY = "acme-robotics/helios-greeter";

/** The slice's workflow (R__dev_seed_live_slice.sql). */
export const SLICE_WORKFLOW = "live-slice";

/** The mirrored issue the slice runs on — `acme-robotics/helios-greeter#1`. */
export const SLICE_ISSUE = {
  id: "5eed00a3-0000-4000-8000-000000000001",
  number: 1,
  title: "greet: the exclamation mark is missing",
} as const;

/** The workspace's GitHub ticket source — what the draft pull request is opened through. */
export const SLICE_SOURCE_ID = "5eed00a2-0000-4000-8000-000000000001";

/** The pool the slice's `build` stage names (`runner_pool: pool-a`). */
export const SLICE_POOL = "pool-a";

/**
 * The git host's token (docker-compose.e2e.yml's `GIT_STUB_PASSWORD`): the workspace GitHub token
 * the engine clones and pushes with, and — any non-empty token will do for the sandbox tracker —
 * the source's credential the pull request is opened with.
 */
export const SANDBOX_GITHUB_TOKEN = "ghp_e2e288planningsandboxtoken0000000000";

/** A claude.ai subscription access token's shape — the one DH.4 (#1304) refuses to store. */
export const SUBSCRIPTION_SHAPED_TOKEN = "sk-ant-oat01-e2e-not-a-real-subscription-token-0000";

/** How long the run may take from its claim to its draft pull request: the six-minute budget's share. */
export const RUN_MS = 4 * 60 * 1000;

/** How long nothing must happen for "admits nothing" to mean something: three supervisor ticks. */
export const QUIET_MS = 15 * 1000;

/** A queue item, as `GET /api/v1/queue` lists it. */
export interface QueueRow {
  readonly id: string;
  readonly issueNumber: number;
  readonly confirmedAt: string | null;
  readonly waiting: { readonly reason: string; readonly scope: string } | null;
}

/** A run, as the runs listing summarizes it. */
export interface RunRow {
  readonly id: string;
  readonly issueNumber: number;
  readonly status: string;
  readonly origin: string;
  readonly prNumber: number | null;
}

/**
 * GET a document as the signed-in person.
 *
 * @param context - The signed-in context.
 * @param path - The path under the API's origin.
 * @returns The parsed body.
 * @throws {Error} When the service refuses, naming the path and the answer.
 */
export async function readAs<Answer>(context: BrowserContext, path: string): Promise<Answer> {
  const token = await sessionTokenOf(context, `reading ${path}`);
  const response = await fetch(`${REST_URL}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });

  if (!response.ok) {
    throw new Error(`GET ${path} answered ${String(response.status)}: ${await response.text()}`);
  }

  return (await response.json()) as Answer;
}

/**
 * Turn the deployment switch, the way an operator does: recreate `rest` with the variable set.
 *
 * `ui` shares `rest`'s network namespace in this stack, so it is recreated after it.
 *
 * @param on - Whether live execution is allowed.
 */
export async function setDeploymentSwitch(on: boolean): Promise<void> {
  process.env.OURO_E2E_LIVE_EXECUTION = on ? "true" : "false";

  for (const service of ["rest", "ui"]) {
    const outcome = await composeOutcome(
      "up",
      "-d",
      "--no-build",
      "--wait",
      "--force-recreate",
      // Only this service: a failure-mode pair may have stopped one it depends on, on purpose.
      "--no-deps",
      service,
    );

    expect(outcome.status, `recreating ${service}:\n${outcome.output}`).toBe(0);
  }
}

/**
 * Make the slice workspace ready to run: the provider fixture's key, the git host's token, the
 * source's credential, and a runner online in `pool-a` — each through its ordinary route.
 *
 * @param context - Signed in as the slice workspace's owner.
 */
export async function prepareSliceWorkspace(context: BrowserContext): Promise<void> {
  await requestAs(
    context,
    "PUT",
    "/api/v1/settings/github-token",
    { token: SANDBOX_GITHUB_TOKEN },
    "storing the git host's token as the workspace's GitHub token",
  );
  await requestAs(
    context,
    "POST",
    `/api/v1/sources/${SLICE_SOURCE_ID}/credentials`,
    { secret: SANDBOX_GITHUB_TOKEN },
    "storing the slice source's credential, which the draft pull request is opened with",
  );
  await ensureRunner(context);
}

/**
 * A runner online in the slice's pool: the pool made, the enroll command pasted into the build
 * machine, and the row read back until it is online.
 *
 * @param context - Signed in as the slice workspace's owner.
 */
export async function ensureRunner(context: BrowserContext): Promise<void> {
  const online = async (): Promise<boolean> => {
    const fleet = await readAs<{ runners: { pool: string; status: string }[] }>(
      context,
      "/api/v1/farm",
    );

    return fleet.runners.some((runner) => runner.pool === SLICE_POOL && runner.status === "online");
  };

  if (await online()) return;

  const pools = await readAs<{ items?: { name: string }[] } | { name: string }[]>(
    context,
    "/api/v1/farm/pools",
  );
  const names = (Array.isArray(pools) ? pools : (pools.items ?? [])).map((pool) => pool.name);

  if (!names.includes(SLICE_POOL)) {
    await requestAs(
      context,
      "POST",
      "/api/v1/farm/pools",
      { name: SLICE_POOL, executor: "shell" },
      `creating the pool ${SLICE_POOL}`,
    );
  }

  const { command } = await readAs<{ command: string }>(
    context,
    `/api/v1/farm/enroll-command?pool=${SLICE_POOL}`,
  );
  const installed = await pasteIntoBuildMachine(command);

  expect(
    installed.status,
    `the enroll command did not install a runner:\n${installed.transcript}`,
  ).toBe(0);
  await expect
    .poll(online, { message: "the runner never came online", timeout: 60_000 })
    .toBe(true);
}

/**
 * The slice issue's queue item, if it is queued.
 *
 * @param context - Signed in.
 * @returns The row, or undefined.
 */
export async function sliceQueueItem(context: BrowserContext): Promise<QueueRow | undefined> {
  const queue = await readAs<{ items: QueueRow[] }>(context, "/api/v1/queue?limit=100");

  return queue.items.find((item) => item.issueNumber === SLICE_ISSUE.number);
}

/**
 * Every run of the slice issue, of every origin, newest first.
 *
 * @param context - Signed in.
 * @returns The runs.
 */
export async function sliceRuns(context: BrowserContext): Promise<RunRow[]> {
  const families = await Promise.all(
    (["active", "terminal"] as const).map((family) =>
      readAs<{ items: RunRow[] }>(context, `/api/v1/runs?status=${family}&limit=100`),
    ),
  );

  return families
    .flatMap((page) => page.items)
    .filter((run) => run.issueNumber === SLICE_ISSUE.number);
}

/**
 * Confirm the slice issue's queue item for a live run, as a person holding `can_approve_loops`
 * does (decision L5). Queueing confirms it by itself only while the deployment allows live runs;
 * with the switch off it waits, and an unconfirmed item would be held for that reason alone —
 * which would make every "admits nothing" below prove nothing.
 *
 * @param context - Signed in as an approver.
 */
export async function confirmSliceItem(context: BrowserContext): Promise<void> {
  const item = await sliceQueueItem(context);

  expect(item, "the slice issue is not queued").toBeDefined();
  if (item!.confirmedAt === null) {
    await requestAs(
      context,
      "POST",
      `/api/v1/queue/${item!.id}/confirm`,
      {},
      "confirming the slice item for a live run",
    );
  }
  expect(
    (await sliceQueueItem(context))?.confirmedAt,
    "the item is still unconfirmed",
  ).not.toBeNull();
}

/**
 * Queue the slice issue, or find it already queued — a warm stack, or a failure-mode pair, may
 * have left the item waiting — and confirm it for a live run.
 *
 * @param context - Signed in as an approver.
 */
export async function queueSliceIssue(context: BrowserContext): Promise<void> {
  if ((await sliceQueueItem(context)) === undefined) {
    await requestAs(
      context,
      "POST",
      "/api/v1/backlog/queue",
      { issueIds: [SLICE_ISSUE.id] },
      "queueing the slice issue",
    );
  }
  await confirmSliceItem(context);
}

/**
 * Raise the workspace's live-run ceiling to the deployment's maximum. A run the slice opened
 * earlier waits in `review` on its draft pull request and counts against the ceiling, so on a
 * warm stack a ceiling of one would hold the next run for that reason alone.
 *
 * @param context - Signed in as an owner or admin.
 */
export async function openTheCeiling(context: BrowserContext): Promise<void> {
  const settings = await readAs<{ ceiling: number; ceilingMax: number }>(
    context,
    "/api/v1/settings/live-execution",
  );

  if (settings.ceiling < settings.ceilingMax) {
    await requestAs(
      context,
      "PATCH",
      "/api/v1/settings/live-execution",
      { ceiling: settings.ceilingMax },
      "raising the workspace's live-run ceiling",
    );
  }
}

/**
 * Wait until the slice's runner is back after `rest` was recreated: online and seen since the
 * restart. A runner reconnects to a new control plane on its own; until it has, no build can be
 * offered to it, and the chain's build would wait out a reconnect inside the run's budget.
 *
 * @param context - Signed in.
 * @param since - When `rest` was recreated.
 */
export async function awaitRunnerBack(context: BrowserContext, since: Date): Promise<void> {
  await expect
    .poll(
      async () => {
        const fleet = await readAs<{
          runners: { pool: string; status: string; lastSeenAt: string | null }[];
        }>(context, "/api/v1/farm");

        return fleet.runners.some(
          (runner) =>
            runner.pool === SLICE_POOL &&
            runner.status === "online" &&
            runner.lastSeenAt !== null &&
            new Date(runner.lastSeenAt) > since,
        );
      },
      { message: "the runner did not come back after rest was recreated", timeout: 60_000 },
    )
    .toBe(true);
}
