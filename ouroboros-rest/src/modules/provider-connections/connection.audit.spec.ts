import { Logger } from "@nestjs/common";

import { recordingAudit } from "../audit/audit.fixture";
import type { ProviderValidation } from "../providers/provider.adapter";
import {
  AUDIT_ACTIONS,
  PROVIDER_CAP_CHANGED_EVENT,
  PROVIDER_DISABLED_EVENT,
  PROVIDER_ENABLED_EVENT,
  PROVIDER_UPDATED_EVENT,
} from "../audit/audit.events";
import { providerValidationFailed } from "./provider-connections.errors";
import { DENIED_WORDS } from "../vault/no-secret-logging";
import {
  PROVIDER_ADDED_EVENT,
  PROVIDER_CONNECTION_SUBJECT,
  PROVIDER_DELETED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_TESTED_EVENT,
  ProviderAudit,
  type ProviderAuditAttempt,
  type ProviderAuditContext,
} from "./connection.audit";

/**
 * The trail, and the four claims made about it.
 *
 * The **names** are AD.4's ([#225](https://github.com/NobuData/ouroboros/issues/225))
 * vocabulary, so somebody grepping later finds the strings that issue's scope wrote down
 * rather than ones this module invented. **One event per operation**, because *every AD.2
 * operation writes exactly one event* is that issue's own acceptance criterion. **A refusal
 * is one too**, which is the sentence AD.4 changed — see `connection.audit.ts` on why AD.2
 * recorded successes only and why that is now wrong. And **nothing secret in a record**,
 * checked against the vault's own denied-word list rather than a list typed here, so a word
 * added where this codebase decides what "secret material" means tightens this test too.
 *
 * `lease.audit.spec.ts` is the same suite for AD.3's one event.
 */

const CONTEXT: ProviderAuditContext = {
  organizationId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  connectionId: "5eed000c-0000-4000-8000-000000000001",
  kind: "anthropic",
  actorId: "5eed0003-0000-4000-8000-000000000001",
  at: new Date("2026-08-23T10:00:00.000Z"),
};

/** A test that passed, as the adapter reports one. */
const PASSED: ProviderValidation = { status: "ok", latencyMs: 38, detail: "200" };

const ATTEMPT: ProviderAuditAttempt = {
  organizationId: CONTEXT.organizationId,
  connectionId: null,
  kind: null,
  actorId: CONTEXT.actorId,
  at: CONTEXT.at,
};

describe("the event names", () => {
  it("are the ones AD.4 named", () => {
    expect(PROVIDER_ADDED_EVENT).toBe("provider.added");
    expect(PROVIDER_REVEALED_EVENT).toBe("provider.revealed");
    expect(PROVIDER_ROTATED_EVENT).toBe("provider.rotated");
    expect(PROVIDER_ENABLED_EVENT).toBe("provider.enabled");
    expect(PROVIDER_DISABLED_EVENT).toBe("provider.disabled");
    expect(PROVIDER_CAP_CHANGED_EVENT).toBe("provider.cap_changed");
    expect(PROVIDER_DELETED_EVENT).toBe("provider.deleted");
    expect(PROVIDER_TESTED_EVENT).toBe("provider.tested");
  });

  it("all satisfy the grammar V022 constrains the column to", () => {
    // `family.event`, lower snake on both sides. A name this service could write and the
    // database would refuse is a credential operation that fails at the last statement, so
    // the two rules are asserted against each other rather than each trusted separately.
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });
});

