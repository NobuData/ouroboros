import { ConflictError, ForbiddenError, NotImplementedError } from "../errors/error.envelope";
import type { ControlsService, Requester } from "../controls/controls.service";
import type { FactsService } from "../facts/facts.service";
import type { GuardrailService } from "../guardrails/guardrails.service";
import type { BatchesService } from "../planning/batches.service";
import type { CriteriaService } from "../pull-requests/criteria/criteria.service";
import type { MergeExecutorService } from "../pull-requests/merge/merge.executor";
import type { PageActionsService } from "../pull-requests/page/page.actions";
import {
  BENCH_UPGRADE_PLANNER,
  InboxActionHandlers,
  denyReason,
  refOf,
  sourceSegment,
  type ActionContext,
} from "./inbox-actions.handlers";
import type { ActionItem, InboxActionsRepository } from "./inbox-actions.repository";

/**
 * The bindings: each action reaches the plane that owns it, with the item's refs and the person,
 * and returns that plane's receipt — over stubbed planes, so each adapter can be read alone.
 */

const ORG = "org-acme";
const RUN = "5eed0009-0000-4000-8000-000000000479";
const PR = "5eed007c-0000-4000-8000-000000000504";
const ADMIN: Requester = { id: "user-ken", name: "Ken", roles: ["admin"] };
const MEMBER: Requester = { id: "user-jorge", name: "Jorge", roles: ["member"] };

/** An item with the given refs and source reference. */
function item(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: "item-1",
    organizationId: ORG,
    kindId: "merge_approval",
    kindVersion: 1,
    status: "open",
    payload: {},
    refs: [
      { type: "run", id: RUN, label: "loop #1844" },
      { type: "pr", id: PR, label: "PR #504" },
      { type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" },
    ],
    sourceRef: `pr:${PR}`,
    ...overrides,
  };
}

/** A context. */
function context(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    organizationId: ORG,
    item: item(),
    actionId: "approve_merge",
    actor: ADMIN,
    note: null,
    attemptId: "attempt-1",
    ...overrides,
  };
}

/** Every plane, stubbed. */
function planes() {
  const trx = { transaction: true };
  const repository = {
    transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(trx)),
    pullRequest: jest.fn(() =>
      Promise.resolve({
        number: 504,
        latestRevisionId: "revision-1",
        ticketSourceId: "source-gh",
        ticketKey: "#465",
      }),
    ),
    loopSeq: jest.fn(() => Promise.resolve(1844)),
    factStatus: jest.fn(() => Promise.resolve("proposed")),
    grantException: jest.fn(() => Promise.resolve("exception-1")),
  };
  const pages = {
    decide: jest.fn(() => Promise.resolve({ review: { id: "review-1" } })),
  };
  const merges = {
    arm: jest.fn(() => Promise.resolve({})),
    run: jest.fn(() => Promise.resolve({ kind: "idle" })),
  };
  const criteria = {
    waive: jest.fn(() =>
      Promise.resolve({ criterion: { status: "waived" }, annotation: { state: "annotated" } }),
    ),
  };
  const guardrails = {
    reevaluatePaths: jest.fn(() =>
      Promise.resolve({
        evaluationId: "evaluation-1",
        verdict: "pass",
        changeSetSeq: 3,
        grantsSpent: ["exception-1"],
      }),
    ),
  };
  const controls = {
    submit: jest.fn(() => Promise.resolve({ id: "control-1", state: "pending" })),
    correctionRound: jest.fn(() => Promise.resolve({ id: "control-2", state: "pending" })),
  };
  const batches = {
    push: jest.fn(() =>
      Promise.resolve({ report: { outcome: "pushed", pushedThisRun: 6 }, queueSmall: null }),
    ),
    compose: jest.fn(() => Promise.resolve({ id: "batch-1", drafts: [{ id: "draft-1" }] })),
  };
  const facts = {
    confirm: jest.fn(() => Promise.resolve({ status: "confirmed" })),
    reconfirm: jest.fn(() => Promise.resolve({ status: "confirmed" })),
    reject: jest.fn(() => Promise.resolve({ status: "rejected" })),
    expire: jest.fn(() => Promise.resolve({ status: "expired" })),
  };
  const handlers = new InboxActionHandlers(
    repository as unknown as InboxActionsRepository,
    pages as unknown as PageActionsService,
    merges as unknown as MergeExecutorService,
    criteria as unknown as CriteriaService,
    guardrails as unknown as GuardrailService,
    controls as unknown as ControlsService,
    batches as unknown as BatchesService,
    facts as unknown as FactsService,
  );

  return {
    handlers,
    trx,
    repository,
    pages,
    merges,
    criteria,
    guardrails,
    controls,
    batches,
    facts,
  };
}

