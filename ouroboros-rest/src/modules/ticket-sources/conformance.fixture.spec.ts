import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PROVIDER_CONFIG_DIALECT } from "../providers/provider.config";
import {
  CANONICAL_LIMITS,
  ConformanceMirror,
  MAX_CHAIN,
  backlogViolations,
  canonicalTicketViolations,
  capabilityViolations,
  mappingViolations,
  pageViolations,
  replay,
  retainedStrings,
  retentionViolations,
  schemaViolations,
  settle,
  syncFailureViolations,
  ticketDifferences,
  validationViolations,
  webhookViolations,
  type Settled,
  type WebhookConformance,
} from "./conformance.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
  IN_MEMORY_WEBHOOK_SECRET,
  InMemoryTicketSourceProvider,
  InMemoryTracker,
  InMemoryWebhookTicketSourceProvider,
  signInMemoryDelivery,
} from "./providers/in-memory.provider.fixture";
import { TicketSourceError } from "./ticket-source.errors";
import { githubTicket, jiraTicket, page } from "./ticket-source.fixture";
import type { TicketSourceProvider, TicketSyncContext } from "./ticket-source.provider";

/**
 * The kit, tested against providers that are wrong on purpose
 * ([#142](https://github.com/NobuData/ouroboros/issues/142)).
 *
 * `providers/in-memory.conformance.spec.ts` and `providers/github.conformance.spec.ts` prove the kit
 * is *passable*. This proves it **bites** — and the two are equally load-bearing, because a
 * conformance kit nobody has watched fail is a conformance kit that passes everything. It is why
 * every rule in `conformance.fixture.ts` is a function returning sentences: a rule shaped like that
 * can itself be a subject.
 *
 * Q.5's second acceptance criterion — *deliberately breaking a canonical mapping fails the kit* —
 * is the `mappingViolations` and `replay` cases below, kept as tests rather than spot-checked once
 * and forgotten. The last block is the other half of *each must pass this kit unchanged*: every
 * provider registered in `ticket-sources.module.ts` has a conformance spec, so a new one cannot ship
 * without taking the kit.
 */

/** The source every case here syncs. */
const CONTEXT: TicketSyncContext = {
  sourceId: "b0420000-0000-4000-8000-0000000001ab",
  organizationId: "org-conformance",
  config: { project: IN_MEMORY_PROJECT },
  credentials: IN_MEMORY_TOKEN,
};

/**
 * An in-memory tracker holding two open records, and a provider over it.
 *
 * `PROJ-1` has a description, a tag and a reporter; `PROJ-2` has none of the three — so between them
 * they exercise every *populated or explicitly null* branch of the canonical model.
 *
 * @param pageSize - How many records one sync answers.
 * @returns The tracker and the provider.
 */
function tracked(pageSize?: number): {
  tracker: InMemoryTracker;
  provider: InMemoryTicketSourceProvider;
} {
  const tracker = new InMemoryTracker();

  tracker.file({
    summary: "Watchdog timer resets during I2C bus recovery",
    description: "The watchdog fires while the bus is being recovered.",
    tags: ["bug"],
    reporter: "field-support",
  });
  tracker.file({ summary: "Calibration drifts after firmware rollback" });

  return {
    tracker,
    provider: new InMemoryTicketSourceProvider(tracker, pageSize === undefined ? {} : { pageSize }),
  };
}

/**
 * A provider with some members replaced.
 *
 * Built on the original through its prototype, so every member not replaced still runs with the
 * original's state. The overrides are typed loosely on purpose: most of them are values the interface
 * would refuse, and the kit's audience includes providers written where the compiler stopped nobody.
 *
 * @param provider - The conforming provider.
 * @param overrides - What to replace.
 * @returns The broken provider.
 */
function broken(
  provider: TicketSourceProvider,
  overrides: Record<string, unknown>,
): TicketSourceProvider {
  return Object.assign(Object.create(provider) as TicketSourceProvider, overrides);
}

/**
 * How a rejected call settles.
 *
 * @param error - What it rejected with.
 * @returns The settled value.
 */
function rejected(error: unknown): Settled<unknown> {
  return { resolved: false, error };
}

