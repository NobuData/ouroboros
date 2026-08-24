import { recordingAudit } from "../audit/audit.fixture";
import { DENIED_WORDS } from "../vault/no-secret-logging";
import {
  LEASE_GRANTED_EVENT,
  LEASE_SUBJECT,
  LeaseAudit,
  type LeaseGrantedEvent,
} from "./lease.audit";

/**
 * The trail, and the three claims made about it.
 *
 * *Every lease grant writes an audit event* is AD.3's acceptance criterion, and since AD.4
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)) landed `audit_events` the event
 * is a row rather than the log line the seam emitted while the table did not exist. What this
 * suite asserts is what was true of the seam and is still true of the row: the event's
 * **name**, which is AD.4's vocabulary and what somebody will grep for; the **record's
 * contents**, which must name what was granted; and that it carries **nothing secret**.
 *
 * The third claim is checked against the vault's own denied-word list rather than against a
 * list typed here, so a word added there — the place that decides what "secret material"
 * means in this codebase — tightens this test too.
 *
 * `connection.audit.spec.ts` is the same suite for AD.2's operations, where there is one more
 * claim: a refusal is an event too. There is deliberately no such claim here — see
 * `lease.audit.ts` on why a refused lease is a fact about a deployment's policy rather than
 * about a credential.
 */

const EVENT: LeaseGrantedEvent = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  organizationId: "aBcD1234eFgH5678iJkL9012mNoP3456",
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  grantedAt: new Date("2026-08-22T18:04:11.000Z"),
  expiresAt: new Date("2026-08-22T18:19:11.000Z"),
};

describe("the event's name", () => {
  it("is the one AD.4 named", () => {
    // One spelling, in one file, so a consumer grepping the trail finds every grant.
    expect(LEASE_GRANTED_EVENT).toBe("credential.lease_granted");
  });
});

describe("what one grant records", () => {
  it("writes exactly one record", async () => {
    const trail = recordingAudit();

    await new LeaseAudit(trail.service).granted(EVENT);

    expect(trail.records).toHaveLength(1);
  });

  it("names the event, the run, the workspace and the instant", async () => {
    const trail = recordingAudit();

    await new LeaseAudit(trail.service).granted(EVENT);

    expect(trail.records[0]).toMatchObject({
      action: LEASE_GRANTED_EVENT,
      organizationId: EVENT.organizationId,
      subjectType: LEASE_SUBJECT,
      subjectId: EVENT.run,
      at: EVENT.grantedAt,
    });
  });

  it("has no actor, because a worker is not somebody", async () => {
    // The one event class in the vocabulary that never names a person: a worker
    // authenticates with a service key, and `audit_events.actor_id` is nullable for exactly
    // this. A sheet that assumed an actor would render nothing sensible against it, which is
    // why `ouroboros-db`'s seed carries one such row.
    const trail = recordingAudit();

    await new LeaseAudit(trail.service).granted(EVENT);

    expect(trail.records[0].actorId).toBeNull();
  });

  it("says which lease, which provider, which address and when it stops being current", async () => {
    // A trail that recorded *a lease happened* without saying what was handed over would be
    // a trail nobody can answer a question with.
    const trail = recordingAudit();

    await new LeaseAudit(trail.service).granted(EVENT);

    expect(trail.records[0].detail).toEqual({
      lease: EVENT.id,
      provider: EVENT.provider,
      address: EVENT.baseUrl,
      expires_at: EVENT.expiresAt.toISOString(),
    });
  });

  it("lets a failed write fail, because a worker holding an unrecorded address is the thing this prevents", async () => {
    // Unlike a rotation there is nothing here that a refusal would have to un-happen: the
    // lease has not left the process yet. See `audit.service.ts`.
    const trail = recordingAudit();

    trail.failWith(new Error("audit_events is unavailable"));

    await expect(new LeaseAudit(trail.service).granted(EVENT)).rejects.toThrow(
      "audit_events is unavailable",
    );
  });

  it("carries nothing that names secret material", async () => {
    // The grep test the roadmap asks of every credential event, run against the vocabulary
    // `no-secret-logging.mjs` defines rather than a list typed here. The event's own name
    // contains `credential`, which is the one legitimate occurrence — it is the *family* the
    // trail files this under — so it is removed before the words are looked for.
    const trail = recordingAudit();

    await new LeaseAudit(trail.service).granted(EVENT);

    const rendered = JSON.stringify(trail.records[0]).replace(LEASE_GRANTED_EVENT, "");

    for (const word of DENIED_WORDS) {
      expect(rendered.toLowerCase()).not.toContain(word);
    }
  });
});
