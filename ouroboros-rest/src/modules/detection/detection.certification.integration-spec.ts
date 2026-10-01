/**
 * **Repository detection, certified end to end** — BB.6
 * ([#389](https://github.com/NobuData/ouroboros/issues/389)).
 *
 * The rule packs are declarative, which makes them easy to get subtly wrong: a probe-table entry
 * that no longer matches a renamed manifest produces a *confident* wrong row. So this suite scans
 * the four archetype trees the way the card does — `POST /onboarding/detection/scan`, through the
 * application's own registry, GitHub provider, rate guard and rule packs, into V067's tables —
 * and holds what `GET /onboarding/detection` then serves to a committed golden file. One provider
 * is replaced: the Octokit factory, by `ArchetypeHost`, so no request leaves the process.
 *
 *   * **Golden row sets** — Zephyr-like, Node, Python, empty: every row with its evidence, the
 *     suggested protected paths, the pack versions and the probes spent
 *     (`detection.archetypes.golden.json`). Removing a rule pack removes its row from all four.
 *   * **Evidence shape** — every row names the pack and version that concluded it and the probes
 *     it read, each of which the host was really asked.
 *   * **`scan_seq` versioning and the debounce** — a second click joins the running scan, a
 *     re-scan inside the window is refused with how long to wait, and a re-scan after it is
 *     scan 2 with scan 1 still readable.
 *   * **Detected → measured** — the tests row is relabelled, and stored relabelled, once the test
 *     plane has a completed run for the repository.
 *   * **Extensibility** — a pack registered beside the core adds a `custom:*` row with the six
 *     core rows byte-for-byte unchanged.
 *   * **Budget exhaustion** — a scan that runs out of probes stores every row, marks the ones it
 *     could not determine, and suggests no protected path it did not conclude.
 *
 * **Mutation checks** (run for #389):
 *   * `TESTS_PACK` filtered out of `CORE_PACKS` → all four golden cases red, and the three
 *     detected → measured cases with them.
 *   * `build.pack`'s `west.yml` entry renamed → all four golden cases red: the Zephyr row loses
 *     its conclusion, and every archetype's evidence lists the probe table it was checked against.
 *   * `DetectionService.start` skipping the debounce → *refuses a re-scan inside the window* red.
 *   * `DetectionService.reconciled` no longer relabelling → *relabels the tests row* red.
 *   * `DetectionRepository.scan` ordering by `created_at, id` again → the golden cases red: the
 *     defect this suite found, where a real scan's card came back in the order of its random ids.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/detection/detection.certification
 * OURO_UPDATE_GOLDENS=1 yarn test:integration src/modules/detection/detection.certification
 * ```
 */

import { join } from "node:path";

import { workspaceWithRepo, type SeededWorkspace } from "../../testing/dashboard.fixture";
import { GoldenFile } from "../../testing/golden.fixture";
import { ApiHarness, type Person, type ProviderOverride } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { OCTOKIT_FACTORY } from "../github/github.client.factory";
import {
  connectGithub,
  inWorkspace,
  repoRef,
  wizardRoute,
} from "../onboarding/onboarding.integration.fixture";
import { VaultService } from "../vault/vault.service";
import {
  ARCHETYPES,
  ARCHETYPE_NAMES,
  ARCHETYPE_TOKEN,
  ArchetypeHost,
  type Archetype,
} from "./detection.archetypes.fixture";
import { DETECTION_ERRORS } from "./detection.errors";
import { LICENSE_PACK, type FixtureRepo } from "./detection.fixture";
import { CORE_ROW_KEYS } from "./detection.pack";
import { RULE_PACKS } from "./detection.registry";
import type {
  DetectionResource,
  DetectionRowResource,
  RescanResource,
} from "./detection.resources";
import { DEFAULT_SCAN_BUDGET, UNDETERMINED_SENTENCES } from "./detection.scan";
import { DetectionService, RESCAN_INTERVAL_SECONDS, SCAN_BUDGET } from "./detection.service";
import { CORE_PACKS } from "./packs/core.packs";

const GOLDEN_PATH = join(__dirname, "detection.archetypes.golden.json");

