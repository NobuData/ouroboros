import { Logger } from "@nestjs/common";

import type { AppConfigService } from "../config/config.service";
import type { VaultService } from "../vault/vault.service";
import { MAX_CHECKS_PER_SWEEP } from "./cadence";
import { checkFor } from "./checks";
import type { ProviderProbe } from "./probe.client";
import type {
  DueConnection,
  HealthWrite,
  ProviderHealthRepository,
} from "./provider-health.repository";
import { ProviderHealthService, measured } from "./provider-health.service";
import { TRAFFIC_KEY, type ProviderHealthRow } from "./snapshot";

/**
 * The sweep — and the three refusals decision **M8** is made of.
 *
 * Every test below is a version of one sentence: **this service writes only states it
 * observed.** A check that ran writes `active` or `error`; a check that could not run writes
 * *nothing at all*, and the row keeps whatever it had. That is what makes `unknown` a real
 * state rather than a placeholder waiting to be overwritten, and it is what lets Y.4's seeded
 * Copilot chip survive a sweep instead of being flattened by one sixty seconds after the seed
 * ran.
 *
 * The probe is stubbed rather than the network, because what is under test here is the
 * *decision* — which rows are checked, what is written back, and what is deliberately not.
 * Whether a GET is a GET is `probe.client.spec.ts`'s question, and whether the row the sweep
 * wrote satisfies V015's CHECKs is `provider-health.integration-spec.ts`'s.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";
const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
const NOW = new Date("2026-08-23T10:00:00.000Z");

/**
 * The sweep reports what it did, and a deployment fault it declined to blame on a provider.
 * Both are correct in a service and noise in a suite; `restoreMocks` puts the real logger
 * back between tests.
 */
