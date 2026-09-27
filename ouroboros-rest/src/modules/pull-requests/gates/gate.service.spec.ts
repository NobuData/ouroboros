import { Logger } from "@nestjs/common";

import type { PullRequestState } from "../../db/schema";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import { aggregate, type GateAggregate, type LatestResult } from "./gate.engine";
import type { GateEvidenceEvent } from "./gate.evidence";
import { ATTEMPT, BUILD, FILES, HEAD, HIL, REVISION_2 } from "./gate.matrix.fixture";
import { DEFAULT_ORG_GATE_CONFIG, type OrgGateConfig, type OrgGatePolicy } from "./gate.policy";
import type {
  EvidenceRows,
  GateStore,
  GateSubject,
  GateTransaction,
  PolicySources,
} from "./gate.repository";
import { GateEngineService, derivePolicy } from "./gate.service";
import type {
  GateDefinitionSpec,
  GatePr,
  GateResultRow,
  GateRevision,
  StoredGateDefinition,
} from "./gate.types";

/**
 * `GateEngineService` over an in-memory store (AX.2, [#358](https://github.com/NobuData/ouroboros/issues/358))
 * — what it writes per revision, when it writes nothing, and the state it moves. The statements
 * themselves are `gates.integration-spec.ts`'s.
 */

/** One stored result. */
interface StoredResult extends GateResultRow {
  readonly revisionId: string;
}

/** A store that keeps PR #514's rows in memory and answers the engine from them. */
class MemoryStore implements GateStore {
  state: PullRequestState = "verifying";
  readonly revisions: GateRevision[] = [
    { ...REVISION_2.revision, id: "rev-1", seq: 1, headSha: "3f9c2ae" },
  ];
  readonly definitions: (StoredGateDefinition & { spec: GateDefinitionSpec })[] = [];
  readonly results: StoredResult[] = [];
  readonly states: PullRequestState[] = [];
  evidence: EvidenceRows = {
    build: BUILD,
    attempt: ATTEMPT,
    hil: HIL,
    waivedCaseKeys: [],
    secrets: REVISION_2.secrets,
  };
  sources: PolicySources = {
    run: {
      organizationId: "org-358",
      githubRepoId: "repo-1",
      issueNumber: 482,
      workflowTag: "standard-fix",
      workflowVersionPin: 14,
    },
    definition: readFixture("valid/standard-fix.json"),
    ticket: { labels: ["security"], planFiles: REVISION_2.planFiles, effort: "m" },
    rules: [
      {
        when: { label: "security" },
        then: { add_vote: { task_kind: "review", alias: "second-opinion" } },
      },
    ],
    blockUntilGreen: false,
  };
  /** Events `targets` has been asked about. */
  readonly asked: GateEvidenceEvent[] = [];

  /** Push a revision. */
  push(revision: GateRevision): void {
    this.revisions.push(revision);
  }

  /** @inheritdoc */
  targets(_organizationId: string, event: GateEvidenceEvent): Promise<string[]> {
    this.asked.push(event);
    return Promise.resolve(["pr-514"]);
  }

  /** @inheritdoc */
  transaction<T>(work: (tx: GateTransaction) => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the transaction is this store's view
    const store = this;
    const pr = (): GatePr => ({
      id: "pr-514",
      organizationId: "org-358",
      state: store.state,
      runId: "run-482",
    });

    return work({
      lockPr: (prId) =>
        Promise.resolve<GateSubject | undefined>(
          prId === "pr-514" ? { pr: pr(), revision: store.revisions.at(-1) ?? null } : undefined,
        ),
      policySources: () => Promise.resolve(store.sources),
      evidence: () => Promise.resolve(store.evidence),
      upsertDefinitions: (_prId, specs) => {
        for (const spec of specs) {
          const index = store.definitions.findIndex((row) => row.gateKey === spec.gateKey);
          const row = {
            id: `def-${spec.gateKey}`,
            gateKey: spec.gateKey,
            required: spec.required,
            source: spec.source,
            spec,
          };

          if (index === -1) store.definitions.push(row);
          else store.definitions[index] = row;
        }
        return Promise.resolve(store.definitions.map(({ spec: _spec, ...row }) => row));
      },
      latestResults: (revisionId) => Promise.resolve(store.latest(revisionId)),
      appendResults: (revisionId, rows) => {
        store.results.push(...rows.map((row) => ({ ...row, revisionId })));
        return Promise.resolve();
      },
      aggregate: (revisionId) => Promise.resolve(store.aggregateOf(revisionId)),
      setState: (_prId, state) => {
        store.state = state;
        store.states.push(state);
        return Promise.resolve();
      },
    });
  }

