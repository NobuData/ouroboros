import { RUN_PULL_REQUEST_OPENED_EVENT } from "../audit/audit.events";
import type { Run } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { planContextMissing } from "../pull-requests/criteria/criteria.errors";
import { PrSyncService } from "../pull-requests/pr-sync.service";
import { readSpendTotals } from "../runs/run.spend";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { CreatePrInput, PrRef } from "../ticket-sources/ticket-source.pr";
import { INGEST_ERRORS } from "./ingest.errors";
import { requestDigest } from "./ingest.idempotency";
import { PULL_REQUEST_BODY_OPENING } from "./run-pull-request.body";
import { RUN_PULL_REQUEST_ERRORS } from "./run-pull-request.errors";
import type { PullRequestBodyBuild, PullRequestBodyStage } from "./run-pull-request.body";
import type { LinkedPullRequest, RunTicketSource } from "./run-pull-request.repository";
import {
  LOOP_PULL_REQUEST_DRAFT,
  PULL_REQUEST_OPERATION,
  RunPullRequestService,
} from "./run-pull-request.service";

jest.mock("../runs/run.spend", () => ({ readSpendTotals: jest.fn() }));

/**
 * The control plane's half of DI.3 (#1311): the refusals in their order, the idempotent answer,
 * a PR that is always a draft — even with the dry-run policy switched off mid-run — and the link,
 * the audit row and the plan import that follow.
 */

const RUN = "5eed0051-0000-4000-8000-000000000002";
const ORG = "org-live-slice";
const REPO = "5eed00a1-0000-4000-8000-000000000001";
const SOURCE = "5eed00b1-0000-4000-8000-000000000001";
const TICKET = "5eed00c1-0000-4000-8000-000000000001";
const PR_ID = "5eed00d1-0000-4000-8000-000000000001";
const BRANCH = `ouro/run-${RUN}-1`;
const PR_URL = "https://github.com/acme-robotics/helios-greeter/pull/2";
const UI = "https://ouro.example";

/** Any instant — the audit row is stamped by the service's own clock. */
const ANY_DATE: unknown = expect.any(Date);

const ASK = { idempotency_key: "run-2-pull-request-1", epoch: 1 };

const TICKET_SOURCE: RunTicketSource = { ticketId: TICKET, sourceId: SOURCE, kind: "github" };

const STAGES: PullRequestBodyStage[] = [
  {
    stageKey: "code",
    label: "Code",
    position: 1,
    attempt: 1,
    status: "succeeded",
    returnedFromStageKey: null,
    returnReason: null,
  },
];

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN,
    organization_id: ORG,
    github_repo_id: REPO,
    issue_number: 1,
    issue_title: "Greet the user by name",
    workflow_tag: "docs-slice",
    workflow_version_pin: 3,
    model: "slice-coder",
    loop_seq: 2,
    status: "coding",
    branch_name: BRANCH,
    exec_epoch: 1,
    reserved_build_job_id: null,
    origin: "live",
    simulated: false,
    started_by: "user-ken",
    ...overrides,
  } as Run;
}

/** Options a case changes. */
interface RigOptions {
  row?: Run | undefined;
  linked?: LinkedPullRequest | undefined;
  receipt?: { request_digest: string; response: unknown } | undefined;
  pushed?: boolean;
  ticket?: RunTicketSource | undefined;
  provider?: "none" | "tracker" | "no-create";
  defaultBranch?: string | null;
  repository?: "missing";
  createPR?: (input: CreatePrInput) => Promise<PrRef | null>;
  sync?: () => Promise<unknown>;
  dryRun?: () => boolean;
  claims?: readonly string[];
  build?: PullRequestBodyBuild | null;
  importPlan?: () => Promise<unknown>;
}

