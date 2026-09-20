import type { RunnerCertificate } from "../../db/schema";
import { buildJob, runnerPool } from "../dispatch/dispatch.fixture";
import { FIXTURE_ORGANIZATION, FIXTURE_RUNNER, runner } from "../farm.fixture";
import { RENEWAL_LEAD_MS } from "../farm.policy";
import { liveBuildResource, poolResource, runnerResource } from "./fleet.resources";

/**
 * Row → resource, and the one property worth asserting rather than reading: **`null` is the
 * mockup's em-dash, and nothing here substitutes a zero for it**.
 *
 * A `0%` CPU meter on a machine nobody has heard from is the single most misleading thing
 * this payload could say, and it is exactly what a mapper that defaulted a missing field
 * would produce.
 */

describe("a runner", () => {
  it("carries everything the runners table draws", () => {
    const row = runner({
      name: "forge-01",
      status: "building",
      last_seen_at: new Date("2026-09-19T11:59:56.000Z"),
      agent_version: "1.0.0",
      hostname: "forge-01.acme.internal",
      uptime_seconds: "3542400",
      capabilities: { docker: true, cpu_count: 8 },
      telemetry: {
        cpu_pct: 82,
        ram_used_bytes: 14_200_000_000,
        ram_total_bytes: 32_000_000_000,
        queue_depth: 2,
      },
    });

    const resource = runnerResource({
      runner: row,
      poolName: "pool-a",
      queueDepth: 2,
      currentJob: buildJob({
        number: 479,
        status: "running",
        started_at: new Date("2026-09-19T11:56:19.000Z"),
      }),
      certificate: undefined,
    });

    expect(resource).toMatchObject({
      name: "forge-01",
      arch: "linux/arm64",
      pool: "pool-a",
      status: "building",
      desiredState: "active",
      securityMode: "mtls",
      agentVersion: "1.0.0",
      hostname: "forge-01.acme.internal",
      uptimeSeconds: 3_542_400,
      queueDepth: 2,
      capabilities: { docker: true, cpu_count: 8 },
    });
    expect(resource.telemetry).toEqual({
      cpuPct: 82,
      ramUsedBytes: 14_200_000_000,
      ramTotalBytes: 32_000_000_000,
      queueDepth: 2,
      sampledAt: null,
    });
    expect(resource.currentJob).toEqual({
      id: buildJob().id,
      number: 479,
      label: "zephyr build",
      title: "Add OTA rollback on failed checksum",
      startedAt: "2026-09-19T11:56:19.000Z",
    });
  });

  it("prints em-dashes for an offline machine rather than zeros", () => {
    // The mockup's `forge-03` row: `—` for CPU, RAM and uptime. V040 clears both columns when
    // the presence sweep flips a runner, precisely so a stale snapshot cannot render as fresh.
    const resource = runnerResource({
      runner: runner({
        name: "forge-03",
        status: "offline",
        last_seen_at: new Date("2026-09-19T10:00:00.000Z"),
        uptime_seconds: null,
        telemetry: {},
      }),
      poolName: "pool-a",
      queueDepth: 0,
      currentJob: undefined,
      certificate: undefined,
    });

    expect(resource.telemetry).toBeNull();
    expect(resource.uptimeSeconds).toBeNull();
    expect(resource.currentJob).toBeNull();
    // A count, though — nothing is waiting on it, and that is a measurement.
    expect(resource.queueDepth).toBe(0);
  });

  it("returns no snapshot at all rather than a record of nulls", () => {
    // So a client can ask *is there one* once, instead of five times.
    const resource = runnerResource({
      runner: runner({ telemetry: {} }),
      poolName: "pool-a",
      queueDepth: 0,
      currentJob: undefined,
      certificate: undefined,
    });

    expect(resource.telemetry).toBeNull();
  });

  it("leaves a field the agent did not send null inside a snapshot that exists", () => {
    // A partial heartbeat is still a heartbeat. The cell the agent said nothing about is the
    // one that gets the em-dash.
    const resource = runnerResource({
      runner: runner({ status: "online", telemetry: { cpu_pct: 3 } }),
      poolName: "pool-a",
      queueDepth: 0,
      currentJob: undefined,
      certificate: undefined,
    });

    expect(resource.telemetry).toEqual({
      cpuPct: 3,
      ramUsedBytes: null,
      ramTotalBytes: null,
      queueDepth: null,
      sampledAt: null,
    });
  });

  it("says a machine that has never connected has never been seen", () => {
    expect(
      runnerResource({
        runner: runner({ last_seen_at: null }),
        poolName: "pool-a",
        queueDepth: 0,
        currentJob: undefined,
        certificate: undefined,
      }).lastSeenAt,
    ).toBeNull();
  });

  it("publishes the bearer fallback rather than hiding it", () => {
    // Decision B3. AI.2 renders this as visibly degraded; a resource that omitted it would
    // leave a green shield over the weaker mode.
    expect(
      runnerResource({
        runner: runner({ security_mode: "bearer_fallback", cert_serial: null }),
        poolName: "pool-b",
        queueDepth: 0,
        currentJob: undefined,
        certificate: undefined,
      }).securityMode,
    ).toBe("bearer_fallback");
  });

  it("carries no sealed secret, and no serial outside the certificate it names", () => {
    // The sealed bearer token has no field it could occupy, which is `farm.resources.ts`'s
    // posture inherited. The row's own `cert_serial` column is not mapped either: since #260
    // the serial an operator reads is the **live certificate's**, under `certificate`, so a
    // machine whose certificate was revoked cannot go on printing the serial it used to hold.
    const resource = runnerResource({
      runner: runner({ bearer_sealed: "ouro.v1.1.abc.def", security_mode: "bearer_fallback" }),
      poolName: "pool-b",
      queueDepth: 0,
      currentJob: undefined,
      certificate: undefined,
    });

    expect(JSON.stringify(resource)).not.toContain("ouro.v1");
    expect(Object.keys(resource)).not.toContain("certSerial");
    expect(Object.keys(resource)).not.toContain("bearerSealed");
  });

  describe("the certificate it presents (#260)", () => {
    /** A live certificate row — neither revoked nor superseded. */
    function liveCertificate(overrides: Partial<RunnerCertificate> = {}): RunnerCertificate {
      return {
        id: "5eed002a-0000-4000-8000-000000000001",
        organization_id: FIXTURE_ORGANIZATION,
        runner_id: FIXTURE_RUNNER,
        serial: "4a110e97",
        fingerprint: "ab".repeat(32),
        issued_for: "enrollment",
        not_before: new Date("2026-07-01T00:00:00.000Z"),
        not_after: new Date("2026-09-29T00:00:00.000Z"),
        issued_at: new Date("2026-07-01T00:00:00.000Z"),
        revoked: false,
        revoked_at: null,
        revoked_by: null,
        revocation_reason: null,
        superseded_at: null,
        ...overrides,
      };
    }

    /**
     * @param certificate - What the fleet read for this runner.
     * @returns The resource's `certificate`.
     */
    function certificateOf(certificate: RunnerCertificate | undefined) {
      return runnerResource({
        runner: runner(),
        poolName: "pool-a",
        queueDepth: 0,
        currentJob: undefined,
        certificate,
      }).certificate;
    }

    it("is the serial and the two dates the details sheet prints, and nothing else", () => {
      expect(certificateOf(liveCertificate())).toEqual({
        serial: "4a110e97",
        notAfter: "2026-09-29T00:00:00.000Z",
        renewAfter: "2026-08-30T00:00:00.000Z",
      });
    });

    it("derives the renewal date by the rule the agent was handed", () => {
      // `renewAfter` is never stored. Deriving it from `RENEWAL_LEAD_MS` — rather than
      // repeating thirty days here — is what keeps the date an operator reads and the date
      // the agent acts on from drifting apart when the policy moves.
      const notAfter = new Date("2027-01-15T08:30:00.000Z");
      const reference = certificateOf(liveCertificate({ not_after: notAfter }));

      expect(reference?.renewAfter).toBe(
        new Date(notAfter.getTime() - RENEWAL_LEAD_MS).toISOString(),
      );
    });

    it("is null for a machine that holds none, never an empty record", () => {
      // A bearer-fallback runner has no certificate by construction (decision B3), and a
      // removal revokes the one a retired machine held. A client asks *is there one* once.
      expect(certificateOf(undefined)).toBeNull();
    });

    it("prints an expired certificate as it stands", () => {
      // Live is not valid: a machine switched off for a quarter still holds a certificate
      // whose `not_after` has passed — the seed's `bigiron` does — and hiding it would make
      // the sheet say *no certificate* about a machine that has one and cannot use it.
      const expired = certificateOf(
        liveCertificate({ not_after: new Date("2026-01-01T00:00:00.000Z") }),
      );

      expect(expired?.notAfter).toBe("2026-01-01T00:00:00.000Z");
    });

    it("carries no fingerprint and no key material", () => {
      const reference = certificateOf(liveCertificate());

      expect(Object.keys(reference ?? {}).sort()).toEqual(["notAfter", "renewAfter", "serial"]);
    });
  });

  it("narrows the bigint uptime without turning null into zero", () => {
    // `pg` hands a bigint over as text so a 64-bit value cannot be silently rounded; uptime
    // in seconds is nowhere near that, and null has to survive the narrowing.
    const withUptime = runnerResource({
      runner: runner({ uptime_seconds: "0" }),
      poolName: "pool-a",
      queueDepth: 0,
      currentJob: undefined,
      certificate: undefined,
    });

    expect(withUptime.uptimeSeconds).toBe(0);
    expect(withUptime.uptimeSeconds).not.toBeNull();
  });
});

