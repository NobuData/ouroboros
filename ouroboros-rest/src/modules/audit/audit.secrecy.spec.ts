import { COOKIE } from "../auth/http";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import {
  FIXTURE_ACTOR,
  FIXTURE_CONNECTION,
  FIXTURE_SECRET,
  FIXTURE_WORKSPACE,
  connectionRow,
} from "../provider-connections/connection.fixture";
import { ProviderAudit } from "../provider-connections/connection.audit";
import type { ProviderConnectionsRepository } from "../provider-connections/provider-connections.repository";
import { ProviderConnectionsService } from "../provider-connections/provider-connections.service";
import { RevealLimiter } from "../provider-connections/reveal.limiter";
import type { StepUpService } from "../provider-connections/step-up";
import { FakeModelProviderAdapter } from "../providers/adapters/fake.adapter.fixture";
import { BASE_URL_FIELD } from "../providers/provider.config";
import { ModelProviderRegistry } from "../providers/provider.registry";
import type { RegistryService } from "../registry/registry.service";
import type { RoutingStatsRepository } from "../routing/stats.repository";
import { DENIED_WORDS } from "../vault/no-secret-logging";
import { inMemoryVault } from "../vault/vault.fixture";
import { LeaseAudit } from "../internal/lease.audit";
import { LEASE_GRANTED_EVENT } from "./audit.events";
import { recordingAudit } from "./audit.fixture";

/**
 * **The grep test.** AD.4's second acceptance criterion, in the form that issue asks for:
 * *a grep test over written events finds no secret material anywhere in the detail payloads*
 * — over the rows a full credential lifecycle **actually writes**, rather than over a payload
 * this file composed to be clean.
 *
 * That distinction is the whole reason the suite exists. `connection.audit.spec.ts` asserts
 * what each builder puts in a record, which is a claim about a method; this drives the real
 * `ProviderConnectionsService` through add, reveal, rotate, edit and delete with a real vault
 * sealing a real-shaped credential, and greps whatever came out. A builder that started
 * copying a mask into a payload would pass that suite by construction and fail this one.
 *
 * ---------------------------------------------------------------------------
 * **Three scans, not one keyword sweep**, and the reason is the same one `ouroboros-db`'s
 * `tests/seed.sql` gives for splitting its own version: a single
 * `~* 'password|token|secret'` over the rendered row is the check that looks strictest and is
 * worth least. It fires on `{"step_up": "password"}` — the *name of a re-authentication
 * method*, and the single most important field an audit of a reveal carries — and a check
 * that has to be weakened the first time it is right about nothing gets weakened until it is
 * right about nothing at all.
 *
 * So they are separated by what they are actually about:
 *
 *   1. **No credential ever appears**, checked against the literal value the fixture sealed
 *      and against every prefix and suffix of it long enough to be a leak. This is the one
 *      that would catch a mask, a truncation, or an envelope fragment.
 *   2. **No field is named as a credential field**, checked against the vault's own
 *      `DENIED_WORDS` over the payload's *keys* — which is where `step_up` and `password`
 *      stop being the same string.
 *   3. **Every payload is flat and scalar**, which is what makes the first two exhaustive
 *      rather than top-level-only.
 *
 * The vocabulary in (2) is the vault's rather than a list typed here, so a word added where
 * this codebase decides what "secret material" means tightens this test too.
 */

const NOW = new Date("2026-08-23T10:00:00.000Z");
const REQUEST = { headers: { [COOKIE]: "better-auth.session_token=abc" } };
const PRINCIPAL = principalFor(FIXTURE_USER, FIXTURE_WORKSPACE);
const CONFIG = { [BASE_URL_FIELD]: "https://fake.invalid/v1", apiKey: FIXTURE_SECRET };

/** A second credential, so a rotation seals something the add did not. */
const ROTATED_SECRET = "sk-ant-api03-alsonotreal-F00DFACEBEEF9zZ1";

/**
 * Drive every credential operation there is, successes and refusals alike, and collect the
 * rows.
 *
 * @returns Every record the lifecycle wrote, in order.
 */
