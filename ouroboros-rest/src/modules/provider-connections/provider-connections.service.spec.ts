import type { AuditRecord } from "../audit/audit.events";
import { recordingAudit } from "../audit/audit.fixture";
import { COOKIE } from "../auth/http";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import {
  FAKE_BASE_URL,
  FAKE_CONFIG_SCHEMA,
  FAKE_MODELS,
  FAKE_PULL_EVENTS,
  FakeModelProviderAdapter,
  FakePullingProviderAdapter,
} from "../providers/adapters/fake.adapter.fixture";
import type { ModelPullProgress, ProviderValidation } from "../providers/provider.adapter";
import { ProviderAdapterError } from "../providers/provider.errors";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_FIELD,
  type ProviderConnectionConfig,
} from "../providers/provider.config";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { ModelPullTracker } from "../providers/provider.pulls";
import type { ProviderHealthService } from "../provider-health/provider-health.service";
import type { RegistryService } from "../registry/registry.service";
import { FOREIGN_KEY_VIOLATION, PROVIDER_DEPENDENCY_CONSTRAINT } from "../registry/registry.errors";
import type { ProviderSpendRow, RoutingStatsRepository } from "../routing/stats.repository";
import { inMemoryVault } from "../vault/vault.fixture";
import type { VaultService } from "../vault/vault.service";
import { ProviderAudit } from "./connection.audit";
import {
  FIXTURE_ACTOR,
  FIXTURE_CONNECTION,
  FIXTURE_MASK,
  FIXTURE_SECRET,
  FIXTURE_WORKSPACE,
  connectionRow,
} from "./connection.fixture";
import type { ProviderConnectionsRepository } from "./provider-connections.repository";
import type { ProviderModelsRepository } from "./provider-models.repository";
import { ProviderConnectionsService, REVEAL_TTL_SECONDS } from "./provider-connections.service";
import { RevealLimiter, REVEAL_ATTEMPTS_PER_CONNECTION } from "./reveal.limiter";
import type { StepUpService } from "./step-up";

/**
 * The order of operations, which is the whole ticket.
 *
 * Every acceptance criterion AD.2 states is a claim about *when* something happens relative
 * to something else — nothing persisted before the provider agrees, the old key still live
 * after a failed rotation, the attempt counted before the step-up is checked — so this suite
 * is mostly assertions about what was *not* called, and about the sequence of what was.
 *
 * The vault is real. `inMemoryVault()` builds the actual `VaultService` over real
 * cryptography and an in-memory `tenant_keys`, so a credential sealed here is genuinely
 * sealed and a mask is genuinely computed from an opened one — which is the half a stubbed
 * vault would quietly turn into an assertion about the stub. The repository is a mock,
 * because what is being asserted about it is *whether it was reached at all*.
 */

const NOW = new Date("2026-08-23T10:00:00.000Z");
const REQUEST = { headers: { [COOKIE]: "better-auth.session_token=abc" } };
const PRINCIPAL = principalFor(FIXTURE_USER, FIXTURE_WORKSPACE);

/** The submission mockup 07's vLLM card produces — a required address and an optional key. */
const CONFIG = { [BASE_URL_FIELD]: "https://fake.invalid/v1", apiKey: FIXTURE_SECRET };

/** The name the repository answers for {@link FIXTURE_ACTOR} — the card's *Added by Ken*. */
const ADDER = "Ken Suenobu";

interface Harness {
  service: ProviderConnectionsService;
  connections: jest.Mocked<ProviderConnectionsRepository>;
  /** Z.5's aggregation, answering whatever a case queues for the month. */
  stats: { byProvider: jest.Mock };
  /** V017's catalog, answering whatever a case queues and recording what was written. */
  discovered: { forConnection: jest.Mock; replace: jest.Mock };
  /** Z.3's writer, recording what a test asked it to store. */
  health: { recordValidation: jest.Mock };
  /** AC.4's tracker, real: it is in-memory and the whole point is what it remembers. */
  tracker: ModelPullTracker;
  adapter: FakeModelProviderAdapter;
  vault: VaultService;
  aliases: { dependentAliases: jest.Mock; aliasesOn: jest.Mock };
  stepUp: { satisfied: jest.Mock };
  limiter: RevealLimiter;
  audited: AuditRecord[];
  /** What the adapter was asked to validate, in order — the config and the credential. */
  validate: jest.SpyInstance<
    Promise<ProviderValidation>,
    [ProviderConnectionConfig, string | null]
  >;
}

/**
 * Build the service with a real vault, a real registry over the fake adapter, and mocks for
 * everything whose *absence of a call* is the assertion.
 *
 * @returns The service and every piece a test drives or inspects.
 */
function harness(): Harness {
  const { vault } = inMemoryVault();
  const adapter = new FakeModelProviderAdapter({ kind: "anthropic" });
  const registry = new ModelProviderRegistry([adapter]);
  // The fake counts its calls; what several assertions need is *what it was called with*, and
  // a spy over the real method records that without the fake growing a second memory.
  const validate = jest.spyOn(adapter, "validate");

  const connections = {
    list: jest.fn(),
    find: jest.fn(),
    envelopeOf: jest.fn(),
    envelopesFor: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    swapCredential: jest.fn(),
    remove: jest.fn(),
    adderNames: jest.fn().mockResolvedValue(new Map([[FIXTURE_ACTOR, ADDER]])),
  } as unknown as jest.Mocked<ProviderConnectionsRepository>;

  const aliases = {
    dependentAliases: jest.fn().mockResolvedValue([]),
    aliasesOn: jest.fn().mockResolvedValue([]),
  };
  const stepUp = { satisfied: jest.fn().mockResolvedValue("password") };
  const limiter = new RevealLimiter();
  const stats = { byProvider: jest.fn().mockResolvedValue([]) };
  const discovered = {
    forConnection: jest.fn().mockResolvedValue([]),
    replace: jest.fn().mockResolvedValue([]),
  };
  const health = { recordValidation: jest.fn().mockResolvedValue(undefined) };
  const tracker = new ModelPullTracker();

  // The trail, as records rather than log lines: AD.4 (#225) turned the interim sink into
  // `audit_events`, so what a suite asserts about is now the row that was written.
  const trail = recordingAudit();
  const audited = trail.records;

  const service = new ProviderConnectionsService(
    connections,
    registry,
    vault,
    aliases as unknown as RegistryService,
    stepUp as unknown as StepUpService,
    limiter,
    new ProviderAudit(trail.service),
    stats as unknown as RoutingStatsRepository,
    discovered as unknown as ProviderModelsRepository,
    health as unknown as ProviderHealthService,
    tracker,
  );

  return {
    service,
    connections,
    adapter,
    vault,
    aliases,
    stepUp,
    limiter,
    audited,
    validate,
    stats,
    discovered,
    health,
    tracker,
  };
}

