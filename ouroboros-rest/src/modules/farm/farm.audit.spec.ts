import type { AuditService } from "../audit/audit.service";
import { AUDIT_ACTIONS, type AuditRecord } from "../audit/audit.events";
import { FarmAudit } from "./farm.audit";
import { FIXTURE_NOW, FIXTURE_ORGANIZATION, FIXTURE_RUNNER } from "./farm.fixture";

/**
 * The trail, and the two properties it carries for the rest of the module.
 *
 * **It is where the six enrollment refusals are told apart.** `farm.errors.ts` gives a
 * stranger one answer on purpose; the fact still has to exist, and this is where.
 *
 * **Nothing here can be handed a secret.** Asserted at the value level — a full lifecycle is
 * driven and every recorded payload is scanned for anything that looks like one — and at the
 * type level, which is stronger and cannot be tested: no method below has a parameter a token
 * value, a bearer secret or an envelope could be passed to.
 */

/** A recording audit service. */
function audit(): { service: AuditService; written: AuditRecord[] } {
  const written: AuditRecord[] = [];

  const service = {
    record: jest.fn((event: AuditRecord) => {
      written.push(event);

      return Promise.resolve("event-id");
    }),
  } as unknown as AuditService;

  return { service, written };
}

const ACTOR = { organizationId: FIXTURE_ORGANIZATION, actorId: "user_ken", at: FIXTURE_NOW };

/** A build somebody submitted through the dialog (#260). */
const SUBMISSION = {
  jobId: "5eed0028-0000-4000-8000-000000000483",
  number: 483,
  pool: "pool-a",
  repository: "acme-robotics/helios-firmware",
  ref: "refs/heads/main",
  commit: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
  runId: null,
};

describe("the events this module writes", () => {
  it("are all in the service's own vocabulary", async () => {
    // A name written here and not in `AUDIT_ACTIONS` is an event that can be recorded and not
    // filtered for.
    const { service, written } = audit();
    const trail = new FarmAudit(service);

    await trail.tokenMinted(ACTOR, {
      id: "t",
      poolId: "p",
      maxUses: 5,
      expiresAt: FIXTURE_NOW,
    });
    await trail.tokenRevoked(ACTOR, { id: "t", usesAtRevocation: 3 });
    await trail.enrolled(ACTOR, {
      id: FIXTURE_RUNNER,
      name: "forge-01",
      poolId: "p",
      tokenId: "t",
      securityMode: "mtls",
      serial: "4a110e97",
    });
    await trail.certificateRenewed(ACTOR, {
      runnerId: FIXTURE_RUNNER,
      previousSerial: "4a110e97",
      serial: "4a110e98",
    });
    await trail.certificateRevoked(ACTOR, {
      runnerId: FIXTURE_RUNNER,
      serial: "4a110e98",
      reason: "operator",
    });

    await trail.jobSubmitted(ACTOR, SUBMISSION);

    expect(written).toHaveLength(6);
    for (const event of written) expect(AUDIT_ACTIONS).toContain(event.action);
  });

  it("files an enrollment under the runner, not the token", async () => {
    // *What happened to this machine* is the question a fleet operator asks; the token is named
    // in the detail so *what did that token let in?* is one `where` away.
    const { service, written } = audit();

    await new FarmAudit(service).enrolled(ACTOR, {
      id: FIXTURE_RUNNER,
      name: "forge-01",
      poolId: "p",
      tokenId: "t",
      securityMode: "mtls",
      serial: "4a110e97",
    });

    expect(written[0]?.subjectType).toBe("runner");
    expect(written[0]?.subjectId).toBe(FIXTURE_RUNNER);
    expect(written[0]?.detail?.tokenId).toBe("t");
  });

  it("records the use count a token was revoked at", async () => {
    // Revoked at zero uses leaked nothing; revoked at four means four machines to account for.
    const { service, written } = audit();

    await new FarmAudit(service).tokenRevoked(ACTOR, { id: "t", usesAtRevocation: 4 });

    expect(written[0]?.detail).toEqual({ usesAtRevocation: 4 });
  });

  it("records both serials on a renewal", async () => {
    // *This runner's identity changed* is only useful if the trail says what it changed from:
    // a superseded serial in a proxy log a week later has to resolve to something.
    const { service, written } = audit();

    await new FarmAudit(service).certificateRenewed(ACTOR, {
      runnerId: FIXTURE_RUNNER,
      previousSerial: "4a110e97",
      serial: "4a110e98",
    });

    expect(written[0]?.detail).toEqual({ previousSerial: "4a110e97", serial: "4a110e98" });
  });

  it("names no person on a renewal, because no person authorised it", async () => {
    const { service, written } = audit();

    await new FarmAudit(service).certificateRenewed(
      { ...ACTOR, actorId: null },
      { runnerId: FIXTURE_RUNNER, previousSerial: "a", serial: "b" },
    );

    expect(written[0]?.actorId).toBeNull();
  });
});