/** What the golden file says it holds. */
const GOLDEN_ABOUT =
  "What GET /api/v1/onboarding/detection serves after a scan of each repository archetype " +
  "(detection.fixture.ts) through the application's own GitHub provider and rule packs: the " +
  "card's rows with their evidence, the suggested protected paths, the pack versions and the " +
  "probes spent.";

/** The command that rewrites it. */
const GOLDEN_REGENERATE =
  "OURO_UPDATE_GOLDENS=1 yarn test:integration src/modules/detection/detection.certification";

/** A workspace with a GitHub source over one repository of the archetype host. */
interface Bench {
  readonly owner: Person;
  readonly workspace: SeededWorkspace;
  /** `owner/name`. */
  readonly repo: string;
}

/** What a golden case records of a served scan: everything that does not depend on the clock. */
interface GoldenScan {
  readonly rows: readonly DetectionRowResource[];
  readonly protectedPaths: DetectionResource["protectedPaths"];
  readonly packVersions: Readonly<Record<string, unknown>>;
  readonly probeBudgetUsed: number | null;
}

/**
 * The clock-free part of a served scan.
 *
 * @param served - `GET /onboarding/detection`.
 * @returns The rows, the policies and the scan's own accounting.
 */
function goldenOf(served: DetectionResource): GoldenScan {
  return {
    rows: served.rows,
    protectedPaths: served.protectedPaths,
    packVersions: served.scan?.packVersions ?? {},
    probeBudgetUsed: served.scan?.probeBudgetUsed ?? null,
  };
}

/**
 * The probe keys a host was asked, as the rule packs name them.
 *
 * @param host - The archetype host.
 * @param repo - The repository.
 * @returns `languages`, `tree` and `file:<path>` keys, in request order.
 */
function probesAsked(host: ArchetypeHost, repo: string): string[] {
  return host.requestsFor(repo).map((request) => {
    if (request.path !== undefined) {
      return `file:${request.path}`;
    }

    return request.route.endsWith("/languages") ? "languages" : "tree";
  });
}

