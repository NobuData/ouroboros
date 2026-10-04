import { Logger } from "@nestjs/common";

import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import type { Requester } from "../controls/controls.service";
import type { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import type { DecisionLifecycle } from "../decisions/decision.lifecycle";
import { SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotImplementedError,
} from "../errors/error.envelope";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import { decisionActionUnbound } from "./inbox-actions.errors";
import type { InboxActionHandlers } from "./inbox-actions.handlers";
import type {
  ActionAttempt,
  ActionItem,
  ActionResolution,
  InboxActionsRepository,
} from "./inbox-actions.repository";
import { ABANDONED_ATTEMPT_MS, InboxActionsService, failureOf } from "./inbox-actions.service";

/**
 * The executor's rules over stubbed planes and a stubbed store: what it refuses before any plane
 * is called, how the claim decides first-answer-wins and replays, and that a failure never reads as
 * an answer.
 */

const ORG = "org-acme";
const KEN: Requester = { id: "user-ken", name: "Ken", roles: ["owner"] };
const PRIYA: Requester = { id: "user-priya", name: "Priya", roles: ["admin"] };
const JORGE: Requester = { id: "user-jorge", name: "Jorge", roles: ["member"] };
const VIEWER: Requester = { id: "user-vic", name: "Vic", roles: ["viewer"] };

/** An open item of a kind. */
function item(kindId: string, overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: "item-1",
    organizationId: ORG,
    kindId,
    kindVersion: 1,
    status: "open",
    payload: {},
    refs: [],
    sourceRef: "source-1",
    ...overrides,
  };
}

/** A stored resolution. */
function resolution(overrides: Partial<ActionResolution> = {}): ActionResolution {
  return {
    actionId: "approve_merge",
    resolver: "human",
    policy: null,
    actor: { id: KEN.id, name: "Ken" },
    channel: "web",
    note: null,
    outcome: { merge: "armed" },
    resolvedAt: new Date("2026-10-04T10:00:00Z"),
    ...overrides,
  };
}

/** A stored attempt. */
function attempt(overrides: Partial<ActionAttempt> = {}): ActionAttempt {
  return {
    id: "attempt-0",
    actionId: "approve_merge",
    actorId: KEN.id,
    actor: { id: KEN.id, name: "Ken" },
    channel: "web",
    idempotencyKey: "key-1",
    status: "succeeded",
    outcome: { merge: "armed" },
    errorCode: null,
    errorMessage: null,
    errorStatus: null,
    startedAt: new Date(),
    ...overrides,
  };
}

/** The executor over stubs; each test adjusts the stubs it needs. */
function executor(options: { item?: ActionItem; explicit?: boolean | null } = {}) {
  const current = options.item ?? item("merge_approval");
  const trx = { trx: true };
  const repository = {
    db: { pool: true },
    transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(trx)),
    item: jest.fn(() => Promise.resolve(current as ActionItem | undefined)),
    attemptByKey: jest.fn(() => Promise.resolve(undefined as ActionAttempt | undefined)),
    runningAttempt: jest.fn(() => Promise.resolve(undefined as ActionAttempt | undefined)),
    resolution: jest.fn(() => Promise.resolve(resolution() as ActionResolution | undefined)),
    insertAttempt: jest.fn(() => Promise.resolve("attempt-1")),
    succeed: jest.fn(() => Promise.resolve()),
    fail: jest.fn(() => Promise.resolve()),
    insertResolution: jest.fn(() => Promise.resolve()),
  };
  const handlers = {
    execute: jest.fn(() =>
      Promise.resolve({ merge: "armed", merge_sha: null } as Record<string, unknown>),
    ),
  };
  const registry = {
    pinnedKind: jest.fn((kindId: string) => Promise.resolve(SHIPPED_KINDS[kindId])),
  };
  const lifecycle = { emit: jest.fn() };
  const audit = { record: jest.fn(() => Promise.resolve("audit-1")) };
  const capabilities = {
    explicitFor: jest.fn(() => Promise.resolve(options.explicit ?? null)),
  };
  const service = new InboxActionsService(
    repository as unknown as InboxActionsRepository,
    handlers as unknown as InboxActionHandlers,
    registry as unknown as DecisionKindRegistry,
    lifecycle as unknown as DecisionLifecycle,
    audit as unknown as AuditService,
    capabilities as unknown as CapabilityRepository,
  );

  return { service, trx, repository, handlers, registry, lifecycle, audit, capabilities };
}