describe("a refused enrollment", () => {
  it("records which of the six it was", async () => {
    // The information the response withholds. Six failed enrollments all `unknown_token` and
    // six all `bad_secret` against one live token are very different mornings.
    const { service, written } = audit();

    await new FarmAudit(service).enrollmentRefused(ACTOR, "bad_secret", "t");

    expect(written[0]?.detail).toEqual({ outcome: "refused", refusal: "bad_secret" });
    expect(written[0]?.subjectType).toBe("enrollment_token");
  });

  it("writes nothing when there is no workspace to attribute it to", async () => {
    // A token id that names no row has no workspace, and a row invented under a default tenant
    // would be worse than no row.
    const { service, written } = audit();

    await new FarmAudit(service).enrollmentRefused(undefined, "unknown_token", null);

    expect(written).toHaveLength(0);
  });

  it("swallows its own failure, so the caller still gets the refusal it is owed", async () => {
    // The one asymmetry in this file: it is called from inside the `catch` that produces the
    // caller's `401`, and an insert that threw there would replace it with an unexplained 500 —
    // losing the more useful of the two facts.
    const service = {
      record: jest.fn(() => Promise.reject(new Error("the trail is down"))),
    } as unknown as AuditService;

    await expect(
      new FarmAudit(service).enrollmentRefused(ACTOR, "expired", "t"),
    ).resolves.toBeUndefined();
  });

  it("is the only method that swallows", async () => {
    // Everywhere else AD.4's posture applies: a failure to record is a failure of the
    // operation.
    const service = {
      record: jest.fn(() => Promise.reject(new Error("the trail is down"))),
    } as unknown as AuditService;
    const trail = new FarmAudit(service);

    await expect(
      trail.tokenMinted(ACTOR, { id: "t", poolId: "p", maxUses: 1, expiresAt: FIXTURE_NOW }),
    ).rejects.toThrow("the trail is down");
    await expect(
      trail.certificateRevoked(ACTOR, { runnerId: "r", serial: "s", reason: "operator" }),
    ).rejects.toThrow("the trail is down");
  });
});

describe("a submitted build (#260)", () => {
  it("is filed under the build, by whoever submitted it", async () => {
    const { service, written } = audit();

    await new FarmAudit(service).jobSubmitted(ACTOR, SUBMISSION);

    expect(written[0]).toMatchObject({
      action: "runner.job_submitted",
      subjectType: "build_job",
      subjectId: SUBMISSION.jobId,
      actorId: "user_ken",
      organizationId: FIXTURE_ORGANIZATION,
      at: FIXTURE_NOW,
    });
  });

  it("records what was asked to be built, down to the exact commit", async () => {
    // *Who sent this to our hardware* is only useful beside *what did they send*: a moving ref
    // would not answer it a week later, which is why the commit is here and not just the ref.
    const { service, written } = audit();

    await new FarmAudit(service).jobSubmitted(ACTOR, SUBMISSION);

    expect(written[0]?.detail).toEqual({
      number: 483,
      pool: "pool-a",
      repository: "acme-robotics/helios-firmware",
      ref: "refs/heads/main",
      commit: "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80",
    });
  });

  it("has no parameter a command could arrive in", async () => {
    // A token pasted onto a command line is the likeliest secret a submission carries. The
    // method takes no command, so none can be recorded — asserted on the keys, because the
    // guarantee is structural and not a matter of what this one fixture happens to hold.
    const { service, written } = audit();

    await new FarmAudit(service).jobSubmitted(ACTOR, SUBMISSION);

    expect(Object.keys(written[0]?.detail ?? {})).not.toContain("command");
    for (const value of Object.values(written[0]?.detail ?? {})) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });

  it("names the run and no person when a run submitted it", async () => {
    // AJ.3 (#265): the submitter is a loop run, which has no user id. `runId` says which.
    const { service, written } = audit();

    await new FarmAudit(service).jobSubmitted(
      { ...ACTOR, actorId: null },
      { ...SUBMISSION, runId: "7f000009-0000-4000-8000-000000000001" },
    );

    expect(written[0]?.actorId).toBeNull();
    expect(written[0]?.detail?.runId).toBe("7f000009-0000-4000-8000-000000000001");
  });
});

describe("what a farm event can carry", () => {
  it("is flat scalars, which is what makes a top-level scan of one complete", async () => {
    const { service, written } = audit();

    await new FarmAudit(service).enrolled(ACTOR, {
      id: FIXTURE_RUNNER,
      name: "forge-01",
      poolId: "p",
      tokenId: "t",
      securityMode: "mtls",
      serial: "4a110e97",
    });

    for (const value of Object.values(written[0]?.detail ?? {})) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });

  it("never contains an envelope or a token value in a full lifecycle", async () => {
    const { service, written } = audit();
    const trail = new FarmAudit(service);

    await trail.tokenMinted(ACTOR, { id: "t", poolId: "p", maxUses: 5, expiresAt: FIXTURE_NOW });
    await trail.enrolled(ACTOR, {
      id: FIXTURE_RUNNER,
      name: "forge-01",
      poolId: "p",
      tokenId: "t",
      securityMode: "mtls",
      serial: "4a110e97",
    });
    await trail.enrollmentRefused(ACTOR, "revoked", "t");
    await trail.certificateRenewed(ACTOR, { runnerId: "r", previousSerial: "a", serial: "b" });
    await trail.certificateRevoked(ACTOR, { runnerId: "r", serial: "b", reason: "operator" });

    const trailText = JSON.stringify(written);

    expect(trailText).not.toContain("ouro.v1.");
    expect(trailText).not.toContain("orb_enroll_");
    expect(trailText).not.toContain("PRIVATE KEY");
  });
});
