/**
 * Leg 31 — *the live slice's fixtures*
 * ([#1314](https://github.com/NobuData/ouroboros/issues/1314), DI.5).
 *
 * The MVP gate (DI.6, [#1321](https://github.com/NobuData/ouroboros/issues/1321)) runs one path
 * from an issue to a draft pull request against three fixtures this ticket adds to the stack: a
 * git host that accepts a push to a run branch, a sandbox tracker that records a branch and a
 * pull request, and a recorded provider that replays a harness session. This leg certifies each
 * of the three **as a service**, over the loopback ports the compose override publishes and with
 * no browser — so that when the slice's leg goes red, a reader can tell a fixture that broke from
 * a product that did.
 *
 * Every assertion here is the issue's own acceptance criterion:
 *
 *   * *the fixture repository accepts a push to a run branch and refuses one to the default
 *     branch* — the first test, with a real `git push` into `git-stub`;
 *   * *a GitHub API fixture that records branch and pull-request creation and answers reads* —
 *     the second, against `tracker-stub`'s new routes in GitHub's shapes;
 *   * *a recording made with a different harness version is reported as such rather than
 *     failing obscurely* — the third, which replays the recorded exchange's first turn and then
 *     asks with another harness's beta set and reads the refusal.
 *
 * Nothing here signs in: these are the fixtures' doors, not the product's. The leg that drives
 * the product through them is DI.6's.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { GIT_STUB_URL } from "../support/farm";
import {
  FIXTURE_KEY,
  LIVE_SLICE_REPOSITORY,
  PROVIDER_FIXTURE_URL,
  fixtureRequests,
  readRecording,
  resetProviderFixture,
} from "../support/live-slice";
import { SANDBOX_GITHUB_TOKEN } from "../support/planning";
import { TRACKER_URL } from "../support/stack";

const run = promisify(execFile);

/** `owner/name` — the slice's repository, on every fixture. */
const SLUG = `${LIVE_SLICE_REPOSITORY.owner}/${LIVE_SLICE_REPOSITORY.name}`;

/** The sentence the git host's update hook prints for a ref it refuses. */
const PUSH_REFUSAL = "only refs/heads/ouro/run-* accept pushes";

/** A token the sandbox tracker accepts — any non-empty one; this is the suite's usual. */
const TRACKER_HEADERS = {
  authorization: `Bearer ${SANDBOX_GITHUB_TOKEN}`,
  "content-type": "application/json",
  accept: "application/vnd.github+json",
};

/**
 * Run git in a directory, with the identity a commit needs and no prompt for a credential.
 *
 * @param cwd - The working tree, or any directory for a clone.
 * @param args - The arguments after `git`.
 * @returns What git wrote.
 */
function git(cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return run("git", [...args], {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Ouroboros e2e",
      GIT_AUTHOR_EMAIL: "e2e@ouroboros.invalid",
      GIT_COMMITTER_NAME: "Ouroboros e2e",
      GIT_COMMITTER_EMAIL: "e2e@ouroboros.invalid",
    },
  });
}

/**
 * The branches the git host holds for the slice's repository, by name.
 *
 * @returns Branch name to sha.
 * @throws {Error} If the git host is not answering, naming it.
 */
async function hostBranches(): Promise<Map<string, string>> {
  const response = await fetch(`${GIT_STUB_URL}/refs/${SLUG}`).catch((error: unknown) => {
    throw new Error(`the git host is not answering at ${GIT_STUB_URL}: ${String(error)}`);
  });

  if (!response.ok) {
    throw new Error(`the git host answered ${String(response.status)} to a refs read of ${SLUG}`);
  }

  const branches = new Map<string, string>();

  for (const line of (await response.text()).split("\n")) {
    const [name, sha] = line.trim().split(/\s+/);
    if (name !== undefined && name !== "" && sha !== undefined) branches.set(name, sha);
  }

  return branches;
}

