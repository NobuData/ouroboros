import { auditEventResource } from "./audit.resources";
import type { AuditEventRow } from "./audit.repository";

/**
 * What leaves the process, enumerated by hand.
 *
 * The row and the resource are separated for the reason they are everywhere else in this
 * service — a column added to `audit_events` later must not become a response field because
 * nobody looked — and that rule carries more weight here than on most tables: this is the one
 * surface that publishes what a workspace's administrators have done with its credentials.
 */

const ROW: AuditEventRow = {
  id: "b2000000-0000-0000-0000-000000000001",
  actor_id: "5eed0003-0000-4000-8000-000000000001",
  actor_name: "Ken Suenobu",
  action: "provider.rotated",
  subject_type: "provider_connection",
  subject_id: "5eed000c-0000-4000-8000-000000000001",
  ip: "198.51.100.24",
  detail: { kind: "anthropic", outcome: "success" },
  occurred_at: new Date("2026-08-21T16:53:00.000Z"),
};

describe("rendering one event", () => {
  it("publishes exactly nine fields, and the workspace is not one of them", () => {
    // The caller's workspace is the caller's session, so echoing it into every row of every
    // page would be telling a client something it supplied.
    expect(Object.keys(auditEventResource(ROW)).sort()).toEqual([
      "action",
      "actorId",
      "actorName",
      "detail",
      "id",
      "ip",
      "occurredAt",
      "subjectId",
      "subjectType",
    ]);
  });

  it("renders the instant as ISO-8601, like every other timestamp in this API", () => {
    // A client that has to know which endpoints send epoch milliseconds is a client with a
    // date bug waiting in it.
    expect(auditEventResource(ROW).occurredAt).toBe("2026-08-21T16:53:00.000Z");
  });

  it("carries the detail through unchanged, because it is already what a reader needs", () => {
    expect(auditEventResource(ROW).detail).toEqual({ kind: "anthropic", outcome: "success" });
  });

  it("renders an event with no actor without inventing one", () => {
    // A lease grant. Both fields are null, and the resource does not distinguish *never had
    // an actor* from *the person has been deleted* because a reader cannot act on that.
    const lease: AuditEventRow = {
      ...ROW,
      actor_id: null,
      actor_name: null,
      action: "credential.lease_granted",
      subject_type: "run",
    };

    expect(auditEventResource(lease)).toMatchObject({ actorId: null, actorName: null });
  });

  it("renders an event whose subject is gone", () => {
    // `provider.deleted` is the row whose subject no longer exists by the time anybody reads
    // it, and the one a foreign key would have made unwritable.
    expect(auditEventResource({ ...ROW, subject_id: null }).subjectId).toBeNull();
  });

  it("renders an event with no address", () => {
    expect(auditEventResource({ ...ROW, ip: null }).ip).toBeNull();
  });
});
