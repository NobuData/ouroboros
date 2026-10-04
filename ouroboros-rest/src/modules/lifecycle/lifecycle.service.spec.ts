import type { AuditService } from "../audit/audit.service";
import type { AuthRequest } from "../auth/http";
import type { Principal } from "../auth/principal";
import { DomainError } from "../errors/error.envelope";
import type { GithubCredentialsService } from "../github/github.credentials.service";
import type { StepUpService } from "../provider-connections/step-up";
import { LIFECYCLE_ERRORS } from "./lifecycle.errors";
import {
  FakeLifecycleStore,
  LIFECYCLE_WORKSPACE as WORKSPACE,
  LIFECYCLE_WORKSPACE_NAME as NAME,
} from "./lifecycle.fixture";
import { LifecycleService } from "./lifecycle.service";

const OWNER: Principal = {
  user: { id: "user-owner" },
  session: { id: "session-owner" },
} as unknown as Principal;

const REQUEST = { headers: {} } as AuthRequest;

/** Everything one service touches, with the doubles exposed for assertions. */
function harness(stepUp: "session" | "password" | null = "session") {
  const store = new FakeLifecycleStore();
  const audit = { record: jest.fn(() => Promise.resolve("event-id")) };
  const github = { clear: jest.fn(() => Promise.resolve({})) };
  const steps = { satisfied: jest.fn(() => Promise.resolve(stepUp)) };
  const auth = {
    revokeSessions: jest.fn(() => Promise.resolve(4)),
    removeOrganization: jest.fn(() => Promise.resolve()),
  };
  const service = new LifecycleService(
    store.repository(),
    store.states(),
    audit as unknown as AuditService,
    github as unknown as GithubCredentialsService,
    steps as unknown as StepUpService,
    auth,
  );

  return { store, audit, github, steps, auth, service };
}

/** The code a rejected promise carries. */
async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as DomainError).envelope().code;
  }

  throw new Error("expected a refusal");
}

describe("pausing", () => {
  it("refuses without an explicit confirmation, and writes nothing", async () => {
    const { store, audit, service } = harness();

    expect(await codeOf(service.pause(WORKSPACE, "user-admin", {}))).toBe(
      LIFECYCLE_ERRORS.confirmationRequired,
    );
    expect(store.rows.size).toBe(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("pauses an active workspace and audits it — the audit row carries the webhook event", async () => {
    const { store, audit, service } = harness();

    const answer = await service.pause(WORKSPACE, "user-admin", { confirm: true });

    expect(answer.state).toBe("paused");
    expect(answer.banner?.kind).toBe("paused");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: WORKSPACE,
        actorId: "user-admin",
        action: "workspace.paused",
        subjectType: "workspace",
        subjectId: WORKSPACE,
        detail: { from: "active", to: "paused" },
      }),
    );
    // The audit writer queues `audit.workspace.paused` in the audit row's transaction (#487);
    // the transition writes no outbox row of its own, so the event is never published twice.
    expect(store.outbox).toEqual([]);
  });

  it("refuses a second pause rather than recording one that did not happen", async () => {
    const { store, audit, service } = harness();
    store.seed(WORKSPACE, "paused");

    expect(await codeOf(service.pause(WORKSPACE, "user-admin", { confirm: true }))).toBe(
      LIFECYCLE_ERRORS.stateConflict,
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(store.outbox).toEqual([]);
  });
});

describe("resuming", () => {
  it("returns a paused workspace to active, audited", async () => {
    const { store, audit, service } = harness();
    store.seed(WORKSPACE, "paused");

    const answer = await service.resume(WORKSPACE, "user-admin");

    expect(answer.state).toBe("active");
    expect(answer.banner).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.resumed",
        detail: { from: "paused", to: "active" },
      }),
    );
  });

  it("refuses to resume a workspace that is not paused", async () => {
    const { service } = harness();

    expect(await codeOf(service.resume(WORKSPACE, "user-admin"))).toBe(
      LIFECYCLE_ERRORS.stateConflict,
    );
  });
});