/**
 * Ask the sandbox tracker.
 *
 * @param method - The verb.
 * @param path - The path under the tracker's root.
 * @param body - A document, or none.
 * @returns The status and the parsed body.
 * @throws {Error} If the tracker is not answering, naming it.
 */
async function tracker(
  method: string,
  path: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<{ status: number; json: Record<string, unknown> | Record<string, unknown>[] }> {
  const response = await fetch(`${TRACKER_URL}${path}`, {
    method,
    headers: TRACKER_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((error: unknown) => {
    throw new Error(`the sandbox tracker is not answering at ${TRACKER_URL}: ${String(error)}`);
  });
  const text = await response.text();

  return {
    status: response.status,
    json: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

/**
 * Ask the provider fixture for one answer, in the Messages API's shape.
 *
 * @param betas - What to put in `anthropic-beta`.
 * @param recording - The recording, for the session's model and prompt.
 * @returns The status and the parsed body.
 * @throws {Error} If the fixture is not answering, naming it.
 */
async function askFixture(
  betas: readonly string[],
  recording: ReturnType<typeof readRecording>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const session = recording.sessions.implement;

  if (session === undefined) {
    throw new Error("the provider fixture's recording holds no implement session");
  }

  const response = await fetch(`${PROVIDER_FIXTURE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": FIXTURE_KEY,
      "anthropic-version": recording.harness.anthropic_version,
      "anthropic-beta": betas.join(","),
    },
    body: JSON.stringify({
      model: session.model,
      max_tokens: 1024,
      stream: false,
      tools: recording.harness.tools.map((name) => ({ name, input_schema: { type: "object" } })),
      messages: [{ role: "user", content: `${session.prompt_prefix ?? "Implement the plan"}.` }],
    }),
  }).catch((error: unknown) => {
    throw new Error(
      `the provider fixture is not answering at ${PROVIDER_FIXTURE_URL}: ${String(error)}`,
    );
  });

  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

test.describe("the live slice's fixtures (#1314)", () => {
  test.describe.configure({ timeout: 30_000 });

  test("the git host accepts a push to a run branch and refuses the default branch", async () => {
    const work = await mkdtemp(join(tmpdir(), "ouro-live-slice-"));
    const branch = `ouro/run-e2e-${Date.now().toString()}`;
    const remote = `${GIT_STUB_URL.replace("://", `://x-access-token:${SANDBOX_GITHUB_TOKEN}@`)}/${SLUG}.git`;

    try {
      await git(work, ["clone", "-q", remote, "tree"]).catch((error: unknown) => {
        throw new Error(`the git host refused a clone of ${SLUG}: ${String(error)}`);
      });
      const tree = join(work, "tree");

      await git(tree, ["checkout", "-q", "-b", branch]);
      await writeFile(join(tree, "NOTE.md"), "A commit the live slice's fixture leg pushed.\n");
      await git(tree, ["add", "NOTE.md"]);
      await git(tree, ["commit", "-q", "-m", "e2e: a run-branch commit"]);
      const sha = (await git(tree, ["rev-parse", "HEAD"])).stdout.trim();

      // --- the run branch: accepted, and visible on the host ------------------------------
      await git(tree, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]).catch(
        (error: unknown) => {
          throw new Error(`the git host refused a push to ${branch}: ${String(error)}`);
        },
      );
      expect(
        (await hostBranches()).get(branch),
        `the git host should list ${branch} at the pushed commit`,
      ).toBe(sha);

      // --- the default branch: refused, with the hook's sentence --------------------------
      const refusal = await git(tree, ["push", "origin", "HEAD:refs/heads/main"]).then(
        () => null,
        (error: unknown) => String(error),
      );
      expect(refusal, "the git host should refuse a push to main").not.toBeNull();
      expect(refusal, "the git host should say why it refused").toContain(PUSH_REFUSAL);
      expect(
        (await hostBranches()).get("main"),
        "the git host should leave main where it was",
      ).not.toBe(sha);

      // --- a run branch may be deleted too ------------------------------------------------
      await git(tree, ["push", "-q", "origin", `:refs/heads/${branch}`]).catch((error: unknown) => {
        throw new Error(`the git host refused deleting ${branch}: ${String(error)}`);
      });
      expect(
        (await hostBranches()).has(branch),
        "the git host should have dropped the run branch",
      ).toBe(false);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  test("the sandbox tracker records a branch and a draft pull request and answers reads", async () => {
    const branch = `ouro/run-e2e-${Date.now().toString()}`;
    const sha = "0123456789abcdef0123456789abcdef01234567";

    try {
      const created = await tracker("POST", `/repos/${SLUG}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha,
      });
      expect(created.status, "the sandbox tracker should record the branch").toBe(201);

      const ref = await tracker("GET", `/repos/${SLUG}/git/ref/heads/${branch}`);
      expect(ref.status, "the sandbox tracker should answer a read of the branch").toBe(200);
      expect(ref.json).toMatchObject({ ref: `refs/heads/${branch}`, object: { sha } });

      const opened = await tracker("POST", `/repos/${SLUG}/pulls`, {
        title: "greet: add the exclamation mark",
        head: branch,
        base: "main",
        body: "Opened by the live slice's fixture leg.",
        draft: true,
      });
      expect(opened.status, "the sandbox tracker should open the pull request").toBe(201);
      const pull = opened.json as { number: number; draft: boolean; state: string };
      expect(pull.draft, "the sandbox tracker should keep the draft flag").toBe(true);
      expect(pull.state).toBe("open");

      const listed = await tracker(
        "GET",
        `/repos/${SLUG}/pulls?head=${encodeURIComponent(`${LIVE_SLICE_REPOSITORY.owner}:${branch}`)}&base=main`,
      );
      expect(listed.status).toBe(200);
      expect(
        (listed.json as { number: number }[]).map((item) => item.number),
        "the sandbox tracker should find the pull request by its head and base",
      ).toEqual([pull.number]);

      const inspected = await tracker("GET", `/__sandbox/pulls/${SLUG}/${pull.number.toString()}`);
      expect(inspected.status, "the sandbox tracker should hold the pull request").toBe(200);
      expect(inspected.json).toMatchObject({ number: pull.number, draft: true });
    } finally {
      await tracker("POST", "/__sandbox/reset");
    }
  });

  test("the provider fixture replays the recorded exchange and reports a different harness", async () => {
    const recording = readRecording();
    const session = recording.sessions.implement;

    expect(
      session,
      "the provider fixture's recording should hold an implement session",
    ).toBeDefined();
    if (session === undefined) return;

    await resetProviderFixture();

    try {
      // --- the recorded harness: the first turn, as recorded -----------------------------
      const replayed = await askFixture(recording.harness.anthropic_beta, recording);
      expect(replayed.status, "the provider fixture should answer the recorded harness").toBe(200);
      expect(replayed.json.content, "the provider fixture should play the first turn").toEqual(
        session.turns[0]?.content,
      );
      expect(replayed.json.stop_reason).toBe("tool_use");

      // --- another harness: refused, naming the one the recording was made with ----------
      const refused = await askFixture(["claude-code-20250219"], recording);
      expect(refused.status, "the provider fixture should refuse a different harness").toBe(400);
      const message = (refused.json as { error?: { message?: string } }).error?.message ?? "";
      expect(message, "the provider fixture should name the recorded harness").toContain(
        `Claude Agent SDK ${recording.harness.sdk}`,
      );
      expect(message).toContain(`CLI ${recording.harness.cli}`);

      const log = await fixtureRequests();
      expect(
        log.map((entry) => [entry.status, entry.mismatch ?? null]),
        "the provider fixture should log the answer and the refusal",
      ).toEqual([
        [200, null],
        [400, "harness"],
      ]);
    } finally {
      await resetProviderFixture();
    }
  });
});
