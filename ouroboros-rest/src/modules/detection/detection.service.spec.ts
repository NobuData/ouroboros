/**
 * `DetectionService` ([#384](https://github.com/NobuData/ouroboros/issues/384)) — debounce and
 * joining, the source a scan rides, what is stored, reconciliation, and failure — over an
 * in-memory store and a fixture provider.
 */

import { ConflictError, NotFoundError } from "../errors/error.envelope";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import { DETECTION_ERRORS } from "./detection.errors";
import { ZEPHYR } from "./detection.fixture";
import type { MeasuredTests } from "./detection.reconcile";
import { RulePackRegistry } from "./detection.registry";
import { DEFAULT_SCAN_BUDGET } from "./detection.scan";
import { DetectionService, RESCAN_INTERVAL_SECONDS } from "./detection.service";
import {
  DETECTION_NOW,
  DETECTION_REPO,
  DETECTION_WORKSPACE,
  FixtureOpener,
  InMemoryDetectionStore,
  detectionSource,
  fixtureProvider,
  fixtureRegistry,
} from "./detection.store.fixture";
import { CORE_PACKS } from "./packs/core.packs";

const MEASURED: MeasuredTests = {
  testRunId: "7e570000-0000-0000-0000-000000000001",
  runId: "7e570000-0000-0000-0000-000000000002",
  suites: 5,
  tests: 71,
  startedAt: DETECTION_NOW,
};

/**
 * A service over the fixtures.
 *
 * @param provider - The provider the registry holds.
 * @returns The service and its world.
 */
function build(provider: unknown = fixtureProvider(ZEPHYR)) {
  const store = new InMemoryDetectionStore();
  const opener = new FixtureOpener();
  const service = new DetectionService(
    store,
    fixtureRegistry(provider),
    opener,
    new RulePackRegistry(CORE_PACKS),
    DEFAULT_SCAN_BUDGET,
  );

  return { store, opener, service };
}

/**
 * Seconds after the fixture clock.
 *
 * @param seconds - How many.
 * @returns The instant.
 */
function after(seconds: number): Date {
  return new Date(DETECTION_NOW.getTime() + seconds * 1000);
}

/**
 * The domain error a promise rejected with.
 *
 * @param promise - The promise.
 * @returns The error.
 */
async function refusal(promise: Promise<unknown>): Promise<ConflictError | NotFoundError> {
  return promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error as ConflictError,
  );
}