/**
 * The one audit record a press wrote.
 *
 * @param audit - The stubbed audit service.
 * @param audit.record - Its recorder.
 * @returns The record.
 */
function recorded(audit: { record: jest.Mock }): AuditRecord {
  expect(audit.record).toHaveBeenCalledTimes(1);

  return (audit.record.mock.calls[0] as [AuditRecord])[0];
}

describe("InboxActionsService", () => {
  let quiet: jest.SpyInstance;

  beforeEach(() => {
    quiet = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => quiet.mockRestore());

  describe("refusals before any plane is called", () => {
    it("refuses a caller with no signed-in person", async () => {
      const { service, handlers } = executor();

      await expect(
        service.execute(ORG, "item-1", "approve_merge", undefined, {}),
      ).rejects.toMatchObject({
        code: "decision_action_needs_person",
      });
      expect(handlers.execute).not.toHaveBeenCalled();
    });

    it("answers 404 for an item the workspace does not have", async () => {
      const { service, repository } = executor();
      repository.item.mockResolvedValue(undefined);

      await expect(service.execute(ORG, "item-x", "approve_merge", KEN, {})).rejects.toMatchObject({
        code: "decision_item_not_found",
      });
    });

    it("answers 404 for an action the pinned kind does not declare", async () => {
      const { service } = executor();

      await expect(service.execute(ORG, "item-1", "allow_once", KEN, {})).rejects.toMatchObject({
        code: "decision_action_not_found",
      });
    });

    it("refuses a link — Open PR verification decides nothing", async () => {
      const { service, handlers } = executor();

      await expect(
        service.execute(ORG, "item-1", "open_verification", KEN, {}),
      ).rejects.toMatchObject({
        code: "decision_action_not_an_answer",
      });
      expect(handlers.execute).not.toHaveBeenCalled();
    });

    it("refuses a member who lacks can_approve_loops an approver's action, server-side", async () => {
      const { service, handlers } = executor();

      const pressed = service.execute(ORG, "item-1", "approve_merge", JORGE, {});

      await expect(pressed).rejects.toBeInstanceOf(ForbiddenError);
      await expect(pressed).rejects.toMatchObject({
        code: "decision_action_forbidden",
        details: { required: "approver" },
      });
      expect(handlers.execute).not.toHaveBeenCalled();
    });

    it("lets a member whose can_approve_loops was granted explicitly approve", async () => {
      const { service, capabilities } = executor({ explicit: true });

      await expect(
        service.execute(ORG, "item-1", "approve_merge", JORGE, {}),
      ).resolves.toMatchObject({
        status: "resolved",
      });
      expect(capabilities.explicitFor).toHaveBeenCalledWith(ORG, JORGE.id);
    });

    it("refuses an admin whose can_approve_loops was revoked explicitly", async () => {
      const { service } = executor({ explicit: false });

      await expect(
        service.execute(ORG, "item-1", "approve_merge", PRIYA, {}),
      ).rejects.toMatchObject({
        code: "decision_action_forbidden",
      });
    });

    it("holds role ladders too: a viewer may not return a loop, a member may", async () => {
      const { service } = executor();

      await expect(
        service.execute(ORG, "item-1", "return_to_loop", VIEWER, { note: "Keep the DMA path." }),
      ).rejects.toMatchObject({
        code: "decision_action_forbidden",
        details: { required: "member" },
      });
      await expect(
        service.execute(ORG, "item-1", "return_to_loop", JORGE, { note: "Keep the DMA path." }),
      ).resolves.toMatchObject({ status: "resolved" });
    });

    it("needs a note exactly when the action takes one", async () => {
      const { service } = executor();

      await expect(service.execute(ORG, "item-1", "return_to_loop", KEN, {})).rejects.toMatchObject(
        {
          code: "decision_note_required",
        },
      );
      await expect(
        service.execute(ORG, "item-1", "return_to_loop", KEN, { note: "   " }),
      ).rejects.toMatchObject({ code: "decision_note_required" });
      await expect(
        service.execute(ORG, "item-1", "approve_merge", KEN, { note: "Ship it." }),
      ).rejects.toMatchObject({ code: "decision_note_not_taken" });
    });
  });

  describe("the claim — first answer wins", () => {
    it("tells the loser who answered, with what and when", async () => {
      const { service, repository, handlers } = executor();
      repository.item
        .mockResolvedValueOnce(item("merge_approval"))
        .mockResolvedValueOnce(item("merge_approval", { status: "resolved" }));
      repository.resolution.mockResolvedValue(
        resolution({ actor: { id: PRIYA.id, name: "Priya" }, channel: "email" }),
      );

      const pressed = service.execute(ORG, "item-1", "approve_merge", KEN, {});

      await expect(pressed).rejects.toBeInstanceOf(ConflictError);
      await expect(pressed).rejects.toMatchObject({
        code: "decision_already_answered",
        details: {
          resolution: {
            actionId: "approve_merge",
            actor: { id: PRIYA.id, name: "Priya" },
            channel: "email",
            resolvedAt: "2026-10-04T10:00:00.000Z",
          },
        },
      });
      expect(handlers.execute).not.toHaveBeenCalled();
    });

    it("names a policy's closure the same way", async () => {
      const { service, repository } = executor();
      repository.item
        .mockResolvedValueOnce(item("merge_approval"))
        .mockResolvedValueOnce(item("merge_approval", { status: "resolved" }));
      repository.resolution.mockResolvedValue(
        resolution({
          resolver: "policy",
          policy: "source_resolved",
          actor: null,
          actionId: "source_resolved",
        }),
      );

      await expect(service.execute(ORG, "item-1", "approve_merge", KEN, {})).rejects.toMatchObject({
        message: "This decision was already answered by a policy.",
      });
    });

    it("refuses an expired item", async () => {
      const { service, repository } = executor();
      repository.item
        .mockResolvedValueOnce(item("merge_approval"))
        .mockResolvedValueOnce(item("merge_approval", { status: "expired" }));

      await expect(service.execute(ORG, "item-1", "approve_merge", KEN, {})).rejects.toMatchObject({
        code: "decision_item_expired",
      });
    });

    it("refuses while another answer is running, naming whose", async () => {
      const { service, repository, handlers } = executor();
      repository.runningAttempt.mockResolvedValue(
        attempt({ status: "running", actor: { id: PRIYA.id, name: "Priya" }, actorId: PRIYA.id }),
      );

      await expect(service.execute(ORG, "item-1", "approve_merge", KEN, {})).rejects.toMatchObject({
        code: "decision_action_in_progress",
        details: { attempt: { actor: { name: "Priya" } } },
      });
      expect(repository.insertAttempt).not.toHaveBeenCalled();
      expect(handlers.execute).not.toHaveBeenCalled();
    });

    it("takes over an attempt abandoned longer ago than any plane call takes", async () => {
      const { service, repository, trx } = executor();
      repository.runningAttempt.mockResolvedValue(
        attempt({
          id: "attempt-stale",
          status: "running",
          startedAt: new Date(Date.now() - ABANDONED_ATTEMPT_MS - 1),
        }),
      );

      await expect(service.execute(ORG, "item-1", "approve_merge", KEN, {})).resolves.toMatchObject(
        {
          status: "resolved",
        },
      );
      expect(repository.fail).toHaveBeenCalledWith(
        trx,
        "attempt-stale",
        expect.objectContaining({
          code: "decision_attempt_abandoned",
        }),
      );
    });

    it("claims under the item's row lock, with the client's key", async () => {
      const { service, repository, trx } = executor();

      await service.execute(
        ORG,
        "item-1",
        "approve_merge",
        KEN,
        { idempotencyKey: "key-7" },
        "slack",
      );

      expect(repository.item).toHaveBeenLastCalledWith(trx, ORG, "item-1", true);
      expect(repository.insertAttempt).toHaveBeenCalledWith(trx, {
        organizationId: ORG,
        itemId: "item-1",
        actionId: "approve_merge",
        actorId: KEN.id,
        channel: "slack",
        idempotencyKey: "key-7",
      });
    });

    it("generates a key when the client sends none", async () => {
      const { service, repository } = executor();

      const answer = await service.execute(ORG, "item-1", "approve_merge", KEN, {});

      const [, inserted] = repository.insertAttempt.mock.calls[0] as unknown as [
        unknown,
        { idempotencyKey: string },
      ];
      expect(inserted.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(answer.attempt.idempotencyKey).toBe(inserted.idempotencyKey);
    });
  });

  describe("idempotency — a retried key never presses twice", () => {
    it("answers a succeeded key with its first answer, executing nothing", async () => {
      const { service, repository, handlers } = executor();
      repository.attemptByKey.mockResolvedValue(attempt());

      const answer = await service.execute(ORG, "item-1", "approve_merge", KEN, {
        idempotencyKey: "key-1",
      });

      expect(answer).toMatchObject({
        replayed: true,
        attempt: { id: "attempt-0", idempotencyKey: "key-1" },
      });
      expect(handlers.execute).not.toHaveBeenCalled();
      expect(repository.insertAttempt).not.toHaveBeenCalled();
    });

    it("answers a failed key with the failure it answered with", async () => {
      const { service, repository, handlers } = executor();
      repository.attemptByKey.mockResolvedValue(
        attempt({
          status: "failed",
          outcome: null,
          errorCode: "merge_plan_not_armable",
          errorMessage: "No.",
          errorStatus: 409,
        }),
      );

      const pressed = service.execute(ORG, "item-1", "approve_merge", KEN, {
        idempotencyKey: "key-1",
      });

      await expect(pressed).rejects.toBeInstanceOf(DomainError);
      await expect(pressed).rejects.toMatchObject({
        code: "merge_plan_not_armable",
        details: { replayed: true, attemptId: "attempt-0" },
      });
      expect(handlers.execute).not.toHaveBeenCalled();
    });

    it("answers a running key as in progress", async () => {
      const { service, repository } = executor();
      repository.attemptByKey.mockResolvedValue(attempt({ status: "running", outcome: null }));

      await expect(
        service.execute(ORG, "item-1", "approve_merge", KEN, { idempotencyKey: "key-1" }),
      ).rejects.toMatchObject({ code: "decision_action_in_progress" });
    });

    it("refuses a key reused for a different action or person", async () => {
      const { service, repository } = executor();
      repository.attemptByKey.mockResolvedValue(attempt({ actorId: PRIYA.id }));

      await expect(
        service.execute(ORG, "item-1", "approve_merge", KEN, { idempotencyKey: "key-1" }),
      ).rejects.toMatchObject({ code: "decision_idempotency_key_reused" });
    });
  });

  describe("execution", () => {
    it("hands the handler the item, the person, the note and the attempt", async () => {
      const current = item("merge_approval", {
        refs: [{ type: "run", id: "run-1", label: "loop #1" }],
      });
      const { service, handlers } = executor({ item: current });

      await service.execute(ORG, "item-1", "return_to_loop", KEN, {
        note: "  Keep the DMA path. ",
      });

      expect(handlers.execute).toHaveBeenCalledWith("run.return_with_note", {
        organizationId: ORG,
        item: current,
        actionId: "return_to_loop",
        actor: KEN,
        note: "Keep the DMA path.",
        attemptId: "attempt-1",
      });
    });

    it("writes the resolution and the receipt together, then audits and tells the lifecycle", async () => {
      const { service, repository, audit, lifecycle, trx } = executor();

      const answer = await service.execute(ORG, "item-1", "approve_merge", KEN, {});

      expect(repository.insertResolution).toHaveBeenCalledWith(trx, {
        itemId: "item-1",
        organizationId: ORG,
        actionId: "approve_merge",
        userId: KEN.id,
        channel: "web",
        note: null,
        outcome: { merge: "armed", merge_sha: null },
      });
      expect(repository.succeed).toHaveBeenCalledWith(trx, "attempt-1", {
        merge: "armed",
        merge_sha: null,
      });
      expect(recorded(audit)).toMatchObject({
        actorId: KEN.id,
        action: "decision.answered",
        subjectType: "decision_item",
        subjectId: "item-1",
        detail: {
          action: "approve_merge",
          channel: "web",
          attempt: "attempt-1",
          outcome_merge: "armed",
        },
      });
      expect(lifecycle.emit).toHaveBeenCalledWith({
        type: "resolved",
        itemId: "item-1",
        organizationId: ORG,
        kindId: "merge_approval",
        resolver: "human",
        policy: null,
        actionId: "approve_merge",
        channel: "web",
      });
      expect(answer.attempt.id).toBe("attempt-1");
      expect(typeof answer.attempt.idempotencyKey).toBe("string");
      expect({ ...answer, attempt: undefined }).toEqual({
        itemId: "item-1",
        kindId: "merge_approval",
        status: "resolved",
        replayed: false,
        attempt: undefined,
        resolution: {
          actionId: "approve_merge",
          resolver: "human",
          policy: null,
          actor: { id: KEN.id, name: "Ken" },
          channel: "web",
          note: null,
          outcome: { merge: "armed" },
          resolvedAt: "2026-10-04T10:00:00.000Z",
        },
      });
    });

    it("leaves the item open when the plane refuses — the failure recorded, audited and re-thrown", async () => {
      const { service, repository, handlers, audit, lifecycle } = executor();
      const refusal = new ConflictError("merge_plan_not_armable", "The plan cannot be armed.");
      handlers.execute.mockRejectedValue(refusal);

      await expect(service.execute(ORG, "item-1", "approve_merge", KEN, {})).rejects.toBe(refusal);

      expect(repository.fail).toHaveBeenCalledWith(repository.db, "attempt-1", {
        code: "merge_plan_not_armable",
        message: "The plan cannot be armed.",
        status: 409,
      });
      expect(repository.insertResolution).not.toHaveBeenCalled();
      expect(recorded(audit)).toMatchObject({
        action: "decision.answer_failed",
        detail: { error: "merge_plan_not_armable", status: 409 },
      });
      expect(lifecycle.emit).not.toHaveBeenCalled();
    });

    it("records an unbound action the same way: 501, item open", async () => {
      const current = item("plan_sign_off");
      const { service, repository, handlers } = executor({ item: current });
      handlers.execute.mockRejectedValue(
        decisionActionUnbound("sign_off", "workflow.sign_off_plan"),
      );

      await expect(service.execute(ORG, "item-1", "sign_off", KEN, {})).rejects.toBeInstanceOf(
        NotImplementedError,
      );
      expect(repository.fail).toHaveBeenCalledWith(
        repository.db,
        "attempt-1",
        expect.objectContaining({ code: "decision_action_unbound", status: 501 }),
      );
    });

    it("never leaves the attempt running when the answer cannot be written", async () => {
      const { service, repository, lifecycle } = executor();
      repository.insertResolution.mockRejectedValue(new Error("decision item is expired"));

      await expect(service.execute(ORG, "item-1", "approve_merge", KEN, {})).rejects.toThrow(
        "expired",
      );

      expect(repository.fail).toHaveBeenCalledWith(
        repository.db,
        "attempt-1",
        expect.objectContaining({ code: "decision_handler_failed", status: 500 }),
      );
      expect(lifecycle.emit).not.toHaveBeenCalled();
    });
  });

  describe("failureOf", () => {
    it("keeps a domain error's code, sentence and status", () => {
      expect(failureOf(new ForbiddenError("forbidden", "No."))).toEqual({
        code: "forbidden",
        message: "No.",
        status: 403,
      });
    });

    it("hides anything else behind a stable 500", () => {
      expect(failureOf(new Error("connection reset by peer"))).toEqual({
        code: "decision_handler_failed",
        message: "The plane that owns this action failed; nothing was decided.",
        status: 500,
      });
    });
  });
});