describe("repository detection, end to end on the archetype trees", () => {
  const host = new ArchetypeHost();
  /** The harness under the case — each `describe` below starts its own. */
  let api: ApiHarness;

  /**
   * Start the application with the archetype host behind its Octokit seam.
   *
   * @param providers - Further providers to replace — the rule packs, the scan budget.
   * @returns The harness.
   */
  function start(providers: readonly ProviderOverride[] = []): Promise<ApiHarness> {
    // A day, so the application's own sync loops cannot reach the host in the middle of a test.
    return ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" }, [
      { provide: OCTOKIT_FACTORY, useValue: host.factory },
      ...providers,
    ]);
  }

  beforeEach(() => {
    host.clear();
  });

  /**
   * A workspace whose GitHub source — token sealed in the vault — covers a repository the host
   * serves from a tree.
   *
   * @param tree - The repository's contents.
   * @returns The bench.
   */
  async function bench(tree: FixtureRepo): Promise<Bench> {
    const owner = await api.signIn();
    const workspace = await workspaceWithRepo(api, owner);
    const repo = repoRef(workspace);
    const sourceId = await connectGithub(api, workspace);
    const sealed = await api.nest
      .get(VaultService)
      .encryptText(workspace.id, sourceId, ARCHETYPE_TOKEN);

    await api.sql.query(
      `update ${SCHEMA_NAME}.ticket_sources set credentials_encrypted = $2 where id = $1`,
      [sourceId, sealed],
    );
    host.serve(repo, tree);

    return { owner, workspace, repo };
  }

  /** `POST /onboarding/detection/scan`, status left to the caller. */
  function requestScan(at: Bench) {
    return inWorkspace(
      api,
      at.owner,
      at.workspace,
    )("post", wizardRoute(at.repo, "/detection/scan"));
  }

  /** `GET /onboarding/detection` — the card. */
  async function card(at: Bench): Promise<DetectionResource> {
    const response = await inWorkspace(
      api,
      at.owner,
      at.workspace,
    )("get", wizardRoute(at.repo, "/detection")).expect(200);

    return bodyOf<DetectionResource>(response);
  }

  /** `GET /onboarding/detection/scans/{scanSeq}`, status left to the caller. */
  function earlier(at: Bench, scanSeq: number) {
    return inWorkspace(
      api,
      at.owner,
      at.workspace,
    )("get", wizardRoute(at.repo, `/detection/scans/${String(scanSeq)}`));
  }

  /**
   * Click *Re-scan*, wait for the background scan, and read the card.
   *
   * @param at - The bench.
   * @returns The card once the scan has settled.
   */
  async function scan(at: Bench): Promise<DetectionResource> {
    const started = bodyOf<RescanResource>(await requestScan(at).expect(202));

    expect(started.joined).toBe(false);
    await api.nest.get(DetectionService).settled(at.workspace.id, at.repo);

    return card(at);
  }

  /**
   * A re-scan after the debounce window has passed — the clock moved, not waited out.
   *
   * @param at - The bench.
   * @returns The card once that scan has settled.
   */
  async function rescanLater(at: Bench): Promise<DetectionResource> {
    const detection = api.nest.get(DetectionService);
    const later = new Date(Date.now() + (RESCAN_INTERVAL_SECONDS + 1) * 1000);

    await detection.start(at.workspace.id, at.repo, later);
    await detection.settled(at.workspace.id, at.repo);

    return card(at);
  }

  /** The test plane's data appearing: a completed test run of the repository, two suites. */
  async function measure(at: Bench): Promise<void> {
    const { rows: runs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.runs
              (organization_id, github_repo_id, issue_number, issue_title, workflow_tag, model,
               status, stage_label, stage_index, stage_total, started_at)
       values ($1, $2, 482, 'Fix flaky CAN-bus telemetry test', 'standard-fix', 'claude-fable-5',
               'building', 'Build farm', 5, 6, now() - interval '1 day')
       returning id`,
      [at.workspace.id, at.workspace.repoId],
    );
    const { rows: attempts } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.test_runs
              (organization_id, run_id, attempt_seq, total, passed, status)
       values ($1, $2, 1, 71, 71, 'complete') returning id`,
      [at.workspace.id, runs[0].id],
    );

    for (const name of ["kernel.timer", "drivers.i2c"]) {
      await api.sql.query(
        `insert into ${SCHEMA_NAME}.test_suites
                (organization_id, test_run_id, name, platform, kind)
         values ($1, $2, $3, 'native_sim', 'sim')`,
        [at.workspace.id, attempts[0].id, name],
      );
    }
  }

  describe("with the core packs and the default budget", () => {
    const golden = new GoldenFile(GOLDEN_PATH, GOLDEN_ABOUT, GOLDEN_REGENERATE);

    beforeAll(async () => {
      api = await start();
    });

    afterAll(async () => {
      golden.save();
      await api.close();
    });

    afterEach(() => api.truncate());

    describe("golden row sets", () => {
      it.each(ARCHETYPE_NAMES)(
        "%s: a scan stores, and the card serves, its golden rows",
        async (name: Archetype) => {
          const at = await bench(ARCHETYPES[name]);

          const served = await scan(at);

          expect(served.progress).toMatchObject({ state: "done", scanSeq: 1, error: null });
          expect(served.scan?.scanSeq).toBe(1);
          // Six rows, in card order, each one concluded: a rule pack that is gone takes its row
          // with it, whatever the golden file says.
          expect(served.rows.map((row) => row.rowKey)).toEqual([...CORE_ROW_KEYS]);
          expect(served.rows.every((row) => row.determined)).toBe(true);
          golden.hold(name, goldenOf(served));
        },
      );

      it("records exactly the four archetypes", () => {
        if (!golden.updating) {
          expect(golden.names()).toEqual(ARCHETYPE_NAMES);
        }
      });
    });

    describe("the evidence payload", () => {
      it.each(ARCHETYPE_NAMES)(
        "%s: every row names its pack, its version, and probes the host was really asked",
        async (name: Archetype) => {
          const at = await bench(ARCHETYPES[name]);

          const served = await scan(at);
          const asked = probesAsked(host, at.repo);
          const owners = new Map(
            CORE_PACKS.flatMap((pack) => pack.rows.map((row) => [row as string, pack] as const)),
          );

          for (const row of served.rows) {
            const pack = owners.get(row.rowKey);

            expect(row.evidence).toMatchObject({
              pack: pack?.key,
              packVersion: pack?.version,
              confidence: row.confidence,
            });
            expect(served.scan?.packVersions[String(row.evidence.pack)]).toBe(pack?.version);
            expect(["high", "medium", "low"]).toContain(row.confidence);
            expect(row.label).toBe("detected");
            expect(Array.isArray(row.evidence.probes)).toBe(true);
            // A row cites only what was read: every probe in its evidence is a request the host saw.
            expect(asked).toEqual(expect.arrayContaining(row.evidence.probes as string[]));
          }

          // The budget is counted in real requests, each made once.
          expect(new Set(asked).size).toBe(asked.length);
          expect(served.scan?.probeBudgetUsed).toBe(asked.length);
        },
      );

      it("opens the source's sealed token for the scan, and never serves it", async () => {
        const at = await bench(ARCHETYPES.zephyr);

        const served = await scan(at);

        expect(host.tokens.length).toBeGreaterThan(0);
        expect(new Set(host.tokens)).toEqual(new Set([ARCHETYPE_TOKEN]));
        expect(JSON.stringify(served)).not.toContain(ARCHETYPE_TOKEN);
      });
    });

    describe("scan_seq versioning and the debounce", () => {
      it("joins the running scan on a second click rather than starting another", async () => {
        const at = await bench(ARCHETYPES.zephyr);
        const release = host.hold();

        const first = bodyOf<RescanResource>(await requestScan(at).expect(202));
        const second = bodyOf<RescanResource>(await requestScan(at).expect(202));

        expect(first).toMatchObject({ joined: false, progress: { state: "running" } });
        expect(second).toMatchObject({ joined: true, progress: { state: "running" } });
        expect((await card(at)).scan).toBeNull();

        release();
        await api.nest.get(DetectionService).settled(at.workspace.id, at.repo);

        // One scan ran: scan 1, and no scan 2.
        expect((await card(at)).scan?.scanSeq).toBe(1);
        await earlier(at, 2).expect(404);
      });

      it("refuses a re-scan inside the window, saying how long to wait, and spends nothing", async () => {
        const at = await bench(ARCHETYPES.zephyr);

        await scan(at);

        const spent = host.requestsFor(at.repo).length;
        const refused = await requestScan(at).expect(409);
        const envelope = bodyOf<ErrorEnvelope>(refused);

        expect(envelope.code).toBe(DETECTION_ERRORS.rescanTooSoon);
        expect(envelope.details.retryAfterSeconds).toBeGreaterThan(0);
        expect(envelope.details.retryAfterSeconds).toBeLessThanOrEqual(RESCAN_INTERVAL_SECONDS);
        expect(host.requestsFor(at.repo)).toHaveLength(spent);
        expect((await card(at)).scan?.scanSeq).toBe(1);
      });

      it("stores a re-scan after the window as scan 2, and keeps scan 1 readable as it was", async () => {
        const at = await bench(ARCHETYPES.zephyr);
        const first = await scan(at);

        // The repository changed between the scans: it is the Node service now.
        host.serve(at.repo, ARCHETYPES.node);

        const second = await rescanLater(at);
        const prior = bodyOf<DetectionResource>(await earlier(at, 1).expect(200));

        expect(second.scan?.scanSeq).toBe(2);
        expect(second.rows.find((row) => row.rowKey === "build")?.value).toBe(
          "yarn + jest (found package.json)",
        );
        expect(prior.scan).toEqual(first.scan);
        expect(prior.rows).toEqual(first.rows);

        const missing = await earlier(at, 3).expect(404);

        expect(bodyOf<ErrorEnvelope>(missing).code).toBe(DETECTION_ERRORS.scanNotFound);
      });

      it("adds a re-scan's new suggestions to the protected paths, never overwriting an edited one", async () => {
        const at = await bench(ARCHETYPES.zephyr);

        await scan(at);
        await api.sql.query(
          `update ${SCHEMA_NAME}.protected_path_policies set source = 'edited'
            where organization_id = $1 and path_glob = 'boot/**'`,
          [at.workspace.id],
        );
        host.serve(at.repo, {
          ...ARCHETYPES.zephyr,
          files: { ...ARCHETYPES.zephyr.files, "infra/main.tf": "# terraform\n" },
        });

        const second = await rescanLater(at);

        expect(second.protectedPaths).toEqual([
          { glob: "boot/**", source: "edited" },
          { glob: "infra/**", source: "suggested" },
          { glob: "keys/**", source: "suggested" },
        ]);
      });

      it("refuses to scan a repository no connected source covers", async () => {
        const at = await bench(ARCHETYPES.zephyr);
        const elsewhere = { ...at, repo: repoRef(at.workspace, "atlas-control") };

        const refused = await requestScan(elsewhere).expect(409);

        expect(bodyOf<ErrorEnvelope>(refused).code).toBe(DETECTION_ERRORS.sourceMissing);
        expect(host.requests).toEqual([]);
      });
    });

    describe("detected → measured", () => {
      /** The stored tests row of a scan, straight from V067's table. */
      async function storedTests(at: Bench, scanSeq: number) {
        const { rows } = await api.sql.query<{ label: string; value: string }>(
          `select label, value from ${SCHEMA_NAME}.repo_detections
            where organization_id = $1 and repo_ref = $2 and scan_seq = $3 and row_key = 'tests'`,
          [at.workspace.id, at.repo, scanSeq],
        );

        return rows[0];
      }

      it("relabels the tests row on the next read once the test plane has results, and stores it", async () => {
        const at = await bench(ARCHETYPES.zephyr);
        const detected = await scan(at);
        const before = detected.rows.find((row) => row.rowKey === "tests");

        expect(before).toMatchObject({ label: "detected", value: "5 suites, 63 tests (detected)" });

        await measure(at);

        const measured = await card(at);
        const after = measured.rows.find((row) => row.rowKey === "tests");

        expect(after).toMatchObject({
          label: "measured",
          value: "2 suites, 71 tests (measured)",
          confidence: "high",
          evidence: {
            source: "test_plane",
            suites: 2,
            tests: 71,
            // What the scan had concluded is kept beside what was measured.
            detected: "5 suites, 63 tests (detected)",
            detectedEvidence: before?.evidence,
          },
        });
        // Only the tests row moved.
        expect(measured.rows.filter((row) => row.rowKey !== "tests")).toEqual(
          detected.rows.filter((row) => row.rowKey !== "tests"),
        );
        // Stored, so every later read — and the earlier-scan route — agrees.
        expect(await storedTests(at, 1)).toEqual({
          label: "measured",
          value: "2 suites, 71 tests (measured)",
        });
        expect(
          bodyOf<DetectionResource>(await earlier(at, 1).expect(200)).rows.find(
            (row) => row.rowKey === "tests",
          )?.label,
        ).toBe("measured");
      });

      it("stores a scan measured from the start when results already exist", async () => {
        const at = await bench(ARCHETYPES.zephyr);

        await measure(at);
        await scan(at);

        expect(await storedTests(at, 1)).toEqual({
          label: "measured",
          value: "2 suites, 71 tests (measured)",
        });
      });

      it("leaves an archetype with no test-plane data detected", async () => {
        const at = await bench(ARCHETYPES.node);

        await scan(at);

        expect(await storedTests(at, 1)).toEqual({
          label: "detected",
          value: "2 suites, 5 tests (detected)",
        });
      });
    });
  });

  describe("with a rule pack registered beside the core", () => {
    /** The Zephyr archetype with a licence file for the test pack to find. */
    const LICENSED: FixtureRepo = {
      ...ARCHETYPES.zephyr,
      files: { ...ARCHETYPES.zephyr.files, LICENSE: "Apache License\nVersion 2.0, January 2004\n" },
    };

    beforeAll(async () => {
      api = await start([{ provide: RULE_PACKS, useValue: [...CORE_PACKS, LICENSE_PACK] }]);
    });

    afterAll(() => api.close());
    afterEach(() => api.truncate());

    it("adds its custom row to the stored card", async () => {
      const served = await scanned(LICENSED);

      expect(served.rows.map((row) => row.rowKey)).toEqual([...CORE_ROW_KEYS, "custom:license"]);
      expect(served.rows.at(-1)).toMatchObject({
        rowKey: "custom:license",
        verdict: "ok",
        value: "Apache License",
        label: "detected",
        determined: true,
        evidence: { pack: "license", packVersion: "0.1.0", hit: "LICENSE" },
      });
      expect(served.packVersions).toMatchObject({ license: "0.1.0" });
    });

    it("leaves the six core rows exactly as the core packs alone produce them", async () => {
      // Compare-only: this case reads the Zephyr golden the core suite above recorded.
      const committed = new GoldenFile(GOLDEN_PATH, GOLDEN_ABOUT, GOLDEN_REGENERATE, false);
      const served = await scanned(ARCHETYPES.zephyr);
      const { license, ...corePackVersions } = served.packVersions;

      expect(license).toBe("0.1.0");
      committed.hold("zephyr", {
        rows: served.rows.slice(0, CORE_ROW_KEYS.length),
        protectedPaths: served.protectedPaths,
        packVersions: corePackVersions,
        // The pack cost its one file: the tree it also reads was already there.
        probeBudgetUsed: (served.probeBudgetUsed ?? 0) - 1,
      } satisfies GoldenScan);
    });

    it("says so honestly when the pack finds nothing", async () => {
      const served = await scanned(ARCHETYPES.python);

      expect(served.rows.at(-1)).toMatchObject({
        rowKey: "custom:license",
        verdict: "missing",
        value: "No LICENSE found",
      });
    });

    /** Scan a tree in a fresh workspace and answer its clock-free card. */
    async function scanned(tree: FixtureRepo): Promise<GoldenScan> {
      return goldenOf(await scan(await bench(tree)));
    }
  });

  describe("with a probe budget too small for the repository", () => {
    const MAX_PROBES = 4;

    beforeAll(async () => {
      api = await start([
        { provide: SCAN_BUDGET, useValue: { ...DEFAULT_SCAN_BUDGET, maxProbes: MAX_PROBES } },
      ]);
    });

    afterAll(() => api.close());
    afterEach(() => api.truncate());

    it("stores every row, marks the ones it could not determine, and stops at the budget", async () => {
      const at = await bench(ARCHETYPES.zephyr);

      const served = await scan(at);
      const undetermined = served.rows.filter((row) => !row.determined);
      const determined = served.rows.filter((row) => row.determined);

      // Never omitted: the card still has its six rows.
      expect(served.rows.map((row) => row.rowKey)).toEqual([...CORE_ROW_KEYS]);
      expect(served.progress).toMatchObject({ state: "done", scanSeq: 1 });
      expect(served.scan?.probeBudgetUsed).toBe(MAX_PROBES);
      expect(host.requestsFor(at.repo)).toHaveLength(MAX_PROBES);

      // Partial: some rows could not be concluded, and each says so rather than guessing.
      expect(undetermined.map((row) => row.rowKey)).toContain("tests");
      for (const row of undetermined) {
        expect(row).toMatchObject({
          verdict: "warn",
          value: `Could not determine — ${UNDETERMINED_SENTENCES.budget_exhausted}`,
          confidence: "low",
          evidence: { undetermined: true, reason: "budget_exhausted" },
        });
      }

      // Honest: what it did conclude is what an unbounded scan concludes.
      expect(determined.length).toBeGreaterThan(0);
      expect(determined.find((row) => row.rowKey === "build")?.value).toBe(
        "west + twister (found west.yml)",
      );

      // And a protected path is suggested only by a pack that reached a conclusion.
      const paths = served.rows.find((row) => row.rowKey === "protected_paths");

      expect(served.protectedPaths.map((policy) => policy.glob)).toEqual(
        paths?.determined === true ? ["boot/**", "keys/**"] : [],
      );
    });
  });
});
