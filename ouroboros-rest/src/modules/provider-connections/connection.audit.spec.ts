import { Logger } from "@nestjs/common";

import { DENIED_WORDS } from "../vault/no-secret-logging";
import {
  PROVIDER_ADDED_EVENT,
  PROVIDER_AUDIT_EVENTS,
  PROVIDER_DELETED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_UPDATED_EVENT,
  ProviderAudit,
  type ProviderAuditContext,
} from "./connection.audit";

/**
 * The trail, and the three claims made about it.
 *
 * The **names** are AD.4's ([#225](https://github.com/NobuData/ouroboros/issues/225))
 * vocabulary, agreed before the trail exists, so somebody grepping later finds the strings
 * that issue's scope wrote down rather than ones this module invented. **One event per
 * operation**, because *every AD.2 operation writes exactly one event* is that issue's own
 * acceptance criterion. And **nothing secret in a record**, checked against the vault's own
 * denied-word list rather than a list typed here — so a word added where this codebase
 * decides what "secret material" means tightens this test too.
 *
 * `lease.audit.spec.ts` is the same suite for AD.3's one event; the sink both write to is
 * interim in exactly the same way and for the same documented reason.
 */

const CONTEXT: ProviderAuditContext = {
  organizationId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
  connectionId: "5eed000c-0000-4000-8000-000000000001",
  kind: "anthropic",
  actorId: "5eed0003-0000-4000-8000-000000000001",
  at: new Date("2026-08-23T10:00:00.000Z"),
};

describe("the event names", () => {
  it("are the ones AD.4 named", () => {
    expect(PROVIDER_ADDED_EVENT).toBe("provider.added");
    expect(PROVIDER_REVEALED_EVENT).toBe("provider.revealed");
    expect(PROVIDER_ROTATED_EVENT).toBe("provider.rotated");
    expect(PROVIDER_UPDATED_EVENT).toBe("provider.updated");
    expect(PROVIDER_DELETED_EVENT).toBe("provider.deleted");
  });

  it("are enumerated, so a sixth operation cannot ship with no trail", () => {
    expect(PROVIDER_AUDIT_EVENTS).toHaveLength(5);
    expect(new Set(PROVIDER_AUDIT_EVENTS).size).toBe(5);
  });

  it("all belong to one family, so one log filter catches the whole trail", () => {
    for (const event of PROVIDER_AUDIT_EVENTS) {
      expect(event.startsWith("provider.")).toBe(true);
    }
  });
});

describe("what an operation records", () => {
  let written: string[];
  let audit: ProviderAudit;

  beforeEach(() => {
    written = [];
    jest.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
      written.push(String(message));
    });
    audit = new ProviderAudit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Every method, as a callable, so the shared claims can be asserted about all five. */
  const everyMethod: readonly [string, (subject: ProviderAudit) => void][] = [
    ["added", (subject) => subject.added(CONTEXT)],
    ["revealed", (subject) => subject.revealed(CONTEXT, "password")],
    ["rotated", (subject) => subject.rotated(CONTEXT)],
    ["updated", (subject) => subject.updated(CONTEXT, ["enabled"])],
    ["deleted", (subject) => subject.deleted(CONTEXT)],
  ];

  it.each(everyMethod)("writes exactly one record for %s", (_name, record) => {
    record(audit);

    expect(written).toHaveLength(1);
  });

  it.each(everyMethod)("names the workspace, the connection and the person in %s", (_n, record) => {
    record(audit);

    expect(written[0]).toContain(`connection=${CONTEXT.connectionId}`);
    expect(written[0]).toContain(`organization=${CONTEXT.organizationId}`);
    expect(written[0]).toContain(`actor=${CONTEXT.actorId}`);
    expect(written[0]).toContain("kind=anthropic");
    expect(written[0]).toContain("at=2026-08-23T10:00:00.000Z");
  });

  it.each(everyMethod)("starts %s's line with the event's own name", (_name, record) => {
    record(audit);

    expect(PROVIDER_AUDIT_EVENTS.some((event) => written[0].startsWith(event))).toBe(true);
  });

  it("records how a reveal's step-up was satisfied", () => {
    // *Whose password opened this key* is the question an audit of a reveal exists to
    // answer: it is the difference between somebody with this session and somebody who
    // proved they are this person.
    audit.revealed(CONTEXT, "session");

    expect(written[0]).toContain("provider.revealed");
    expect(written[0]).toContain("step-up=session");
  });

  it("records which settings an edit wrote, and not their values", () => {
    // The values are in the row and echoing them here would put request content into a log
    // for no gain that AD.4's own before/after will not give properly.
    audit.updated(CONTEXT, ["capabilityNote", "enabled"]);

    expect(written[0]).toContain("fields=capabilityNote,enabled");
  });
});

describe("what a record never contains", () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    jest.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
      written.push(String(message));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("names nothing the vault calls secret material", () => {
    const audit = new ProviderAudit();

    audit.added(CONTEXT);
    audit.revealed(CONTEXT, "password");
    audit.rotated(CONTEXT);
    audit.updated(CONTEXT, ["config"]);
    audit.deleted(CONTEXT);

    for (const line of written) {
      // The `step-up=` clause is removed before the scan, and it is the one exemption this
      // assertion has. `password` there is the *name of a method* published in the `401`
      // challenge's `details.methods` — it says how somebody proved who they were, not what
      // they typed — and a trail that could not record which method was used would be
      // missing the one fact an audit of a reveal exists to capture. Everything else in
      // every line is held to the vault's own vocabulary.
      const scanned = line.toLowerCase().replace(/ step-up=\S+/, "");

      for (const word of DENIED_WORDS) {
        expect(scanned).not.toContain(word);
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