  /** The latest result per definition on a revision. */
  latest(revisionId: string): LatestResult[] {
    const latest = new Map<string, StoredResult>();

    for (const row of this.results.filter((each) => each.revisionId === revisionId)) {
      latest.set(row.definitionId, row);
    }
    return [...latest.values()];
  }

  /** V056's aggregate over this store. */
  aggregateOf(revisionId: string): GateAggregate {
    const latest = new Map(this.latest(revisionId).map((row) => [row.definitionId, row.verdict]));

    return aggregate(
      this.definitions.map((row) => ({ required: row.required, verdict: latest.get(row.id) })),
    );
  }

  /** Rows written for one revision. */
  rowsFor(revisionId: string): StoredResult[] {
    return this.results.filter((row) => row.revisionId === revisionId);
  }
}

/**
 * @param config - The org config.
 * @returns A policy port answering it.
 */
function org(config: OrgGateConfig = DEFAULT_ORG_GATE_CONFIG): OrgGatePolicy {
  return { forOrganization: () => Promise.resolve(config) };
}

/** Revision 2 of PR #514. */
const REV_2: GateRevision = {
  ...REVISION_2.revision,
  id: "rev-2",
  seq: 2,
  headSha: HEAD,
  files: FILES,
};

describe("GateEngineService", () => {
  let store: MemoryStore;
  let service: GateEngineService;

  beforeEach(() => {
    store = new MemoryStore();
    service = new GateEngineService(store, org());
  });

  it("materializes seven definitions with the pin as their provenance", async () => {
    await service.evaluate("pr-514");

    expect(store.definitions).toHaveLength(7);
    expect(new Set(store.definitions.map((row) => row.source))).toEqual(
      new Set(["standard-fix@v14 pin"]),
    );
  });

  it("reads Revision 2 as 5 of 7 green — the documented aggregate", async () => {
    store.push(REV_2);

    const result = await service.evaluate("pr-514");

    expect(result?.aggregate).toEqual({
      requiredCount: 7,
      greenCount: 5,
      redCount: 0,
      satisfiedCount: 6,
      mergeReady: false,
    });
    expect(result?.state).toBe("verifying");
    expect(result?.armedReady).toBe(false);
    expect(
      Object.fromEntries(store.rowsFor("rev-2").map((row) => [row.gateKey, row.verdict])),
    ).toEqual({
      build: "green",
      test_suite: "green",
      physical_hil: "green",
      diff_vs_plan: "green",
      secrets_license: "green",
      model_review: "unavailable",
      human_approval: "not_required",
    });
  });

  it("writes a new snapshot for a pushed revision and leaves the previous revision's intact", async () => {
    // Revision 1: the overshoot over its ceiling and the tests failing — blocked.
    store.evidence = {
      ...store.evidence,
      attempt: { ...ATTEMPT, attemptSeq: 3, passed: 61, failed: 2, failingCaseKeys: ["x", "y"] },
      hil: [{ ...HIL[0], value: "2.4", verdict: "fail" }],
    };
    await service.evaluate("pr-514");
    const revision1 = structuredClone(store.rowsFor("rev-1"));

    expect(store.state).toBe("blocked");
    expect(store.aggregateOf("rev-1").redCount).toBe(2);

    // Revision 2 pushed, with Build 4's evidence.
    store.push(REV_2);
    store.evidence = { ...store.evidence, attempt: ATTEMPT, hil: HIL };
    await service.notify("org-358", { kind: "revision_pushed", prId: "pr-514" });

    expect(store.rowsFor("rev-1")).toEqual(revision1);
    expect(store.rowsFor("rev-2")).toHaveLength(7);
    expect(store.state).toBe("verifying");
    expect(store.states).toEqual(["blocked", "verifying"]);
  });

  it("is idempotent — identical inputs append nothing the second time", async () => {
    store.push(REV_2);

    const first = await service.evaluate("pr-514");
    const second = await service.evaluate("pr-514");

    expect(first?.written).toBe(7);
    expect(second?.written).toBe(0);
    expect(store.results).toHaveLength(7);
  });

  it("re-evaluates only the gates an event affects", async () => {
    store.push(REV_2);
    await service.evaluate("pr-514");

    // Everything changes; a test report may only move the test and HIL gates.
    store.evidence = {
      build: { ...BUILD, status: "failed", exitCode: 1 },
      attempt: { ...ATTEMPT, status: "running" },
      hil: [],
      waivedCaseKeys: [],
      secrets: null,
    };
    await service.notify("org-358", { kind: "test_run_parsed", testRunId: ATTEMPT.id });

    expect(
      store
        .rowsFor("rev-2")
        .slice(7)
        .map((row) => row.gateKey),
    ).toEqual(["test_suite", "physical_hil"]);

    await service.notify("org-358", { kind: "build_job_finished", jobId: BUILD.jobId });

    expect(
      store
        .rowsFor("rev-2")
        .slice(9)
        .map((row) => row.gateKey),
    ).toEqual(["build"]);
    expect(store.state).toBe("blocked");
  });

  it("evaluates a gate never judged on the revision, whatever the event", async () => {
    store.push(REV_2);

    await service.notify("org-358", { kind: "pr_synced", prId: "pr-514" });

    expect(store.rowsFor("rev-2")).toHaveLength(7);
  });

  it("leaves merged and closed PRs alone", async () => {
    store.push(REV_2);
    store.state = "merged";

    const result = await service.evaluate("pr-514");

    expect(result).toMatchObject({ written: 0, aggregate: null, state: "merged" });
    expect(store.results).toHaveLength(0);
  });

  it("answers undefined for a PR that does not exist, and nothing for one without a revision", async () => {
    store.revisions.length = 0;

    expect(await service.evaluate("pr-missing")).toBeUndefined();
    expect(await service.evaluate("pr-514")).toMatchObject({ revisionId: null, written: 0 });
    expect(store.definitions).toHaveLength(7);
  });

  it("switches a gate off through org config", async () => {
    store.push(REV_2);
    service = new GateEngineService(
      store,
      org({ ...DEFAULT_ORG_GATE_CONFIG, overrides: { physical_hil: { disabled: true } } }),
    );

    await service.evaluate("pr-514");

    expect(store.rowsFor("rev-2").find((row) => row.gateKey === "physical_hil")).toMatchObject({
      verdict: "not_required",
      evidence: "not required by org config",
      required: false,
    });
  });

  it("never fails its caller, and logs what went wrong", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    store.transaction = () => Promise.reject(new Error("connection reset"));
    await expect(
      service.notify("org-358", { kind: "revision_pushed", prId: "pr-514" }),
    ).resolves.toBeUndefined();

    store.targets = () => Promise.reject(new Error("pool exhausted"));
    await expect(
      service.notify("org-358", { kind: "guardrail_evaluated", runId: "run-482" }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe("derivePolicy", () => {
  it("reads the pin, the vote rules and the review facts with AP.3's readers", () => {
    const store = new MemoryStore();
    const derived = derivePolicy(store.sources);

    expect(derived.pin).toEqual({ tag: "standard-fix", version: 14 });
    expect(derived.policy?.holdsOnChecks).toBe(true);
    expect(derived.voteRules).toBe(1);
    expect(derived.review).toEqual({ autoMerges: true, voteRules: 1 });
  });

  it("has no pin and no policy for a PR without a run", () => {
    expect(
      derivePolicy({
        run: undefined,
        definition: undefined,
        ticket: { labels: [] },
        rules: [],
        blockUntilGreen: false,
      }),
    ).toEqual({ pin: null, policy: undefined, voteRules: 0, review: undefined });
  });
});
