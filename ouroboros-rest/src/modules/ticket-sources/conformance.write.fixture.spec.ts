import { settle } from "./conformance.fixture";
import {
  ledgerGrowthViolations,
  writeFailureViolations,
  writeRefViolations,
  type WriteLedger,
} from "./conformance.write.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  InMemoryTracker,
  InMemoryWriteTicketSourceProvider,
} from "./providers/in-memory.provider.fixture";
import { TicketSourceError } from "./ticket-source.errors";
import type { TicketSyncContext } from "./ticket-source.provider";
import { dependencyMarkersIn, type TicketDraftInput } from "./ticket-source.write";

/**
 * The write kit's rules, each watched failing (AL.2, [#278](https://github.com/NobuData/ouroboros/issues/278)).
 *
 * `in-memory.write-conformance.spec.ts` shows the suites pass for a conforming fake; this is the
 * other half — a rule that has never been seen to fail is a rule that passes everything. The
 * scenario cases at the bottom build providers that break the contract the ways a real writer
 * would (a create with no search, a link that doubles, a class read off the wrong table) and
 * show the rules report each one.
 */

/** The source every write runs against. */
const CONTEXT: TicketSyncContext = {
  sourceId: "s-278",
  organizationId: "o-278",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
};

/** A draft the fake accepts. */
const DRAFT: TicketDraftInput = {
  idempotencyKey: "batch-1:OTA-1",
  title: "Journal writes before the OTA image is swapped",
  body: null,
  labels: [],
  milestone: null,
};

/** A ledger with nothing in it. */
const EMPTY: WriteLedger = {
  tickets: [],
  dependencies: [],
  milestones: [],
  containers: [],
  memberships: [],
};

/**
 * A tracker's ledger, in the kit's shape.
 *
 * @param tracker - The tracker.
 * @returns The ledger.
 */
function ledgerOf(tracker: InMemoryTracker): WriteLedger {
  const ledger = tracker.ledger(dependencyMarkersIn);

  return {
    tickets: ledger.records,
    dependencies: [...ledger.relations, ...ledger.markers],
    milestones: ledger.milestones,
    containers: ledger.containers,
    memberships: ledger.memberships,
  };
}

describe("writeRefViolations", () => {
  it("passes a reference a sync could adopt", () => {
    expect(
      writeRefViolations(
        { externalId: "10001", externalKey: "PROJ-1", url: "https://tracker.example.invalid/x" },
        "ref",
      ),
    ).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ["no answer", undefined, "ref: must answer { externalId, externalKey, url }"],
    [
      "a blank identity",
      { externalId: " ", externalKey: "PROJ-1", url: "https://t.example/x" },
      "ref: externalId must be non-blank text of at most 255 characters — the ticket a sync adopts carries the same identity",
    ],
    [
      "a numeric key",
      { externalId: "1", externalKey: 1, url: "https://t.example/x" },
      "ref: externalKey must be non-blank text of at most 128 characters — the ticket a sync adopts carries the same identity",
    ],
    [
      "a link that is not https",
      { externalId: "1", externalKey: "PROJ-1", url: "javascript:alert(1)" },
      "ref: url must be an https link with a host",
    ],
  ])("catches %s", (_case, ref, violation) => {
    expect(writeRefViolations(ref, "ref")).toContain(violation);
  });
});