describe("adding a provider", () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
    subject.connections.insert.mockResolvedValue(connectionRow());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const add = (config: Record<string, string> = CONFIG) =>
    subject.service.add(FIXTURE_WORKSPACE, FIXTURE_ACTOR, {
      kind: "anthropic",
      displayName: "Anthropic Claude",
      config,
      monthlyCapCents: 60_000,
    });

  it("asks the provider before it writes anything", async () => {
    await add();

    expect(subject.adapter.calls.validate).toBe(1);
    expect(subject.connections.insert).toHaveBeenCalledTimes(1);
  });

  it("stores nothing at all when the provider refuses the key", async () => {
    // The ticket's *adding a provider with an invalid key fails without persisting
    // anything* — a property of the control flow, not of a rollback: there is no row to
    // clean up because there was never a row.
    subject.adapter.willFail("auth");

    await expect(add()).rejects.toMatchObject({ response: { code: "provider_validation_failed" } });
    expect(subject.connections.insert).not.toHaveBeenCalled();
  });

  it("stores nothing when the submission does not satisfy the adapter's schema", async () => {
    await expect(add({ apiKey: FIXTURE_SECRET })).rejects.toMatchObject({
      response: { code: "provider_config_invalid" },
    });
    expect(subject.adapter.calls.validate).toBe(0);
    expect(subject.connections.insert).not.toHaveBeenCalled();
  });

  it("stores nothing when a submitted setting has no column in this build", async () => {
    const adapter = new FakeModelProviderAdapter({
      kind: "anthropic",
      schema: {
        ...FAKE_CONFIG_SCHEMA,
        properties: {
          ...FAKE_CONFIG_SCHEMA.properties,
          organization: { type: "string", title: "Org" },
        },
      },
    });
    const registry = new ModelProviderRegistry([adapter]);
    const service = new ProviderConnectionsService(
      subject.connections,
      registry,
      subject.vault,
      subject.aliases as unknown as RegistryService,
      subject.stepUp as unknown as StepUpService,
      subject.limiter,
      new ProviderAudit(recordingAudit().service),
      subject.stats as unknown as RoutingStatsRepository,
      subject.discovered as unknown as ProviderModelsRepository,
      subject.health as unknown as ProviderHealthService,
      subject.tracker,
    );

    await expect(
      service.add(FIXTURE_WORKSPACE, FIXTURE_ACTOR, {
        kind: "anthropic",
        displayName: "Copilot-ish",
        config: { ...CONFIG, organization: "acme-robotics" },
      }),
    ).rejects.toMatchObject({ response: { code: "provider_config_not_storable" } });
    expect(subject.connections.insert).not.toHaveBeenCalled();
  });

  it("seals the credential and never hands it to the row builder in the clear", async () => {
    await add();

    const [, envelope] = subject.connections.insert.mock.calls[0];
    expect(envelope).toMatch(/^ouro\.v1\.\d+\./);
    expect(envelope).not.toContain(FIXTURE_SECRET);
  });

  it("seals it bound to the row's own id, which is why the id is minted first", async () => {
    // The vault binds a ciphertext to `(organization, record)`, so the identity has to exist
    // before the credential can be sealed — and a database-generated id would mean a window
    // in which the connection exists with no credential.
    await add();

    const [row, envelope] = subject.connections.insert.mock.calls[0];

    await expect(
      subject.vault.decryptText(FIXTURE_WORKSPACE, String(row.id), envelope ?? ""),
    ).resolves.toBe(FIXTURE_SECRET);
    // Bound, not merely stored beside: another record's id cannot open it.
    await expect(
      subject.vault.decryptText(FIXTURE_WORKSPACE, "another-record", envelope ?? ""),
    ).rejects.toThrow();
  });

  it("stores no credential for a provider that needs none", async () => {
    await add({ [BASE_URL_FIELD]: "https://fake.invalid/v1" });

    const [, envelope] = subject.connections.insert.mock.calls[0];
    expect(envelope).toBeNull();
  });

  it("maps the two reserved field names onto their columns and drops nothing else", async () => {
    const adapter = new FakeModelProviderAdapter({
      kind: "anthropic",
      schema: {
        ...FAKE_CONFIG_SCHEMA,
        properties: {
          ...FAKE_CONFIG_SCHEMA.properties,
          [CAPABILITY_NOTE_FIELD]: { type: "string", title: "Capability note" },
        },
      },
    });
    const service = new ProviderConnectionsService(
      subject.connections,
      new ModelProviderRegistry([adapter]),
      subject.vault,
      subject.aliases as unknown as RegistryService,
      subject.stepUp as unknown as StepUpService,
      subject.limiter,
      new ProviderAudit(recordingAudit().service),
      subject.stats as unknown as RoutingStatsRepository,
      subject.discovered as unknown as ProviderModelsRepository,
      subject.health as unknown as ProviderHealthService,
      subject.tracker,
    );

    await service.add(FIXTURE_WORKSPACE, FIXTURE_ACTOR, {
      kind: "anthropic",
      displayName: "vLLM",
      config: { ...CONFIG, [CAPABILITY_NOTE_FIELD]: "self-hosted · A100 ×2" },
    });

    expect(subject.connections.insert.mock.calls[0][0]).toMatchObject({
      base_url: "https://fake.invalid/v1",
      capability_note: "self-hosted · A100 ×2",
    });
  });

  it("records the check that just ran rather than leaving the card unknown", async () => {
    await add();

    expect(subject.connections.insert.mock.calls[0][0]).toMatchObject({
      status: "active",
      health: { latency_ms: 7 },
      added_by: FIXTURE_ACTOR,
      monthly_cap_cents: 60_000,
    });
  });

  it("answers the connection with its credential masked", async () => {
    await expect(add()).resolves.toMatchObject({ mask: FIXTURE_MASK });
  });

  it("writes one audit event", async () => {
    await add();

    expect(subject.audited.filter((event) => event.action === "provider.added")).toHaveLength(1);
    expect(subject.audited[0].detail).toMatchObject({ kind: "anthropic", outcome: "success" });
  });

  it("writes one audit event when nothing was stored, and marks it a refusal", async () => {
    // AD.4's first criterion covers the failure paths, which is where it parts company with
    // AD.2: *nobody added a provider* and *somebody tried and the provider refused the key*
    // are different facts, and only the second is worth an incident. The event names no
    // connection because nothing was written — see `connection.audit.ts`.
    subject.adapter.willFail("auth");

    await expect(add()).rejects.toThrow();

    expect(subject.audited).toHaveLength(1);
    expect(subject.audited[0]).toMatchObject({ action: "provider.added", subjectId: null });
    expect(subject.audited[0].detail).toMatchObject({
      kind: "anthropic",
      outcome: "failure",
      reason: "provider_validation_failed",
    });
  });

  it("refuses a kind this build has no adapter for, before anything else", async () => {
    await expect(
      subject.service.add(FIXTURE_WORKSPACE, FIXTURE_ACTOR, {
        kind: "cursor",
        displayName: "Cursor",
        config: {},
      }),
    ).rejects.toMatchObject({ response: { code: "provider_kind_unsupported" } });
    expect(subject.connections.insert).not.toHaveBeenCalled();
  });
});

