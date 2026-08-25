import { Logger } from "@nestjs/common";

import { recordingAudit } from "../audit/audit.fixture";
import { COOKIE } from "../auth/http";
import { FIXTURE_USER, principalFor } from "../auth/principal.fixture";
import { namesResponseSecret } from "../internal/no-secret-responses";
import { FakeModelProviderAdapter } from "../providers/adapters/fake.adapter.fixture";
import { BASE_URL_FIELD } from "../providers/provider.config";
import { ModelProviderRegistry } from "../providers/provider.registry";
import { ModelPullTracker } from "../providers/provider.pulls";
import type { RegistryService } from "../registry/registry.service";
import type { ProviderHealthService } from "../provider-health/provider-health.service";
import type { RoutingStatsRepository } from "../routing/stats.repository";
import { inMemoryVault } from "../vault/vault.fixture";
import { ProviderAudit } from "./connection.audit";
import {
  FIXTURE_ACTOR,
  FIXTURE_CONNECTION,
  FIXTURE_SECRET,
  FIXTURE_WORKSPACE,
  connectionRow,
} from "./connection.fixture";
import { SUFFIX_LENGTH } from "./masking";
import type { ProviderConnectionsRepository } from "./provider-connections.repository";
import type { ProviderModelsRepository } from "./provider-models.repository";
import { ProviderConnectionsService } from "./provider-connections.service";
import { RevealLimiter } from "./reveal.limiter";
import type { StepUpService } from "./step-up";

/**
 * The contract test AD.2 asks for: **every list and read payload is grepped for secret
 * material, and finds none**.
 *
 * `resources.ts` is what makes the promise true — the resource shape has nowhere for a
 * credential to go — and this is what keeps it true when somebody adds a field. It works on
 * the *serialized* answer rather than on the object, because a field added to an inner type,
 * or a `toJSON` somebody writes later, would both be invisible to a shape assertion and
 * perfectly visible on the wire.
 *
 * `provider-connections.integration-spec.ts` runs the same grep over the real HTTP responses.
 * Both are worth having: this one covers every operation cheaply and on every run, and that
 * one covers the pipeline that actually serializes them.
 *
 * **The grep is demonstrated to be capable of failing.** A search that could never find
 * anything would pass over a service that returned the key in every field, so the last group
 * points it at the one payload that *does* carry a credential — the reveal — and requires it
 * to fire.
 */

const NOW = new Date("2026-08-23T10:00:00.000Z");
const PRINCIPAL = principalFor(FIXTURE_USER, FIXTURE_WORKSPACE);
const REQUEST = { headers: { [COOKIE]: "better-auth.session_token=abc" } };

/**
 * Every window of the credential longer than the four characters a mask is allowed to show.
 *
 * Windowed rather than "does it contain the whole key", because the mistake that matters is
 * a payload carrying *most* of a credential — a prefix, a truncation, a debug field — and a
 * whole-string search would sail past all of them.
 */
const REVEALING_WINDOWS: string[] = Array.from(
  { length: FIXTURE_SECRET.length - SUFFIX_LENGTH },
  (_value, start) => FIXTURE_SECRET.slice(start, start + SUFFIX_LENGTH + 1),
);

/** Assert that one payload says nothing about the credential it belongs to. */
function expectNoSecretIn(payload: unknown): void {
  const serialized = JSON.stringify(payload);

  expect(serialized).not.toContain(FIXTURE_SECRET);

  for (const window of REVEALING_WINDOWS) {
    expect(serialized).not.toContain(window);
  }

  // The envelope is ciphertext and is not a credential — but it is the stored form of one,
  // and a payload carrying it would mean the sealed column had reached a resource.
  expect(serialized).not.toContain("ouro.v1.");
}

/** Assert that no field name in a payload names credential material. */
function expectNoSecretFieldIn(payload: unknown): void {
  // The word list is `no-secret-responses.mjs`'s — the rule that guards the engine-facing
  // surface. It is not *applied* to this module by ESLint, because a request body here
  // legitimately carries a `secret` and a `password` and the rule cannot tell a request from
  // a response. Borrowing its vocabulary for the answers is the half that is checkable.
  for (const key of Object.keys(payload as Record<string, unknown>)) {
    expect(namesResponseSecret(key)).toBe(false);
  }
}

