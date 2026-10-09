/**
 * The bisect primitive over a scripted-failure line (CL.4, #617).
 *
 * The farm is {@link MemoryFarm}: a test decides each job — `failed` from the planted culprit on,
 * `succeeded` before it — which is `git bisect run` with the farm in place of the local test. The
 * acceptance criteria held here: the culprit is isolated in at most ⌊log₂ n⌋ + 1 farm jobs, and a
 * bisect interrupted mid-run resumes from its checkpoint instead of restarting.
 */

import {
  BISECT_COMMITS_WIRE,
  HELIOS,
  ORG,
  recordedReader,
} from "../tools/adapters/code/code.recordings.fixture";
import { CodeBisectService, type StartBisect } from "./code-bisect.service";
import { MemoryBisectStore, MemoryFarm } from "./code-bisect.store.fixture";
import type { CodeReader } from "./code.reader";
import { CodeRefusal } from "./code.reader";

const REQUEST: StartBisect = {
  organizationId: ORG,
  repository: "helios-firmware",
  good: "v2.0.4",
  bad: "nightly",
  testRef: "hil:hover_drift",
  pool: "hil-rig",
  command: ["west", "twister", "-T", "tests/hil/hover_drift"],
  investigationId: "5eed0617-0000-4000-8000-000000000001",
};

/** The fixture's line, c2…c7; the planted culprit is c4 — `Gust feed-forward in PID`. */
const LINE = BISECT_COMMITS_WIRE.commits as readonly string[];
const CULPRIT = LINE[2];

function line(n: number): Record<string, unknown> {
  const commits = Array.from({ length: n }, (_, index) => index.toString(16).padStart(40, "a"));
  return {
    ...BISECT_COMMITS_WIRE,
    commits,
    bad_sha: commits[n - 1],
    max_steps: Math.floor(Math.log2(n)) + 1,
  };
}

interface Rig {
  readonly farm: MemoryFarm;
  readonly store: MemoryBisectStore;
  service: CodeBisectService;
  readonly reader: ReturnType<typeof recordedReader>;
}

async function rig(overrides: Record<string, unknown> = {}): Promise<Rig> {
  const { bisectCommitsSchema } = await import("../../engine/engine.code.contract");
  const parsed = Object.fromEntries(
    Object.entries(overrides).map(([route, wire]) => [route, bisectCommitsSchema.parse(wire)]),
  );
  const farm = new MemoryFarm();
  const store = new MemoryBisectStore(farm);
  const reader = recordedReader(parsed);
  return { farm, store, reader, service: serviceOver(store, farm, reader) };
}

function serviceOver(
  store: MemoryBisectStore,
  farm: MemoryFarm,
  reader: Pick<CodeReader, "repository" | "read">,
): CodeBisectService {
  const service = new CodeBisectService(store as never, reader as never, farm as never);
  service.now = () => new Date("2026-10-09T07:00:00Z");
  return service;
}

/**
 * Run every queued step to its verdict — `failed` at or after the culprit — until the bisect ends.
 *
 * @param r - The rig.
 * @param bisectId - The bisect.
 * @param culpritIndex - Where the planted culprit is in the line, or null for none.
 * @param commits - The line.
 */
async function drive(
  r: Rig,
  bisectId: string,
  culpritIndex: number | null,
  commits: readonly string[],
): Promise<void> {
  for (let guard = 0; guard < 64; guard += 1) {
    const view = await r.service.get(ORG, bisectId);
    if (view === undefined || view.bisect.status !== "running") return;
    const open = view.steps.find((step) => step.verdict === null);
    if (open === undefined) throw new Error("a running bisect with no step in flight");
    const index = commits.indexOf(open.commitSha);
    const bad = culpritIndex !== null && index >= culpritIndex;
    r.farm.finish(open.buildJobId, bad ? "failed" : "succeeded");
    await r.service.onCompletion({
      organizationId: ORG,
      jobId: open.buildJobId,
      status: bad ? "failed" : "succeeded",
    });
  }
  throw new Error("the bisect never ended");
}