describe("canonicalTicketViolations", () => {
  it("passes a GitHub-shaped ticket and a Jira-shaped one", () => {
    expect(canonicalTicketViolations(githubTicket())).toEqual([]);
    expect(canonicalTicketViolations(jiraTicket())).toEqual([]);
  });

  it("refuses something that is not an object", () => {
    expect(canonicalTicketViolations("PROJ-142", "payload")).toEqual([
      "payload: must be an object",
    ]);
  });

  it("catches a field left undefined rather than null — absent is not the same as unsaid", () => {
    expect(canonicalTicketViolations({ ...jiraTicket(), body: undefined })).toEqual([
      "ticket: body is missing — a value the tracker did not supply is null, never absent",
    ]);
  });

  it("catches a field outside the canonical model, which belongs in meta", () => {
    expect(canonicalTicketViolations({ ...githubTicket(), repository: "helios-firmware" })).toEqual(
      ["ticket: repository is not a canonical field — carry it in meta"],
    );
  });

  const LINK = "ticket: externalUrl must be an https link with a host, at most 2048 characters";
  const META = "ticket: meta must be a plain JSON object — it is stored as jsonb";

  it.each<[string, Record<string, unknown>, string]>([
    ["an http link", { externalUrl: "http://github.com/acme/x/issues/1" }, LINK],
    ["a javascript: link", { externalUrl: "javascript:alert(1)" }, LINK],
    [
      "a blank identity",
      { externalId: "  " },
      "ticket: externalId must be non-blank text of at most 255 characters",
    ],
    [
      "a key past its column",
      { externalKey: "K".repeat(CANONICAL_LIMITS.externalKey + 1) },
      "ticket: externalKey must be non-blank text of at most 128 characters",
    ],
    [
      "a blank title",
      { title: "" },
      "ticket: title must be non-blank text of at most 512 characters",
    ],
    [
      "a body past its column",
      { body: "b".repeat(CANONICAL_LIMITS.body + 1) },
      "ticket: body must be null or text of at most 262144 characters",
    ],
    ["a third state", { state: "resolved" }, "ticket: state must be one of open, closed"],
    [
      "labels that are not a list",
      { labels: "bug" },
      "ticket: labels must be an array — empty when the ticket has none",
    ],
    [
      "too many labels",
      {
        labels: Array.from(
          { length: CANONICAL_LIMITS.labels + 1 },
          (_label, index) => `label-${index.toString()}`,
        ),
      },
      "ticket: labels holds more than 100 names",
    ],
    [
      "a blank label",
      { labels: ["bug", " "] },
      "ticket: every label must be non-blank text of at most 255 characters",
    ],
    [
      "an empty author instead of null",
      { author: "" },
      "ticket: author must be non-blank text of at most 255 characters",
    ],
    [
      "a date that does not parse",
      { sourceCreatedAt: new Date("the other day") },
      "ticket: sourceCreatedAt must be a valid Date",
    ],
    [
      "a timestamp left as text",
      { sourceUpdatedAt: "2026-09-11T09:00:00Z" },
      "ticket: sourceUpdatedAt must be a valid Date",
    ],
    [
      "an update from before the ticket was opened",
      { sourceUpdatedAt: new Date("2026-09-01T00:00:00.000Z") },
      "ticket: sourceUpdatedAt is before sourceCreatedAt — two fields swapped",
    ],
    ["meta as a list", { meta: ["github"] }, META],
    ["meta holding a Date", { meta: { github: { seen: new Date() } } }, META],
  ])("catches %s", (_case, overrides, violation) => {
    expect(canonicalTicketViolations({ ...githubTicket(), ...overrides })).toEqual([violation]);
  });
});

describe("capabilityViolations", () => {
  it("passes both in-memory providers", () => {
    const tracker = new InMemoryTracker();

    expect(capabilityViolations(new InMemoryTicketSourceProvider(tracker))).toEqual([]);
    expect(
      capabilityViolations(
        new InMemoryWebhookTicketSourceProvider(tracker, IN_MEMORY_WEBHOOK_SECRET),
      ),
    ).toEqual([]);
  });

  it("catches a flag left out, because false is an answer", () => {
    const provider = broken(tracked().provider, {
      capabilities: () => ({ webhooks: false, labels: true }),
    });

    expect(capabilityViolations(provider)).toEqual([
      "capabilities().bidirectionalWrites must be a boolean — false is an answer",
    ]);
  });

  it("catches capabilities that change between calls", () => {
    let labels = false;
    const provider = broken(tracked().provider, {
      capabilities: () => {
        labels = !labels;

        return { webhooks: false, labels, bidirectionalWrites: false };
      },
    });

    expect(capabilityViolations(provider)).toContain(
      "capabilities() must answer the same flags every call",
    );
  });

  it("catches a webhookHandler with no capability behind it", () => {
    const provider = broken(tracked().provider, {
      webhookHandler: () => Promise.resolve({ tickets: [] }),
    });

    expect(capabilityViolations(provider)).toEqual([
      "capabilities().webhooks is false but webhookHandler is present — the registry refuses that disagreement at boot",
    ]);
  });

  it("catches a capability with no webhookHandler behind it", () => {
    const provider = broken(tracked().provider, {
      capabilities: () => ({ webhooks: true, labels: true, bidirectionalWrites: false }),
    });

    expect(capabilityViolations(provider)).toEqual([
      "capabilities().webhooks is true but webhookHandler is absent — the registry refuses that disagreement at boot",
    ]);
  });

  it("catches a provider spending AL.2's reservation", () => {
    const provider = broken(tracked().provider, {
      capabilities: () => ({ webhooks: false, labels: true, bidirectionalWrites: true }),
    });

    expect(capabilityViolations(provider)).toEqual([
      "capabilities().bidirectionalWrites is reserved until a write member exists (AL.2, #278) and must be false",
    ]);
  });
});

