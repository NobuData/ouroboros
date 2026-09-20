import { describe, expect, it } from "vitest";

import type { FarmRunner } from "@/app/api/farm";
import {
  GROUP_MACHINE,
  GROUP_SECURITY,
  GROUP_TELEMETRY,
  NO_CERTIFICATE_BEARER,
  NO_CERTIFICATE_REVOKED,
  NO_SNAPSHOT,
  type RunnerFact,
  certificateState,
  datedFromNow,
  runnerFacts,
  runnerSheetLabel,
} from "@/app/farm/runner-details";
import { BEARER_FALLBACK_NOTE, DRAIN_REQUESTED } from "@/app/farm/runners";
import { NOT_MEASURED } from "@/app/farm/view";

import { FARM_READ_AT, farmRunner, runnerTelemetry, seededFarm } from "../helpers/farm";

/**
 * What the runner details sheet says (#260): the security mode, the agent version and the
 * certificate's serial and renewal date — *the operational facts a fleet owner needs* — beside
 * the telemetry snapshot, under the table's two rules: stale data is not current, and `null` is
 * not `0`.
 */

/** A date as the suite says it: the ISO day, so the assertions do not depend on a locale. */
function day(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/**
 * One fact from a runner's sheet.
 *
 * @param runner The runner.
 * @param group The group's title.
 * @param term The fact's term.
 * @returns The fact.
 */
function fact(runner: FarmRunner, group: string, term: string): RunnerFact {
  const found = runnerFacts(runner, FARM_READ_AT, day)
    .find((candidate) => candidate.title === group)
    ?.facts.find((candidate) => candidate.term === term);
  if (found === undefined) throw new Error(`no ${term} under ${group}`);

  return found;
}

/**
 * One of the seeded fleet.
 *
 * @param name The runner's name.
 * @returns The runner.
 */
function seeded(name: string): FarmRunner {
  const runner = seededFarm().runners.find((candidate) => candidate.name === name);
  if (runner === undefined) throw new Error(`no seeded ${name}`);

  return runner;
}

describe("the sheet's name", () => {
  it("is the runner's", () => {
    expect(runnerSheetLabel("forge-01")).toBe("Runner forge-01");
  });
});

describe("the machine", () => {
  it("says the agent version — and an em dash for a machine that never connected", () => {
    expect(fact(farmRunner(), GROUP_MACHINE, "Agent version")).toMatchObject({
      value: "0.9.0",
      mono: true,
    });
    expect(fact(farmRunner({ agentVersion: null }), GROUP_MACHINE, "Agent version").value).toBe(
      NOT_MEASURED,
    );
  });

  it("says the status in the pill's word, with what was asked of it beside it", () => {
    expect(fact(seeded("forge-02"), GROUP_MACHINE, "Status").value).toBe("idle");
    expect(
      fact(farmRunner({ status: "building", desiredState: "draining" }), GROUP_MACHINE, "Status").value,
    ).toBe(`building · ${DRAIN_REQUESTED}`);
  });

  it("says when it enrolled and how long ago, against the page's instant and no other clock", () => {
    // 1 August to 19 September.
    expect(fact(farmRunner(), GROUP_MACHINE, "Enrolled").value).toBe("2026-08-01 · 49d ago");
  });

  it("says the last heartbeat the way the row does", () => {
    expect(fact(seeded("forge-03"), GROUP_MACHINE, "Last heartbeat").value).toBe("last seen 2h ago");
    expect(fact(farmRunner({ lastSeenAt: null }), GROUP_MACHINE, "Last heartbeat").value).toBe(
      "never seen",
    );
  });

  it("has no hostname to show for a machine that reported none", () => {
    expect(fact(farmRunner({ hostname: null }), GROUP_MACHINE, "Hostname").value).toBe(NOT_MEASURED);
  });
});

describe("the security mode", () => {
  it("says mTLS plainly", () => {
    const mode = fact(seeded("forge-01"), GROUP_SECURITY, "Security mode");

    expect(mode.value).toBe("mTLS — client certificate");
    expect(mode.tone).toBeUndefined();
  });

  it("says the bearer fallback as a warning, in words and not only in colour", () => {
    // Decision B3: a degraded connection nobody can see is the worst outcome.
    const mode = fact(seeded("anvil-mac"), GROUP_SECURITY, "Security mode");

    expect(mode).toMatchObject({
      value: "Bearer-token fallback",
      tone: "warn",
      note: BEARER_FALLBACK_NOTE,
    });
  });
});

describe("where a certificate stands", () => {
  const certificate = {
    serial: "4a110e98",
    notAfter: "2026-10-30T09:00:00.000Z",
    renewAfter: "2026-09-30T09:00:00.000Z",
  };

  it.each([
    ["2026-09-19T14:02:00.000Z", "valid"],
    ["2026-09-30T08:59:59.999Z", "valid"],
    ["2026-09-30T09:00:00.000Z", "renewal_due"],
    ["2026-10-30T08:59:59.999Z", "renewal_due"],
    ["2026-10-30T09:00:00.000Z", "expired"],
    ["2027-01-01T00:00:00.000Z", "expired"],
  ])("at %s it is %s", (now, state) => {
    expect(certificateState(certificate, Date.parse(now))).toBe(state);
  });

  it("is none for a machine that holds none", () => {
    expect(certificateState(null, FARM_READ_AT)).toBe("none");
  });

  it("does not invent an incident over a stamp that does not parse", () => {
    expect(certificateState({ ...certificate, notAfter: "soon" }, FARM_READ_AT)).toBe("valid");
  });
});

describe("the certificate", () => {
  it("shows the serial and the renewal date of a certificate in good standing", () => {
    const runner = seeded("forge-01");

    expect(fact(runner, GROUP_SECURITY, "Certificate serial")).toMatchObject({
      value: "4a110e97",
      mono: true,
    });
    expect(fact(runner, GROUP_SECURITY, "Certificate expires")).toEqual({
      term: "Certificate expires",
      value: "2026-10-30 · in 40d",
    });
    expect(fact(runner, GROUP_SECURITY, "Renews after")).toEqual({
      term: "Renews after",
      value: "2026-09-30 · in 10d",
    });
  });

  it("says renewal is due for a machine that has been off through its window", () => {
    const renews = fact(seeded("forge-03"), GROUP_SECURITY, "Renews after");

    expect(renews.value).toBe("2026-09-10 · 9d ago");
    expect(renews.tone).toBe("warn");
    expect(renews.note).toMatch(/Renewal is due/u);
    // Not expired yet, so the expiry is drawn plainly.
    expect(fact(seeded("forge-03"), GROUP_SECURITY, "Certificate expires").tone).toBeUndefined();
  });

  it("says a live certificate has expired rather than hiding that it has", () => {
    // Live is not valid — the dev seed's `bigiron` enrolled ninety-five days ago.
    const expires = fact(seeded("bigiron"), GROUP_SECURITY, "Certificate expires");

    expect(expires.value).toBe("2026-09-14 · 5d ago");
    expect(expires.tone).toBe("err");
    expect(expires.note).toMatch(/Expired/u);
    // The renewal date is past too, and the louder fact is the one that carries the tone.
    expect(fact(seeded("bigiron"), GROUP_SECURITY, "Renews after").tone).toBeUndefined();
  });

  it("says a bearer-fallback machine holds none, and why", () => {
    const security = runnerFacts(seeded("anvil-mac"), FARM_READ_AT, day).find(
      (group) => group.title === GROUP_SECURITY,
    );

    expect(security?.facts.map((entry) => entry.term)).toEqual(["Security mode", "Certificate"]);
    expect(fact(seeded("anvil-mac"), GROUP_SECURITY, "Certificate")).toMatchObject({
      value: NO_CERTIFICATE_BEARER,
      tone: "warn",
    });
  });

  it("says an mTLS machine with none has had it revoked", () => {
    expect(fact(farmRunner({ certificate: null }), GROUP_SECURITY, "Certificate").value).toBe(
      NO_CERTIFICATE_REVOKED,
    );
  });
});

describe("the telemetry snapshot", () => {
  it("reads the row's own figures, and tells the two queues apart", () => {
    const runner = seeded("forge-01");

    expect(fact(runner, GROUP_TELEMETRY, "CPU").value).toBe("82%");
    expect(fact(runner, GROUP_TELEMETRY, "RAM").value).toBe("14.2/32 GB");
    expect(fact(runner, GROUP_TELEMETRY, "Queue (control plane)").value).toBe("q:2");
    expect(fact(runner, GROUP_TELEMETRY, "Queue (agent reported)").value).toBe("2");
    expect(fact(runner, GROUP_TELEMETRY, "Uptime").value).toBe("41d");
  });

  it("draws a metric the agent could not collect as an em dash, never as zero", () => {
    const runner = farmRunner({
      telemetry: { ...runnerTelemetry(3, 2.1, 32), cpuPct: null, queueDepth: null },
    });

    expect(fact(runner, GROUP_TELEMETRY, "CPU").value).toBe(NOT_MEASURED);
    expect(fact(runner, GROUP_TELEMETRY, "Queue (agent reported)").value).toBe(NOT_MEASURED);
  });

  it("says how old the sample is", () => {
    const runner = farmRunner({
      telemetry: { ...runnerTelemetry(3, 2.1, 32), sampledAt: "2026-09-19T14:01:53.000Z" },
    });

    expect(fact(runner, GROUP_TELEMETRY, "Sampled").value).toBe("7s ago");
  });

  it("has no snapshot for a machine the fleet cannot vouch for — whatever the payload carries", () => {
    // An offline row that still carried a snapshot would be a two-hour-old reading drawn as
    // current. The sheet keeps the table's rule.
    const stale = farmRunner({ status: "offline", telemetry: runnerTelemetry(82, 14.2, 32, 2) });
    const snapshot = runnerFacts(stale, FARM_READ_AT, day).find(
      (group) => group.title === GROUP_TELEMETRY,
    );

    expect(snapshot?.facts).toEqual([{ term: "Snapshot", value: NO_SNAPSHOT }]);
  });
});

describe("a date with how far off it is", () => {
  it("says a future date as in, and a past one as ago", () => {
    expect(datedFromNow("2026-09-20T14:02:00.000Z", FARM_READ_AT, day)).toBe("2026-09-20 · in 1d");
    expect(datedFromNow("2026-09-19T13:02:00.000Z", FARM_READ_AT, day)).toBe("2026-09-19 · 1h ago");
  });

  it("is an em dash for a stamp that does not parse", () => {
    expect(datedFromNow("not a date", FARM_READ_AT, day)).toBe(NOT_MEASURED);
  });
});
