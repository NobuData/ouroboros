import { HarnessCredentialsService, compare } from "./harness.credentials.service";
import { mintToken, tokenHash } from "./harness.credential";
import type { CredentialBinding, HarnessRepository, RecordedUsage } from "./harness.repository";

const NOW = new Date("2026-10-14T09:00:00.000Z");
const RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94";

/** A bound credential, live unless the case says otherwise. */
function binding(overrides: Partial<CredentialBinding> = {}): CredentialBinding {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    organizationId: "acme",
    runId: RUN,
    stage: "implement",
    alias: "coder-max",
    attempt: 1,
    expiresAt: new Date(NOW.getTime() + 60_000),
    revokedAt: null,
    runStatus: "building",
    ...overrides,
  };
}

/** The service over a fake repository. */
function service(
  found: { run?: unknown; binding?: CredentialBinding; recorded?: RecordedUsage[] } = {},
) {
  const repository = {
    runOf: jest
      .fn()
      .mockResolvedValue(
        "run" in found ? found.run : { organizationId: "acme", status: "building" },
      ),
    insert: jest.fn().mockResolvedValue("c0000000-0000-4000-8000-000000000001"),
    byDigest: jest.fn().mockResolvedValue(found.binding),
    byId: jest.fn().mockResolvedValue(found.binding),
    revoke: jest.fn().mockResolvedValue(undefined),
    recorded: jest.fn().mockResolvedValue(found.recorded ?? []),
    reconciled: jest.fn().mockResolvedValue(undefined),
  };

  return {
    repository,
    service: new HarnessCredentialsService(repository as unknown as HarnessRepository, () => NOW),
  };
}

describe("mint", () => {
  it("stores the digest, never the token, and shows the token once", async () => {
    const { service: subject, repository } = service();
    const minted = await subject.mint({
      run: RUN,
      stage: "implement",
      alias: "coder-max",
      attempt: 2,
    });

    const stored = (repository.insert.mock.calls as unknown[][])[0][0] as {
      digest: Buffer;
      expiresAt: Date;
    };

    expect(stored.digest.equals(tokenHash(minted.token))).toBe(true);
    expect(JSON.stringify(repository.insert.mock.calls)).not.toContain(minted.token);
    expect(stored.expiresAt).toEqual(new Date("2026-10-14T11:00:00.000Z"));
    expect(minted).toMatchObject({ run: RUN, stage: "implement", alias: "coder-max", attempt: 2 });
  });

  it("defaults the attempt to 1", async () => {
    await expect(
      service().service.mint({ run: RUN, stage: "s", alias: "a" }),
    ).resolves.toMatchObject({ attempt: 1 });
  });

  it("refuses an unknown run and a finished one", async () => {
    await expect(
      service({ run: undefined }).service.mint({ run: RUN, stage: "s", alias: "a" }),
    ).rejects.toMatchObject({
      code: "run_not_found",
    });
    await expect(
      service({ run: { organizationId: "acme", status: "merged" } }).service.mint({
        run: RUN,
        stage: "s",
        alias: "a",
      }),
    ).rejects.toMatchObject({ code: "run_finished" });
  });
});

describe("revoke", () => {
  it("revokes a known credential and refuses an unknown one", async () => {
    const { service: subject, repository } = service({ binding: binding() });

    await subject.revoke("c1");
    expect(repository.revoke).toHaveBeenCalledWith("c1", NOW);
    await expect(service().service.revoke("c1")).rejects.toMatchObject({
      code: "credential_not_found",
    });
  });
});

describe("authenticate", () => {
  const presented = { "x-api-key": mintToken() };

  it.each([
    ["no credential at all", {}, binding(), "credential_invalid"],
    ["an unknown one", presented, undefined, "credential_invalid"],
    ["a revoked one", presented, binding({ revokedAt: NOW }), "credential_revoked"],
    ["an expired one", presented, binding({ expiresAt: NOW }), "credential_expired"],
    ["one whose run has finished", presented, binding({ runStatus: "failed" }), "run_finished"],
    [
      "one presented for another run",
      { ...presented, "x-ouroboros-run": "other" },
      binding(),
      "credential_run_mismatch",
    ],
  ])("refuses %s with 401", async (_case, headers, found, code) => {
    const refused = await service({ binding: found }).service.authenticate(headers);

    expect(refused).toMatchObject({
      status: 401,
      body: { error: { type: "authentication_error" }, ouroboros: { code } },
    });
  });

  it("admits a live credential, looked up by its digest", async () => {
    const { service: subject, repository } = service({ binding: binding() });

    await expect(subject.authenticate({ ...presented, "x-ouroboros-run": RUN })).resolves.toEqual(
      binding(),
    );
    expect(
      ((repository.byDigest.mock.calls as unknown[][])[0][0] as Buffer).equals(
        tokenHash(presented["x-api-key"]),
      ),
    ).toBe(true);
  });
});

describe("reconcile", () => {
  const row = (overrides: Partial<RecordedUsage>): RecordedUsage => ({
    alias: "coder-max",
    model: "claude-sonnet-4-5",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 5,
    cacheWriteTokens: 0,
    calls: 2,
    ...overrides,
  });

  it("matches the harness's totals keyed by alias or by model", () => {
    const byAlias = compare([row({})], {
      "coder-max": { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 5 },
    });
    const byModel = compare([row({})], {
      "claude-sonnet-4-5": { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 5 },
    });

    expect(byAlias.matches).toBe(true);
    expect(byModel.matches).toBe(true);
    expect(byAlias.models[0]).toMatchObject({
      calls: 2,
      difference: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("surfaces a difference rather than averaging it away", () => {
    const result = compare([row({})], { "coder-max": { inputTokens: 120, outputTokens: 20 } });

    expect(result.matches).toBe(false);
    expect(result.models[0].difference).toEqual({
      inputTokens: 20,
      outputTokens: 0,
      cacheReadTokens: -5,
      cacheWriteTokens: 0,
    });
  });

  it("lists a recorded model the harness did not report, and a reported one nothing recorded", () => {
    const result = compare([row({ alias: "sizer", model: "claude-haiku-4-5" })], {
      "coder-max": { inputTokens: 1, outputTokens: 1 },
    });

    expect(result.matches).toBe(false);
    expect(
      result.models.map((model) => [model.model, model.reported === null, model.calls]),
    ).toEqual([
      ["coder-max", false, 0],
      ["claude-haiku-4-5", true, 2],
    ]);
  });

  it("stores the comparison on the credential", async () => {
    const { service: subject, repository } = service({ binding: binding(), recorded: [row({})] });
    const result = await subject.reconcile("c1", {
      "coder-max": { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 5 },
    });

    expect(result).toMatchObject({ id: "c1", matches: true, reconciledAt: NOW.toISOString() });
    expect(repository.reconciled).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ matches: true }),
      NOW,
    );
  });
});