describe("schemaViolations", () => {
  it("passes the in-memory provider over its own configuration", () => {
    expect(schemaViolations(tracked().provider, CONTEXT)).toEqual([]);
  });

  it("reports the dialect's violations and stops there", () => {
    const provider = broken(tracked().provider, { configSchema: () => ({ type: "object" }) });

    expect(schemaViolations(provider, CONTEXT)).toContain(
      `$schema must be "${PROVIDER_CONFIG_DIALECT}"`,
    );
  });

  it("catches a schema that changes between calls", () => {
    const { provider } = tracked();
    let calls = 0;
    const unstable = broken(provider, {
      configSchema: () => {
        calls += 1;

        return { ...provider.configSchema(), title: `Connect ${calls.toString()}` };
      },
    });

    expect(schemaViolations(unstable, CONTEXT)).toContain(
      "configSchema() must answer the same schema every call",
    );
  });

  it("catches what the registry refuses at boot and the dialect does not see", () => {
    const provider = broken(tracked().provider, {
      webhookHandler: () => Promise.resolve({ tickets: [] }),
    });

    expect(schemaViolations(provider, CONTEXT)).toEqual([
      'the registry refuses it at boot: Error: Provider "custom" declares webhooks: false but its webhookHandler member says otherwise',
    ]);
  });

  it("catches a credential the form has no field to collect", () => {
    const { provider } = tracked();
    const schema = provider.configSchema();
    const secretless = broken(provider, {
      configSchema: () => ({ ...schema, properties: { project: schema.properties.project } }),
    });

    expect(schemaViolations(secretless, CONTEXT)).toContain(
      "the harness syncs with a credential but the schema marks no x-ouroboros-secret field, so the settings form would render no way to enter one",
    );
  });

  it("catches a credential field the recordings never exercise", () => {
    expect(schemaViolations(tracked().provider, { ...CONTEXT, credentials: null })).toContain(
      'the schema marks "token" as the credential but the harness supplies none, so the recordings never exercise the field the form collects',
    );
  });

  it("catches a configuration that is not an object", () => {
    expect(schemaViolations(tracked().provider, { ...CONTEXT, config: "PROJ" })).toContain(
      "the harness's config must be an object — ticket_sources_config_shape stores nothing else",
    );
  });

  it("catches a sample configuration the provider's own form would refuse", () => {
    expect(
      schemaViolations(tracked().provider, { ...CONTEXT, config: { project: "proj" } }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("the settings form would refuse the harness's own project:"),
      ]),
    );
  });
});

