import type { AuditRecord } from "../audit/audit.events";
import { recordingAudit } from "../audit/audit.fixture";
import { COOKIE } from "../auth/http";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import {
  FAKE_CONFIG_SCHEMA,
  FakeModelProviderAdapter,
} from "../providers/adapters/fake.adapter.fixture";
import type { ProviderValidation } from "../providers/provider.adapter";
import {
  BASE_URL_FIELD,
  CAPABILITY_NOTE_FIELD,
  type ProviderConnectionConfig,
} from "../providers/provider.config";
import { ModelProviderRegistry } from "../providers/provider.registry";
import type { RegistryService } from "../registry/registry.service";
import { FOREIGN_KEY_VIOLATION, PROVIDER_DEPENDENCY_CONSTRAINT } from "../registry/registry.errors";
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

interface Harness {
  service: ProviderConnectionsService;
  connections: jest.Mocked<ProviderConnectionsRepository>;
  adapter: FakeModelProviderAdapter;
  vault: VaultService;
  aliases: { dependentAliases: jest.Mock };
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
  } as unknown as jest.Mocked<ProviderConnectionsRepository>;

  const aliases = { dependentAliases: jest.fn().mockResolvedValue([]) };
  const stepUp = { satisfied: jest.fn().mockResolvedValue("password") };
  const limiter = new RevealLimiter();

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
  );

  return { service, connections, adapter, vault, aliases, stepUp, limiter, audited, validate };
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