/** The service, with a real vault holding a real sealed credential. */
async function subject() {
  const { vault } = inMemoryVault();
  const envelope = await vault.encryptText(FIXTURE_WORKSPACE, FIXTURE_CONNECTION, FIXTURE_SECRET);

  const connections = {
    list: jest.fn().mockResolvedValue({ rows: [connectionRow()], total: 1 }),
    find: jest.fn().mockResolvedValue(connectionRow({ base_url: "https://fake.invalid/v1" })),
    envelopeOf: jest.fn().mockResolvedValue(envelope),
    envelopesFor: jest.fn().mockResolvedValue(new Map([[FIXTURE_CONNECTION, envelope]])),
    insert: jest.fn().mockResolvedValue(connectionRow()),
    update: jest.fn().mockResolvedValue(connectionRow()),
    swapCredential: jest.fn().mockResolvedValue(connectionRow()),
    remove: jest.fn().mockResolvedValue(true),
    adderNames: jest.fn().mockResolvedValue(new Map([[FIXTURE_ACTOR, "Ken Suenobu"]])),
  } as unknown as jest.Mocked<ProviderConnectionsRepository>;

  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

  const service = new ProviderConnectionsService(
    connections,
    new ModelProviderRegistry([new FakeModelProviderAdapter({ kind: "anthropic" })]),
    vault,
    { dependentAliases: jest.fn().mockResolvedValue([]) } as unknown as RegistryService,
    { satisfied: jest.fn().mockResolvedValue("password") } as unknown as StepUpService,
    new RevealLimiter(),
    new ProviderAudit(recordingAudit().service),
    { byProvider: jest.fn().mockResolvedValue([]) } as unknown as RoutingStatsRepository,
    {
      forConnection: jest.fn().mockResolvedValue([]),
      replace: jest.fn().mockResolvedValue([]),
    } as unknown as ProviderModelsRepository,
    {
      recordValidation: jest.fn().mockResolvedValue(undefined),
    } as unknown as ProviderHealthService,
    new ModelPullTracker(),
  );

  return { service, connections };
}

describe("what a payload may say about a credential", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says nothing in a listing", async () => {
    const { service } = await subject();

    const page = await service.list(FIXTURE_WORKSPACE, {});

    expect(page.items[0].mask).toBe("••••Xq4A");
    expectNoSecretIn(page);
    expectNoSecretFieldIn(page.items[0]);
  });

  it("says nothing in a read", async () => {
    const { service } = await subject();

    expectNoSecretIn(await service.read(FIXTURE_WORKSPACE, FIXTURE_CONNECTION));
  });

  it("says nothing in the answer to an add, which was handed the credential", async () => {
    // The path most likely to echo one back: the plaintext arrived in the request and is in
    // scope while the answer is built.
    const { service } = await subject();

    expectNoSecretIn(
      await service.add(FIXTURE_WORKSPACE, FIXTURE_ACTOR, {
        kind: "anthropic",
        displayName: "Anthropic Claude",
        config: { [BASE_URL_FIELD]: "https://fake.invalid/v1", apiKey: FIXTURE_SECRET },
      }),
    );
  });

  it("says nothing in the answer to a rotation, which was handed a new one", async () => {
    const { service } = await subject();

    expectNoSecretIn(
      await service.rotate(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, {
        secret: FIXTURE_SECRET,
      }),
    );
  });

  it("says nothing in the answer to an edit, which opened the stored one", async () => {
    const { service } = await subject();

    expectNoSecretIn(
      await service.update(FIXTURE_WORKSPACE, FIXTURE_ACTOR, FIXTURE_CONNECTION, {
        config: { [BASE_URL_FIELD]: "https://elsewhere.invalid/v1" },
      }),
    );
  });

  it("names no field after credential material, anywhere", async () => {
    const { service } = await subject();

    expectNoSecretFieldIn(await service.read(FIXTURE_WORKSPACE, FIXTURE_CONNECTION));
    expectNoSecretFieldIn(
      await service.reveal(FIXTURE_WORKSPACE, PRINCIPAL, REQUEST, FIXTURE_CONNECTION, {}, NOW),
    );
  });
});

describe("the grep is capable of failing", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("finds the credential in the one payload that carries one", async () => {
    // A search that could never find anything would pass over a service that returned the key
    // in every field. The reveal is the deliberate exception, so it is what proves the search
    // works — and every group above is then a real assertion rather than a tautology.
    const { service } = await subject();

    const revealed = await service.reveal(
      FIXTURE_WORKSPACE,
      PRINCIPAL,
      REQUEST,
      FIXTURE_CONNECTION,
      {},
      NOW,
    );

    expect(() => {
      expectNoSecretIn(revealed);
    }).toThrow();
    expect(revealed.value).toBe(FIXTURE_SECRET);
  });
});
