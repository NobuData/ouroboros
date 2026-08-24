import { runWithAuditContext } from "./audit.context";
import { PROVIDER_REVEALED_EVENT, type AuditRecord } from "./audit.events";
import { AuditRepository, type AuditEventRow } from "./audit.repository";
import { AuditService } from "./audit.service";

/**
 * The one writer and the one reader, and the four claims they make.
 *
 * **The address comes from the request**, never from the caller — a caller that could supply
 * its own address is a caller that could supply somebody else's, and the whole value of the
 * column is that it says where the request came from rather than what it claimed.
 * **`undefined` becomes `null`**, because the column is nullable and a missing property is
 * not an insert. **A failure to record propagates**, which is decision P5's premise in
 * control flow. And **a page is scoped and filtered by what the query asked for**, with the
 * window resolved through the #31 convention rather than reinvented here.
 */

const WORKSPACE = "5eed0001-0000-4000-8000-000000000001";
const CONNECTION = "5eed000c-0000-4000-8000-000000000001";
const ACTOR = "5eed0003-0000-4000-8000-000000000001";

const RECORD: AuditRecord = {
  organizationId: WORKSPACE,
  actorId: ACTOR,
  action: PROVIDER_REVEALED_EVENT,
  subjectType: "provider_connection",
  subjectId: CONNECTION,
  at: new Date("2026-08-24T16:13:00.000Z"),
  detail: { kind: "anthropic", step_up: "password" },
};

const ROW: AuditEventRow = {
  id: "b2000000-0000-0000-0000-000000000001",
  actor_id: ACTOR,
  actor_name: "Ken Suenobu",
  action: PROVIDER_REVEALED_EVENT,
  subject_type: "provider_connection",
  subject_id: CONNECTION,
  ip: "198.51.100.24",
  detail: { kind: "anthropic", step_up: "password" },
  occurred_at: new Date("2026-08-24T16:13:00.000Z"),
};

/** A repository whose two statements are recorded rather than issued. */
function repository() {
  return {
    append: jest.fn().mockResolvedValue("b2000000-0000-0000-0000-000000000001"),
    page: jest.fn().mockResolvedValue({ rows: [ROW], total: 1 }),
  } as unknown as jest.Mocked<AuditRepository>;
}

describe("recording an event", () => {
  it("writes every field the caller assembled", async () => {
    const events = repository();

    await new AuditService(events).record(RECORD);

    expect(events.append).toHaveBeenCalledTimes(1);
    expect(events.append.mock.calls[0][0]).toMatchObject({
      organization_id: WORKSPACE,
      actor_id: ACTOR,
      action: PROVIDER_REVEALED_EVENT,
      subject_type: "provider_connection",
      subject_id: CONNECTION,
      occurred_at: RECORD.at,
      detail: { kind: "anthropic", step_up: "password" },
    });
  });

  it("takes the address from the request's own context", async () => {
    // Not from a parameter: `AuditRecord` has no field for one, so a caller cannot name an
    // address at all — which is what makes the column say where the request came from rather
    // than what it claimed.
    const events = repository();

    await runWithAuditContext("198.51.100.24", () => new AuditService(events).record(RECORD));

    expect(events.append.mock.calls[0][0].ip).toBe("198.51.100.24");
  });

  it("writes null when no address was knowable", async () => {
    // A background job, or a socket that reported no peer. The column is nullable for this,
    // and `undefined` is not an insert.
    const events = repository();

    await new AuditService(events).record(RECORD);

    expect(events.append.mock.calls[0][0].ip).toBeNull();
  });

  it("drops the fields a builder left undefined", async () => {
    const events = repository();

    await new AuditService(events).record({
      ...RECORD,
      detail: { kind: "anthropic", reason: undefined },
    });

    expect(events.append.mock.calls[0][0].detail).toEqual({ kind: "anthropic" });
  });

  it("gives an event with nothing to say an empty document rather than none", async () => {
    const events = repository();

    await new AuditService(events).record({ ...RECORD, detail: undefined });

    expect(events.append.mock.calls[0][0].detail).toEqual({});
  });

  it("answers with the event's id, so a caller can correlate its own answer", async () => {
    await expect(new AuditService(repository()).record(RECORD)).resolves.toBe(
      "b2000000-0000-0000-0000-000000000001",
    );
  });

  it("lets a failed write fail, because an unaudited credential operation is what P5 forbids", async () => {
    const events = repository();

    events.append.mockRejectedValue(new Error("audit_events is unavailable"));

    await expect(new AuditService(events).record(RECORD)).rejects.toThrow(
      "audit_events is unavailable",
    );
  });
});

describe("reading a workspace's trail", () => {
  it("scopes the page to the workspace it was given", async () => {
    const events = repository();

    await new AuditService(events).list(WORKSPACE, {});

    expect(events.page.mock.calls[0][0]).toBe(WORKSPACE);
  });

  it("passes the three filters through as the repository's own", async () => {
    const events = repository();

    await new AuditService(events).list(WORKSPACE, {
      connectionId: CONNECTION,
      actorId: ACTOR,
      action: PROVIDER_REVEALED_EVENT,
    });

    expect(events.page.mock.calls[0][1]).toEqual({
      subjectId: CONNECTION,
      actorId: ACTOR,
      action: PROVIDER_REVEALED_EVENT,
    });
  });

  it("applies the #31 window defaults rather than inventing its own", async () => {
    const events = repository();

    await new AuditService(events).list(WORKSPACE, {});

    expect(events.page.mock.calls[0][2]).toEqual({ limit: 25, offset: 0 });
  });

  it("echoes back the window it actually applied", async () => {
    // So a client that sent neither can compute the next offset without knowing the
    // defaults — the third of the pagination convention's three decisions.
    const page = await new AuditService(repository()).list(WORKSPACE, { limit: 5, offset: 10 });

    expect(page).toMatchObject({ total: 1, limit: 5, offset: 10 });
  });

  it("renders each row as the resource a client reads", async () => {
    const page = await new AuditService(repository()).list(WORKSPACE, {});

    expect(page.items).toEqual([
      {
        id: ROW.id,
        occurredAt: "2026-08-24T16:13:00.000Z",
        actorId: ACTOR,
        actorName: "Ken Suenobu",
        action: PROVIDER_REVEALED_EVENT,
        subjectType: "provider_connection",
        subjectId: CONNECTION,
        ip: "198.51.100.24",
        detail: { kind: "anthropic", step_up: "password" },
      },
    ]);
  });
});