describe("refOf and sourceSegment", () => {
  it("find the first ref of a type", () => {
    expect(refOf(item(), "pr")).toBe(PR);
  });

  it("refuse an item that names no such ref", () => {
    expect(() => refOf(item({ refs: [] }), "run")).toThrow(ConflictError);
  });

  it("read a labelled segment of the source reference", () => {
    expect(sourceSegment(item({ sourceRef: `pr:${PR}:criterion:crit-5` }), "criterion")).toBe(
      "crit-5",
    );
    expect(sourceSegment(item({ sourceRef: "fact:fact-3:stale:t-1" }), "fact")).toBe("fact-3");
  });

  it("refuse a source reference without the segment", () => {
    expect(() => sourceSegment(item({ sourceRef: `pr:${PR}` }), "criterion")).toThrow(
      "names no criterion in its source reference",
    );
    expect(() => sourceSegment(item({ sourceRef: "batch:" }), "batch")).toThrow(ConflictError);
  });
});

describe("InboxActionHandlers", () => {
  it("knows which bindings it can execute", () => {
    const { handlers } = planes();

    expect(handlers.isBound("pr.approve_and_merge")).toBe(true);
    expect(handlers.isBound("guardrail.allow_once")).toBe(true);
    expect(handlers.isBound("workflow.sign_off_plan")).toBe(false);
  });

  it.each([
    "workflow.sign_off_plan",
    "planning.abandon_batch",
    "estimation.accept_resize",
    "estimation.keep_size",
    "spend.approve_overage",
  ])(
    "answers 501 decision_action_unbound for %s, whose plane has no operation",
    async (binding) => {
      const { handlers } = planes();

      const pressed = handlers.execute(binding, context());

      await expect(pressed).rejects.toBeInstanceOf(NotImplementedError);
      await expect(pressed).rejects.toMatchObject({ code: "decision_action_unbound" });
    },
  );

  describe("Approve & merge", () => {
    it("approves through AX.5, arms the existing plan against the latest revision, and runs it once", async () => {
      const { handlers, pages, merges } = planes();

      const outcome = await handlers.execute("pr.approve_and_merge", context());

      expect(pages.decide).toHaveBeenCalledWith(ORG, PR, ADMIN, { decision: "approve" });
      expect(merges.arm).toHaveBeenCalledWith(
        ORG,
        PR,
        { id: ADMIN.id, roles: ADMIN.roles },
        "revision-1",
      );
      expect(merges.run).toHaveBeenCalledWith(ORG, PR, { kind: "armed" });
      expect(outcome).toEqual({
        approval_id: "review-1",
        pr_id: PR,
        merge: "armed",
        merge_sha: null,
      });
    });

    it("puts the merge SHA in the receipt when the gates were already green", async () => {
      const { handlers, merges } = planes();
      merges.run.mockResolvedValue({
        kind: "merged",
        plan: { mergedResult: { sha: "9f3c2ae" } },
      } as never);

      const outcome = await handlers.execute("pr.approve_and_merge", context());

      expect(outcome).toMatchObject({ merge: "merged", merge_sha: "9f3c2ae" });
    });

    it("stays armed when the re-check only waits for gates", async () => {
      const { handlers, merges } = planes();
      merges.run.mockResolvedValue({
        kind: "refused",
        disarmed: false,
        refusal: { code: "gates_pending", message: "Gates are still running." },
      } as never);

      await expect(handlers.execute("pr.approve_and_merge", context())).resolves.toMatchObject({
        merge: "armed",
      });
    });

    it("fails when the re-check refused and disarmed the plan — never a false resolution", async () => {
      const { handlers, merges } = planes();
      merges.run.mockResolvedValue({
        kind: "refused",
        disarmed: true,
        refusal: { code: "host_conflict", message: "The host reports a conflict." },
      } as never);

      await expect(handlers.execute("pr.approve_and_merge", context())).rejects.toMatchObject({
        code: "merge_refused",
        details: { refusal: "host_conflict" },
      });
    });

    it("fails when the PR has no revision to arm", async () => {
      const { handlers, repository, merges } = planes();
      repository.pullRequest.mockResolvedValue({
        number: 504,
        latestRevisionId: null,
        ticketSourceId: null,
        ticketKey: null,
      } as never);

      await expect(handlers.execute("pr.approve_and_merge", context())).rejects.toThrow(
        ConflictError,
      );
      expect(merges.arm).not.toHaveBeenCalled();
    });
  });

  it("waives through AX.3 with the note as the reason, and reports the host annotation", async () => {
    const { handlers, criteria } = planes();

    const outcome = await handlers.execute(
      "pr.waive_criterion",
      context({
        item: item({ sourceRef: `pr:${PR}:criterion:crit-5` }),
        note: "Rig has no thermal chamber.",
      }),
    );

    expect(criteria.waive).toHaveBeenCalledWith(
      ORG,
      PR,
      "crit-5",
      { id: ADMIN.id, name: "Ken" },
      {
        reason: "Rig has no thermal chamber.",
      },
    );
    expect(outcome).toEqual({
      pr_id: PR,
      criterion_id: "crit-5",
      waived: true,
      annotation: "annotated",
    });
  });

  describe("Allow once", () => {
    it("grants, has AP.3 re-judge (consuming the grant) in one transaction, then resumes through AP.4", async () => {
      const { handlers, repository, guardrails, controls, trx } = planes();

      const outcome = await handlers.execute(
        "guardrail.allow_once",
        context({ actionId: "allow_once" }),
      );

      expect(repository.grantException).toHaveBeenCalledWith(trx, {
        organizationId: ORG,
        runId: RUN,
        pathGlob: "boot/rollback_flag.c",
        grantedBy: ADMIN.id,
        itemId: "item-1",
      });
      expect(guardrails.reevaluatePaths).toHaveBeenCalledWith(trx, RUN);
      expect(controls.submit).toHaveBeenCalledWith(ORG, RUN, ADMIN, {
        kind: "resume",
        idempotencyKey: "inbox:attempt-1",
      });
      expect(outcome).toEqual({
        run_id: RUN,
        exception_id: "exception-1",
        evaluation_id: "evaluation-1",
        control_id: "control-1",
        control_state: "pending",
      });
    });

    it("grants nothing and resumes nothing when AP.3 still blocks the run", async () => {
      const { handlers, guardrails, controls } = planes();
      guardrails.reevaluatePaths.mockResolvedValue({
        evaluationId: "evaluation-1",
        verdict: "fail",
        changeSetSeq: 3,
        grantsSpent: [],
      });

      await expect(
        handlers.execute("guardrail.allow_once", context({ actionId: "allow_once" })),
      ).rejects.toMatchObject({ code: "allow_once_still_blocked", details: { verdict: "fail" } });
      expect(controls.submit).not.toHaveBeenCalled();
    });

    it("refuses when the run has no change-set to re-judge", async () => {
      const { handlers, guardrails } = planes();
      guardrails.reevaluatePaths.mockResolvedValue(undefined as never);

      await expect(
        handlers.execute("guardrail.allow_once", context({ actionId: "allow_once" })),
      ).rejects.toMatchObject({ code: "allow_once_still_blocked" });
    });

    it("refuses before granting when the person could not resume the run", async () => {
      const { handlers, repository } = planes();

      await expect(
        handlers.execute(
          "guardrail.allow_once",
          context({ actor: MEMBER, actionId: "allow_once" }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(repository.grantException).not.toHaveBeenCalled();
    });
  });

  it("denies through an AP.4 correction round that tells the run why", async () => {
    const { handlers, controls } = planes();

    const outcome = await handlers.execute(
      "run.deny_protected_path",
      context({ actionId: "deny" }),
    );

    expect(controls.correctionRound).toHaveBeenCalledWith(
      ORG,
      RUN,
      ADMIN,
      denyReason("boot/rollback_flag.c"),
      "inbox:attempt-1",
    );
    expect(denyReason("boot/rollback_flag.c")).toContain("stays protected");
    expect(outcome).toEqual({ run_id: RUN, control_id: "control-2", control_state: "pending" });
  });

  it.each(["run.return_with_note", "run.retry_with_note"])(
    "delivers %s's note through AP.4's correction round",
    async (binding) => {
      const { handlers, controls } = planes();

      await handlers.execute(binding, context({ note: "Keep the DMA path." }));

      expect(controls.correctionRound).toHaveBeenCalledWith(
        ORG,
        RUN,
        ADMIN,
        "Keep the DMA path.",
        "inbox:attempt-1",
      );
    },
  );

  it("cancels through AP.4's abort, confirmed with the run's own loop number", async () => {
    const { handlers, controls } = planes();

    await handlers.execute("run.cancel", context({ actionId: "cancel_run" }));

    expect(controls.submit).toHaveBeenCalledWith(ORG, RUN, ADMIN, {
      kind: "abort",
      confirmation: "1844",
      idempotencyKey: "inbox:attempt-1",
    });
  });

  it("pushes the split's batch through AL.3", async () => {
    const { handlers, batches } = planes();

    const outcome = await handlers.execute(
      "planning.push_batch",
      context({ item: item({ sourceRef: "batch:batch-9" }) }),
    );

    expect(batches.push).toHaveBeenCalledWith(ORG, "batch-9");
    expect(outcome).toEqual({ draft_batch_id: "batch-9", push: "pushed", pushed: 6 });
  });

  describe("Require bench upgrade", () => {
    it("composes a one-draft bench-gap batch into the PR's ticket source, and returns the draft's ref", async () => {
      const { handlers, batches } = planes();

      const outcome = await handlers.execute(
        "planning.require_bench_upgrade",
        context({
          item: item({
            payload: {
              claim: "Flake must not reappear across temperature range",
              missing_capability: "thermal chamber",
            },
          }),
        }),
      );

      expect(batches.compose).toHaveBeenCalledWith(
        ORG,
        ADMIN.id,
        expect.objectContaining({
          planner: BENCH_UPGRADE_PLANNER,
          targetSourceId: "source-gh",
          drafts: [
            expect.objectContaining({
              localKey: "bench-1",
              title: "Bench: add a thermal chamber to the rig",
            }),
          ],
        }),
      );
      expect(outcome).toEqual({ pr_id: PR, draft_batch_id: "batch-1", draft_id: "draft-1" });
    });

    it("refuses a PR with no ticket to target", async () => {
      const { handlers, repository, batches } = planes();
      repository.pullRequest.mockResolvedValue({
        number: 504,
        latestRevisionId: "revision-1",
        ticketSourceId: null,
        ticketKey: null,
      } as never);

      await expect(
        handlers.execute("planning.require_bench_upgrade", context()),
      ).rejects.toMatchObject({
        code: "bench_upgrade_target_missing",
      });
      expect(batches.compose).not.toHaveBeenCalled();
    });
  });

  describe("facts", () => {
    const fact = (status: string) => {
      const stubs = planes();
      stubs.repository.factStatus.mockResolvedValue(status);

      return stubs;
    };

    it("confirms a proposed fact and reconfirms a stale one", async () => {
      const proposed = fact("proposed");
      const stale = fact("stale");
      const press = context({ item: item({ sourceRef: "fact:fact-3:proposed" }) });

      await proposed.handlers.execute("facts.confirm", press);
      await stale.handlers.execute("facts.confirm", press);

      expect(proposed.facts.confirm).toHaveBeenCalledWith(ORG, "fact-3", ADMIN.id);
      expect(stale.facts.reconfirm).toHaveBeenCalledWith(ORG, "fact-3", ADMIN.id);
    });

    it("retires a proposed fact by rejecting it and a confirmed one by expiring it, with the note", async () => {
      const proposed = fact("proposed");
      const confirmed = fact("confirmed");
      const press = context({
        item: item({ sourceRef: "fact:fact-3:stale:t-1" }),
        note: "Zephyr 4.1.",
      });

      const rejected = await proposed.handlers.execute("facts.retire", press);
      const expired = await confirmed.handlers.execute("facts.retire", press);

      expect(proposed.facts.reject).toHaveBeenCalledWith(ORG, "fact-3", ADMIN.id, "Zephyr 4.1.");
      expect(confirmed.facts.expire).toHaveBeenCalledWith(ORG, "fact-3", ADMIN.id, "Zephyr 4.1.");
      expect(rejected).toEqual({ fact_id: "fact-3", status: "rejected" });
      expect(expired).toEqual({ fact_id: "fact-3", status: "expired" });
    });
  });
});