/** The service over stand-ins — the real PR plane opener, a fake host behind it. */
function rig(options: RigOptions = {}) {
  const row = "row" in options ? options.row : run();
  const runs = {
    db: "pool",
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work("trx")),
    lockRun: jest.fn().mockResolvedValue(row),
    findReceipt: jest.fn().mockResolvedValue(options.receipt),
    insertReceipt: jest.fn().mockResolvedValue(undefined),
  };
  const execution = {
    repositoryOf: jest.fn().mockResolvedValue(
      options.repository === "missing"
        ? undefined
        : {
            id: REPO,
            slug: "acme-robotics/helios-greeter",
            name: "helios-greeter",
            defaultBranch: "defaultBranch" in options ? options.defaultBranch : "main",
          },
    ),
  };
  const store = {
    linked: jest.fn().mockResolvedValue(options.linked),
    pushed: jest.fn().mockResolvedValue(options.pushed ?? true),
    ticketSource: jest.fn().mockResolvedValue("ticket" in options ? options.ticket : TICKET_SOURCE),
    stages: jest.fn().mockResolvedValue(STAGES),
    latestBuild: jest.fn().mockResolvedValue(options.build ?? null),
    link: jest.fn().mockResolvedValue(undefined),
  };
  const answer =
    options.createPR ??
    ((input: CreatePrInput) =>
      Promise.resolve({ number: 2, url: PR_URL, draft: input.draft === true }));
  const createPR = jest.fn((_context: unknown, input: CreatePrInput) => answer(input));
  const host = {
    kind: "github",
    capabilities: () => ({
      pr: {
        pullRequests: options.provider !== "tracker",
        create: options.provider !== "no-create",
      },
    }),
    createPR,
  };
  const registry = { find: jest.fn(() => (options.provider === "none" ? undefined : host)) };
  const mirror = {
    source: jest.fn().mockResolvedValue({
      sourceId: SOURCE,
      organizationId: ORG,
      kind: "github",
      displayName: "GitHub · acme-robotics",
      config: {},
      cursor: null,
      syncedAt: null,
    }),
  };
  const opener = {
    withCredentials: jest.fn((_source: unknown, work: (context: unknown) => Promise<unknown>) =>
      work("context"),
    ),
  };
  const policy = {
    dryRun: jest.fn(() => Promise.resolve(options.dryRun?.() ?? true)),
    dryRunNow: jest.fn(() => Promise.resolve(options.dryRun?.() ?? true)),
  };
  const prs = new PrSyncService(
    mirror as never,
    registry as never,
    opener as never,
    undefined,
    undefined,
    policy,
  );
  const sync = jest
    .spyOn(prs, "sync")
    .mockImplementation(
      (options.sync as never) ??
        (() => Promise.resolve({ prId: PR_ID, state: "open", created: true } as never)),
    );
  const criteria = {
    planClaims: jest.fn().mockResolvedValue(options.claims ?? ["Says hello to the named user"]),
    importPlan: jest.fn(options.importPlan ?? (() => Promise.resolve({ imported: [] }))),
  };
  const audit = { record: jest.fn().mockResolvedValue("audit-1") };
  const config = { uiUrl: UI };

  jest.mocked(readSpendTotals).mockResolvedValue({
    tokensIn: 1000,
    tokensOut: 400,
    costCents: null,
    unpricedEvents: 2,
  });

  const service = new RunPullRequestService(
    runs as never,
    execution as never,
    store,
    registry as never,
    prs,
    criteria as never,
    audit as never,
    config as never,
  );

  return { service, runs, store, createPR, sync, policy, criteria, audit, registry };
}

