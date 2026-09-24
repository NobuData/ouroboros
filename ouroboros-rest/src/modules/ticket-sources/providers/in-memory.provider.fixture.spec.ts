import { retainedStrings } from "../conformance.fixture";
import { TicketSourceError } from "../ticket-source.errors";
import { supportsWebhooks, supportsWrites } from "../ticket-source.provider";
import { NO_PR_CAPABILITIES } from "../ticket-source.pr";
import { READ_ONLY_WRITE_CAPABILITIES } from "../ticket-source.write";
import {
  IN_MEMORY_PAGE_SIZE,
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  IN_MEMORY_WEBHOOK_SECRET,
  InMemoryTicketSourceProvider,
  InMemoryTracker,
  InMemoryTrackerRefusal,
  InMemoryWebhookTicketSourceProvider,
  InMemoryWriteTicketSourceProvider,
  asInMemoryFailure,
  asInMemoryWriteFailure,
  inMemoryCursor,
  readInMemoryCursor,
  signInMemoryDelivery,
  verifyInMemoryDelivery,
  type InMemoryQuery,
} from "./in-memory.provider.fixture";

/**
 * The in-memory tracker and the providers over it
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)).
 *
 * The conformance kit is this file's main suite — `in-memory.conformance.spec.ts` runs it against
 * both classes. What is asserted here is what the kit does not reach: the tracker's own rules, which
 * core intake tests lean on (numbering, the clock, the access log, the arranged refusal), and the
 * provider's corners — page-size guards, a cursor it did not write, a tie on the instant, a throw
 * that is not a refusal.
 */

/** The source a sync here runs against. */
const CONTEXT = {
  sourceId: "b0420000-0000-4000-8000-000000000001",
  organizationId: "org-in-memory",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
};

/**
 * The refusal a tracker call threw, if it threw one.
 *
 * @param call - The call.
 * @returns The refusal, or undefined when the call answered.
 * @throws Whatever else the call threw.
 */
function refusalOf(call: () => unknown): InMemoryTrackerRefusal | undefined {
  try {
    call();
  } catch (error) {
    if (error instanceof InMemoryTrackerRefusal) {
      return error;
    }

    throw error;
  }

  return undefined;
}