beforeEach(() => {
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

/** A due row, defaulting to a reachable local daemon. */
function due(overrides: Partial<DueConnection> = {}): DueConnection {
  return {
    id: CONNECTION,
    organization_id: WORKSPACE,
    kind: "ollama",
    base_url: "http://workstation:11434",
    health: {},
    has_credential: false,
    ...overrides,
  };
}

/** The repository, as a set of jest functions a test drives. */
function repository(rows: DueConnection[] = []) {
  return {
    due: jest.fn<Promise<DueConnection[]>, unknown[]>().mockResolvedValue(rows),
    sealedCredential: jest.fn<Promise<string | null>, unknown[]>().mockResolvedValue(null),
    record: jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined),
    forOrganization: jest.fn<Promise<ProviderHealthRow[]>, unknown[]>().mockResolvedValue([]),
  };
}

/** A probe that always answers the same way. */
function probing(outcome: Awaited<ReturnType<ProviderProbe["run"]>>) {
  return { run: jest.fn().mockResolvedValue(outcome) };
}

/** The two cadences, as the service reads them. */
const CONFIG = {
  providerHealthIntervalSeconds: 60,
  providerHealthKeyCheckSeconds: 900,
} as unknown as AppConfigService;

/** A vault that opens anything, unless a test says otherwise. */
function vaulting(plaintext = "sk-ant-opened") {
  return { decryptText: jest.fn<Promise<string>, unknown[]>().mockResolvedValue(plaintext) };
}

/** Build the service over the stubs a test cares about. */
function service(parts: {
  connections: ReturnType<typeof repository>;
  probe?: { run: jest.Mock };
  vault?: { decryptText: jest.Mock };
}): ProviderHealthService {
  return new ProviderHealthService(
    parts.connections as unknown as ProviderHealthRepository,
    (parts.probe ?? probing({ ok: true, latencyMs: 4, models: 3 })) as unknown as ProviderProbe,
    (parts.vault ?? vaulting()) as unknown as VaultService,
    CONFIG,
  );
}

/** The write a test is asserting about. */
function written(connections: ReturnType<typeof repository>): HealthWrite {
  return connections.record.mock.calls[0][2] as HealthWrite;
}

describe("which connections a sweep asks about", () => {
  it("asks for the fast cadence's kinds against the interval", async () => {
    const connections = repository();

    await service({ connections }).sweep(NOW);

    expect(connections.due).toHaveBeenCalledWith(
      expect.objectContaining({
        local: {
          kinds: ["ollama", "openai_compatible"],
          before: new Date(NOW.getTime() - 60_000),
        },
      }),
      MAX_CHECKS_PER_SWEEP,
    );
  });

  it("asks for the slow cadence's kinds against a much older cutoff", async () => {
    const connections = repository();

    await service({ connections }).sweep(NOW);

    expect(connections.due).toHaveBeenCalledWith(
      expect.objectContaining({
        cloud: { kinds: ["anthropic"], before: new Date(NOW.getTime() - 900_000) },
      }),
      MAX_CHECKS_PER_SWEEP,
    );
  });

  it("does nothing at all when nothing is due, which is the ordinary cycle", async () => {
    const connections = repository();
    const probe = probing({ ok: true, latencyMs: 4, models: null });

    const report = await service({ connections, probe }).sweep(NOW);

    expect(probe.run).not.toHaveBeenCalled();
    expect(connections.record).not.toHaveBeenCalled();
    expect(report).toEqual({ checked: 0, active: 0, failed: 0, skipped: 0, capped: false });
  });
});

describe("what a performed check writes", () => {
  it("records a reachable daemon as active, with its latency and model count", async () => {
    const connections = repository([due()]);
    const probe = probing({ ok: true, latencyMs: 4, models: 3 });

    await service({ connections, probe }).sweep(NOW);

    expect(probe.run).toHaveBeenCalledWith(
      "http://workstation:11434/api/tags",
      checkFor("ollama"),
      undefined,
    );
    expect(written(connections)).toMatchObject({
      status: "active",
      health: { check: "reachability", models: 3 },
    });
  });

  it("records a stopped daemon as an error, with a reason a person can act on", async () => {
    // The compose-verified criterion, as the decision under it: the stub is stopped, the probe
    // says why, and the chip becomes amber within one cycle.
    const connections = repository([due()]);
    const probe = probing({ ok: false, detail: "unreachable (ECONNREFUSED)" });

    await service({ connections, probe }).sweep(NOW);

    expect(written(connections)).toMatchObject({
      status: "error",
      health: { check: "reachability", detail: "unreachable (ECONNREFUSED)" },
    });
  });

  it("stores no latency for a check that failed", async () => {
    const connections = repository([due()]);
    const probe = probing({ ok: false, detail: "timed out after 5000 ms" });

    await service({ connections, probe }).sweep(NOW);

    expect(written(connections).health).not.toHaveProperty("latency_ms");
  });

  it("stamps the check's own clock, so the strip can say when it last looked", async () => {
    const connections = repository([due()]);

    await service({ connections }).sweep(NOW);

    expect(written(connections).checkedAt).toBeInstanceOf(Date);
  });

  it("keeps a traffic window AB.2 wrote, rather than flattening it every minute", async () => {
    const traffic = { error_rate: 0.02, p95_latency_ms: 910 };
    const connections = repository([due({ health: { [TRAFFIC_KEY]: traffic } })]);

    await service({ connections }).sweep(NOW);

    expect(written(connections).health).toMatchObject({ [TRAFFIC_KEY]: traffic });
  });

  it("never writes `unknown`, because `unknown` is not something a check can observe", async () => {
    const connections = repository([due(), due({ id: "second" })]);
    const probe = probing({ ok: false, detail: "responded 503" });

    await service({ connections, probe }).sweep(NOW);

    for (const call of connections.record.mock.calls) {
      expect((call[2] as HealthWrite).status).not.toBe("unknown");
    }
  });
});

describe("what a sweep declines to check, and therefore declines to write", () => {
  it("leaves a kind with nothing cheap to ask exactly as it found it", async () => {
    // Unreachable through `due`, which asks only for kinds that have a check. Asserted anyway,
    // because this is the guarantee Copilot and Cursor's `unknown` chips rest on and it should
    // not depend on a query somebody could widen.
    const connections = repository([due({ kind: "copilot", base_url: null })]);
    const probe = probing({ ok: true, latencyMs: 4, models: null });

    const report = await service({ connections, probe }).sweep(NOW);

    expect(probe.run).not.toHaveBeenCalled();
    expect(connections.record).not.toHaveBeenCalled();
    expect(report).toMatchObject({ checked: 0, skipped: 1 });
  });

  it("leaves a connection nothing can reach alone", async () => {
    const connections = repository([due({ kind: "ollama", base_url: null })]);

    const report = await service({ connections }).sweep(NOW);

    expect(connections.record).not.toHaveBeenCalled();
    expect(report).toMatchObject({ skipped: 1 });
  });

  it("leaves a cloud connection whose key has not been entered yet alone", async () => {
    // A row mockup 07 has not finished, not a provider that is failing. Marking it `error`
    // would put an administrator's unfinished setup on the strip as an outage.
    const connections = repository([
      due({ kind: "anthropic", base_url: null, has_credential: false }),
    ]);
    const probe = probing({ ok: true, latencyMs: 42, models: null });

    const report = await service({ connections, probe }).sweep(NOW);

    expect(probe.run).not.toHaveBeenCalled();
    expect(connections.record).not.toHaveBeenCalled();
    expect(report).toMatchObject({ skipped: 1 });
  });

  it("leaves a row alone when this deployment cannot open its credential", async () => {
    // The vault failing is this deployment's fault — a database restored without
    // `tenant_keys`, a workspace whose rows outlived its key — and says nothing whatever about
    // Anthropic. Writing `error` would put our own fault on somebody else's chip.
    const connections = repository([due({ kind: "anthropic", has_credential: true })]);
    connections.sealedCredential.mockResolvedValue("ouro.v1.1.nonce.cipher");
    const vault = { decryptText: jest.fn().mockRejectedValue(new Error("no key at version 1")) };
    const probe = probing({ ok: true, latencyMs: 42, models: null });

    const report = await service({ connections, probe, vault }).sweep(NOW);

    expect(probe.run).not.toHaveBeenCalled();
    expect(connections.record).not.toHaveBeenCalled();
    expect(report).toMatchObject({ skipped: 1 });
  });

  it("leaves a row alone when its credential was cleared between the two reads", async () => {
    const connections = repository([due({ kind: "anthropic", has_credential: true })]);
    connections.sealedCredential.mockResolvedValue(null);
    const probe = probing({ ok: true, latencyMs: 42, models: null });

    await service({ connections, probe }).sweep(NOW);

    expect(probe.run).not.toHaveBeenCalled();
    expect(connections.record).not.toHaveBeenCalled();
  });
});

describe("the one plaintext in this module", () => {
  it("is opened against the connection's own id, and handed only to the probe", async () => {
    const connections = repository([
      due({ kind: "anthropic", base_url: null, has_credential: true }),
    ]);
    connections.sealedCredential.mockResolvedValue("ouro.v1.1.nonce.cipher");
    const vault = vaulting("sk-ant-opened");
    const probe = probing({ ok: true, latencyMs: 42, models: null });

    await service({ connections, probe, vault }).sweep(NOW);

    // The record id is the connection's primary key, which is what the envelope's additional
    // data is bound to — see `registry.secrets.ts`.
    expect(vault.decryptText).toHaveBeenCalledWith(WORKSPACE, CONNECTION, "ouro.v1.1.nonce.cipher");
    expect(probe.run).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=1",
      checkFor("anthropic"),
      "sk-ant-opened",
    );
  });

  it("is never asked for on a check that has no use for one", async () => {
    const connections = repository([due({ has_credential: true })]);
    const vault = vaulting();

    await service({ connections, vault }).sweep(NOW);

    expect(connections.sealedCredential).not.toHaveBeenCalled();
    expect(vault.decryptText).not.toHaveBeenCalled();
  });

  it("does not reach the row it validated", async () => {
    const connections = repository([due({ kind: "anthropic", has_credential: true })]);
    connections.sealedCredential.mockResolvedValue("ouro.v1.1.nonce.cipher");
    const probe = probing({ ok: true, latencyMs: 42, models: null });

    await service({ connections, probe, vault: vaulting("sk-ant-opened") }).sweep(NOW);

    expect(JSON.stringify(written(connections))).not.toContain("sk-ant-opened");
  });
});