describe("what a completed operation records", () => {
  /** Every method, as a callable, so the shared claims can be asserted about all of them. */
  const everyMethod: readonly [string, (subject: ProviderAudit) => Promise<void>][] = [
    ["added", (subject) => subject.added(CONTEXT)],
    ["revealed", (subject) => subject.revealed(CONTEXT, "password")],
    ["rotated", (subject) => subject.rotated(CONTEXT)],
    ["updated", (subject) => subject.updated(CONTEXT, ["enabled"], undefined, true)],
    ["deleted", (subject) => subject.deleted(CONTEXT)],
    ["tested", (subject) => subject.tested(CONTEXT, PASSED)],
  ];

  it.each(everyMethod)("writes exactly one record for %s", async (_name, record) => {
    const trail = recordingAudit();

    await record(new ProviderAudit(trail.service));

    expect(trail.records).toHaveLength(1);
  });

  it.each(everyMethod)(
    "names the workspace, the connection and the person in %s",
    async (_n, record) => {
      const trail = recordingAudit();

      await record(new ProviderAudit(trail.service));

      expect(trail.records[0]).toMatchObject({
        organizationId: CONTEXT.organizationId,
        actorId: CONTEXT.actorId,
        subjectType: PROVIDER_CONNECTION_SUBJECT,
        subjectId: CONTEXT.connectionId,
        at: CONTEXT.at,
      });
      expect(trail.records[0].detail).toMatchObject({ kind: "anthropic" });
    },
  );

  it.each(everyMethod)("records %s under an action AD.4 named", async (_name, record) => {
    const trail = recordingAudit();

    await record(new ProviderAudit(trail.service));

    expect(AUDIT_ACTIONS).toContain(trail.records[0].action);
  });

  it.each(everyMethod)(
    "marks %s a success, so the failure path is tellable apart",
    async (_n, record) => {
      // A trail in which a refusal and a completion look the same is a trail that answers
      // *did this happen* with *somebody asked*.
      const trail = recordingAudit();

      await record(new ProviderAudit(trail.service));

      expect(trail.records[0].detail?.outcome).toBe("success");
    },
  );

  it("records how a reveal's step-up was satisfied", async () => {
    // *Whose password opened this key* is the question an audit of a reveal exists to
    // answer: it is the difference between somebody with this session and somebody who
    // proved they are this person.
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).revealed(CONTEXT, "session");

    expect(trail.records[0].action).toBe(PROVIDER_REVEALED_EVENT);
    expect(trail.records[0].detail?.step_up).toBe("session");
  });

  it("records which settings an edit wrote, and not their values", async () => {
    // The values are in the row, and echoing an address or a note here would put request
    // content into a table nothing prunes.
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).updated(CONTEXT, ["capabilityNote", "enabled"]);

    expect(trail.records[0].detail?.fields).toBe("capabilityNote,enabled");
  });
});

describe("which name a settings change gets", () => {
  it("is the specialised one when that was the only thing that changed", async () => {
    const trail = recordingAudit();
    const audit = new ProviderAudit(trail.service);

    await audit.updated(CONTEXT, ["enabled"], undefined, true);
    await audit.updated(CONTEXT, ["enabled"], undefined, false);
    await audit.updated(CONTEXT, ["monthlyCapCents"], { from: 40000, to: 60000 });

    expect(trail.records.map((record) => record.action)).toEqual([
      PROVIDER_ENABLED_EVENT,
      PROVIDER_DISABLED_EVENT,
      PROVIDER_CAP_CHANGED_EVENT,
    ]);
  });

  it("carries both cap figures, because one of them is not a change", async () => {
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).updated(CONTEXT, ["monthlyCapCents"], {
      from: null,
      to: 60000,
    });

    expect(trail.records[0].detail).toMatchObject({ from_cap_cents: null, to_cap_cents: 60000 });
  });

  it("is the general one when the request did more than one thing", async () => {
    // `provider.enabled` on a request that also tripled the spend ceiling would be a trail
    // answering *what happened* with half of it.
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).updated(
      CONTEXT,
      ["enabled", "monthlyCapCents"],
      { from: 40000, to: 120000 },
      true,
    );

    expect(trail.records[0].action).toBe(PROVIDER_UPDATED_EVENT);
    expect(trail.records[0].detail?.fields).toBe("enabled,monthlyCapCents");
  });
});

describe("what a refused operation records", () => {
  it("writes one event under the name the success would have used", async () => {
    // No `provider.rotate_failed`: AD.4's vocabulary has nine names and a refusal is not a
    // tenth. `outcome` is what tells the two apart.
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).failed(
      { ...ATTEMPT, connectionId: CONTEXT.connectionId, kind: "anthropic" },
      PROVIDER_ROTATED_EVENT,
      providerValidationFailed({ status: "failed", errorClass: "auth", detail: "401" }),
    );

    expect(trail.records).toHaveLength(1);
    expect(trail.records[0]).toMatchObject({
      action: PROVIDER_ROTATED_EVENT,
      subjectId: CONTEXT.connectionId,
    });
    expect(trail.records[0].detail).toMatchObject({
      kind: "anthropic",
      outcome: "failure",
      reason: "provider_validation_failed",
    });
  });

  it("records the refusal's code and never its message", async () => {
    // A message is written for a person and can carry whatever an upstream provider chose to
    // say. A code is a word this service controls.
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).failed(
      ATTEMPT,
      PROVIDER_ADDED_EVENT,
      providerValidationFailed({
        status: "failed",
        errorClass: "auth",
        detail: "401 from api.anthropic.com for key sk-live-42",
      }),
    );

    expect(JSON.stringify(trail.records[0].detail)).not.toContain("sk-live-42");
    expect(trail.records[0].detail?.reason).toBe("provider_validation_failed");
  });

  it("names no connection when there is not one, and no kind when it was never known", async () => {
    // A refused add wrote no row, and a rate-limited reveal was refused before anything was
    // read. Both are honest nulls rather than placeholders.
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).failed(ATTEMPT, PROVIDER_ADDED_EVENT, new Error("no"));

    expect(trail.records[0].subjectId).toBeNull();
    expect(trail.records[0].detail?.kind).toBeUndefined();
  });

  it("calls an unrecognised failure what it is rather than guessing", async () => {
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).failed(ATTEMPT, PROVIDER_ADDED_EVENT, new TypeError());

    expect(trail.records[0].detail?.reason).toBe("internal_error");
  });
});