describe("InMemoryTracker", () => {
  it("numbers records in filing order and stamps each change one tick later", () => {
    const tracker = new InMemoryTracker();
    const first = tracker.file({ summary: "First" });
    const second = tracker.file({ summary: "Second" });

    expect(first).toStrictEqual({
      id: "10001",
      key: "PROJ-1",
      project: "PROJ",
      summary: "First",
      description: null,
      status: "todo",
      tags: [],
      reporter: null,
      created: "2026-09-01T09:01:00.000Z",
      updated: "2026-09-01T09:01:00.000Z",
    });
    expect(second).toMatchObject({
      id: "10002",
      key: "PROJ-2",
      created: "2026-09-01T09:02:00.000Z",
    });
    expect(tracker.edit(first.id, { summary: "First, revised" })).toMatchObject({
      summary: "First, revised",
      created: "2026-09-01T09:01:00.000Z",
      updated: "2026-09-01T09:03:00.000Z",
    });
    expect(tracker.transition(first.id, "done")).toMatchObject({
      status: "done",
      updated: "2026-09-01T09:04:00.000Z",
    });
    expect(tracker.record(first.id).summary).toBe("First, revised");
  });

  it("serves frozen records, so what a suite holds cannot change what it serves", () => {
    const record = new InMemoryTracker().file({ summary: "Frozen", tags: ["a"] });

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.tags)).toBe(true);
  });

  it("refuses to file into a project it lacks, or to touch a record it does not have", () => {
    const tracker = new InMemoryTracker();

    expect(() => tracker.file({ summary: "x", project: "NOPE" })).toThrow(RangeError);
    expect(() => tracker.edit("99999", { summary: "x" })).toThrow(RangeError);
    expect(() => tracker.transition("99999", "done")).toThrow(RangeError);
    expect(() => tracker.deliver("99999", IN_MEMORY_WEBHOOK_SECRET)).toThrow(RangeError);
  });

  it("keeps the token as a digest, never as the token, and still recognises it", () => {
    const tracker = new InMemoryTracker();

    expect(retainedStrings(tracker).some((value) => value.includes(IN_MEMORY_TOKEN))).toBe(false);
    expect(tracker.probe(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT)).toBe(0);
  });

  it("refuses a missing or wrong token with 401, and a public tracker asks for none", () => {
    const tracker = new InMemoryTracker();

    expect(refusalOf(() => tracker.probe(null, IN_MEMORY_PROJECT))?.status).toBe(401);
    expect(
      refusalOf(() => tracker.probe("imt_not_the_token_at_all", IN_MEMORY_PROJECT))?.status,
    ).toBe(401);
    expect(new InMemoryTracker({ token: null }).probe(null, IN_MEMORY_PROJECT)).toBe(0);
  });

  it("refuses a project it does not have with 404", () => {
    expect(refusalOf(() => new InMemoryTracker().probe(IN_MEMORY_TOKEN, "NOPE"))?.status).toBe(404);
  });

  it("counts only the open records in the probed project", () => {
    const tracker = new InMemoryTracker({ projects: ["PROJ", "OPS"] });

    tracker.file({ summary: "open" });
    tracker.file({ summary: "closed", status: "done" });
    tracker.file({ summary: "elsewhere", project: "OPS" });

    expect(tracker.probe(IN_MEMORY_TOKEN, "PROJ")).toBe(1);
  });

  it("lists in its own order, strictly after a position, and says when more matched", () => {
    const tracker = new InMemoryTracker();
    const first = tracker.file({ summary: "a" });

    tracker.file({ summary: "b", status: "wont_do" });

    const third = tracker.file({ summary: "c" });

    // Edited last, so it now sorts last.
    tracker.edit(first.id, { summary: "a, revised" });

    const query: InMemoryQuery = {
      token: IN_MEMORY_TOKEN,
      project: IN_MEMORY_PROJECT,
      openOnly: false,
      after: null,
      limit: 2,
    };
    const summaries = (listed: InMemoryQuery): string[] =>
      tracker.list(listed).records.map((record) => record.summary);

    expect(summaries(query)).toStrictEqual(["b", "c"]);
    expect(tracker.list(query).more).toBe(true);
    expect(summaries({ ...query, openOnly: true, limit: 10 })).toStrictEqual(["c", "a, revised"]);
    expect(summaries({ ...query, after: { updated: third.updated, id: third.id } })).toStrictEqual([
      "a, revised",
    ]);
    expect(
      summaries({ ...query, after: { updated: third.updated, id: first.id }, limit: 10 }),
    ).toStrictEqual(["c", "a, revised"]);
  });

  it("keeps an access log with no token in it", () => {
    const tracker = new InMemoryTracker();

    tracker.probe(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT);
    tracker.list({
      token: IN_MEMORY_TOKEN,
      project: IN_MEMORY_PROJECT,
      openOnly: true,
      after: null,
      limit: 1,
    });

    expect(tracker.requests).toStrictEqual([
      { operation: "probe", project: "PROJ", openOnly: true, after: null },
      { operation: "list", project: "PROJ", openOnly: true, after: null },
    ]);
    expect(JSON.stringify(tracker.requests)).not.toContain(IN_MEMORY_TOKEN);
  });

  it("refuses everything after refuse() until recover(), carrying a window only on a rate limit", () => {
    const tracker = new InMemoryTracker();
    const lifts = new Date("2026-09-12T14:20:00.000Z");

    tracker.refuse("rate_limit", lifts);
    expect(refusalOf(() => tracker.probe(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT))).toMatchObject({
      status: 429,
      retryAt: lifts,
    });

    tracker.refuse("upstream", lifts);
    expect(refusalOf(() => tracker.probe(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT))).toMatchObject({
      status: 503,
      retryAt: null,
    });

    tracker.recover();
    expect(tracker.probe(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT)).toBe(0);
  });

  it("signs a delivery it can verify, and a ping carries no record", () => {
    const tracker = new InMemoryTracker();
    const record = tracker.file({ summary: "Signed" });
    const delivery = tracker.deliver(record.id, IN_MEMORY_WEBHOOK_SECRET);
    const ping = tracker.ping(IN_MEMORY_WEBHOOK_SECRET);

    expect(delivery.payload).toStrictEqual({ event: "record.updated", record });
    expect(delivery.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(
      verifyInMemoryDelivery(delivery.payload, delivery.signature, IN_MEMORY_WEBHOOK_SECRET),
    ).toBe(true);
    expect(ping.payload).toStrictEqual({ event: "ping" });
  });
});