describe("disconnecting GitHub", () => {
  it("previews from live counts, in sentences", async () => {
    const { service } = harness();

    const preview = await service.previewDisconnect(WORKSPACE);

    expect(preview).toMatchObject({ openPullRequests: 3, activeRuns: 2, tokenStored: true });
    expect(preview.consequences[0]).toBe("3 open pull requests remain on GitHub, untouched.");
    expect(preview.consequences[2]).toBe("1 GitHub source and 4 repositories stop syncing.");
  });

  it("refuses without confirmation, touching nothing", async () => {
    const { github, service } = harness();

    expect(await codeOf(service.disconnect(WORKSPACE, "user-admin", {}))).toBe(
      LIFECYCLE_ERRORS.confirmationRequired,
    );
    expect(github.clear).not.toHaveBeenCalled();
  });

  it("pauses loops, pauses GitHub sources and clears the token — PRs untouched", async () => {
    const { store, audit, github, service } = harness();

    const answer = await service.disconnect(WORKSPACE, "user-admin", { confirm: true });

    expect(answer.openPullRequests).toBe(3);
    expect(store.rows.get(WORKSPACE)?.state).toBe("paused");
    expect(store.sourcesPaused).toBe(1);
    expect(github.clear).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: WORKSPACE, actorId: "user-admin" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.disconnected",
        detail: expect.objectContaining({
          from: "active",
          to: "paused",
          sources_paused: 1,
        }) as unknown,
      }),
    );
    expect(store.outbox).toEqual([]);
  });

  it("keeps an already-paused workspace paused", async () => {
    const { store, service } = harness();
    store.seed(WORKSPACE, "paused");

    await service.disconnect(WORKSPACE, "user-admin", { confirm: true });

    expect(store.rows.get(WORKSPACE)?.state).toBe("paused");
  });

  it("refuses while pending deletion, and keeps the token", async () => {
    const { store, github, service } = harness();
    store.seed(WORKSPACE, "pending_delete", new Date("2026-11-01T00:00:00Z"));

    expect(await codeOf(service.disconnect(WORKSPACE, "user-admin", { confirm: true }))).toBe(
      LIFECYCLE_ERRORS.stateConflict,
    );
    expect(github.clear).not.toHaveBeenCalled();
  });
});

describe("requesting deletion", () => {
  it("refuses a name that is not exactly the workspace's, before any step-up", async () => {
    const { store, steps, service } = harness();

    for (const typed of ["acme", "Acme-Robotics", ` ${NAME}`, `${NAME} `]) {
      expect(
        await codeOf(service.requestDelete(WORKSPACE, OWNER, REQUEST, { confirmName: typed })),
      ).toBe(LIFECYCLE_ERRORS.nameMismatch);
    }

    expect(steps.satisfied).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });

  it("refuses without a step-up, writing nothing", async () => {
    const { store, auth, audit, service } = harness(null);

    expect(
      await codeOf(service.requestDelete(WORKSPACE, OWNER, REQUEST, { confirmName: NAME })),
    ).toBe(LIFECYCLE_ERRORS.stepUpRequired);
    expect(store.rows.size).toBe(0);
    expect(auth.revokeSessions).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("hands the offered password to the step-up", async () => {
    const { steps, service } = harness("password");

    await service.requestDelete(WORKSPACE, OWNER, REQUEST, { confirmName: NAME, password: "pw" });

    expect(steps.satisfied).toHaveBeenCalledWith(OWNER, REQUEST, "pw", expect.any(Date));
  });

  it("moves to pending_delete for thirty days and revokes every non-owner session", async () => {
    const { store, auth, audit, service } = harness();
    const before = Date.now();

    const answer = await service.requestDelete(WORKSPACE, OWNER, REQUEST, { confirmName: NAME });

    expect(answer.state).toBe("pending_delete");
    const closes = new Date(answer.purgeAfter as string).getTime();
    expect(closes - before).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 1000);
    expect(closes - before).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 1000);
    expect(answer.banner?.kind).toBe("pending_delete");
    expect(auth.revokeSessions).toHaveBeenCalledWith(WORKSPACE, ["user-owner"]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.delete_requested", actorId: "user-owner" }),
    );
    expect(store.outbox).toEqual([]);
  });

  it("may delete a paused workspace", async () => {
    const { store, service } = harness();
    store.seed(WORKSPACE, "paused");

    await expect(
      service.requestDelete(WORKSPACE, OWNER, REQUEST, { confirmName: NAME }),
    ).resolves.toMatchObject({ state: "pending_delete" });
  });

  it("refuses to delete twice", async () => {
    const { store, auth, service } = harness();
    store.seed(WORKSPACE, "pending_delete", new Date("2026-11-01T00:00:00Z"));

    expect(
      await codeOf(service.requestDelete(WORKSPACE, OWNER, REQUEST, { confirmName: NAME })),
    ).toBe(LIFECYCLE_ERRORS.stateConflict);
    expect(auth.revokeSessions).not.toHaveBeenCalled();
  });
});

describe("restoring", () => {
  it("returns a pending deletion to active, clears the window and audits it", async () => {
    const { store, audit, service } = harness();
    store.seed(WORKSPACE, "pending_delete", new Date("2026-11-01T00:00:00Z"));

    const answer = await service.restore(WORKSPACE, "user-owner");

    expect(answer).toMatchObject({ state: "active", purgeAfter: null, banner: null });
    expect(store.rows.get(WORKSPACE)?.purge_after).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.restored",
        detail: { from: "pending_delete", to: "active" },
      }),
    );
  });

  it("refuses to restore a workspace that is not pending deletion", async () => {
    const { service } = harness();

    expect(await codeOf(service.restore(WORKSPACE, "user-owner"))).toBe(
      LIFECYCLE_ERRORS.stateConflict,
    );
  });
});