describe("writeFailureViolations", () => {
  it("passes a classified refusal with a clean detail", async () => {
    const settled = await settle(() =>
      Promise.reject(new TicketSourceError("permission", "403 on create", null, 403)),
    );

    expect(writeFailureViolations(settled, "permission", IN_MEMORY_TOKEN, "create")).toEqual([]);
  });

  it("catches a write that answered while refused", async () => {
    const settled = await settle(() => Promise.resolve("ok"));

    expect(writeFailureViolations(settled, "validation", null, "create")).toEqual([
      "create: the validation recording answered instead of failing",
    ]);
  });

  it("catches a stringly-typed failure", async () => {
    const settled = await settle(() => Promise.reject(new Error("HTTP 422")));

    expect(writeFailureViolations(settled, "validation", null, "create")).toEqual([
      "create: a failed write must reject with a TicketSourceError, not Error: HTTP 422 — a push failure has to be classifiable",
    ]);
  });

  it("catches a permission failure read off the read table as auth", async () => {
    const settled = await settle(() => Promise.reject(new TicketSourceError("auth", "403")));

    expect(writeFailureViolations(settled, "permission", null, "create")).toEqual([
      "create: the permission recording was classified auth",
    ]);
  });

  it("catches a credential in the detail", async () => {
    const settled = await settle(() =>
      Promise.reject(new TicketSourceError("validation", `bad body: Bearer ${IN_MEMORY_TOKEN}`)),
    );

    expect(writeFailureViolations(settled, "validation", IN_MEMORY_TOKEN, "create")).toEqual([
      "create: the error's detail contains the credential",
    ]);
  });
});

describe("ledgerGrowthViolations", () => {
  it("passes growth that matches what was allowed", () => {
    expect(
      ledgerGrowthViolations(EMPTY, { ...EMPTY, tickets: ["1"] }, { tickets: 1 }, "step"),
    ).toEqual([]);
  });

  it("catches a second milestone, and growth nothing allowed", () => {
    expect(
      ledgerGrowthViolations(
        EMPTY,
        { ...EMPTY, milestones: ["M1", "M2"], containers: ["EPIC-1"] },
        { milestones: 1 },
        "step",
      ),
    ).toEqual([
      "step: milestones grew by 2, expected 1 — a retried write must not create a second one",
      "step: containers grew by 1, expected 0 — a retried write must not create a second one",
    ]);
  });
});

describe("the write rules against providers that break the contract", () => {
  it("catch a create that never searches, so a retry creates a second ticket", async () => {
    const tracker = new InMemoryTracker();
    const careless = new InMemoryWriteTicketSourceProvider(tracker);
    let calls = 0;

    // Every call looks like a new draft to the tracker — the crash-between-201-and-commit bug.
    const createTicket = (draft: TicketDraftInput) => {
      calls += 1;

      return careless.createTicket(CONTEXT, {
        ...draft,
        idempotencyKey: `${draft.idempotencyKey}#${calls.toString()}`,
      });
    };

    const before = ledgerOf(tracker);

    await createTicket(DRAFT);
    await createTicket(DRAFT);

    expect(ledgerGrowthViolations(before, ledgerOf(tracker), { tickets: 1 }, "twice")).toEqual([
      "twice: tickets grew by 2, expected 1 — a retried write must not create a second one",
    ]);
  });

  it("catch a fallback link appended on every call", async () => {
    const tracker = new InMemoryTracker();
    const provider = new InMemoryWriteTicketSourceProvider(tracker, {
      write: { nativeDependencies: false },
    });
    const blocker = await provider.createTicket(CONTEXT, DRAFT);
    const blocked = await provider.createTicket(CONTEXT, { ...DRAFT, idempotencyKey: "k2" });
    const before = ledgerOf(tracker);
    const marker = `<!-- ouroboros:blocked-by ${blocker.externalId} -->`;

    // A writer that appends without looking — the marker, twice.
    tracker.amend(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, blocked.externalId, `${marker}\n${marker}`);

    expect(
      ledgerGrowthViolations(before, ledgerOf(tracker), { dependencies: 1 }, "link twice"),
    ).toEqual([
      "link twice: dependencies grew by 2, expected 1 — a retried write must not create a second one",
    ]);
  });

  it("catch a refused create that left a half-made ticket behind", () => {
    const tracker = new InMemoryTracker();
    const before = ledgerOf(tracker);

    // The tracker stored the record and then the provider reported a failure anyway.
    tracker.file({ summary: DRAFT.title });

    expect(ledgerGrowthViolations(before, ledgerOf(tracker), {}, "refused create")).toEqual([
      "refused create: tickets grew by 1, expected 0 — a retried write must not create a second one",
    ]);
  });
});