describe("starting a scan", () => {
  it("answers at once with running progress, then stores the scan at scan_seq 1", async () => {
    const { service, store, opener } = build();
    const started = await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);

    expect(started).toEqual({
      joined: false,
      progress: {
        state: "running",
        startedAt: DETECTION_NOW.toISOString(),
        finishedAt: null,
        probesPlanned: 0,
        probesSettled: 0,
        scanSeq: null,
        error: null,
      },
    });

    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(opener.opened).toEqual([detectionSource()]);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      organizationId: DETECTION_WORKSPACE,
      repo: DETECTION_REPO,
      scanSeq: 1,
      probesUsed: 9,
      protectedPaths: ["boot/**", "keys/**"],
      packVersions: { language: "1.0.0", conventions: "1.1.0" },
    });
    expect(store.records[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(store.records[0]?.rows.map((row) => row.rowKey)).toEqual([
      "language",
      "build",
      "devcontainer",
      "tests",
      "protected_paths",
      "conventions",
    ]);

    const read = await service.read(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(read.progress).toMatchObject({
      state: "done",
      scanSeq: 1,
      probesPlanned: 9,
      probesSettled: 9,
    });
    expect(read.progress?.finishedAt).not.toBeNull();
  });

  it("compares the repository case-insensitively", async () => {
    const { service, store } = build();

    await service.start(DETECTION_WORKSPACE, "Acme-Robotics/Helios-Firmware", DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(store.records[0]?.repo).toBe(DETECTION_REPO);
  });

  it("joins the running scan rather than starting a second", async () => {
    const { service, store, opener } = build();
    let release = (): void => undefined;

    opener.gate = new Promise((resolve) => {
      release = resolve;
    });

    const first = await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    const second = await service.start(DETECTION_WORKSPACE, DETECTION_REPO, after(1));

    expect(second).toEqual({ joined: true, progress: first.progress });
    expect((await service.read(DETECTION_WORKSPACE, DETECTION_REPO)).progress?.state).toBe(
      "running",
    );

    release();
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(store.records).toHaveLength(1);
    expect(opener.opened).toHaveLength(1);
  });

  it("is debounced: a re-scan inside the window is refused with how long to wait", async () => {
    const { service } = build();

    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    const error = await refusal(service.start(DETECTION_WORKSPACE, DETECTION_REPO, after(10)));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.rescanTooSoon,
      details: { retryAfterSeconds: RESCAN_INTERVAL_SECONDS - 10 },
    });
  });

  it("versions a re-scan by scan_seq, and keeps the prior scan readable", async () => {
    const { service, store } = build();

    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);
    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, after(RESCAN_INTERVAL_SECONDS));
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(store.records.map((record) => record.scanSeq)).toEqual([1, 2]);
    expect((await service.read(DETECTION_WORKSPACE, DETECTION_REPO)).scan?.scanSeq).toBe(2);

    const prior = await service.readScan(DETECTION_WORKSPACE, DETECTION_REPO, 1);

    expect(prior.scan?.scanSeq).toBe(1);
    expect(prior.rows).toHaveLength(6);
    expect(prior.progress).toBeNull();
  });

  it("keeps a person's edited glob and suggests only what is new", async () => {
    const { service, store } = build();

    store.setPolicy(DETECTION_REPO, "boot/**", "edited");
    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect((await service.read(DETECTION_WORKSPACE, DETECTION_REPO)).protectedPaths).toEqual([
      { glob: "boot/**", source: "edited" },
      { glob: "keys/**", source: "suggested" },
    ]);
  });
});

describe("editing the protected paths (#391)", () => {
  it("replaces the list with the person's, every glob edited, and answers the card", async () => {
    const { service, store } = build();

    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    const card = await service.editProtectedPaths(DETECTION_WORKSPACE, DETECTION_REPO, [
      "boot/**",
      "firmware/keys/**",
      "boot/**",
    ]);

    expect(card.protectedPaths).toEqual([
      { glob: "boot/**", source: "edited" },
      { glob: "firmware/keys/**", source: "edited" },
    ]);
    expect(card.scan?.scanSeq).toBe(1);
    expect(store.edited.has(`${DETECTION_WORKSPACE}|${DETECTION_REPO}`)).toBe(true);
  });

  it("compares the repository case-insensitively", async () => {
    const { service } = build();

    await service.editProtectedPaths(DETECTION_WORKSPACE, "Acme-Robotics/Helios-Firmware", [
      "boot/**",
    ]);

    expect((await service.read(DETECTION_WORKSPACE, DETECTION_REPO)).protectedPaths).toEqual([
      { glob: "boot/**", source: "edited" },
    ]);
  });

  it("saves an empty list — nothing protected — and no later scan suggests over it", async () => {
    const { service } = build();

    await service.editProtectedPaths(DETECTION_WORKSPACE, DETECTION_REPO, []);
    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    const card = await service.read(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(card.scan?.scanSeq).toBe(1);
    expect(card.protectedPaths).toEqual([]);
  });

  it("refuses every glob the guardrails cannot enforce, naming each, and writes nothing", async () => {
    const { service, store } = build();

    store.setPolicy(DETECTION_REPO, "boot/**", "suggested");

    const error = await refusal(
      service.editProtectedPaths(DETECTION_WORKSPACE, DETECTION_REPO, [
        "keys/**",
        "/etc/**",
        "../secrets/**",
        " boot/**",
        "",
        "win\\path",
      ]),
    );

    expect(error.getStatus()).toBe(422);
    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.globInvalid,
      details: { invalid: ["/etc/**", "../secrets/**", " boot/**", "", "win\\path"] },
    });
    expect((await service.read(DETECTION_WORKSPACE, DETECTION_REPO)).protectedPaths).toEqual([
      { glob: "boot/**", source: "suggested" },
    ]);
    expect(store.edited.size).toBe(0);
  });

  it("never touches another workspace's list", async () => {
    const { service } = build();

    await service.editProtectedPaths(DETECTION_WORKSPACE, DETECTION_REPO, ["boot/**"]);

    expect((await service.read("org-elsewhere", DETECTION_REPO)).protectedPaths).toEqual([]);
  });
});