describe("when the trail itself cannot be written", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lets a completed operation's write fail, because an unaudited operation is the thing P5 forbids", async () => {
    const trail = recordingAudit();

    trail.failWith(new Error("audit_events is unavailable"));

    await expect(new ProviderAudit(trail.service).revealed(CONTEXT, "password")).rejects.toThrow(
      "audit_events is unavailable",
    );
  });

  it("swallows a refusal's write, because replacing the caller's error loses the better fact", async () => {
    // The one asymmetry in the module. `failed` runs inside the operation's `catch`; an
    // insert that threw there would turn a `422 provider_validation_failed` into an
    // unexplained `500` and tell the client to retry something correctly refused.
    const logged: string[] = [];

    jest.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => {
      logged.push(String(message));
    });

    const trail = recordingAudit();

    trail.failWith(new Error("audit_events is unavailable"));

    await expect(
      new ProviderAudit(trail.service).failed(ATTEMPT, PROVIDER_ADDED_EVENT, new Error("no")),
    ).resolves.toBeUndefined();

    // And the record still exists somewhere durable, which is the point of logging it here
    // rather than dropping it.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(PROVIDER_ADDED_EVENT);
    expect(logged[0]).toContain(ATTEMPT.organizationId);
  });
});

describe("what a record never contains", () => {
  it("names nothing the vault calls secret material", async () => {
    const trail = recordingAudit();
    const audit = new ProviderAudit(trail.service);

    await audit.added(CONTEXT);
    await audit.revealed(CONTEXT, "password");
    await audit.rotated(CONTEXT);
    await audit.updated(CONTEXT, ["config"]);
    await audit.deleted(CONTEXT);
    await audit.tested(CONTEXT, PASSED);
    await audit.failed(ATTEMPT, PROVIDER_ADDED_EVENT, new Error("no"));

    for (const record of trail.records) {
      // The `step_up` field is removed before the scan, and it is the one exemption this
      // assertion has. `password` there is the *name of a method* published in the `401`
      // challenge's `details.methods` — it says how somebody proved who they were, not what
      // they typed — and a trail that could not record which method was used would be
      // missing the one fact an audit of a reveal exists to capture. Everything else in
      // every record is held to the vault's own vocabulary.
      const { step_up: _method, ...scanned } = record.detail ?? {};
      const rendered = JSON.stringify({ ...record, detail: scanned }).toLowerCase();

      for (const word of DENIED_WORDS) {
        expect(rendered).not.toContain(word);
      }
    }
  });

  it("takes no plaintext, no mask and no envelope — there is nowhere to put one", () => {
    // The structural half: `ProviderAuditContext` has five fields and none of them could
    // hold a credential, so this is a property of the shape rather than of anybody's care.
    expect(Object.keys(CONTEXT).sort()).toEqual([
      "actorId",
      "at",
      "connectionId",
      "kind",
      "organizationId",
    ]);
  });
});

describe("what a test records about what it found (#230)", () => {
  it("records a pass as a success with its latency", async () => {
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).tested(CONTEXT, PASSED);

    expect(trail.records[0]).toMatchObject({
      action: "provider.tested",
      detail: { outcome: "success", latency_ms: 38, kind: CONTEXT.kind },
    });
  });

  it("records a refusal as a failure, under the validation code, with the taxonomy's class", async () => {
    const trail = recordingAudit();

    await new ProviderAudit(trail.service).tested(CONTEXT, {
      status: "failed",
      errorClass: "auth",
      detail: "key rejected (401)",
    });

    expect(trail.records[0]).toMatchObject({
      action: "provider.tested",
      detail: {
        outcome: "failure",
        reason: "provider_validation_failed",
        error_class: "auth",
        kind: CONTEXT.kind,
      },
    });
    // The phrase stays out of the trail: it is written for a person, and an upstream chose it.
    expect(JSON.stringify(trail.records[0].detail)).not.toContain("key rejected");
  });
});