describe("the bisect primitive", () => {
  it("dispatches its first farm job at the line's middle, on the commit, with the test's command", async () => {
    const r = await rig();

    const view = await r.service.start(REQUEST);

    expect(view.bisect).toMatchObject({
      status: "running",
      repository: HELIOS.slug,
      lo: 0,
      hi: 5,
      maxSteps: 3,
      buildRef: "refs/heads/nightly",
      investigationId: REQUEST.investigationId,
    });
    expect(r.farm.list()).toHaveLength(1);
    expect(r.farm.list()[0]?.request).toMatchObject({
      pool: "hil-rig",
      repository: HELIOS.slug,
      ref: "refs/heads/nightly",
      commit: LINE[2],
      command: REQUEST.command,
      label: "bisect",
      title: `bisect hil:hover_drift · step 1/3 · ${LINE[2].slice(0, 7)}`,
    });
    expect(r.reader.calls).toEqual([
      { operation: "bisect-commits", body: { good: "v2.0.4", bad: "nightly" } },
    ]);
  });

  it("isolates the planted culprit within ⌊log₂ n⌋ + 1 farm jobs, citing the jobs that proved it", async () => {
    const r = await rig();
    const started = await r.service.start(REQUEST);

    await drive(r, started.bisect.id, 2, LINE);

    const done = await r.service.get(ORG, started.bisect.id);
    expect(done?.bisect).toMatchObject({ status: "converged", culpritSha: CULPRIT, lo: 2, hi: 2 });
    expect(done?.steps.length).toBeLessThanOrEqual(3);
    expect(r.farm.list()).toHaveLength(done?.steps.length ?? -1);
    expect(done?.steps.every((step) => step.verdict !== null)).toBe(true);
  });

  it.each([
    [300, 137],
    [300, 0],
    [300, 299],
    [1000, 613],
  ])("isolates a culprit in a line of %i at %i within the bound", async (n, at) => {
    const r = await rig({ "bisect-commits": line(n) });
    const commits = line(n).commits as string[];
    const started = await r.service.start(REQUEST);

    await drive(r, started.bisect.id, at, commits);

    const done = await r.service.get(ORG, started.bisect.id);
    expect(done?.bisect.status).toBe("converged");
    expect(done?.bisect.culpritSha).toBe(commits[at]);
    expect(r.farm.list().length).toBeLessThanOrEqual(Math.floor(Math.log2(n)) + 1);
  });

  it("resumes from its checkpoint after a restart instead of starting again", async () => {
    const uninterrupted = await rig({ "bisect-commits": line(300) });
    const first = await uninterrupted.service.start(REQUEST);
    await drive(uninterrupted, first.bisect.id, 137, line(300).commits as string[]);
    const builtUninterrupted = uninterrupted.farm.list().map((job) => job.request.commit);

    const r = await rig({ "bisect-commits": line(300) });
    const started = await r.service.start(REQUEST);
    // Two steps decided normally…
    for (let i = 0; i < 2; i += 1) {
      const open = (await r.service.get(ORG, started.bisect.id))?.steps.find(
        (s) => s.verdict === null,
      );
      const index = (line(300).commits as string[]).indexOf(open?.commitSha ?? "");
      const status = index >= 137 ? "failed" : "succeeded";
      r.farm.finish(open?.buildJobId ?? "", status);
      await r.service.onCompletion({ organizationId: ORG, jobId: open?.buildJobId ?? "", status });
    }
    const checkpoint = await r.service.get(ORG, started.bisect.id);
    // …then the third job finishes while the service is down: its event is never heard.
    const third = checkpoint?.steps.find((s) => s.verdict === null);
    const thirdIndex = (line(300).commits as string[]).indexOf(third?.commitSha ?? "");
    r.farm.finish(third?.buildJobId ?? "", thirdIndex >= 137 ? "failed" : "succeeded");

    // A new process, the same rows.
    r.service = serviceOver(r.store, r.farm, r.reader);
    expect(await r.service.resume()).toBe(1);

    const resumed = await r.service.get(ORG, started.bisect.id);
    expect(resumed?.steps.slice(0, 3).every((s) => s.verdict !== null)).toBe(true);
    expect(resumed?.bisect.lo).toBeGreaterThanOrEqual(checkpoint?.bisect.lo ?? 0);
    expect(resumed?.bisect.hi).toBeLessThanOrEqual(checkpoint?.bisect.hi ?? 0);

    await drive(r, started.bisect.id, 137, line(300).commits as string[]);
    const built = r.farm.list().map((job) => job.request.commit);
    expect(built).toEqual(builtUninterrupted); // nothing rebuilt, nothing skipped
    expect((await r.service.get(ORG, started.bisect.id))?.bisect.culpritSha).toBe(
      (line(300).commits as string[])[137],
    );
  });

  it("resumes a bisect whose next step was never dispatched", async () => {
    const r = await rig();
    const started = await r.service.start(REQUEST);
    const open = started.steps[0];
    r.farm.finish(open?.buildJobId ?? "", "succeeded");
    // Settled, but the process stops before the next dispatch: emulate by deciding only.
    await r.store.decide(undefined, started.bisect.id, 1, "good", { lo: 3, hi: 5 }, new Date());

    await serviceOver(r.store, r.farm, r.reader).resume();

    const view = await r.service.get(ORG, started.bisect.id);
    expect(view?.steps).toHaveLength(2);
    expect(view?.steps[1]?.candidate).toBe(4);
  });

  it("follows an automatic retry rather than reading the lost runner's job", async () => {
    const r = await rig();
    const started = await r.service.start(REQUEST);
    const first = started.steps[0]?.buildJobId ?? "";

    const retry = r.farm.retry(first);
    await r.service.onCompletion({ organizationId: ORG, jobId: first, status: "retried" });
    expect((await r.service.get(ORG, started.bisect.id))?.steps[0]).toMatchObject({
      buildJobId: retry.id,
      verdict: null,
    });

    r.farm.finish(retry.id, "failed");
    await r.service.onCompletion({ organizationId: ORG, jobId: retry.id, status: "failed" });
    expect((await r.service.get(ORG, started.bisect.id))?.steps[0]?.verdict).toBe("bad");
  });

  it("fails honestly when a step's job is canceled", async () => {
    const r = await rig();
    const started = await r.service.start(REQUEST);
    const job = started.steps[0]?.buildJobId ?? "";

    r.farm.finish(job, "canceled");
    await r.service.onCompletion({ organizationId: ORG, jobId: job, status: "canceled" });

    const view = await r.service.get(ORG, started.bisect.id);
    expect(view?.bisect.status).toBe("failed");
    expect(view?.bisect.note).toMatch(/step 1's farm job #\d+ was canceled/);
  });

  it("fails honestly when the farm refuses the step", async () => {
    const r = await rig();
    r.farm.missingPools.add("hil-rig");

    const view = await r.service.start(REQUEST);

    expect(view.bisect.status).toBe("failed");
    expect(view.bisect.note).toContain("the farm refused step 1");
  });

  it("answers the bisect already asking the same question instead of starting another", async () => {
    const r = await rig();
    const first = await r.service.start(REQUEST);

    const again = await r.service.start({ ...REQUEST, repository: HELIOS.slug });

    expect(again.bisect.id).toBe(first.bisect.id);
    expect(r.farm.list()).toHaveLength(1);
    const other = await r.service.start({ ...REQUEST, command: null });
    expect(other.bisect.id).not.toBe(first.bisect.id);
  });

  it("is cancellable, and cancels its open step's job", async () => {
    const r = await rig();
    const started = await r.service.start(REQUEST);

    const canceled = await r.service.cancel(ORG, started.bisect.id);

    expect(canceled?.bisect.status).toBe("canceled");
    expect(r.farm.job(started.steps[0]?.buildJobId ?? "").status).toBe("canceled");
    // A completion arriving afterwards changes nothing.
    await r.service.onCompletion({
      organizationId: ORG,
      jobId: started.steps[0]?.buildJobId ?? "",
      status: "canceled",
    });
    expect((await r.service.get(ORG, started.bisect.id))?.bisect.status).toBe("canceled");
  });

  it("confirms a one-commit line, and calls it inconclusive when it builds good", async () => {
    const r = await rig({ "bisect-commits": line(1) });
    const started = await r.service.start(REQUEST);
    expect(started.bisect.maxSteps).toBe(1);

    await drive(r, started.bisect.id, null, line(1).commits as string[]);

    const view = await r.service.get(ORG, started.bisect.id);
    expect(view?.bisect.status).toBe("inconclusive");
    expect(view?.bisect.note).toContain("built good");
    expect(r.farm.list()).toHaveLength(1);
  });

  it("refuses a repository the workspace has not enabled, and a blank test", async () => {
    const r = await rig();

    await expect(r.service.start({ ...REQUEST, repository: "acme/other" })).rejects.toBeInstanceOf(
      CodeRefusal,
    );
    await expect(r.service.start({ ...REQUEST, testRef: " " })).rejects.toMatchObject({
      refusalClass: "unsupported",
    });
    expect(r.farm.list()).toHaveLength(0);
  });

  it("ignores a completion that decides no bisect, and another workspace's bisect", async () => {
    const r = await rig();
    const started = await r.service.start(REQUEST);

    await r.service.onCompletion({ organizationId: ORG, jobId: "not-a-step", status: "failed" });
    await r.service.onCompletion({
      organizationId: "org-other",
      jobId: started.steps[0]?.buildJobId ?? "",
      status: "failed",
    });

    expect(await r.service.get("org-other", started.bisect.id)).toBeUndefined();
    expect((await r.service.get(ORG, started.bisect.id))?.steps[0]?.verdict).toBeNull();
  });
});