describe("the source a scan rides", () => {
  it("is refused when the workspace has none", async () => {
    const { service, store } = build();

    store.sources = [];

    const error = await refusal(service.start(DETECTION_WORKSPACE, DETECTION_REPO));

    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.sourceMissing,
      details: { repo: DETECTION_REPO },
    });
    expect((await service.read(DETECTION_WORKSPACE, DETECTION_REPO)).progress).toBeNull();
  });

  it("is refused when no source covers the repository", async () => {
    const { service } = build();
    const error = await refusal(service.start(DETECTION_WORKSPACE, "acme-robotics/other"));

    expect(error.getResponse()).toMatchObject({ code: DETECTION_ERRORS.sourceMissing });
  });

  it("is refused when the covering source's provider cannot probe", async () => {
    const tracker = { kind: "jira", capabilities: () => ({ probe: { repoProbes: false } }) };
    const { service } = build(tracker);
    const error = await refusal(service.start(DETECTION_WORKSPACE, DETECTION_REPO));

    expect(error.getResponse()).toMatchObject({ code: DETECTION_ERRORS.sourceMissing });
  });

  it("is the first that covers the repository", async () => {
    const { service, store, opener } = build();
    const other = detectionSource({
      sourceId: "d3700000-0000-0000-0000-000000000002",
      config: { login: "acme-robotics", repos: ["other"] },
    });

    store.sources = [other, detectionSource()];
    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(opener.opened.map((source) => source.sourceId)).toEqual([detectionSource().sourceId]);
  });
});