async function everythingThatCanBeRecorded() {
  const trail = recordingAudit();
  const { vault } = inMemoryVault();
  const adapter = new FakeModelProviderAdapter({ kind: "anthropic" });
  // The stored row carries the address, because a rotation re-validates the *stored* config
  // against the live provider and the fake's schema requires one — a row with no address
  // would refuse every rotation for a reason that has nothing to do with this suite.
  const stored = connectionRow({ base_url: "https://fake.invalid/v1" });
  const connections = {
    find: jest.fn().mockResolvedValue(stored),
    envelopeOf: jest.fn(),
    insert: jest.fn().mockResolvedValue(stored),
    update: jest.fn().mockResolvedValue(stored),
    swapCredential: jest.fn().mockResolvedValue(stored),
    remove: jest.fn().mockResolvedValue(true),
    adderNames: jest.fn().mockResolvedValue(new Map()),
  } as unknown as jest.Mocked<ProviderConnectionsRepository>;

  const service = new ProviderConnectionsService(
    connections,
    new ModelProviderRegistry([adapter]),
    vault,
    { dependentAliases: jest.fn().mockResolvedValue([]) } as unknown as RegistryService,
    { satisfied: jest.fn().mockResolvedValue("password") } as unknown as StepUpService,
    new RevealLimiter(),
    new ProviderAudit(trail.service),
    { byProvider: jest.fn().mockResolvedValue([]) } as unknown as RoutingStatsRepository,
  );

  // The envelope a reveal and a rotation open is a *real* one: the in-memory vault seals the
  // fixture credential with real AES-256-GCM, so what those paths hold in memory is the
  // credential itself rather than a stub that could not leak.
  connections.envelopeOf.mockResolvedValue(
    await vault.encryptText(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, FIXTURE_SECRET),
  );

  await service.add(FIXTURE_WORKSPACE, FIXTURE_ACTOR, {
    kind: "anthropic",
    displayName: "Anthropic Claude",
    config: CONFIG,
  });
  await service.reveal(FIXTURE_WORKSPACE, PRINCIPAL, REQUEST, FIXTURE_CONNECTION, {}, NOW);
  await service.rotate(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, {
    secret: ROTATED_SECRET,
  });
  await service.update(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, { enabled: false });
  await service.update(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, {
    monthlyCapCents: 60_000,
  });
  await service.update(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, {
    displayName: "Anthropic",
    monthlyCapCents: 90_000,
  });
  await service.remove(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION);

  // And the refusals, which AD.4 records too. A provider that rejects the credential is the
  // path where a service most plausibly reaches for the value to explain itself with.
  adapter.willFail("auth").willFail("auth");

  await expect(
    service.add(FIXTURE_WORKSPACE, FIXTURE_ACTOR, {
      kind: "anthropic",
      displayName: "Anthropic Claude",
      config: CONFIG,
    }),
  ).rejects.toThrow();
  await expect(
    service.rotate(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, {
      secret: ROTATED_SECRET,
    }),
  ).rejects.toThrow();

  // AD.3's grant, which is the tenth name in the vocabulary and the one written elsewhere.
  await new LeaseAudit(trail.service).granted({
    id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
    organizationId: FIXTURE_WORKSPACE,
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    grantedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 900_000),
  });

  return trail.records;
}

describe("what a full credential lifecycle writes down", () => {
  it("writes exactly one event per operation, refusals included", async () => {
    // Seven completions, two refusals and one lease grant. Asserted first because every scan
    // below is only as strong as the number of rows it has to scan — a lifecycle that
    // silently recorded three things would pass all three of them.
    // Ten operations, ten rows — and *ten* is the assertion rather than *at least ten*.
    // `recording()` writes a refusal for anything an operation throws, so a statement that
    // could throw after a successful audit write would leave two rows describing one
    // operation; the service builds every resource before it records, which is what makes
    // the audit call the last fallible statement in all five.
    const records = await everythingThatCanBeRecorded();

    expect(records).toHaveLength(10);
    expect(new Set(records.map((record) => record.action))).toEqual(
      new Set([
        "provider.added",
        "provider.revealed",
        "provider.rotated",
        "provider.disabled",
        "provider.cap_changed",
        "provider.updated",
        "provider.deleted",
        LEASE_GRANTED_EVENT,
      ]),
    );
  });

  it("never contains a credential, a fragment of one, or an envelope", async () => {
    // The scan that would catch a mask, a truncation or an envelope prefix. Every substring
    // of eight characters or more is looked for, because a *partial* key in an unprunable
    // table is a leak with extra steps — and the mask `••••Xq4A` publishes four of them by
    // design, which is why eight is the floor rather than four.
    const records = await everythingThatCanBeRecorded();
    const rendered = JSON.stringify(records);

    for (const credential of [FIXTURE_SECRET, ROTATED_SECRET]) {
      for (let length = credential.length; length >= 8; length -= 1) {
        for (let start = 0; start + length <= credential.length; start += 1) {
          expect(rendered).not.toContain(credential.slice(start, start + length));
        }
      }
    }

    expect(rendered).not.toContain("ouro.v1.");
  });

  it("names no field the vault calls secret material", async () => {
    // Over the payload's *keys*, which is where `step_up` and `password` stop being the same
    // string — see this file's header on why that separation is the point.
    const records = await everythingThatCanBeRecorded();

    for (const record of records) {
      for (const field of Object.keys(record.detail ?? {})) {
        for (const word of DENIED_WORDS) {
          expect(field.toLowerCase()).not.toContain(word);
        }
      }
    }
  });

  it("keeps every payload flat and scalar, so enumerating its keys is the whole of reading it", async () => {
    // What makes the two scans above exhaustive rather than top-level-only. A nested object
    // would be somewhere for a credential to hide from a key scan.
    const records = await everythingThatCanBeRecorded();

    for (const record of records) {
      for (const value of Object.values(record.detail ?? {})) {
        expect(value === null || typeof value !== "object").toBe(true);
      }
    }
  });

  it("carries the one field that reads like a credential and is not", async () => {
    // The exemption, asserted positively rather than left as a gap in the scans above:
    // `step_up: "password"` is the *method* somebody proved themselves with, published in the
    // `401` challenge's own `details.methods`. A trail that could not say which method opened
    // a key would be missing the fact an audit of a reveal exists to capture.
    const records = await everythingThatCanBeRecorded();
    const revealed = records.find((record) => record.action === "provider.revealed");

    expect(revealed?.detail).toMatchObject({ step_up: "password" });
  });
});