describe("validationViolations", () => {
  it("passes a success that says what it found, and a failure of the recorded class", () => {
    expect(
      validationViolations(
        { status: "ok", detail: "PROJ · 3 open tickets" },
        null,
        IN_MEMORY_TOKEN,
      ),
    ).toEqual([]);
    expect(
      validationViolations(
        { status: "failed", errorClass: "auth", detail: "credentials rejected" },
        "auth",
        IN_MEMORY_TOKEN,
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "not a result at all",
      undefined,
      null,
      "validateConfig must answer a result — { status, detail }",
    ],
    [
      "a bare tick",
      { status: "ok", detail: " " },
      null,
      "detail must say something — it is what Test connection renders",
    ],
    [
      "a detail quoting the token",
      { status: "failed", errorClass: "auth", detail: `401 for ${IN_MEMORY_TOKEN}` },
      "auth",
      "detail contains the credential",
    ],
    [
      "a failure where success was recorded",
      { status: "failed", errorClass: "not_found", detail: "no such project" },
      null,
      "the accepted configuration answered failed (not_found): no such project",
    ],
    [
      "a success carrying a class",
      { status: "ok", errorClass: "auth", detail: "fine" },
      null,
      "a passing test carries no errorClass",
    ],
    [
      "a success where a refusal was recorded",
      { status: "ok", detail: "fine" },
      "rate_limit",
      "the rate_limit recording answered ok, not failed",
    ],
    [
      "the wrong class",
      { status: "failed", errorClass: "upstream", detail: "503" },
      "auth",
      "the auth recording was classified upstream",
    ],
  ] as const)("catches %s", (_case, validation, expected, violation) => {
    expect(validationViolations(validation, expected, IN_MEMORY_TOKEN)).toContain(violation);
  });
});

describe("syncFailureViolations", () => {
  it("passes a TicketSourceError of the recorded class", () => {
    const refusal = new TicketSourceError(
      "rate_limit",
      "429",
      new Date("2026-09-12T14:20:00.000Z"),
      429,
    );

    expect(syncFailureViolations(rejected(refusal), "rate_limit", IN_MEMORY_TOKEN)).toEqual([]);
  });

  it.each<[string, Settled<unknown>, string]>([
    [
      "a sync that answered a page",
      { resolved: true, value: page() },
      "the auth recording answered a page instead of failing",
    ],
    [
      "a plain Error",
      rejected(new Error("socket hang up")),
      "a failed sync must reject with a TicketSourceError, not Error: socket hang up — the loop records anything else as upstream",
    ],
    [
      "the wrong class",
      rejected(new TicketSourceError("upstream", "503")),
      "the auth recording was classified upstream",
    ],
    [
      "a detail quoting the token",
      rejected(new TicketSourceError("auth", `bad token ${IN_MEMORY_TOKEN}`)),
      "the error's detail contains the credential — a detail reaches the log",
    ],
    [
      "a retry time that is not a time",
      rejected(Object.assign(new TicketSourceError("auth", "401"), { retryAt: new Date("soon") })),
      "retryAt must be null or a valid Date",
    ],
    [
      "a success status",
      rejected(Object.assign(new TicketSourceError("auth", "401"), { httpStatus: 200 })),
      "httpStatus must be null or the refusal's HTTP status",
    ],
    [
      "a look-alike from another copy of the class, missing its window",
      rejected({ errorClass: "auth", detail: "401" }),
      "retryAt must be null or a valid Date",
    ],
  ])("catches %s", (_case, settled, violation) => {
    expect(syncFailureViolations(settled, "auth", IN_MEMORY_TOKEN)).toContain(violation);
  });
});

describe("pageViolations", () => {
  /** A provider's flags, with labels. */
  const LABELLED = { webhooks: false, labels: true, bidirectionalWrites: false };
  const CURSOR =
    "page: nextCursor must be null or non-blank text of at most 255 characters — '' would re-import the backlog every pass";

  it("passes an ascending page with a cursor", () => {
    expect(
      pageViolations(
        page([githubTicket(), jiraTicket()], { nextCursor: "c1", hasMore: true }),
        "page",
        LABELLED,
      ),
    ).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ["not a page", "page", "page: must answer a page — { tickets, nextCursor, hasMore }"],
    ["an empty cursor", page([], { nextCursor: "" }), CURSOR],
    ["a cursor past its column", page([], { nextCursor: "c".repeat(256) }), CURSOR],
    [
      "hasMore as a word",
      { tickets: [], nextCursor: null, hasMore: "yes" },
      "page: hasMore must be a boolean",
    ],
    [
      "tickets that are not a list",
      { tickets: {}, nextCursor: null, hasMore: false },
      "page: tickets must be an array",
    ],
    [
      "a page out of order",
      page([jiraTicket(), githubTicket()]),
      "page: #485 is out of order — a page ascends by sourceUpdatedAt, or the cursor it returns cannot resume it",
    ],
    [
      "one ticket twice",
      page([githubTicket(), githubTicket()]),
      "page: #485 appears twice — a page is written in one transaction",
    ],
    [
      "a malformed ticket",
      page([{ ...githubTicket(), title: "" }]),
      "page, ticket 0: title must be non-blank text of at most 512 characters",
    ],
  ])("catches %s", (_case, candidate, violation) => {
    expect(pageViolations(candidate, "page", LABELLED)).toContain(violation);
  });

  it("catches labels from a provider that says its tracker has none", () => {
    expect(pageViolations(page([githubTicket()]), "page", { ...LABELLED, labels: false })).toEqual([
      "page: #485 carries labels, but capabilities().labels is false",
    ]);
  });
});

describe("mappingViolations", () => {
  /**
   * The in-memory provider's own recordings.
   *
   * @returns The provider, two mappings between them covering both absences and a label, and one
   *   payload to refuse.
   */
  function recordings() {
    const { tracker, provider } = tracked();
    const watchdog = tracker.record("10001");
    const calibration = tracker.record("10002");

    return {
      provider,
      mappings: [
        { name: "watchdog", raw: watchdog, expected: provider.mapTicket(watchdog) },
        { name: "calibration", raw: calibration, expected: provider.mapTicket(calibration) },
      ],
      unmappable: [{ name: "not a record", raw: "PROJ-1" }],
    };
  }

  it("passes recordings that cover an absent body, an absent author and a label", () => {
    const { provider, mappings, unmappable } = recordings();

    expect(mappingViolations(provider, mappings, unmappable)).toEqual([]);
  });

  it("fails a deliberately broken mapping — the key collapsed onto the identity", () => {
    // Q.5's second acceptance criterion. This is the mistake a GitHub-shaped mapping makes, because
    // `485` and `#485` differ by one character — and it produces a row V030 accepts, so nothing but
    // a stated answer catches it.
    const { provider, mappings, unmappable } = recordings();
    const collapsed = broken(provider, {
      mapTicket: (raw: unknown) => {
        const ticket = provider.mapTicket(raw);

        return { ...ticket, externalKey: ticket.externalId };
      },
    });

    expect(mappingViolations(collapsed, mappings, unmappable)).toEqual([
      'mapping "watchdog": externalKey is "10001", recorded as "PROJ-1"',
      'mapping "calibration": externalKey is "10002", recorded as "PROJ-2"',
    ]);
  });

  it("fails a mapping that drops a field instead of nulling it", () => {
    const { provider, mappings, unmappable } = recordings();
    const dropped = broken(provider, {
      mapTicket: (raw: unknown) => ({ ...provider.mapTicket(raw), author: undefined }),
    });

    expect(mappingViolations(dropped, mappings, unmappable)).toContain(
      'mapping "calibration": author is missing — a value the tracker did not supply is null, never absent',
    );
  });

  it("fails a mapping that throws on what it should read, and refuses with the wrong error", () => {
    const { provider, mappings, unmappable } = recordings();
    const throwing = broken(provider, {
      mapTicket: () => {
        throw new Error("boom");
      },
    });

    expect(mappingViolations(throwing, mappings, unmappable)).toEqual([
      'mapping "watchdog" threw: Error: boom',
      'mapping "calibration" threw: Error: boom',
      'payload "not a record" was refused with Error: boom rather than a TicketSourceError',
    ]);
  });

  it("fails recordings that never exercise an absence or a label", () => {
    const { provider, mappings, unmappable } = recordings();

    expect(mappingViolations(provider, [mappings[0]], unmappable)).toEqual([
      "no recording maps to a null body — record a payload with no description, so absent is seen to be null rather than ''",
      "no recording maps to a null author — record a payload with none, which is what a deleted account looks like",
    ]);
    expect(mappingViolations(provider, [mappings[1]], unmappable)).toEqual([
      "capabilities().labels is true but no recording maps to a label",
    ]);
  });

  it("fails empty recordings", () => {
    expect(mappingViolations(recordings().provider, [], [])).toEqual(
      expect.arrayContaining([
        "record at least one payload for mapTicket to map",
        "record at least one payload mapTicket must refuse — a half-filled row is worse than none",
      ]),
    );
  });

  it("fails a payload mapped rather than refused, and one refused with the wrong class", () => {
    const { provider, mappings } = recordings();

    expect(
      mappingViolations(provider, mappings, [{ name: "a readable record", raw: mappings[0].raw }]),
    ).toEqual(['payload "a readable record" was mapped rather than refused']);

    const picky = broken(provider, {
      mapTicket: (raw: unknown) => {
        if (raw === "PROJ-1") {
          throw new TicketSourceError("not_found", "no such record");
        }

        return provider.mapTicket(raw);
      },
    });

    expect(mappingViolations(picky, mappings, [{ name: "not a record", raw: "PROJ-1" }])).toEqual([
      'payload "not a record" was refused as not_found — a payload the tracker sent and this build cannot read is upstream',
    ]);
  });
});

describe("ticketDifferences", () => {
  it("compares dates by instant and meta by content, not by identity or key order", () => {
    const ticket = githubTicket({ meta: { github: { owner: "acme-robotics", repo: "x" } } });
    const copy = {
      ...ticket,
      sourceCreatedAt: new Date(ticket.sourceCreatedAt.getTime()),
      meta: { github: { repo: "x", owner: "acme-robotics" } },
    };

    expect(ticketDifferences(ticket, copy, "#485")).toEqual([]);
  });

  it("names each field that differs, with both values", () => {
    expect(
      ticketDifferences(githubTicket({ state: "closed", labels: [] }), githubTicket(), "#485"),
    ).toEqual([
      '#485: state is "closed", recorded as "open"',
      '#485: labels is [], recorded as ["bug","i2c","watchdog"]',
    ]);
  });
});

describe("backlogViolations", () => {
  it("catches a ticket that differs, one missing from the mirror, and one it should not hold", () => {
    expect(
      backlogViolations(
        [githubTicket({ title: "Renamed" }), jiraTicket()],
        [githubTicket(), jiraTicket({ externalId: "10043", externalKey: "PROJ-143" })],
        "cold import",
      ),
    ).toEqual([
      'cold import: #485: title is "Renamed", recorded as "Watchdog timer resets during I2C bus recovery"',
      "cold import: PROJ-143 should be in the mirror and is not",
      "cold import: the mirror holds PROJ-142, which the recording does not expect",
    ]);
  });
});

describe("ConformanceMirror", () => {
  it("stores an open ticket and leaves alone a closed one it has never seen", () => {
    const mirror = new ConformanceMirror();

    expect(
      mirror.apply(page([githubTicket(), jiraTicket({ state: "closed" })], { nextCursor: "c1" })),
    ).toStrictEqual({ writes: [{ externalKey: "#485", write: "imported" }], regressions: [] });
    expect(mirror.tickets()).toStrictEqual([githubTicket()]);
    expect(mirror.cursor).toBe("c1");
  });

  it("writes nothing for a ticket that has not changed, and keeps its cursor on a null", () => {
    const mirror = new ConformanceMirror();

    mirror.apply(page([githubTicket()], { nextCursor: "c1" }));

    expect(mirror.apply(page([githubTicket()]))).toStrictEqual({ writes: [], regressions: [] });
    expect(mirror.cursor).toBe("c1");
  });

  it("rewrites a ticket that changed — a close included — and reports one that went backwards", () => {
    const mirror = new ConformanceMirror();

    mirror.apply(page([githubTicket()]));

    const closed = mirror.apply(
      page([
        githubTicket({ state: "closed", sourceUpdatedAt: new Date("2026-09-12T09:00:00.000Z") }),
      ]),
    );

    expect(closed.writes).toStrictEqual([{ externalKey: "#485", write: "updated" }]);
    expect(mirror.apply(page([githubTicket()])).regressions).toStrictEqual([
      "#485 came back as of 2026-09-11T09:00:00.000Z, older than the 2026-09-12T09:00:00.000Z copy the mirror holds — a cursor that moved backwards",
    ]);
  });

  it("keeps its own copy of meta, as jsonb would", () => {
    const meta = { github: { repo: "helios-firmware" } };
    const mirror = new ConformanceMirror();

    mirror.apply(page([githubTicket({ meta })]));
    meta.github.repo = "changed afterwards";

    expect(mirror.tickets()[0]?.meta).toStrictEqual({ github: { repo: "helios-firmware" } });
  });
});

describe("replay", () => {
  it("follows hasMore from a cold import until the provider settles", async () => {
    const { provider } = tracked(1);
    const replayed = await replay(provider, CONTEXT, new ConformanceMirror(), "cold import");

    expect(replayed.violations).toStrictEqual([]);
    expect(
      replayed.pages.map((answered) => answered.tickets.map((ticket) => ticket.externalKey)),
    ).toStrictEqual([["PROJ-1"], ["PROJ-2"]]);
    expect(replayed.writes).toHaveLength(2);
  });

  it("fails a deliberately broken mapping through a sync, against the recorded backlog", async () => {
    // The same broken mapping as above, reached the way the loop reaches it — through `fullSync` —
    // so the break is caught by the sync legs too, not only by the mapping leg.
    const { tracker, provider } = tracked();
    const backlog = [
      provider.mapTicket(tracker.record("10001")),
      provider.mapTicket(tracker.record("10002")),
    ];
    const collapsed = broken(provider, {
      mapTicket: (raw: unknown) => {
        const ticket = provider.mapTicket(raw);

        return { ...ticket, externalKey: ticket.externalId };
      },
    });
    const mirror = new ConformanceMirror();

    await replay(collapsed, CONTEXT, mirror, "cold import");

    expect(backlogViolations(mirror.tickets(), backlog, "cold import")).toEqual([
      'cold import: PROJ-1: externalKey is "10001", recorded as "PROJ-1"',
      'cold import: PROJ-2: externalKey is "10002", recorded as "PROJ-2"',
    ]);
  });

  it("reports a provider whose hasMore never turns false", async () => {
    const provider = broken(tracked().provider, {
      fullSync: () => Promise.resolve(page([], { hasMore: true })),
    });
    const replayed = await replay(provider, CONTEXT, new ConformanceMirror(), "cold import");

    expect(replayed.violations).toStrictEqual([
      `cold import never settled — hasMore was still true after ${MAX_CHAIN.toString()} pages`,
    ]);
    expect(replayed.pages).toHaveLength(MAX_CHAIN);
  });

  it("reports a rejection and a malformed page, and stops at either", async () => {
    const rejecting = broken(tracked().provider, {
      fullSync: () => Promise.reject(new TicketSourceError("upstream", "503")),
    });

    expect(
      (await replay(rejecting, CONTEXT, new ConformanceMirror(), "cold import")).violations,
    ).toStrictEqual(["cold import, page 1 (fullSync) rejected: TicketSourceError: 503"]);

    const malformed = broken(tracked().provider, {
      fullSync: () => Promise.resolve({ tickets: [] }),
    });
    const replayed = await replay(malformed, CONTEXT, new ConformanceMirror(), "cold import");

    expect(replayed.violations).toStrictEqual([
      "cold import, page 1 (fullSync): nextCursor must be null or non-blank text of at most 255 characters — '' would re-import the backlog every pass",
      "cold import, page 1 (fullSync): hasMore must be a boolean",
    ]);
    expect(replayed.pages).toStrictEqual([]);
  });
});

describe("webhookViolations", () => {
  /**
   * The webhook provider's own recordings.
   *
   * @returns The provider and the recordings the kit takes.
   */
  function webhookRecordings(): {
    provider: InMemoryWebhookTicketSourceProvider;
    webhook: WebhookConformance;
  } {
    const tracker = new InMemoryTracker();
    const record = tracker.file({ summary: "Watchdog timer resets during I2C bus recovery" });
    const provider = new InMemoryWebhookTicketSourceProvider(tracker, IN_MEMORY_WEBHOOK_SECRET);
    const delivery = tracker.deliver(record.id, IN_MEMORY_WEBHOOK_SECRET);

    return {
      provider,
      webhook: {
        delivery,
        expected: [provider.mapTicket(record)],
        forged: {
          payload: delivery.payload,
          signature: signInMemoryDelivery(delivery.payload, "whsec_wrong_secret_entirely_0000"),
        },
      },
    };
  }

  it("passes the webhook provider's own recordings", async () => {
    const { provider, webhook } = webhookRecordings();

    expect(await webhookViolations(provider, webhook)).toEqual([]);
  });

  it("will not check a provider that does not declare the capability", async () => {
    expect(await webhookViolations(tracked().provider, webhookRecordings().webhook)).toEqual([
      "the provider does not declare webhooks, so it has no delivery to check",
    ]);
  });

  it("fails a provider that accepts whatever arrives", async () => {
    const { provider, webhook } = webhookRecordings();
    const credulous = broken(provider, {
      webhookHandler: () => Promise.resolve({ tickets: webhook.expected }),
    });

    expect(await webhookViolations(credulous, webhook)).toEqual([
      "an unsigned delivery was accepted — a provider verifies its own signatures and refuses what fails",
      "a forged delivery was accepted — a provider verifies its own signatures and refuses what fails",
    ]);
  });

  it("fails a wrong ticket, a refusal of the wrong class, and a refused signed delivery", async () => {
    const { provider, webhook } = webhookRecordings();
    const wrong = broken(provider, {
      webhookHandler: (_payload: unknown, signature: string | null) =>
        signature === webhook.delivery.signature
          ? Promise.resolve({ tickets: [{ ...webhook.expected[0], title: "Something else" }] })
          : Promise.reject(new TicketSourceError("upstream", "no")),
    });

    expect(await webhookViolations(wrong, webhook)).toEqual([
      'delivered ticket 0: title is "Something else", recorded as "Watchdog timer resets during I2C bus recovery"',
      "an unsigned delivery was refused with TicketSourceError: no rather than auth",
      "a forged delivery was refused with TicketSourceError: no rather than auth",
    ]);

    const refusing = broken(provider, {
      webhookHandler: () => Promise.reject(new TicketSourceError("auth", "bad signature")),
    });

    expect(await webhookViolations(refusing, webhook)).toEqual([
      "the signed delivery was refused: TicketSourceError: bad signature",
    ]);
  });

  it("fails a recording that delivers no ticket, and an outcome that carries none", async () => {
    const { provider, webhook } = webhookRecordings();

    expect(await webhookViolations(provider, { ...webhook, expected: [] })).toEqual([
      "record a delivery that carries a ticket — an empty outcome checks nothing about its shape",
      "the signed delivery answered 1 ticket(s), recorded as 0",
    ]);

    const shapeless = broken(provider, {
      webhookHandler: (_payload: unknown, signature: string | null) =>
        signature === webhook.delivery.signature
          ? Promise.resolve({})
          : Promise.reject(new TicketSourceError("auth", "refused")),
    });

    expect(await webhookViolations(shapeless, webhook)).toEqual([
      "webhookHandler must answer { tickets } — the tickets a sync would write",
    ]);
  });
});

describe("retainedStrings and retentionViolations", () => {
  it("finds a string however it is held, and survives a cycle", () => {
    const holder: Record<string, unknown> = {
      byId: new Map([["key", { nested: ["listed", new Set(["deep"])] }]]),
    };

    holder.self = holder;

    expect(retainedStrings(holder)).toEqual(expect.arrayContaining(["key", "listed", "deep"]));
  });

  it("finds no credential in the in-memory provider after it synced with one", async () => {
    const { provider } = tracked();

    await provider.fullSync(CONTEXT);

    expect(retentionViolations(provider, IN_MEMORY_TOKEN)).toEqual([]);
  });

  it("catches a provider that kept the token it was handed", () => {
    const keeper = broken(tracked().provider, { cache: { lastToken: IN_MEMORY_TOKEN } });

    expect(retentionViolations(keeper, IN_MEMORY_TOKEN)).toEqual([
      "the provider holds the credential after the call returned — a provider is a singleton, and one that keeps a token holds it across every request",
    ]);
    expect(retentionViolations(keeper, null)).toEqual([]);
  });
});

describe("settle", () => {
  it("answers a value, a rejection and a synchronous throw alike", async () => {
    const error = new Error("refused");

    await expect(settle(() => Promise.resolve(1))).resolves.toStrictEqual({
      resolved: true,
      value: 1,
    });
    await expect(settle(() => Promise.reject(error))).resolves.toStrictEqual({
      resolved: false,
      error,
    });
    await expect(
      settle(() => {
        throw error;
      }),
    ).resolves.toStrictEqual({ resolved: false, error });
  });
});

describe("every registered ticket source provider", () => {
  /** The registration point's own source. */
  const MODULE = readFileSync(join(__dirname, "ticket-sources.module.ts"), "utf8");

  /** The provider files it imports — `github` for `./providers/github.provider`. */
  const REGISTERED = [...MODULE.matchAll(/from "\.\/providers\/([a-z0-9-]+)\.provider"/g)].map(
    (match) => match[1],
  );

  it("is found in the module at all, or this guard is guarding nothing", () => {
    expect(REGISTERED).toContain("github");
  });

  it.each(REGISTERED)("runs the conformance kit: providers/%s.conformance.spec.ts", (name) => {
    // Q.5's gate, made mechanical: T.2–T.4 register a provider with one line in the module, and
    // this is the line that makes that registration red until the kit has been taken.
    const spec = join(__dirname, "providers", `${name}.conformance.spec.ts`);

    expect(existsSync(spec)).toBe(true);
    expect(readFileSync(spec, "utf8")).toContain("describeTicketSourceConformance(");
  });

  it("includes the in-memory fake — both classes — which is what shows the kit is not GitHub-shaped", () => {
    const spec = readFileSync(
      join(__dirname, "providers", "in-memory.conformance.spec.ts"),
      "utf8",
    );

    expect(spec).toContain('describeTicketSourceConformance("InMemoryTicketSourceProvider"');
    expect(spec).toContain('describeTicketSourceConformance("InMemoryWebhookTicketSourceProvider"');
  });
});
