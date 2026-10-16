import { RUN_BUDGET_EXCEEDED_EVENT } from "../../audit/audit.events";
import { readPinnedWorkflow } from "../../ingest/ingest.pin";
import { readFixture } from "../../workflows/dsl.golden.fixture";
import { HarnessBudgetGuard } from "./harness.budget";
import type { CredentialBinding, HarnessRepository } from "./harness.repository";

/**
 * The facade's budget guard (AR.1, #315, decision 2): where a stage's token budget comes from,
 * when it is reached, and that a breach files one system abort and one audit row per run.
 */

const BINDING: CredentialBinding = {
  id: "d0000000-0000-4000-8000-000000000315",
  organizationId: "acme",
  runId: "5eed0009-0000-4000-8000-000000000479",
  stage: "implement",
  alias: "coder-max",
  attempt: 2,
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  revokedAt: null,
  runStatus: "coding",
};

const NOW = Date.parse("2026-10-15T12:00:00.000Z");

/** The pinned golden document's `implement` budget, read the way the guard must read it. */
function implementBudget(): number {
  const budget = readPinnedWorkflow(readFixture("valid/standard-fix.json")).stages.get(
    "implement",
  )?.tokenBudget;

  if (budget === undefined) {
    throw new Error("the golden standard-fix document has no implement token budget");
  }

  return budget;
}

/** The guard over fakes. */
function guard(options: { definition?: unknown; spent?: number; queued?: boolean | null } = {}) {
  const repository = {
    pinnedDefinition: jest
      .fn()
      .mockResolvedValue(
        "definition" in options ? options.definition : readFixture("valid/standard-fix.json"),
      ),
    attemptTokens: jest.fn().mockResolvedValue(options.spent ?? 0),
  };
  const controls = {
    submitSystem: jest
      .fn()
      .mockResolvedValue(
        options.queued === null
          ? undefined
          : { control: { id: "c1" }, queued: options.queued ?? true },
      ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  return {
    repository,
    controls,
    audit,
    subject: new HarnessBudgetGuard(
      repository as unknown as HarnessRepository,
      controls,
      audit,
      () => NOW,
    ),
  };
}

describe("HarnessBudgetGuard.attemptBudgetBreach", () => {
  it("reads the pinned node's limits.token_budget and the attempt's input + output tokens", async () => {
    const budget = implementBudget();
    const { subject, repository } = guard({ spent: budget });

    await expect(subject.attemptBudgetBreach(BINDING)).resolves.toEqual({
      limitTokens: budget,
      spentTokens: budget,
      stage: "implement",
      attempt: 2,
    });
    expect(repository.pinnedDefinition).toHaveBeenCalledWith(BINDING);
    expect(repository.attemptTokens).toHaveBeenCalledWith(BINDING);
  });

  it("lets an attempt under its budget through", async () => {
    const { subject } = guard({ spent: implementBudget() - 1 });

    await expect(subject.attemptBudgetBreach(BINDING)).resolves.toBeUndefined();
  });

  it("enforces nothing for a run with no pinned document", async () => {
    const { subject, repository } = guard({ definition: undefined, spent: 10_000_000 });

    await expect(subject.attemptBudgetBreach(BINDING)).resolves.toBeUndefined();
    expect(repository.attemptTokens).not.toHaveBeenCalled();
  });

  it("enforces nothing for a stage the pin names without limits, or does not name", async () => {
    const { subject } = guard({ spent: 10_000_000 });

    await expect(
      subject.attemptBudgetBreach({ ...BINDING, stage: "issue-queued" }),
    ).resolves.toBeUndefined();
    await expect(
      subject.attemptBudgetBreach({ ...BINDING, stage: "no-such-stage" }),
    ).resolves.toBeUndefined();
  });
});

describe("HarnessBudgetGuard.breached", () => {
  it("files a system abort through the control queue and audits run.budget_exceeded", async () => {
    const { subject, controls, audit } = guard();

    await expect(
      subject.breached(BINDING, { limit: "token_budget", spent: 400_512, cap: 400_000 }),
    ).resolves.toBe(true);

    expect(controls.submitSystem).toHaveBeenCalledWith(
      "acme",
      BINDING.runId,
      "abort",
      "token_budget_exceeded",
    );
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: "acme",
      actorId: null,
      action: RUN_BUDGET_EXCEEDED_EVENT,
      subjectType: "run",
      subjectId: BINDING.runId,
      at: new Date(NOW),
      detail: {
        limit: "token_budget",
        spent: 400_512,
        cap: 400_000,
        stage: "implement",
        attempt: 2,
      },
    });
  });

  it("names the cost cap as its own reason", async () => {
    const { subject, controls, audit } = guard();

    await subject.breached(BINDING, { limit: "cost_cap", spent: 260, cap: 250 });

    expect(controls.submitSystem).toHaveBeenCalledWith(
      "acme",
      BINDING.runId,
      "abort",
      "cost_cap_exceeded",
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ limit: "cost_cap" }) as unknown,
      }),
    );
  });

  it("writes no second audit row while the first abort is still pending — once per run", async () => {
    const { subject, audit } = guard({ queued: false });

    await expect(
      subject.breached(BINDING, { limit: "cost_cap", spent: 260, cap: 250 }),
    ).resolves.toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("writes nothing for a run that has already finished", async () => {
    const { subject, audit } = guard({ queued: null });

    await expect(
      subject.breached(BINDING, { limit: "cost_cap", spent: 260, cap: 250 }),
    ).resolves.toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