describe("a scan that fails", () => {
  it("reports failed progress, stores nothing, and never echoes the credential", async () => {
    const { service, store, opener } = build();

    opener.failure = new TicketSourceError("auth", "the stored credential could not be opened");
    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    const read = await service.read(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(read.progress).toMatchObject({ state: "failed", error: "the source refused (auth)" });
    expect(JSON.stringify(read)).not.toContain("ghp_");
    expect(store.records).toEqual([]);
  });

  it("stores the rows it could determine when the host rate-limits mid-scan", async () => {
    const { service, store } = build(fixtureProvider(ZEPHYR, { remaining: 2 }));

    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    const rows = store.records[0]?.rows ?? [];

    expect(rows).toHaveLength(6);
    expect(rows.some((row) => row.evidence.undetermined === true)).toBe(true);
    expect(rows.find((row) => row.rowKey === "conventions")?.verdict).toBe("warn");
  });
});

describe("detected → measured", () => {
  it("stores the tests row measured when the test plane already has results", async () => {
    const { service, store } = build();

    store.measured = MEASURED;
    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(store.records[0]?.rows.find((row) => row.rowKey === "tests")).toMatchObject({
      label: "measured",
      value: "5 suites, 71 tests (measured)",
      evidence: { detected: "5 suites, 63 tests (detected)" },
    });
  });

  it("relabels a stored detected row on read once results exist — and stores the relabel", async () => {
    const { service, store } = build();

    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    const before = await service.read(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(before.rows.find((row) => row.rowKey === "tests")?.label).toBe("detected");
    expect(store.relabels).toEqual([]);

    store.measured = MEASURED;

    const after = await service.read(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(after.rows.find((row) => row.rowKey === "tests")).toMatchObject({
      label: "measured",
      value: "5 suites, 71 tests (measured)",
      confidence: "high",
      determined: true,
    });
    expect(store.relabels).toHaveLength(1);
    expect(store.relabels[0]).toMatchObject({ scanSeq: 1, row: { label: "measured" } });

    // A measured row is not relabelled twice.
    await service.read(DETECTION_WORKSPACE, DETECTION_REPO);

    expect(store.relabels).toHaveLength(1);
  });
});

describe("reading", () => {
  it("answers a repository never scanned with no scan, rather than a 404", async () => {
    const { service } = build();

    await expect(service.read(DETECTION_WORKSPACE, DETECTION_REPO)).resolves.toEqual({
      repo: DETECTION_REPO,
      scan: null,
      rows: [],
      protectedPaths: [],
      progress: null,
    });
  });

  it("refuses a scan number the repository does not have", async () => {
    const { service } = build();
    const error = await refusal(service.readScan(DETECTION_WORKSPACE, DETECTION_REPO, 7));

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.getResponse()).toMatchObject({
      code: DETECTION_ERRORS.scanNotFound,
      details: { scanSeq: 7 },
    });
  });

  it("never reads another workspace's scan", async () => {
    const { service } = build();

    await service.start(DETECTION_WORKSPACE, DETECTION_REPO, DETECTION_NOW);
    await service.settled(DETECTION_WORKSPACE, DETECTION_REPO);

    expect((await service.read("org-elsewhere", DETECTION_REPO)).scan).toBeNull();
  });
});

describe("reading a repository's files (BF.4's import, #413)", () => {
  it("answers each path through the covering source, null where the file is absent", async () => {
    const provider = fixtureProvider({ languages: {}, files: { "CLAUDE.md": "# Rules\n" } });
    const { service, opener } = build(provider);
    const files = await service.readFiles(DETECTION_WORKSPACE, "Acme-Robotics/Helios-Firmware", [
      "CLAUDE.md",
      ".cursorrules",
    ]);

    expect([...files.entries()]).toEqual([
      ["CLAUDE.md", { path: "CLAUDE.md", content: "# Rules\n", size: 8 }],
      [".cursorrules", null],
    ]);
    expect(provider.calls).toEqual(["file:CLAUDE.md", "file:.cursorrules"]);
    expect(opener.opened).toEqual([detectionSource()]);
  });

  it("is refused when no source covers the repository, having opened nothing", async () => {
    const { service, opener } = build();
    const error = await refusal(service.readFiles(DETECTION_WORKSPACE, "acme-robotics/other", []));

    expect(error.getResponse()).toMatchObject({ code: DETECTION_ERRORS.sourceMissing });
    expect(opener.opened).toEqual([]);
  });

  it("lets the host's refusal through, for the caller to classify", async () => {
    const provider = fixtureProvider(ZEPHYR, { remaining: 0 });
    const { service } = build(provider);

    await expect(
      service.readFiles(DETECTION_WORKSPACE, DETECTION_REPO, ["CLAUDE.md"]),
    ).rejects.toMatchObject({ errorClass: "rate_limit" });
  });
});

describe("listing a repository's tree and picked files (BF.6's repo-map, #415)", () => {
  it("lists the tree once, then reads only the paths picked from it, on one credential", async () => {
    const provider = fixtureProvider(ZEPHYR);
    const { service, opener } = build(provider);
    const { tree, files } = await service.readTree(DETECTION_WORKSPACE, DETECTION_REPO, (listed) =>
      listed.entries.some((entry) => entry.path === "west.yml") ? ["west.yml", "CODEOWNERS"] : [],
    );

    expect(tree.entries.some((entry) => entry.path === "src/main.c")).toBe(true);
    expect([...files.keys()]).toEqual(["west.yml", "CODEOWNERS"]);
    expect(files.get("CODEOWNERS")).toBeNull();
    expect(provider.calls).toEqual(["tree", "file:west.yml", "file:CODEOWNERS"]);
    expect(opener.opened).toHaveLength(1);
  });

  it("lets the host's refusal through, sending nothing after it", async () => {
    const provider = fixtureProvider(ZEPHYR, { remaining: 0 });
    const { service } = build(provider);

    await expect(
      service.readTree(DETECTION_WORKSPACE, DETECTION_REPO, () => ["CODEOWNERS"]),
    ).rejects.toMatchObject({ errorClass: "rate_limit" });
  });
});