describe("what a sweep reports", () => {
  it("counts what answered, what did not, and what had nothing to check", async () => {
    const connections = repository([
      due({ id: "a" }),
      due({ id: "b" }),
      due({ id: "c", base_url: null }),
    ]);
    const probe = { run: jest.fn() };
    probe.run
      .mockResolvedValueOnce({ ok: true, latencyMs: 4, models: 3 })
      .mockResolvedValueOnce({ ok: false, detail: "responded 503" });

    const report = await service({ connections, probe }).sweep(NOW);

    expect(report).toEqual({ checked: 2, active: 1, failed: 1, skipped: 1, capped: false });
  });

  it("says out loud when a cycle hit its cap", async () => {
    // A silent truncation reads, from outside, exactly like a sweep that covered everything.
    const connections = repository(
      Array.from({ length: MAX_CHECKS_PER_SWEEP }, (_unused, index) =>
        due({ id: `c${String(index)}` }),
      ),
    );

    const report = await service({ connections }).sweep(NOW);

    expect(report.capped).toBe(true);
    expect(report.checked).toBe(MAX_CHECKS_PER_SWEEP);
  });
});

describe("what the page and the resolver read", () => {
  const row: ProviderHealthRow = {
    id: CONNECTION,
    kind: "ollama",
    display_name: "Ollama",
    base_url: "http://workstation:11434",
    status: "active",
    last_checked_at: NOW,
    health: { check: "reachability", models: 3 },
  };

  it("serves the chips for one workspace", async () => {
    const connections = repository();
    connections.forOrganization.mockResolvedValue([row]);

    const strip = await service({ connections }).strip(WORKSPACE);

    expect(connections.forOrganization).toHaveBeenCalledWith(WORKSPACE);
    expect(strip.providers).toEqual([
      expect.objectContaining({ displayName: "Ollama", meta: "workstation · 3 models" }),
    ]);
  });

  it("serves an empty strip for a workspace with no providers, rather than failing", async () => {
    const connections = repository();

    await expect(service({ connections }).strip(WORKSPACE)).resolves.toEqual({ providers: [] });
  });

  it("serves Z.1 pure inputs — it reads what the sweep wrote and checks nothing", async () => {
    // A resolver that probed while resolving would make routing latency a function of provider
    // latency, and would answer the same question two different ways a second apart.
    const connections = repository();
    connections.forOrganization.mockResolvedValue([row]);
    const probe = probing({ ok: true, latencyMs: 4, models: 3 });

    const snapshots = await service({ connections, probe }).snapshots(WORKSPACE);

    expect(probe.run).not.toHaveBeenCalled();
    expect(snapshots).toEqual([
      expect.objectContaining({
        connectionId: CONNECTION,
        status: "active",
        measured: { check: "reachability", latencyMs: null, models: 3, detail: null },
      }),
    ]);
  });
});

describe("a probe outcome as the keys the column owns", () => {
  it("carries a latency only on success, and only for a check that reports one", () => {
    expect(measured(checkFor("anthropic")!, { ok: true, latencyMs: 42, models: null })).toEqual({
      check: "key_validation",
      latency_ms: 42,
    });
  });

  it("keeps a local daemon's loopback round trip off the row", () => {
    // Measured, and deliberately not published — `ProviderCheck.reportsLatency` argues why a
    // number that never changes is worse on a chip than no number at all.
    expect(measured(checkFor("ollama")!, { ok: true, latencyMs: 4, models: 3 })).toEqual({
      check: "reachability",
      models: 3,
    });
  });

  it("omits a count nothing counted, rather than writing zero", () => {
    expect(
      measured(checkFor("openai_compatible")!, { ok: true, latencyMs: 4, models: null }),
    ).toEqual({ check: "reachability" });
  });

  it("carries only the reason on failure", () => {
    expect(measured(checkFor("anthropic")!, { ok: false, detail: "key rejected (401)" })).toEqual({
      check: "key_validation",
      detail: "key rejected (401)",
    });
  });
});
