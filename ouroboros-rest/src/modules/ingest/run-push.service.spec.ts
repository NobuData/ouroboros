import { RUN_BRANCH_PUSHED_EVENT, RUN_PUSH_GRANTED_EVENT } from "../audit/audit.events";
import type { Run } from "../db/schema";
import { DomainError } from "../errors/error.envelope";
import { GITHUB_FAILURES, GithubApiError } from "../github/github.errors";
import { RUN_PUSH_ERRORS } from "./run-push.errors";
import type { LatestGuardrail } from "./run-push.policy";
import { BRANCH_ROUTE, PUSH_USERNAME, RunPushService } from "./run-push.service";

/**
 * The control plane's half of DI.2 (#1310): every refusal before the credential, the one refspec
 * the grant builds, and the audit rows naming who started the run.
 */

const RUN = "5eed0051-0000-4000-8000-000000000001";
const ORG = "org-live-slice";
const REPO = "5eed00a1-0000-4000-8000-000000000001";
const BRANCH = `ouro/run-${RUN}-1`;
const HEAD = "a".repeat(40);
const TOKEN = "ghp_canary-push-grant-1310";
const REMOTE = "https://github.com/acme-robotics/helios-greeter.git";

/** Any instant — the audit row is stamped by the service's own clock. */
const ANY_DATE: unknown = expect.any(Date);

const EVALUATED: LatestGuardrail[] = [
  { check: "allowed_paths", verdict: "pass", mode: "block", changeSetSeq: 2 },
  { check: "ci_config", verdict: "not_applicable", mode: "block", changeSetSeq: 2 },
  { check: "secrets", verdict: "pass", mode: "warn", changeSetSeq: 2 },
  { check: "review_required", verdict: "pass", mode: "block", changeSetSeq: null },
];

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN,
    organization_id: ORG,
    github_repo_id: REPO,
    issue_number: 1,
    status: "coding",
    branch_name: BRANCH,
    change_set_seq: 2,
    exec_epoch: 1,
    origin: "live",
    simulated: false,
    started_by: "user-ken",
    ...overrides,
  } as Run;
}