describe("InMemoryTicketSourceProvider", () => {
  it.each([0, -1, 1.5, Number.NaN])(
    "refuses a page size of %p, which could never finish a walk",
    (pageSize) => {
      expect(() => new InMemoryTicketSourceProvider(new InMemoryTracker(), { pageSize })).toThrow(
        RangeError,
      );
    },
  );

  it("keys on custom with the default page size, unless told otherwise", async () => {
    const tracker = new InMemoryTracker();

    for (let index = 0; index <= IN_MEMORY_PAGE_SIZE; index += 1) {
      tracker.file({ summary: `Ticket ${index.toString()}` });
    }

    const provider = new InMemoryTicketSourceProvider(tracker);
    const first = await provider.fullSync(CONTEXT);

    expect(provider.kind).toBe("custom");
    expect(new InMemoryTicketSourceProvider(tracker, { kind: "jira" }).kind).toBe("jira");
    expect(first.tickets).toHaveLength(IN_MEMORY_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
  });

  it("answers a fresh schema every call, so one caller's edits never reach the next", () => {
    const provider = new InMemoryTicketSourceProvider(new InMemoryTracker());

    expect(provider.configSchema()).not.toBe(provider.configSchema());
    expect(provider.configSchema()).toStrictEqual(provider.configSchema());
  });

  it("says how many open tickets Test connection found", async () => {
    const tracker = new InMemoryTracker();
    const provider = new InMemoryTicketSourceProvider(tracker);

    tracker.file({ summary: "one" });
    await expect(provider.validateConfig(CONTEXT.config, IN_MEMORY_TOKEN)).resolves.toStrictEqual({
      status: "ok",
      detail: "PROJ · 1 open ticket",
    });

    tracker.file({ summary: "two" });
    await expect(provider.validateConfig(CONTEXT.config, IN_MEMORY_TOKEN)).resolves.toMatchObject({
      detail: "PROJ · 2 open tickets",
    });
  });

  it.each<[string, unknown, string | null, string]>([
    ["no configuration", null, IN_MEMORY_TOKEN, "not_found"],
    ["a list", [IN_MEMORY_PROJECT], IN_MEMORY_TOKEN, "not_found"],
    ["a key in lower case", { project: "proj" }, IN_MEMORY_TOKEN, "not_found"],
    ["no token", { project: IN_MEMORY_PROJECT }, null, "auth"],
  ])(
    "answers %s as a failed result rather than a rejection",
    async (_case, config, credentials, errorClass) => {
      await expect(
        new InMemoryTicketSourceProvider(new InMemoryTracker()).validateConfig(config, credentials),
      ).resolves.toMatchObject({ status: "failed", errorClass });
    },
  );

  it("refuses an unreadable configuration before asking the tracker anything", async () => {
    const tracker = new InMemoryTracker();

    await expect(
      new InMemoryTicketSourceProvider(tracker).fullSync({ ...CONTEXT, config: { project: 7 } }),
    ).rejects.toMatchObject({ errorClass: "not_found" });
    expect(tracker.requests).toStrictEqual([]);
  });

  it.each([
    ["todo", "open"],
    ["in_progress", "open"],
    ["done", "closed"],
    ["wont_do", "closed"],
  ] as const)("maps %s onto %s, keeping the tracker's own word in meta", (status, state) => {
    const tracker = new InMemoryTracker();
    const record = tracker.file({ summary: "Collapsed", status });

    expect(
      new InMemoryTicketSourceProvider(tracker, { kind: "linear" }).mapTicket(record),
    ).toMatchObject({ state, meta: { linear: { project: "PROJ", status } } });
  });

  it("resumes strictly after the cursor it wrote, with a tie on the instant broken by id", async () => {
    const tracker = new InMemoryTracker();
    const first = tracker.file({ summary: "first" });
    const second = tracker.file({ summary: "second" });
    const provider = new InMemoryTicketSourceProvider(tracker);
    const keys = async (cursor: string): Promise<string[]> =>
      (await provider.incrementalSync(CONTEXT, cursor)).tickets.map((ticket) => ticket.externalKey);

    expect(await keys(inMemoryCursor(first))).toStrictEqual(["PROJ-2"]);
    // The same instant as `second` but a lower id: only the id says `second` is after it.
    expect(await keys(inMemoryCursor({ updated: second.updated, id: first.id }))).toStrictEqual([
      "PROJ-2",
    ]);
    await expect(provider.incrementalSync(CONTEXT, inMemoryCursor(second))).resolves.toStrictEqual({
      tickets: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("treats a cursor it did not write as no cursor — one cold import of open records", async () => {
    const tracker = new InMemoryTracker();

    tracker.file({ summary: "open" });
    tracker.file({ summary: "closed", status: "done" });

    const answered = await new InMemoryTicketSourceProvider(tracker).incrementalSync(
      CONTEXT,
      "2026-09-01T09:00:00Z",
    );

    expect(answered.tickets.map((ticket) => ticket.title)).toStrictEqual(["open"]);
    expect(tracker.requests.at(-1)).toMatchObject({ openOnly: true, after: null });
  });

  it("classifies a refusal by its status, carrying the window and the status", async () => {
    const tracker = new InMemoryTracker();

    tracker.refuse("rate_limit", new Date("2026-09-12T14:20:00.000Z"));

    await expect(new InMemoryTicketSourceProvider(tracker).fullSync(CONTEXT)).rejects.toMatchObject(
      {
        errorClass: "rate_limit",
        retryAt: new Date("2026-09-12T14:20:00.000Z"),
        httpStatus: 429,
      },
    );
  });

  it("calls anything else the tracker throws upstream, rather than letting it out unclassified", async () => {
    const tracker = new InMemoryTracker();

    jest.spyOn(tracker, "list").mockImplementation(() => {
      throw new TypeError("socket hang up");
    });

    await expect(new InMemoryTicketSourceProvider(tracker).fullSync(CONTEXT)).rejects.toMatchObject(
      {
        errorClass: "upstream",
        detail: "the in-memory tracker failed in a way it does not describe: socket hang up",
      },
    );
    expect(asInMemoryFailure("a string").detail).toBe(
      "the in-memory tracker failed in a way it does not describe: a string",
    );
  });

  it("refuses a record it cannot represent as upstream, naming the rule rather than the value", () => {
    const tracker = new InMemoryTracker();
    const record = tracker.file({ summary: "x".repeat(600) });
    let thrown: unknown;

    try {
      new InMemoryTicketSourceProvider(tracker).mapTicket(record);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TicketSourceError);
    expect(thrown).toMatchObject({ errorClass: "upstream" });
    expect((thrown as TicketSourceError).detail).toContain(
      "title must be non-blank text of at most 512 characters",
    );
    expect((thrown as TicketSourceError).detail).not.toContain("xxxx");
  });

  it.each<[string, (record: Record<string, unknown>) => unknown]>([
    ["something that is not a record", () => "PROJ-1"],
    ["an id that is not numeric", (record) => ({ ...record, id: "PROJ-1" })],
    ["a status the tracker does not have", (record) => ({ ...record, status: "archived" })],
    ["tags that are not names", (record) => ({ ...record, tags: [1] })],
    ["a description that is not text", (record) => ({ ...record, description: 7 })],
    ["a stamp that is not a date", (record) => ({ ...record, updated: "the other day" })],
  ])("refuses %s as upstream", (_case, mangle) => {
    const tracker = new InMemoryTracker();
    const raw = mangle({ ...tracker.file({ summary: "Readable" }) });
    let thrown: unknown;

    try {
      new InMemoryTicketSourceProvider(tracker).mapTicket(raw);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TicketSourceError);
    expect(thrown).toMatchObject({ errorClass: "upstream" });
  });
});

describe("InMemoryWebhookTicketSourceProvider", () => {
  /**
   * A tracker with one record, and the webhook provider over it.
   *
   * @returns The three.
   */
  function build() {
    const tracker = new InMemoryTracker();
    const record = tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });

    return {
      tracker,
      record,
      provider: new InMemoryWebhookTicketSourceProvider(tracker, IN_MEMORY_WEBHOOK_SECRET),
    };
  }

  it("declares webhooks, keeping the polling flags, and is reachable through supportsWebhooks", () => {
    const { provider } = build();

    expect(provider.capabilities()).toStrictEqual({
      webhooks: true,
      labels: true,
      bidirectionalWrites: false,
      write: READ_ONLY_WRITE_CAPABILITIES,
      pr: NO_PR_CAPABILITIES,
    });
    expect(supportsWebhooks(provider)).toBe(true);
    expect(supportsWebhooks(new InMemoryTicketSourceProvider(new InMemoryTracker()))).toBe(false);
  });

  it("maps the record a signed delivery announces", async () => {
    const { tracker, record, provider } = build();
    const delivery = tracker.deliver(record.id, IN_MEMORY_WEBHOOK_SECRET);

    await expect(
      provider.webhookHandler(delivery.payload, delivery.signature),
    ).resolves.toStrictEqual({
      tickets: [provider.mapTicket(record)],
    });
  });

  it("answers no tickets for a ping, or for an event it does not act on", async () => {
    const { tracker, provider } = build();
    const ping = tracker.ping(IN_MEMORY_WEBHOOK_SECRET);
    const other = { event: "record.deleted", id: "10001" };

    await expect(provider.webhookHandler(ping.payload, ping.signature)).resolves.toStrictEqual({
      tickets: [],
    });
    await expect(
      provider.webhookHandler(other, signInMemoryDelivery(other, IN_MEMORY_WEBHOOK_SECRET)),
    ).resolves.toStrictEqual({ tickets: [] });
  });

  it("refuses a signed delivery it cannot read as upstream", async () => {
    const { provider } = build();

    for (const payload of [
      { event: "record.updated" },
      "not an object",
      { event: "record.updated", record: { id: "x" } },
    ]) {
      await expect(
        provider.webhookHandler(payload, signInMemoryDelivery(payload, IN_MEMORY_WEBHOOK_SECRET)),
      ).rejects.toMatchObject({ errorClass: "upstream" });
    }
  });

  it("refuses an unsigned, a wrongly signed and a malformed signature as auth, without throwing", async () => {
    const { tracker, record, provider } = build();
    const delivery = tracker.deliver(record.id, IN_MEMORY_WEBHOOK_SECRET);

    await expect(provider.webhookHandler(delivery.payload, null)).rejects.toMatchObject({
      errorClass: "auth",
    });
    await expect(
      provider.webhookHandler(delivery.payload, signInMemoryDelivery(delivery.payload, "another")),
    ).rejects.toMatchObject({ errorClass: "auth" });
    await expect(provider.webhookHandler(delivery.payload, "sha256=short")).rejects.toMatchObject({
      errorClass: "auth",
    });
  });
});

describe("the in-memory cursor", () => {
  it("round-trips a record's position", () => {
    const position = { updated: "2026-09-01T09:01:00.000Z", id: "10001" };

    expect(readInMemoryCursor(inMemoryCursor(position))).toStrictEqual(position);
  });

  it.each([
    "",
    "2026-09-01T09:01:00.000Z",
    "2026-09-01T09:01:00.000Z~",
    "2026-09-01T09:01:00Z~10001",
    "the other day~10001",
    "2026-09-01T09:01:00.000Z~PROJ-1",
    "2026-09-01T09:01:00.000Z~10001~extra",
  ])("refuses %p, which this provider could not have written", (cursor) => {
    expect(readInMemoryCursor(cursor)).toBeUndefined();
  });
});

describe("InMemoryWriteTicketSourceProvider", () => {
  /** The source every write runs against. */
  const CONTEXT = {
    sourceId: "s-278",
    organizationId: "o-278",
    config: { project: IN_MEMORY_PROJECT },
    credentials: IN_MEMORY_TOKEN,
  };

  /** A draft with nothing optional set. */
  const DRAFT = {
    idempotencyKey: "batch-1:OTA-1",
    title: "Journal writes before the OTA image is swapped",
    body: "Resume rather than brick.",
    labels: ["ota"],
    milestone: null,
  };

  it("declares every feature unless told otherwise, and is reachable through supportsWrites", () => {
    const provider = new InMemoryWriteTicketSourceProvider(new InMemoryTracker());

    expect(provider.capabilities()).toStrictEqual({
      webhooks: false,
      labels: true,
      bidirectionalWrites: true,
      write: {
        createTicket: true,
        nativeDependencies: true,
        epicMapping: "parent_issue",
        milestones: true,
      },
      pr: NO_PR_CAPABILITIES,
    });
    expect(supportsWrites(provider)).toBe(true);
    expect(supportsWrites(new InMemoryTicketSourceProvider(new InMemoryTracker()))).toBe(false);
  });

  it("creates a record a sync then maps to the same identity", async () => {
    const tracker = new InMemoryTracker();
    const provider = new InMemoryWriteTicketSourceProvider(tracker);
    const ref = await provider.createTicket(CONTEXT, DRAFT);
    const page = await provider.fullSync(CONTEXT);

    expect(page.tickets).toHaveLength(1);
    expect(page.tickets[0]).toMatchObject({
      externalId: ref.externalId,
      externalKey: ref.externalKey,
      externalUrl: ref.url,
      title: DRAFT.title,
      labels: ["ota"],
    });
  });

  it("searches before it creates, so a retry sends no second create", async () => {
    const tracker = new InMemoryTracker();
    const provider = new InMemoryWriteTicketSourceProvider(tracker);

    await provider.createTicket(CONTEXT, DRAFT);
    await provider.createTicket(CONTEXT, DRAFT);

    expect(tracker.requests.map((request) => request.operation)).toStrictEqual([
      "search",
      "create",
      "search",
    ]);
    expect(JSON.stringify(tracker.requests)).not.toContain(IN_MEMORY_TOKEN);
  });

  it("records a fallback link as one marker line on the blocked record's body", async () => {
    const tracker = new InMemoryTracker();
    const provider = new InMemoryWriteTicketSourceProvider(tracker, {
      write: { nativeDependencies: false },
    });
    const blocker = await provider.createTicket(CONTEXT, DRAFT);
    const blocked = await provider.createTicket(CONTEXT, {
      ...DRAFT,
      idempotencyKey: "batch-1:OTA-3",
    });

    await expect(provider.linkDependency(CONTEXT, blocker, blocked)).resolves.toStrictEqual({
      mode: "fallback",
    });
    await provider.linkDependency(CONTEXT, blocker, blocked);

    expect(tracker.record(blocked.externalId).description).toBe(
      `Resume rather than brick.\n\n<!-- ouroboros:blocked-by ${blocker.externalId} -->`,
    );
    expect(tracker.ledger(() => []).relations).toStrictEqual([]);
  });

  it("refuses a milestone on a declaration without milestones before sending anything", async () => {
    const tracker = new InMemoryTracker();
    const provider = new InMemoryWriteTicketSourceProvider(tracker, {
      write: { milestones: false },
    });

    await expect(
      provider.createTicket(CONTEXT, {
        ...DRAFT,
        milestone: { externalRef: "M1", name: "Helios" },
      }),
    ).rejects.toMatchObject({ errorClass: "validation" });
    expect(tracker.requests).toStrictEqual([]);
  });

  it("refuses a milestone the tracker does not have as validation, creating nothing", async () => {
    const tracker = new InMemoryTracker();
    const provider = new InMemoryWriteTicketSourceProvider(tracker);

    await expect(
      provider.createTicket(CONTEXT, { ...DRAFT, milestone: { externalRef: "M9", name: "Gone" } }),
    ).rejects.toMatchObject({ errorClass: "validation", httpStatus: 422 });
    expect(tracker.ledger(() => []).records).toStrictEqual([]);
  });

  it.each([
    ["a blank key", { ...DRAFT, idempotencyKey: "  " }],
    ["an overlong key", { ...DRAFT, idempotencyKey: "k".repeat(129) }],
  ])("refuses %s as validation", async (_case, draft) => {
    await expect(
      new InMemoryWriteTicketSourceProvider(new InMemoryTracker()).createTicket(CONTEXT, draft),
    ).rejects.toMatchObject({ errorClass: "validation" });
  });

  it("refuses a mirror of another mapping as validation", async () => {
    const provider = new InMemoryWriteTicketSourceProvider(new InMemoryTracker(), {
      write: { epicMapping: "epic" },
    });
    const ticket = await provider.createTicket(CONTEXT, DRAFT);

    await expect(
      provider.attachToEpic(CONTEXT, ticket, { mapping: "parent_issue", externalRef: "EPIC-1" }),
    ).rejects.toMatchObject({ errorClass: "validation" });
  });

  it("refuses a sync configuration it cannot read, on the write path too", async () => {
    await expect(
      new InMemoryWriteTicketSourceProvider(new InMemoryTracker()).createTicket(
        { ...CONTEXT, config: {} },
        DRAFT,
      ),
    ).rejects.toMatchObject({ errorClass: "not_found" });
  });
});

describe("asInMemoryWriteFailure", () => {
  it.each([
    [403, "permission"],
    [422, "validation"],
    [429, "rate_limit"],
    [401, "auth"],
  ])("reads a %i write refusal as %s", (status, errorClass) => {
    expect(asInMemoryWriteFailure(new InMemoryTrackerRefusal(status))).toMatchObject({
      errorClass,
      httpStatus: status,
    });
  });

  it("passes anything else to the read-side translation", () => {
    expect(asInMemoryWriteFailure(new Error("boom"))).toMatchObject({ errorClass: "upstream" });
  });
});