/** The code and status a refusal carries. */
async function refusal(
  promise: Promise<unknown>,
): Promise<{ code: string; status: number; details: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) {
      return {
        code: error.envelope().code,
        status: error.getStatus(),
        details: error.envelope().details,
      };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("opening a run's draft pull request", () => {
  it("opens the PR as a draft from the run's branch into the default branch, and links it", async () => {
    const { service, createPR, sync, store, runs } = rig();

    await expect(service.open(RUN, ASK)).resolves.toEqual({
      pull_request_id: PR_ID,
      number: 2,
      url: PR_URL,
      draft: true,
      created: true,
    });

    expect(createPR).toHaveBeenCalledTimes(1);
    expect(createPR).toHaveBeenCalledWith(
      "context",
      expect.objectContaining({
        branch: BRANCH,
        base: "main",
        title: "Greet the user by name",
        draft: true,
      }),
    );
    expect(sync).toHaveBeenCalledWith(ORG, SOURCE, 2);
    expect(store.link).toHaveBeenCalledWith("trx", {
      run: expect.objectContaining({ id: RUN }) as unknown,
      prId: PR_ID,
      number: 2,
      ticketId: TICKET,
    });
    expect(runs.insertReceipt).toHaveBeenCalledWith("trx", {
      organization_id: ORG,
      run_id: RUN,
      operation: PULL_REQUEST_OPERATION,
      idempotency_key: ASK.idempotency_key,
      request_digest: requestDigest({ run_id: RUN, ...ASK }),
      response: { pull_request_id: PR_ID, number: 2, url: PR_URL, draft: true, created: true },
    });
  });

  it("composes the body from the run's rows", async () => {
    const { service, createPR } = rig({
      build: { number: 41, pool: "linux-x64", status: "succeeded", exitCode: 0 },
    });

    await service.open(RUN, ASK);

    const body = createPR.mock.calls[0][1].body as string;

    expect(body.split("\n")[0]).toBe(PULL_REQUEST_BODY_OPENING);
    expect(body).toContain(
      `Run: [Loop #2](${UI}/runs/${RUN}) · workflow docs-slice@v3 · model alias: slice-coder`,
    );
    expect(body).toContain("Stages passed: Code.");
    expect(body).toContain("- [ ] Says hello to the named user — unverified, no evidence yet");
    expect(body).toContain("farm job #41 · linux-x64 · succeeded · exit 0");
    expect(body).toContain("not priced · 1,400 tokens");
    expect(body.split("\n").at(-1)).toBe("Refs #1");
  });

  it("says no criteria were imported, and no build ran, when there were none", async () => {
    const { service, createPR } = rig({ claims: [], build: null });

    await service.open(RUN, ASK);

    const body = createPR.mock.calls[0][1].body as string;

    expect(body).toContain("No acceptance criteria were imported.");
    expect(body).toContain("Build: none ran for this run.");
    expect(body).toContain(`[Run console](${UI}/runs/${RUN})`);
  });

  describe("always a draft", () => {
    it("asks for a draft as a constant, not a choice", () => {
      expect(LOOP_PULL_REQUEST_DRAFT).toBe(true);
    });

    it("still sends draft: true when the dry-run policy was switched off mid-run", async () => {
      let dryRun = true;
      const { service, createPR, policy } = rig({ dryRun: () => dryRun });

      // The workspace turns dry-run off after the run started, before its PR opens.
      dryRun = false;

      await expect(service.open(RUN, ASK)).resolves.toMatchObject({ draft: true });

      expect(policy.dryRunNow).toHaveBeenCalledWith(ORG);
      await expect(policy.dryRunNow.mock.results[0].value).resolves.toBe(false);
      expect(createPR.mock.calls[0][1]).toMatchObject({ draft: true });
    });

    it("sends draft: true with the policy on, too", async () => {
      const { service, createPR } = rig({ dryRun: () => true });

      await service.open(RUN, ASK);

      expect(createPR.mock.calls[0][1]).toMatchObject({ draft: true });
    });
  });

  describe("the idempotent path", () => {
    it("answers the PR already linked to the run, created: false, writing nothing", async () => {
      const { service, createPR, store, audit, runs, criteria } = rig({
        linked: { id: PR_ID, number: 2, url: PR_URL },
      });

      await expect(service.open(RUN, { ...ASK, epoch: 1 })).resolves.toEqual({
        pull_request_id: PR_ID,
        number: 2,
        url: PR_URL,
        draft: true,
        created: false,
      });

      expect(createPR).not.toHaveBeenCalled();
      expect(store.link).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(runs.insertReceipt).not.toHaveBeenCalled();
      expect(criteria.importPlan).not.toHaveBeenCalled();
    });

    it("replays what this key was answered", async () => {
      const answer = { pull_request_id: PR_ID, number: 2, url: PR_URL, draft: true, created: true };
      const { service, createPR } = rig({
        receipt: { request_digest: requestDigest({ run_id: RUN, ...ASK }), response: answer },
      });

      await expect(service.open(RUN, ASK)).resolves.toEqual(answer);
      expect(createPR).not.toHaveBeenCalled();
    });

    it("refuses a key that answered another request", async () => {
      const { service, createPR } = rig({ receipt: { request_digest: "other", response: {} } });

      expect((await refusal(service.open(RUN, ASK))).code).toBe(INGEST_ERRORS.idempotencyKeyReused);
      expect(createPR).not.toHaveBeenCalled();
    });

    it("links nothing a second time when a racing request linked first", async () => {
      const { service, store, audit } = rig();

      // The first read finds nothing; the read under the second lock finds the racer's link.
      store.linked
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: PR_ID, number: 2, url: PR_URL });

      await expect(service.open(RUN, ASK)).resolves.toMatchObject({ created: false });
      expect(store.link).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe("the refusals, in order", () => {
    it("fences a superseded epoch before anything else", async () => {
      const { service, store } = rig({ row: run({ exec_epoch: 3, status: "review" }) });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: INGEST_ERRORS.fenced,
        status: 409,
      });
      expect(store.linked).not.toHaveBeenCalled();
    });

    it("refuses a run that no longer executes, before looking for its PR", async () => {
      const { service, store } = rig({
        row: run({ status: "review" }),
        linked: { id: PR_ID, number: 2, url: PR_URL },
      });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: INGEST_ERRORS.runNotExecutable,
        status: 409,
      });
      expect(store.linked).not.toHaveBeenCalled();
    });

    it("answers 404 for a run that does not exist", async () => {
      const { service } = rig({ row: undefined });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: INGEST_ERRORS.runNotFound,
        status: 404,
      });
    });

    it("refuses not_pushed when no push of the run's branch reached the host", async () => {
      const { service, store, createPR } = rig({ pushed: false });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: RUN_PULL_REQUEST_ERRORS.notPushed,
        status: 409,
        details: { branch: BRANCH },
      });
      expect(store.ticketSource).not.toHaveBeenCalled();
      expect(createPR).not.toHaveBeenCalled();
    });

    it("refuses not_pushed for a run with no branch at all", async () => {
      const { service, store } = rig({ row: run({ branch_name: null }) });

      expect((await refusal(service.open(RUN, ASK))).code).toBe(RUN_PULL_REQUEST_ERRORS.notPushed);
      expect(store.pushed).not.toHaveBeenCalled();
    });

    it.each<[string, RigOptions, string]>([
      ["no GitHub source mirrors the issue", { ticket: undefined }, "no_source"],
      ["no provider is registered for the source", { provider: "none" }, "no_pull_requests"],
      ["the source is a tracker without PRs", { provider: "tracker" }, "no_pull_requests"],
      ["the provider declares pr.create false", { provider: "no-create" }, "no_pull_requests"],
      ["the repository has no default branch", { defaultBranch: null }, "no_base_branch"],
    ])("refuses pr_source_unavailable when %s", async (_name, options, reason) => {
      const { service, createPR } = rig(options);

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: RUN_PULL_REQUEST_ERRORS.prSourceUnavailable,
        status: 409,
        details: { reason },
      });
      expect(createPR).not.toHaveBeenCalled();
    });

    it("checks the push before the source", async () => {
      const { service } = rig({ pushed: false, ticket: undefined });

      expect((await refusal(service.open(RUN, ASK))).code).toBe(RUN_PULL_REQUEST_ERRORS.notPushed);
    });

    it("answers 404 when the run's repository is gone", async () => {
      const { service, createPR } = rig({ repository: "missing" });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: INGEST_ERRORS.repositoryNotFound,
        status: 404,
      });
      expect(createPR).not.toHaveBeenCalled();
    });

    it("refuses pr_source_unavailable when the provider answers null", async () => {
      const { service, store } = rig({ createPR: () => Promise.resolve(null) });

      expect((await refusal(service.open(RUN, ASK))).code).toBe(
        RUN_PULL_REQUEST_ERRORS.prSourceUnavailable,
      );
      expect(store.link).not.toHaveBeenCalled();
    });

    it("refuses draft_refused with the host's words when it refuses the draft as invalid", async () => {
      const { service, store, sync, audit } = rig({
        createPR: () =>
          Promise.reject(
            new TicketSourceError("validation", "Draft pull requests are not supported", null, 422),
          ),
      });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: RUN_PULL_REQUEST_ERRORS.draftRefused,
        status: 409,
        details: { host_message: "Draft pull requests are not supported" },
      });
      expect(sync).not.toHaveBeenCalled();
      expect(store.link).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("refuses draft_refused, naming the PR and linking nothing, when the host answers a ready PR", async () => {
      // An already-open ready PR on the run's branch: createPR answers it as it is.
      const { service, store, sync, audit } = rig({
        createPR: () => Promise.resolve({ number: 9, url: PR_URL, draft: false }),
      });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: RUN_PULL_REQUEST_ERRORS.draftRefused,
        status: 409,
        details: { url: PR_URL, number: 9 },
      });
      expect(sync).not.toHaveBeenCalled();
      expect(store.link).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each(["auth", "permission", "rate_limit", "not_found", "upstream"] as const)(
      "answers 502 pr_create_failed for a %s refusal, with its class",
      async (errorClass) => {
        const { service, store } = rig({
          createPR: () => Promise.reject(new TicketSourceError(errorClass, "host said no")),
        });

        expect(await refusal(service.open(RUN, ASK))).toMatchObject({
          code: RUN_PULL_REQUEST_ERRORS.prCreateFailed,
          status: 502,
          details: { error_class: errorClass, host_message: "host said no" },
        });
        expect(store.link).not.toHaveBeenCalled();
      },
    );

    it("answers 502 pr_create_failed when the opened PR cannot be read back, linking nothing", async () => {
      const { service, store } = rig({
        sync: () => Promise.reject(new TicketSourceError("validation", "read failed")),
      });

      expect(await refusal(service.open(RUN, ASK))).toMatchObject({
        code: RUN_PULL_REQUEST_ERRORS.prCreateFailed,
        status: 502,
        details: { error_class: "validation" },
      });
      expect(store.link).not.toHaveBeenCalled();
    });

    it("lets an unexpected failure through unchanged", async () => {
      const { service } = rig({ createPR: () => Promise.reject(new Error("socket hang up")) });

      await expect(service.open(RUN, ASK)).rejects.toThrow("socket hang up");
    });

    it("fences a worker superseded while the host was asked, linking nothing", async () => {
      const { service, runs, store } = rig();

      runs.lockRun.mockResolvedValueOnce(run()).mockResolvedValueOnce(run({ exec_epoch: 2 }));

      expect((await refusal(service.open(RUN, ASK))).code).toBe(INGEST_ERRORS.fenced);
      expect(store.link).not.toHaveBeenCalled();
    });
  });

  describe("after the link", () => {
    it("writes run.pull_request_opened naming the person who started the run", async () => {
      const { service, audit } = rig();

      await service.open(RUN, ASK);

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith({
        organizationId: ORG,
        actorId: "user-ken",
        action: RUN_PULL_REQUEST_OPENED_EVENT,
        subjectType: "run",
        subjectId: RUN,
        at: ANY_DATE,
        detail: { number: 2, url: PR_URL, draft: true },
      });
    });

    it("writes the audit row with no actor for a run nobody started", async () => {
      const { service, audit } = rig({ row: run({ started_by: null }) });

      await service.open(RUN, ASK);

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
    });

    it("imports the ticket's plan criteria into the PR, as the person who started the run", async () => {
      const { service, criteria, store } = rig();

      await service.open(RUN, ASK);

      expect(criteria.planClaims).toHaveBeenCalledWith(ORG, TICKET);
      expect(criteria.importPlan).toHaveBeenCalledWith(ORG, PR_ID, { id: "user-ken" });
      // After the link: the import reads the PR's ticket, which the link wrote.
      expect(store.link.mock.invocationCallOrder[0]).toBeLessThan(
        criteria.importPlan.mock.invocationCallOrder[0],
      );
    });

    it("answers the PR when the ticket has no plan to import", async () => {
      const { service } = rig({
        importPlan: () => Promise.reject(planContextMissing(PR_ID, TICKET)),
      });

      await expect(service.open(RUN, ASK)).resolves.toMatchObject({ created: true });
    });

    it("answers the PR, and logs, when the import fails for another reason", async () => {
      const { service } = rig({ importPlan: () => Promise.reject(new Error("deadlock")) });
      const logged = jest
        .spyOn((service as unknown as { logger: { error: () => void } }).logger, "error")
        .mockImplementation(() => undefined);

      await expect(service.open(RUN, ASK)).resolves.toMatchObject({ created: true });
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });
});