/** The service over stand-ins; every collaborator that could reach a credential is a spy. */
function rig(
  options: {
    row?: Run | undefined;
    guardrails?: LatestGuardrail[];
    configured?: boolean;
    branch?: () => Promise<unknown>;
    token?: string | null;
    receipt?: { request_digest: string; response: unknown } | undefined;
  } = {},
) {
  const row = "row" in options ? options.row : run();
  const runs = {
    db: "pool",
    transaction: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work("trx")),
    lockRun: jest.fn().mockResolvedValue(row),
    findReceipt: jest.fn().mockResolvedValue(options.receipt),
    insertReceipt: jest.fn().mockResolvedValue(undefined),
  };
  const execution = {
    repositoryOf: jest.fn().mockResolvedValue({
      id: REPO,
      slug: "acme-robotics/helios-greeter",
      name: "helios-greeter",
      defaultBranch: "main",
    }),
  };
  const pushes = { latestGuardrails: jest.fn().mockResolvedValue(options.guardrails ?? EVALUATED) };
  const credentials = { isConfigured: jest.fn().mockResolvedValue(options.configured ?? true) };
  const client = {
    request: jest.fn(
      options.branch ??
        (() =>
          Promise.reject(
            new GithubApiError(GITHUB_FAILURES.notFound, "no branch", undefined, 404),
          )),
    ),
  };
  const github = { forOrganization: jest.fn().mockResolvedValue(client) };
  const code = {
    repositoryRef: jest.fn().mockResolvedValue({
      workspace: ORG,
      slug: "acme-robotics/helios-greeter",
      remote: REMOTE,
      token: "token" in options ? options.token : TOKEN,
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue("audit-1") };

  const service = new RunPushService(
    runs as never,
    execution as never,
    pushes,
    credentials as never,
    github as never,
    code as never,
    audit as never,
  );

  return { service, runs, credentials, github, client, code, audit };
}

const ASK = {
  idempotency_key: "push-1",
  epoch: 1,
  branch: BRANCH,
  head_sha: HEAD,
  change_set_seq: 2,
};

/** The code a refusal carries. */
async function codeOf(promise: Promise<unknown>): Promise<{ code: string; status: number }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) {
      return { code: error.envelope().code, status: error.getStatus() };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("granting a push", () => {
  it("answers the one refspec, the remote and the credential, built from the run's own branch", async () => {
    const { service, client } = rig();

    await expect(service.grant(RUN, ASK)).resolves.toEqual({
      refspec: `refs/heads/${BRANCH}:refs/heads/${BRANCH}`,
      remote: REMOTE,
      username: PUSH_USERNAME,
      password: TOKEN,
    });
    expect(client.request).toHaveBeenCalledWith(BRANCH_ROUTE, {
      owner: "acme-robotics",
      repo: "helios-greeter",
      branch: BRANCH,
    });
  });

  it("never builds a forced refspec", async () => {
    const { service } = rig();

    const grant = await service.grant(RUN, ASK);

    expect(grant.refspec.startsWith("+")).toBe(false);
    expect(grant.refspec.split(":")).toEqual([`refs/heads/${BRANCH}`, `refs/heads/${BRANCH}`]);
  });

  it("writes run.push_granted naming who started the run, and nothing of the credential", async () => {
    const { service, audit } = rig();

    await service.grant(RUN, ASK);

    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: "user-ken",
      action: RUN_PUSH_GRANTED_EVENT,
      subjectType: "run",
      subjectId: RUN,
      at: ANY_DATE,
      detail: { branch: BRANCH, head_sha: HEAD },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(TOKEN);
  });

  it("writes the grant with no actor for a run no person started", async () => {
    const { service, audit } = rig({ row: run({ started_by: null }) });

    await service.grant(RUN, ASK);

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: null }));
  });

  it("writes no receipt: the answer carries a credential no table may hold", async () => {
    const { service, runs } = rig();

    await service.grant(RUN, ASK);

    expect(runs.insertReceipt).not.toHaveBeenCalled();
    expect(runs.findReceipt).not.toHaveBeenCalled();
  });

  describe("refuses before the credential is opened or GitHub is asked", () => {
    it.each<[string, Parameters<typeof rig>[0], Partial<typeof ASK> & { force?: boolean }, string]>(
      [
        ["a force push", {}, { force: true }, RUN_PUSH_ERRORS.forcePushRefused],
        [
          "another branch",
          {},
          { branch: "ouro/run-someone-else-2" },
          RUN_PUSH_ERRORS.branchMismatch,
        ],
        [
          "a run branch outside ouro/run-*",
          { row: run({ branch_name: "loop/482-fix" }) },
          { branch: "loop/482-fix" },
          RUN_PUSH_ERRORS.notARunBranch,
        ],
        [
          "the default branch",
          { row: run({ branch_name: "main" }) },
          { branch: "main" },
          RUN_PUSH_ERRORS.notARunBranch,
        ],
        [
          "an unevaluated change-set",
          {},
          { change_set_seq: 1 },
          RUN_PUSH_ERRORS.changesNotEvaluated,
        ],
        [
          "a blocking guardrail",
          {
            guardrails: EVALUATED.map((row) =>
              row.check === "allowed_paths" ? { ...row, verdict: "fail" as const } : row,
            ),
          },
          {},
          RUN_PUSH_ERRORS.guardrailBlocking,
        ],
        [
          "a workspace with no token",
          { configured: false },
          {},
          RUN_PUSH_ERRORS.githubNotConfigured,
        ],
      ],
    )("%s", async (_name, options, ask, code) => {
      const { service, github, client, code: workspace, audit } = rig(options);

      await expect(codeOf(service.grant(RUN, { ...ASK, ...ask }))).resolves.toEqual({
        code,
        status: 409,
      });
      expect(github.forOrganization).not.toHaveBeenCalled();
      expect(client.request).not.toHaveBeenCalled();
      expect(workspace.repositoryRef).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it("refuses a branch GitHub reports protected, and opens no credential", async () => {
    const { service, code, audit } = rig({
      branch: () => Promise.resolve({ status: 200, data: { name: BRANCH, protected: true } }),
    });

    await expect(codeOf(service.grant(RUN, ASK))).resolves.toEqual({
      code: RUN_PUSH_ERRORS.protectedBranch,
      status: 409,
    });
    expect(code.repositoryRef).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("grants an existing, unprotected run branch — the second push of a correction round", async () => {
    const { service } = rig({
      branch: () => Promise.resolve({ status: 200, data: { name: BRANCH, protected: false } }),
    });

    await expect(service.grant(RUN, ASK)).resolves.toMatchObject({ password: TOKEN });
  });

  it("refuses 502 branch_check_failed when GitHub cannot be asked", async () => {
    const { service, code } = rig({
      branch: () => Promise.reject(new GithubApiError(GITHUB_FAILURES.upstreamError, "socket")),
    });

    await expect(codeOf(service.grant(RUN, ASK))).resolves.toEqual({
      code: RUN_PUSH_ERRORS.branchCheckFailed,
      status: 502,
    });
    expect(code.repositoryRef).not.toHaveBeenCalled();
  });

  it("refuses github_not_configured when the token went away before it was opened", async () => {
    const { service, audit } = rig({ token: null });

    await expect(codeOf(service.grant(RUN, ASK))).resolves.toEqual({
      code: RUN_PUSH_ERRORS.githubNotConfigured,
      status: 409,
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("is fenced to the start's epoch, and refuses a run nothing executes", async () => {
    await expect(codeOf(rig().service.grant(RUN, { ...ASK, epoch: 9 }))).resolves.toMatchObject({
      code: "fenced",
    });
    await expect(
      codeOf(rig({ row: run({ status: "review" }) }).service.grant(RUN, ASK)),
    ).resolves.toMatchObject({ code: "run_not_executable" });
    await expect(codeOf(rig({ row: undefined }).service.grant(RUN, ASK))).resolves.toMatchObject({
      code: "run_not_found",
    });
  });
});

describe("recording how a push ended", () => {
  const PUSHED = {
    idempotency_key: "push-result-1",
    epoch: 1,
    branch: BRANCH,
    outcome: "pushed" as const,
    pushed_sha: HEAD,
  };

  it("writes run.branch_pushed naming who started the run, and a receipt", async () => {
    const { service, audit, runs } = rig();

    await expect(service.recordResult(RUN, PUSHED)).resolves.toEqual({ recorded: true });
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: "user-ken",
      action: RUN_BRANCH_PUSHED_EVENT,
      subjectType: "run",
      subjectId: RUN,
      at: ANY_DATE,
      detail: { branch: BRANCH, outcome: "pushed", pushed_sha: HEAD },
    });
    expect(runs.insertReceipt).toHaveBeenCalledWith(
      "trx",
      expect.objectContaining({ operation: "run.push_result", idempotency_key: "push-result-1" }),
    );
  });

  it("records a failed push with the host's own reason", async () => {
    const { service, audit } = rig();

    await service.recordResult(RUN, {
      idempotency_key: "push-result-2",
      branch: BRANCH,
      outcome: "failed",
      reason: "remote: Permission to acme-robotics/helios-greeter.git denied.",
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: {
          branch: BRANCH,
          outcome: "failed",
          reason: "remote: Permission to acme-robotics/helios-greeter.git denied.",
        },
      }),
    );
  });

  it("answers a replay from its receipt without a second audit row", async () => {
    const { requestDigest } =
      jest.requireActual<typeof import("./ingest.idempotency")>("./ingest.idempotency");
    const { service, audit } = rig({
      receipt: { request_digest: requestDigest(PUSHED), response: { recorded: true } },
    });

    await expect(service.recordResult(RUN, PUSHED)).resolves.toEqual({ recorded: true });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("is fenced to the start's epoch", async () => {
    await expect(
      codeOf(rig().service.recordResult(RUN, { ...PUSHED, epoch: 4 })),
    ).resolves.toMatchObject({ code: "fenced" });
  });
});