describe("the catalog", () => {
  it("is the registry the service was built with, as `catalog.ts` renders it", () => {
    // One line in the service and one assertion here: the entries are the registered kinds
    // with their forms, and `catalog.spec.ts` is where the rendering itself is held.
    const subject = harness();

    expect(subject.service.catalog()).toEqual({
      kinds: [
        {
          kind: "anthropic",
          title: FAKE_CONFIG_SCHEMA.title,
          fields: [
            expect.objectContaining({ name: BASE_URL_FIELD, widget: "url", required: true }),
            expect.objectContaining({ name: "apiKey", widget: "secret", required: false }),
          ],
          capabilities: { discovery: true, pull: false, entitlements: false, invocation: false },
        },
      ],
    });
  });
});

describe("reading", () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("masks each listed connection from its own sealed credential", async () => {
    const envelope = await subject.vault.encryptText(
      FIXTURE_WORKSPACE,
      FIXTURE_CONNECTION,
      FIXTURE_SECRET,
    );
    subject.connections.list.mockResolvedValue({ rows: [connectionRow()], total: 1 });
    subject.connections.envelopesFor.mockResolvedValue(new Map([[FIXTURE_CONNECTION, envelope]]));

    const page = await subject.service.list(FIXTURE_WORKSPACE, {});

    expect(page.items[0].mask).toBe(FIXTURE_MASK);
    expect(page.total).toBe(1);
  });

  it("asks for a page's envelopes in one batch rather than one at a time", async () => {
    subject.connections.list.mockResolvedValue({ rows: [connectionRow()], total: 1 });
    subject.connections.envelopesFor.mockResolvedValue(new Map([[FIXTURE_CONNECTION, null]]));

    await subject.service.list(FIXTURE_WORKSPACE, {});

    expect(subject.connections.envelopesFor).toHaveBeenCalledTimes(1);
    expect(subject.connections.envelopeOf).not.toHaveBeenCalled();
  });

  it("masks nothing for a connection that stores no credential", async () => {
    subject.connections.list.mockResolvedValue({ rows: [connectionRow()], total: 1 });
    subject.connections.envelopesFor.mockResolvedValue(new Map([[FIXTURE_CONNECTION, null]]));

    const page = await subject.service.list(FIXTURE_WORKSPACE, {});

    expect(page.items[0].mask).toBeNull();
  });

  it("answers 404 for a connection this workspace does not have", async () => {
    subject.connections.find.mockResolvedValue(undefined);

    await expect(subject.service.read(FIXTURE_WORKSPACE, FIXTURE_CONNECTION)).rejects.toMatchObject(
      { response: { code: "provider_connection_not_found" } },
    );
  });

  it("names the adder on every listed connection, from one read of the workspace's adders", async () => {
    // The card's *Added by Ken* (#228): a name rather than an id, resolved once per page rather
    // than once per row — and resolved through the workspace, so the map can name nobody who
    // did not connect one of its providers.
    subject.connections.list.mockResolvedValue({
      rows: [connectionRow(), connectionRow({ id: "5eed000c-0000-4000-8000-000000000002" })],
      total: 2,
    });
    subject.connections.envelopesFor.mockResolvedValue(new Map());

    const page = await subject.service.list(FIXTURE_WORKSPACE, {});

    expect(page.items.map((item) => item.addedByName)).toEqual([ADDER, ADDER]);
    expect(subject.connections.adderNames).toHaveBeenCalledTimes(1);
    expect(subject.connections.adderNames).toHaveBeenCalledWith(FIXTURE_WORKSPACE);
  });

  it("carries a null name for a connection whose adder has since gone, and asks nothing for one nobody added", async () => {
    // V015's set-null leaves `added_by` pointing at nobody; the card draws an em-dash for it,
    // and must never be handed an id to draw instead.
    subject.connections.find.mockResolvedValue(connectionRow());
    subject.connections.envelopeOf.mockResolvedValue(null);
    subject.connections.adderNames.mockResolvedValue(new Map());

    await expect(
      subject.service.read(FIXTURE_WORKSPACE, FIXTURE_CONNECTION),
    ).resolves.toMatchObject({ addedBy: FIXTURE_ACTOR, addedByName: null });

    subject.connections.find.mockResolvedValue(connectionRow({ added_by: null }));
    subject.connections.adderNames.mockClear();

    await expect(
      subject.service.read(FIXTURE_WORKSPACE, FIXTURE_CONNECTION),
    ).resolves.toMatchObject({ addedBy: null, addedByName: null });
    expect(subject.connections.adderNames).not.toHaveBeenCalled();
  });
});