describe("a pool", () => {
  it("carries the card's metadata and its runner count", () => {
    expect(
      poolResource({
        pool: runnerPool({ env_allowlist: ["CCACHE_DIR"], tags: ["firmware"] }),
        runners: 3,
      }),
    ).toEqual({
      id: runnerPool().id,
      name: "pool-a",
      description: "firmware builds",
      executor: "container",
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      enabled: true,
      maxConcurrency: 2,
      envAllowlist: ["CCACHE_DIR"],
      tags: ["firmware"],
      defaultCommand: "west build -b helios_mainboard app",
      autoscalePref: {},
      runners: 3,
    });
  });

  it("returns the auto-scale preference exactly as stored", () => {
    // The acceptance criterion — *persists and is returned unchanged*. Decision B9 makes it
    // inert, and a mapper that renamed its keys would be this service having an opinion about
    // a document it does not act on.
    const stored = { enabled: false, queue_threshold: 5 };

    expect(
      poolResource({ pool: runnerPool({ autoscale_pref: stored }), runners: 3 }),
    ).toMatchObject({ autoscalePref: { enabled: false, queue_threshold: 5 } });
  });

  it("is a pool with zero runners rather than a pool that has vanished", () => {
    expect(poolResource({ pool: runnerPool(), runners: 0 }).runners).toBe(0);
  });
});

describe("the live build", () => {
  it("carries what the LIVE card's head prints", () => {
    expect(
      liveBuildResource(
        buildJob({
          number: 479,
          status: "running",
          runner_id: "7f000002-0000-4000-8000-000000000001",
          started_at: new Date("2026-09-19T11:56:19.000Z"),
        }),
        "forge-01",
      ),
    ).toEqual({
      id: buildJob().id,
      number: 479,
      label: "zephyr build",
      title: "Add OTA rollback on failed checksum",
      runner: "forge-01",
      runnerId: "7f000002-0000-4000-8000-000000000001",
      startedAt: "2026-09-19T11:56:19.000Z",
    });
  });
});