describe("the monthly spend", () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
  });

  /** A ledger row as Z.5's statement answers one — text where PostgreSQL keeps precision. */
  const row = (overrides: Partial<ProviderSpendRow> = {}): ProviderSpendRow => ({
    provider: "anthropic",
    spend_cents: "41280.0000",
    tokens: "24000000",
    priced_calls: 15,
    unpriced_calls: 0,
    ...overrides,
  });

  it("asks Z.5's statement for the rows since the first of the UTC month, for this workspace", async () => {
    // Decision P7: a cap is a calendar-month agreement, so the meter's numerator is measured
    // from the first of the month — in UTC, the zone the seed places its rows in — and never
    // from a rolling thirty days. The same statement the routing card uses, with one instant
    // changed, so the two surfaces cannot come to differ about an invoice.
    await subject.service.spend(FIXTURE_WORKSPACE, new Date("2026-08-23T09:59:41.882Z"));

    expect(subject.stats.byProvider).toHaveBeenCalledWith(
      FIXTURE_WORKSPACE,
      new Date("2026-08-01T00:00:00.000Z"),
    );
  });

  it("answers the month, and one row per kind in the contract's vocabulary", async () => {
    subject.stats.byProvider.mockResolvedValue([
      row(),
      row({
        provider: "ollama",
        spend_cents: null,
        tokens: "2100000",
        priced_calls: 0,
        unpriced_calls: 2,
      }),
    ]);

    const spend = await subject.service.spend(
      FIXTURE_WORKSPACE,
      new Date("2026-08-23T09:59:41.882Z"),
    );

    expect(spend).toEqual({
      month: { since: "2026-08-01T00:00:00.000Z", until: "2026-08-23T09:59:41.882Z" },
      providers: [
        {
          kind: "anthropic",
          local: false,
          spendCents: 41_280,
          tokens: 24_000_000,
          pricedCalls: 15,
          unpricedCalls: 0,
        },
        // Unpriced stays null — the meter's *no metered spend* — and never becomes a `$0.00`.
        {
          kind: "ollama",
          local: true,
          spendCents: null,
          tokens: 2_100_000,
          pricedCalls: 0,
          unpricedCalls: 2,
        },
      ],
    });
  });

  it("answers no rows at all for a workspace that has spent nothing this month", async () => {
    await expect(
      subject.service.spend(FIXTURE_WORKSPACE, new Date("2026-08-23T09:59:41.882Z")),
    ).resolves.toMatchObject({ providers: [] });
  });
});

describe("revealing a credential", () => {
  let subject: Harness;
  let envelope: string;

  beforeEach(async () => {
    subject = harness();
    envelope = await subject.vault.encryptText(
      FIXTURE_WORKSPACE,
      FIXTURE_CONNECTION,
      FIXTURE_SECRET,
    );
    subject.connections.find.mockResolvedValue(connectionRow());
    subject.connections.envelopeOf.mockResolvedValue(envelope);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const reveal = (body: { password?: string } = {}, now: Date = NOW) =>
    subject.service.reveal(FIXTURE_WORKSPACE, PRINCIPAL, REQUEST, FIXTURE_CONNECTION, body, now);

  it("answers the credential once the step-up is satisfied", async () => {
    await expect(reveal({ password: "a-password" })).resolves.toEqual({
      connectionId: FIXTURE_CONNECTION,
      value: FIXTURE_SECRET,
      expiresAt: new Date(NOW.getTime() + REVEAL_TTL_SECONDS * 1000).toISOString(),
    });
  });

  it("refuses with a challenge when there is no recent step-up", async () => {
    subject.stepUp.satisfied.mockResolvedValue(null);

    await expect(reveal()).rejects.toMatchObject({
      response: { code: "step_up_required", details: { methods: ["session", "password"] } },
    });
  });

  it("opens nothing when the step-up is refused", async () => {
    subject.stepUp.satisfied.mockResolvedValue(null);

    await expect(reveal()).rejects.toThrow();

    expect(subject.connections.envelopeOf).not.toHaveBeenCalled();
  });

  it("counts the attempt before it checks the step-up", async () => {
    // The one ordering in this module that is a security property rather than a preference:
    // a limiter behind the step-up would leave the password comparison unlimited.
    subject.stepUp.satisfied.mockResolvedValue(null);

    for (let n = 0; n < REVEAL_ATTEMPTS_PER_CONNECTION; n += 1) {
      await expect(reveal({ password: "wrong" })).rejects.toMatchObject({
        response: { code: "step_up_required" },
      });
    }

    await expect(reveal({ password: "wrong" })).rejects.toMatchObject({
      response: { code: "provider_reveal_rate_limited", details: { scope: "connection" } },
    });
    // And the step-up was not even consulted on the refused attempt.
    expect(subject.stepUp.satisfied).toHaveBeenCalledTimes(REVEAL_ATTEMPTS_PER_CONNECTION);
  });

  it("answers 409 for a connection that stores no credential", async () => {
    subject.connections.envelopeOf.mockResolvedValue(null);

    await expect(reveal()).rejects.toMatchObject({
      response: { code: "provider_credential_absent" },
    });
  });

  it("answers 404 for a connection this workspace does not have", async () => {
    subject.connections.find.mockResolvedValue(undefined);

    await expect(reveal()).rejects.toMatchObject({
      response: { code: "provider_connection_not_found" },
    });
  });

  it("writes one audit event naming how the step-up was satisfied", async () => {
    subject.stepUp.satisfied.mockResolvedValue("session");

    await reveal();

    const revealed = subject.audited.filter((event) => event.action === "provider.revealed");
    expect(revealed).toHaveLength(1);
    expect(revealed[0].detail).toMatchObject({ step_up: "session", outcome: "success" });
    expect(revealed[0].actorId).toBe(FIXTURE_USER.id);
  });

  it("writes one audit event when the step-up refused, which is the reveal worth reading", async () => {
    // *Somebody could not prove they were who they said and asked for this key anyway* is
    // the single most interesting row this trail can hold, and AD.2 did not record it.
    subject.stepUp.satisfied.mockResolvedValue(null);

    await expect(reveal()).rejects.toThrow();

    expect(subject.audited).toHaveLength(1);
    expect(subject.audited[0]).toMatchObject({
      action: "provider.revealed",
      subjectId: FIXTURE_CONNECTION,
      actorId: FIXTURE_USER.id,
    });
    expect(subject.audited[0].detail).toMatchObject({
      outcome: "failure",
      reason: "step_up_required",
    });
  });

  it("names no provider on a refusal that happened before the row was read", async () => {
    // The limiter runs first, on purpose — see the service's header. A refusal there
    // genuinely does not know which provider was being asked for, and a guess would be worse
    // than the honest absence.
    subject.stepUp.satisfied.mockResolvedValue(null);

    await expect(reveal()).rejects.toThrow();

    expect(subject.audited[0].detail?.kind).toBeUndefined();
  });
});

describe("rotating a credential", () => {
  let subject: Harness;
  let previous: string;

  beforeEach(async () => {
    subject = harness();
    previous = await subject.vault.encryptText(
      FIXTURE_WORKSPACE,
      FIXTURE_CONNECTION,
      FIXTURE_SECRET,
    );
    subject.connections.find.mockResolvedValue(
      connectionRow({ base_url: "https://fake.invalid/v1" }),
    );
    subject.connections.envelopeOf.mockResolvedValue(previous);
    subject.connections.swapCredential.mockResolvedValue(connectionRow());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const rotate = (secret = "sk-ant-api03-the-new-key-7Kd2") =>
    subject.service.rotate(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, { secret });

  it("validates the new credential against the live provider first", async () => {
    await rotate();

    expect(subject.adapter.calls.validate).toBe(1);
    expect(subject.connections.swapCredential).toHaveBeenCalledTimes(1);
  });

  it("leaves the old credential live when the new one is refused", async () => {
    // The ticket's *rotate with an invalid new key leaves the old key live and working* —
    // and it holds because the refusal happens before any statement is issued, not because
    // something was undone.
    subject.adapter.willFail("auth");

    await expect(rotate()).rejects.toMatchObject({
      response: { code: "provider_validation_failed", details: { detail: "key rejected (401)" } },
    });
    expect(subject.connections.swapCredential).not.toHaveBeenCalled();
  });

  it("swaps conditionally on the credential it validated against", async () => {
    await rotate();

    const [, , seen] = subject.connections.swapCredential.mock.calls[0];
    expect(seen).toBe(previous);
  });

  it("answers 409 when the row moved under the validation", async () => {
    subject.connections.swapCredential.mockResolvedValue(undefined);

    await expect(rotate()).rejects.toMatchObject({
      response: { code: "provider_connection_changed" },
    });
  });

  it("seals the new credential bound to the same connection", async () => {
    await rotate();

    const [, , , next] = subject.connections.swapCredential.mock.calls[0];
    await expect(
      subject.vault.decryptText(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, next),
    ).resolves.toBe("sk-ant-api03-the-new-key-7Kd2");
  });

  it("answers the connection masked with the new credential's own suffix", async () => {
    await expect(rotate()).resolves.toMatchObject({ mask: "••••7Kd2" });
  });

  it("refuses a provider that takes no credential at all", async () => {
    const adapter = new FakeModelProviderAdapter({
      kind: "anthropic",
      schema: {
        ...FAKE_CONFIG_SCHEMA,
        properties: { [BASE_URL_FIELD]: FAKE_CONFIG_SCHEMA.properties[BASE_URL_FIELD] },
        required: [BASE_URL_FIELD],
      },
    });
    const service = new ProviderConnectionsService(
      subject.connections,
      new ModelProviderRegistry([adapter]),
      subject.vault,
      subject.aliases as unknown as RegistryService,
      subject.stepUp as unknown as StepUpService,
      subject.limiter,
      new ProviderAudit(recordingAudit().service),
      subject.stats as unknown as RoutingStatsRepository,
      subject.discovered as unknown as ProviderModelsRepository,
      subject.health as unknown as ProviderHealthService,
      subject.tracker,
    );

    await expect(
      service.rotate(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, { secret: "x" }),
    ).rejects.toMatchObject({ response: { code: "provider_credential_absent" } });
  });

  it("rotates onto a connection whose optional credential was absent", async () => {
    // An OpenAI-compatible endpoint that has just been put behind auth is a real thing to
    // rotate onto, and the new key is live-validated exactly as any other.
    subject.connections.envelopeOf.mockResolvedValue(null);

    await rotate();

    const [, , seen] = subject.connections.swapCredential.mock.calls[0];
    expect(seen).toBeNull();
  });

  it("writes one audit event, and one more on a refusal", async () => {
    // *A failed rotation is still an event* — AD.4's criterion, named in that issue's own
    // words. Both rows carry `provider.rotated`; `outcome` is what tells them apart, so no
    // tenth name enters the vocabulary from outside it.
    await rotate();
    expect(subject.audited).toHaveLength(1);
    expect(subject.audited[0].detail).toMatchObject({ outcome: "success" });

    subject.adapter.willFail("auth");
    await expect(rotate()).rejects.toThrow();

    const rotations = subject.audited.filter((event) => event.action === "provider.rotated");
    expect(rotations).toHaveLength(2);
    expect(rotations[1].detail).toMatchObject({
      kind: "anthropic",
      outcome: "failure",
      reason: "provider_validation_failed",
    });
  });
});

describe("editing a connection", () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
    subject.connections.find.mockResolvedValue(
      connectionRow({ base_url: "https://fake.invalid/v1" }),
    );
    subject.connections.envelopeOf.mockResolvedValue(null);
    subject.connections.update.mockResolvedValue(connectionRow());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const update = (body: Parameters<ProviderConnectionsService["update"]>[3]) =>
    subject.service.update(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, body);

  it("writes only the settings the body named", async () => {
    await update({ enabled: false });

    expect(subject.connections.update).toHaveBeenCalledWith(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, {
      enabled: false,
    });
  });

  it("clears a setting an explicit null names, and leaves an absent one alone", async () => {
    await update({ monthlyCapCents: null });

    expect(subject.connections.update).toHaveBeenCalledWith(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, {
      monthly_cap_cents: null,
    });
  });

  it("asks no provider when nothing about the configuration changed", async () => {
    await update({ displayName: "Renamed" });

    expect(subject.adapter.calls.validate).toBe(0);
  });

  it("validates an address change against the live provider", async () => {
    await update({ config: { [BASE_URL_FIELD]: "https://elsewhere.invalid/v1" } });

    expect(subject.adapter.calls.validate).toBe(1);
    expect(subject.connections.update.mock.calls[0][2]).toMatchObject({
      base_url: "https://elsewhere.invalid/v1",
      status: "active",
    });
  });

  it("changes nothing when the provider refuses the new address", async () => {
    subject.adapter.willFail("network");

    await expect(
      update({ config: { [BASE_URL_FIELD]: "https://elsewhere.invalid/v1" } }),
    ).rejects.toMatchObject({ response: { code: "provider_validation_failed" } });
    expect(subject.connections.update).not.toHaveBeenCalled();
  });

  it("merges the edit over what is stored rather than judging half a request", async () => {
    // A schema's rules can span fields, so a partial edit is only checkable once it is a
    // whole configuration again.
    await update({ config: { [BASE_URL_FIELD]: "https://elsewhere.invalid/v1" } });

    expect(subject.validate.mock.calls[0][0]).toEqual({
      [BASE_URL_FIELD]: "https://elsewhere.invalid/v1",
    });
  });

  it("opens the stored credential for the one call that needs it", async () => {
    const envelope = await subject.vault.encryptText(
      FIXTURE_WORKSPACE,
      FIXTURE_CONNECTION,
      FIXTURE_SECRET,
    );
    subject.connections.envelopeOf.mockResolvedValue(envelope);

    await update({ config: { [BASE_URL_FIELD]: "https://elsewhere.invalid/v1" } });

    expect(subject.validate.mock.calls[0][1]).toBe(FIXTURE_SECRET);
  });

  it("refuses a capability note sent inside config", async () => {
    // It has a field of its own on this body; two ways to set it with no rule about which
    // wins is worse than one refusal that says where it goes.
    await expect(update({ config: { [CAPABILITY_NOTE_FIELD]: "a note" } })).rejects.toMatchObject({
      response: { code: "provider_config_invalid" },
    });
  });

  it("applies the note after the configuration, so an edit that clears it ends cleared", async () => {
    await update({
      config: { [BASE_URL_FIELD]: "https://elsewhere.invalid/v1" },
      capabilityNote: null,
    });

    expect(subject.connections.update.mock.calls[0][2]).toMatchObject({ capability_note: null });
  });

  it("answers the connection unchanged, and writes nothing, for a body that changes nothing", async () => {
    await expect(update({})).resolves.toMatchObject({ id: FIXTURE_CONNECTION });

    expect(subject.connections.update).not.toHaveBeenCalled();
    expect(subject.audited).toHaveLength(0);
  });

  it("records which settings an edit wrote", async () => {
    await update({ enabled: false, monthlyCapCents: 100 });

    const updated = subject.audited.filter((event) => event.action === "provider.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0].detail).toMatchObject({ fields: "enabled,monthlyCapCents" });
  });

  it("names the switch when the switch is all that moved", async () => {
    // AD.4's vocabulary singles out the two settings mockup 07 draws as affordances of their
    // own, and a trail that said *updated* where somebody saw themselves press a switch would
    // be describing the request instead of the act.
    await update({ enabled: false });

    expect(subject.audited).toHaveLength(1);
    expect(subject.audited[0].action).toBe("provider.disabled");
  });

  it("names the cap when the cap is all that moved, and says where it moved from", async () => {
    await update({ monthlyCapCents: 100 });

    expect(subject.audited).toHaveLength(1);
    expect(subject.audited[0].action).toBe("provider.cap_changed");
    expect(subject.audited[0].detail).toMatchObject({ to_cap_cents: 100 });
  });
});

describe("removing a connection", () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
    subject.connections.find.mockResolvedValue(connectionRow());
    subject.connections.remove.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const remove = () => subject.service.remove(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION);

  it("removes a connection nothing depends on", async () => {
    await expect(remove()).resolves.toBeUndefined();

    expect(subject.connections.remove).toHaveBeenCalledWith(FIXTURE_WORKSPACE, FIXTURE_CONNECTION);
    expect(subject.audited.filter((event) => event.action === "provider.deleted")).toHaveLength(1);
  });

  it("refuses while aliases resolve on it, and names them", async () => {
    subject.aliases.dependentAliases.mockResolvedValue(["coder-max", "local-docs"]);

    await expect(remove()).rejects.toMatchObject({
      response: {
        code: "provider_connection_in_use",
        details: { aliases: ["coder-max", "local-docs"] },
      },
    });
    expect(subject.connections.remove).not.toHaveBeenCalled();
  });

  it("recognises the same refusal when it arrives from the server instead", async () => {
    // The race the pre-flight cannot close: an alias created between the check and the
    // delete makes PostgreSQL refuse anyway, and a caller that could not recognise that
    // would report a designed 409 as an unexplained 500.
    subject.connections.remove.mockRejectedValue(
      Object.assign(new Error("violates foreign key constraint"), {
        code: FOREIGN_KEY_VIOLATION,
        constraint: PROVIDER_DEPENDENCY_CONSTRAINT,
      }),
    );
    subject.aliases.dependentAliases
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["created-mid-flight"]);

    await expect(remove()).rejects.toMatchObject({
      response: {
        code: "provider_connection_in_use",
        details: { aliases: ["created-mid-flight"] },
      },
    });
  });

  it("re-raises an unrelated failure unchanged", async () => {
    const failure = new Error("connection terminated");
    subject.connections.remove.mockRejectedValue(failure);

    await expect(remove()).rejects.toBe(failure);
  });

  it("re-raises the driver's own error when the blocking alias has itself gone", async () => {
    // An error naming no alias would be worse than the driver's own.
    const failure = Object.assign(new Error("violates foreign key constraint"), {
      code: FOREIGN_KEY_VIOLATION,
      constraint: PROVIDER_DEPENDENCY_CONSTRAINT,
    });
    subject.connections.remove.mockRejectedValue(failure);

    await expect(remove()).rejects.toBe(failure);
  });

  it("answers 404 for a connection this workspace does not have", async () => {
    subject.connections.find.mockResolvedValue(undefined);

    await expect(remove()).rejects.toMatchObject({
      response: { code: "provider_connection_not_found" },
    });
  });
});

/** Let the tracker's detached pump run to its next await. */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * A pull-capable fake whose stream waits to be released, so a case can hold a pull `running`
 * for as long as it needs to observe the second one `queued`.
 */
class GatedPullingAdapter extends FakePullingProviderAdapter {
  /** Streams parked after their first event, oldest first. */
  private readonly waiting: (() => void)[] = [];

  /** Releases granted before a stream asked for one, so `finish()` can be called early. */
  private passes = 0;

  /** Let the oldest parked stream finish — or the next one to park, if none is parked yet. */
  finish(): void {
    const next = this.waiting.shift();

    if (next === undefined) {
      this.passes += 1;
    } else {
      next();
    }
  }

  override async *pullModel(): AsyncIterable<ModelPullProgress> {
    this.calls.pullModel += 1;

    yield FAKE_PULL_EVENTS[0];

    if (this.passes > 0) {
      this.passes -= 1;
    } else {
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    }

    yield FAKE_PULL_EVENTS[FAKE_PULL_EVENTS.length - 1];
  }
}

describe("testing a connection — AE.4's card foot (#230)", () => {
  let subject: Harness;

  beforeEach(async () => {
    subject = harness();
    // The fake's schema requires an address; the stored projection of a row without one is a
    // `config` failure, which is the fake being honest rather than the case under test.
    subject.connections.find.mockResolvedValue(connectionRow({ base_url: FAKE_BASE_URL }));
    subject.connections.envelopeOf.mockResolvedValue(
      await subject.vault.encryptText(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, FIXTURE_SECRET),
    );
  });

  it("asks the adapter with the stored settings and the opened credential", async () => {
    await subject.service.test(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, NOW);

    expect(subject.validate).toHaveBeenCalledTimes(1);
    expect(subject.validate.mock.calls[0][1]).toBe(FIXTURE_SECRET);
  });

  it("answers a pass as the card foot's `✓ 200 · 38ms`, with the latency the adapter measured", async () => {
    const result = await subject.service.test(
      FIXTURE_WORKSPACE,
      FIXTURE_ACTOR,
      FIXTURE_CONNECTION,
      NOW,
    );

    expect(result).toMatchObject({
      connectionId: FIXTURE_CONNECTION,
      checkedAt: NOW.toISOString(),
      status: "active",
      pill: { tone: "ok", label: "connected" },
      note: "200",
      errorClass: null,
      retryable: false,
    });
    expect(result.latencyMs).toEqual(expect.any(Number));
  });

  it("answers a refusal as a value, not a 422 — the foot exists to render `△ 503 upstream · retrying`", async () => {
    subject.adapter.willFail("upstream");

    const result = await subject.service.test(
      FIXTURE_WORKSPACE,
      FIXTURE_ACTOR,
      FIXTURE_CONNECTION,
      NOW,
    );

    expect(result).toMatchObject({
      status: "error",
      pill: { tone: "warn", label: "degraded upstream" },
      errorClass: "upstream",
      retryable: true,
      latencyMs: null,
    });
    expect(result.note).toMatch(/· retrying$/);
  });

  it("writes what it found through Z.3's own writer, so the strip and the pill agree", async () => {
    subject.adapter.willFail("auth");

    await subject.service.test(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, NOW);

    expect(subject.health.recordValidation).toHaveBeenCalledWith(
      FIXTURE_WORKSPACE,
      FIXTURE_CONNECTION,
      "anthropic",
      true,
      expect.objectContaining({ status: "failed", errorClass: "auth" }),
      NOW,
    );
    // Never through the lifecycle's own row writer: one column, one writer.
    expect(subject.connections.update).not.toHaveBeenCalled();
  });

  it("records `provider.tested` with what was found — a success with its latency", async () => {
    await subject.service.test(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, NOW);

    expect(subject.audited).toHaveLength(1);
    expect(subject.audited[0]).toMatchObject({
      action: "provider.tested",
      actorId: FIXTURE_ACTOR,
      subjectId: FIXTURE_CONNECTION,
      detail: expect.objectContaining({ outcome: "success", kind: "anthropic" }) as object,
    });
  });

  it("records a provider's refusal as a failure outcome, with the taxonomy's class", async () => {
    subject.adapter.willFail("rate_limit");

    await subject.service.test(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, NOW);

    expect(subject.audited[0].detail).toMatchObject({
      outcome: "failure",
      reason: "provider_validation_failed",
      error_class: "rate_limit",
    });
  });

  it("records a refusal of the operation itself under the same name — a connection that is not there", async () => {
    subject.connections.find.mockResolvedValue(undefined);

    await expect(
      subject.service.test(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, NOW),
    ).rejects.toMatchObject({ code: "provider_connection_not_found" });

    expect(subject.audited[0]).toMatchObject({
      action: "provider.tested",
      detail: expect.objectContaining({
        outcome: "failure",
        reason: "provider_connection_not_found",
      }) as object,
    });
    expect(subject.validate).not.toHaveBeenCalled();
    expect(subject.health.recordValidation).not.toHaveBeenCalled();
  });

  it("opens no credential for a connection that stores none", async () => {
    subject.connections.envelopeOf.mockResolvedValue(null);

    await subject.service.test(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, NOW);

    expect(subject.validate.mock.calls[0][1]).toBeNull();
  });
});

describe("the discovered catalog — the chips and the flag (#230)", () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
    subject.connections.find.mockResolvedValue(connectionRow());
    subject.connections.envelopeOf.mockResolvedValue(null);
  });

  it("reads what discovery stored, with the aliases the catalog has stranded", async () => {
    subject.discovered.forConnection.mockResolvedValue([
      {
        model_id: "fake/small",
        display: "Fake Small",
        size_bytes: null,
        meta: {},
        discovered_at: NOW,
      },
    ]);
    subject.aliases.aliasesOn.mockResolvedValue([
      { id: "a1", alias: "local-ds", model_id: "fake/gone" },
    ]);

    const catalog = await subject.service.models(FIXTURE_WORKSPACE, FIXTURE_CONNECTION);

    expect(catalog.models.map((model) => model.modelId)).toEqual(["fake/small"]);
    expect(catalog.unlisted).toEqual([
      { modelId: "fake/gone", aliases: [{ id: "a1", alias: "local-ds" }] },
    ]);
    expect(subject.discovered.forConnection).toHaveBeenCalledWith(
      FIXTURE_WORKSPACE,
      FIXTURE_CONNECTION,
    );
    expect(subject.aliases.aliasesOn).toHaveBeenCalledWith(FIXTURE_WORKSPACE, FIXTURE_CONNECTION);
  });

  it("refuses to read a connection this workspace does not have", async () => {
    subject.connections.find.mockResolvedValue(undefined);

    await expect(
      subject.service.models(FIXTURE_WORKSPACE, FIXTURE_CONNECTION),
    ).rejects.toMatchObject({
      code: "provider_connection_not_found",
    });
    expect(subject.discovered.forConnection).not.toHaveBeenCalled();
  });

  it("asks the adapter, replaces the catalog with its answer, and says what changed", async () => {
    subject.discovered.replace.mockResolvedValue(["fake/small", "fake/gone"]);
    subject.discovered.forConnection.mockResolvedValue(
      FAKE_MODELS.map((model) => ({
        model_id: model.id,
        display: model.display,
        size_bytes: model.sizeBytes === null ? null : model.sizeBytes.toString(),
        meta: {},
        discovered_at: NOW,
      })),
    );

    const discovery = await subject.service.discover(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, NOW);

    expect(subject.adapter.calls.discoverModels).toBe(1);
    expect(subject.discovered.replace).toHaveBeenCalledWith(
      FIXTURE_WORKSPACE,
      FIXTURE_CONNECTION,
      [...FAKE_MODELS],
      NOW,
    );
    expect(discovery.added).toEqual(["fake/large"]);
    expect(discovery.removed).toEqual(["fake/gone"]);
    expect(discovery.models.map((model) => model.modelId)).toEqual(["fake/small", "fake/large"]);
  });

  it("leaves the catalog unchanged and answers 502 when the provider did not answer", async () => {
    subject.adapter.willFailDiscovery("network");

    await expect(
      subject.service.discover(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, NOW),
    ).rejects.toMatchObject({
      code: "provider_discovery_failed",
      details: { errorClass: "network", detail: expect.any(String) as string },
    });
    expect(subject.discovered.replace).not.toHaveBeenCalled();
  });

  it("leaves an error that is not the provider's alone", async () => {
    jest.spyOn(subject.adapter, "discoverModels").mockRejectedValue(new TypeError("a bug"));

    await expect(
      subject.service.discover(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, NOW),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("writes no health and no audit event: a refresh is not a check", async () => {
    await subject.service.discover(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, NOW);

    expect(subject.health.recordValidation).not.toHaveBeenCalled();
    expect(subject.audited).toHaveLength(0);
  });

  it("answers 404 when the connection vanished between the read and the write", async () => {
    subject.discovered.replace.mockResolvedValue(undefined);

    await expect(
      subject.service.discover(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, NOW),
    ).rejects.toMatchObject({ code: "provider_connection_not_found" });
  });
});

describe("pulling a model — the route over the tracker (#230)", () => {
  const OLLAMA = connectionRow({
    id: FIXTURE_CONNECTION,
    kind: "ollama",
    base_url: "http://workstation:11434",
  });

  function pulling(adapter: FakePullingProviderAdapter): Harness {
    const subject = harness();
    const registry = new ModelProviderRegistry([adapter]);
    const service = new ProviderConnectionsService(
      subject.connections,
      registry,
      subject.vault,
      subject.aliases as unknown as RegistryService,
      subject.stepUp as unknown as StepUpService,
      subject.limiter,
      new ProviderAudit(recordingAudit().service),
      subject.stats as unknown as RoutingStatsRepository,
      subject.discovered as unknown as ProviderModelsRepository,
      subject.health as unknown as ProviderHealthService,
      subject.tracker,
    );

    subject.connections.find.mockResolvedValue(OLLAMA);
    subject.connections.envelopeOf.mockResolvedValue(null);

    return { ...subject, service };
  }

  it("answers at once with a running record for an idle connection", async () => {
    const subject = pulling(new FakePullingProviderAdapter());

    const record = await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, {
      modelId: "phi4:14b",
    });

    expect(record).toMatchObject({
      connectionId: FIXTURE_CONNECTION,
      modelId: "phi4:14b",
      state: "running",
      finishedAt: null,
    });
  });

  it("reports the stream's progress to a later read — the 61% a reload lands on", async () => {
    const subject = pulling(new FakePullingProviderAdapter());

    await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { modelId: "phi4:14b" });
    await subject.tracker.whenSettled(FIXTURE_CONNECTION, "phi4:14b");

    const { pulls } = await subject.service.pulls(FIXTURE_WORKSPACE, FIXTURE_CONNECTION);

    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({ state: "succeeded", percent: 100, status: "success" });
  });

  it("queues a second model while the first is running, and asks the daemon for nothing yet", async () => {
    const adapter = new GatedPullingAdapter();
    const subject = pulling(adapter);

    const first = await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, {
      modelId: "llama4:scout",
    });
    await flush();
    const second = await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, {
      modelId: "phi4:14b",
    });

    expect(first.state).toBe("running");
    expect(second).toMatchObject({ state: "queued", status: "queued", startedAt: null });
    expect(adapter.calls.pullModel).toBe(1);

    adapter.finish();
    await subject.tracker.whenSettled(FIXTURE_CONNECTION, "llama4:scout");
    await flush();
    adapter.finish();
    await subject.tracker.whenSettled(FIXTURE_CONNECTION, "phi4:14b");

    expect(adapter.calls.pullModel).toBe(2);
  });

  it("answers the existing record for a model already in flight — a double click is one pull", async () => {
    const adapter = new GatedPullingAdapter();
    const subject = pulling(adapter);

    const first = await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, {
      modelId: "llama4:scout",
    });
    const again = await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, {
      modelId: "llama4:scout",
    });
    await flush();

    expect(again.queuedAt).toBe(first.queuedAt);
    expect(adapter.calls.pullModel).toBe(1);

    adapter.finish();
    await subject.tracker.whenSettled(FIXTURE_CONNECTION, "llama4:scout");
  });

  it("refreshes the catalog once when the pull lands, whether or not anybody is watching", async () => {
    const adapter = new GatedPullingAdapter();
    const subject = pulling(adapter);

    await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { modelId: "llama4:scout" });
    await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { modelId: "llama4:scout" });
    expect(subject.discovered.replace).not.toHaveBeenCalled();

    adapter.finish();
    await subject.tracker.whenSettled(FIXTURE_CONNECTION, "llama4:scout");
    await flush();
    await flush();

    expect(adapter.calls.discoverModels).toBe(1);
    expect(subject.discovered.replace).toHaveBeenCalledTimes(1);
  });

  it("does not refresh after a pull that failed — there is nothing new on the host", async () => {
    const failing = new FakePullingProviderAdapter(undefined, []);
    // eslint-disable-next-line @typescript-eslint/require-await
    jest.spyOn(failing, "pullModel").mockImplementation(async function* () {
      yield FAKE_PULL_EVENTS[0];
      throw new ProviderAdapterError("upstream", "the host closed the stream");
    });
    const subject = pulling(failing);

    await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { modelId: "phi4:14b" });
    const settled = await subject.tracker.whenSettled(FIXTURE_CONNECTION, "phi4:14b");
    await flush();

    expect(settled).toMatchObject({ state: "failed", errorClass: "upstream" });
    expect(subject.discovered.replace).not.toHaveBeenCalled();
  });

  it("opens the stream against the row as it stands when the pull starts, not when it was asked for", async () => {
    const subject = pulling(new FakePullingProviderAdapter());
    subject.connections.find.mockResolvedValueOnce(OLLAMA);

    await subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { modelId: "phi4:14b" });
    await subject.tracker.whenSettled(FIXTURE_CONNECTION, "phi4:14b");

    // Once for the request, once when the stream opened.
    expect(subject.connections.find.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a kind that cannot pull as 422, before anything is queued", async () => {
    const subject = harness();
    subject.connections.find.mockResolvedValue(connectionRow());

    await expect(
      subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { modelId: "phi4:14b" }),
    ).rejects.toMatchObject({ code: "provider_kind_cannot_pull" });
    expect(subject.tracker.list(FIXTURE_CONNECTION)).toEqual([]);
  });

  it("refuses to start or read pulls for a connection this workspace does not have", async () => {
    const subject = pulling(new FakePullingProviderAdapter());
    subject.connections.find.mockResolvedValue(undefined);

    await expect(
      subject.service.pull(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, { modelId: "phi4:14b" }),
    ).rejects.toMatchObject({ code: "provider_connection_not_found" });
    await expect(
      subject.service.pulls(FIXTURE_WORKSPACE, FIXTURE_CONNECTION),
    ).rejects.toMatchObject({
      code: "provider_connection_not_found",
    });
  });

  it("answers an empty list for a connection nothing has pulled on", async () => {
    const subject = pulling(new FakePullingProviderAdapter());

    await expect(subject.service.pulls(FIXTURE_WORKSPACE, FIXTURE_CONNECTION)).resolves.toEqual({
      connectionId: FIXTURE_CONNECTION,
      pulls: [],
    });
  });
});
