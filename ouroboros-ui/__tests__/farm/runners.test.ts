import { describe, expect, it } from "vitest";

import {
  BEARER_FALLBACK_NOTE,
  CPU_OK_BELOW,
  CPU_WARN_FROM,
  DRAIN_REQUESTED,
  FINISHING,
  NEVER_SEEN,
  RUNNER_PILLS,
  UNDRAIN_REQUESTED,
  buildingPill,
  cpuReading,
  intentNote,
  isVouchedFor,
  jobFacts,
  jobNote,
  jobNumber,
  jobSheetLabel,
  lastSeen,
  queueReading,
  ramReading,
  rowAnnouncement,
  runnerActionsLabel,
  runnerRow,
  runnerRows,
  sortRunners,
  uptimeReading,
} from "@/app/farm/runners";
import { NOT_MEASURED } from "@/app/farm/view";

import { FARM_READ_AT, farmRunner, runnerTelemetry, seededFarm } from "../helpers/farm";

/**
 * Every judgement the runners table makes (#257), as functions of small values: which pill a
 * status takes, when the CPU warns, how RAM is written, what is *not* drawn for a machine nobody
 * can hear, and the order the fleet stands in.
 */

/** A gigabyte, decimal — the unit the mockup's `32 GB` machine is `32` in. */
const GB = 1e9;

/** The seeded fleet's names, in the order a grouping puts them. */
function namesIn(grouping: "pool" | "status"): readonly string[] {
  return sortRunners(seededFarm().runners, grouping).map((runner) => runner.name);
}

describe("the status pill", () => {
  it("maps each observed status to the mockup's pill", () => {
    expect(RUNNER_PILLS.building).toEqual({ label: "building", tone: "accent", dot: "pulse" });
    expect(RUNNER_PILLS.online).toEqual({ label: "idle", tone: "neutral", dot: "filled" });
    expect(RUNNER_PILLS.draining).toEqual({ label: "draining", tone: "warn", dot: "filled" });
    expect(RUNNER_PILLS.offline).toEqual({ label: "offline", tone: "err", dot: "filled" });
  });

  it("draws a removed machine, should one ever be served, as a state nobody reports", () => {
    expect(RUNNER_PILLS.removed).toEqual({ label: "removed", tone: "neutral", dot: "ring" });
  });

  it("separates every status by more than hue — no two share a word", () => {
    const labels = Object.values(RUNNER_PILLS).map((pill) => pill.label);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("vouches for exactly the three connected statuses — the ones the stat row counts online", () => {
    expect(["online", "building", "draining"].map((s) => isVouchedFor(s as never))).toEqual([true, true, true]);
    expect(["offline", "removed"].map((s) => isVouchedFor(s as never))).toEqual([false, false]);
  });
});

describe("intent beside the pill (#260)", () => {
  it("says nothing while what was asked and what is observed agree", () => {
    expect(intentNote("online", "active")).toBeNull();
    expect(intentNote("building", "active")).toBeNull();
    expect(intentNote("offline", "active")).toBeNull();
    expect(intentNote("draining", "draining")).toBeNull();
  });

  it.each(["online", "building", "offline"] as const)(
    "says a drain was requested of a machine still reporting %s",
    (status) => {
      // A drain writes intent; the pill is the agent's own heartbeat and follows on the next
      // one. Without the note the click would look like it did nothing.
      expect(intentNote(status, "draining")).toBe(DRAIN_REQUESTED);
    },
  );

  it("says a machine returned to service is on its way back, while it still reports draining", () => {
    expect(intentNote("draining", "active")).toBe(UNDRAIN_REQUESTED);
  });

  it("says nothing about a machine that is gone", () => {
    expect(intentNote("removed", "removed")).toBeNull();
    expect(intentNote("offline", "removed")).toBeNull();
    expect(intentNote("removed", "draining")).toBeNull();
  });
});

describe("last seen", () => {
  it("says how stale an offline row is, in the coarsest honest unit", () => {
    expect(lastSeen("2026-09-19T12:02:00.000Z", FARM_READ_AT)).toBe("last seen 2h ago");
    expect(lastSeen("2026-09-19T14:01:15.000Z", FARM_READ_AT)).toBe("last seen 45s ago");
    expect(lastSeen("2026-09-19T13:50:00.000Z", FARM_READ_AT)).toBe("last seen 12m ago");
    expect(lastSeen("2026-09-16T14:01:59.000Z", FARM_READ_AT)).toBe("last seen 3d ago");
  });

  it("agrees with the stat row's own note about the same machine", () => {
    const page = seededFarm();
    const offline = page.stats.runnersOnline.offline!;

    // `forge-03 offline · 2h` above the table, `last seen 2h ago` in it.
    expect(page.stats.runnersOnline.note).toContain("· 2h");
    expect(lastSeen(offline.lastSeenAt, FARM_READ_AT)).toBe("last seen 2h ago");
  });

  it("says never seen for a machine that enrolled and never connected — enrolment is not a sighting", () => {
    expect(lastSeen(null, FARM_READ_AT)).toBe(NEVER_SEEN);
    expect(lastSeen("not a date", FARM_READ_AT)).toBe(NEVER_SEEN);
  });

  it("reads a sighting from the future — two clocks disagreeing — as just now, never negative", () => {
    expect(lastSeen("2026-09-19T14:05:00.000Z", FARM_READ_AT)).toBe("last seen 0s ago");
  });
});

describe("the CPU cell", () => {
  it("draws the mockup's four figures with the mockup's three treatments", () => {
    expect(cpuReading(82)).toEqual({ text: "82%", meter: 0.82, tone: "warn" });
    expect(cpuReading(54)).toEqual({ text: "54%", meter: 0.54, tone: "accent" });
    expect(cpuReading(6)).toEqual({ text: "6%", meter: 0.06, tone: "ok" });
    expect(cpuReading(3)).toEqual({ text: "3%", meter: 0.03, tone: "ok" });
  });

  it("engages the warn treatment at exactly 80 and not before", () => {
    expect(CPU_WARN_FROM).toBe(80);
    expect(cpuReading(79).tone).toBe("accent");
    expect(cpuReading(80).tone).toBe("warn");
    expect(cpuReading(100).tone).toBe("warn");
    expect(cpuReading(CPU_OK_BELOW - 1).tone).toBe("ok");
    expect(cpuReading(CPU_OK_BELOW).tone).toBe("accent");
  });

  it("decides the tone on the figure it draws, so a number and its colour never disagree", () => {
    expect(cpuReading(79.6)).toEqual({ text: "80%", meter: 0.8, tone: "warn" });
    expect(cpuReading(79.4)).toEqual({ text: "79%", meter: 0.79, tone: "accent" });
  });

  it("draws null as an em dash with no meter — never 0%, and never an empty bar", () => {
    expect(cpuReading(null)).toEqual({ text: NOT_MEASURED, meter: null, tone: "accent" });
    expect(cpuReading(Number.NaN).meter).toBeNull();
  });

  it("keeps a genuine zero a zero: an idle machine is measured, not unmeasured", () => {
    expect(cpuReading(0)).toEqual({ text: "0%", meter: 0, tone: "ok" });
  });

  it("clamps a reading outside 0–100 rather than drawing a bar past its track", () => {
    expect(cpuReading(140).text).toBe("100%");
    expect(cpuReading(-3).text).toBe("0%");
  });
});

describe("the RAM cell", () => {
  it("writes the mockup's figures exactly", () => {
    expect(ramReading(14.2 * GB, 32 * GB)).toBe("14.2/32 GB");
    expect(ramReading(2.1 * GB, 32 * GB)).toBe("2.1/32 GB");
    expect(ramReading(5 * GB, 64 * GB)).toBe("5.0/64 GB");
    expect(ramReading(88 * GB, 256 * GB)).toBe("88/256 GB");
  });

  it("writes the issue's own figures exactly", () => {
    expect(ramReading(8.1 * GB, 16 * GB)).toBe("8.1/16 GB");
    expect(ramReading(3 * GB, 64 * GB)).toBe("3.0/64 GB");
  });

  it("keeps a real machine's uneven total to a tenth", () => {
    // 16 GiB, as an agent reports it.
    expect(ramReading(8.1 * GB, 17_179_869_184)).toBe("8.1/17.2 GB");
  });

  it("draws an em dash without a used figure — never 0 — and the used figure alone without a total", () => {
    expect(ramReading(null, 32 * GB)).toBe(NOT_MEASURED);
    expect(ramReading(null, null)).toBe(NOT_MEASURED);
    expect(ramReading(14.2 * GB, null)).toBe("14.2 GB");
    expect(ramReading(14.2 * GB, 0)).toBe("14.2 GB");
    expect(ramReading(-1, 32 * GB)).toBe(NOT_MEASURED);
  });

  it("keeps a genuine zero a zero", () => {
    expect(ramReading(0, 32 * GB)).toBe("0.0/32 GB");
  });
});

describe("uptime and queue", () => {
  it("writes uptime compactly, as the mockup does", () => {
    expect(uptimeReading(41 * 86_400)).toBe("41d");
    expect(uptimeReading(12 * 86_400)).toBe("12d");
    expect(uptimeReading(3 * 86_400 + 7_000)).toBe("3d");
    expect(uptimeReading(5 * 3_600)).toBe("5h");
  });

  it("draws an em dash with no live report — never 0s", () => {
    expect(uptimeReading(null)).toBe(NOT_MEASURED);
    expect(uptimeReading(Number.NaN)).toBe(NOT_MEASURED);
  });

  it("writes the queue chip, where zero is a genuine count", () => {
    expect(queueReading(2)).toBe("q:2");
    expect(queueReading(0)).toBe("q:0");
    expect(queueReading(-1)).toBe("q:0");
  });
});

describe("the current job", () => {
  it("writes the number with its hash and the label beside it", () => {
    expect(jobNumber(479)).toBe("#479");
    expect(jobNote("zephyr build", "building")).toBe("zephyr build");
  });

  it("says a draining machine's build is finishing, as the mockup does", () => {
    expect(jobNote("HIL test rig", "draining")).toBe(`HIL test rig · ${FINISHING}`);
  });
});

describe("a row", () => {
  it("is the mockup's forge-01, cell for cell", () => {
    const row = runnerRow(seededFarm().runners[0]!, FARM_READ_AT);

    expect(row).toMatchObject({
      name: "forge-01",
      arch: "linux/arm64",
      pool: "pool-a",
      status: "building",
      desiredState: "active",
      intent: null,
      degraded: false,
      dim: false,
      lastSeen: null,
      jobNumber: "#479",
      jobNote: "zephyr build",
      jobTitle: "Add OTA rollback on failed checksum",
      cpu: "82%",
      cpuMeter: 0.82,
      cpuTone: "warn",
      ram: "14.2/32 GB",
      queue: "q:2",
      uptime: "41d",
    });
  });

  it("is the mockup's dimmed forge-03: em dashes, the queue it still holds, and how stale it is", () => {
    const row = runnerRow(seededFarm().runners[4]!, FARM_READ_AT);

    expect(row).toMatchObject({
      name: "forge-03",
      status: "offline",
      dim: true,
      lastSeen: "last seen 2h ago",
      jobNumber: null,
      cpu: NOT_MEASURED,
      cpuMeter: null,
      ram: NOT_MEASURED,
      queue: "q:0",
      uptime: NOT_MEASURED,
    });
  });

  it("does not draw an offline machine's last-known figures as current, whatever the payload carries", () => {
    const stale = farmRunner({
      status: "offline",
      uptimeSeconds: 41 * 86_400,
      telemetry: runnerTelemetry(82, 14.2, 32, 2),
      queueDepth: 2,
    });
    const row = runnerRow(stale, FARM_READ_AT);

    expect([row.cpu, row.ram, row.uptime]).toEqual([NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]);
    expect(row.cpuMeter).toBeNull();
    // The queue is the control plane's count, and is still true.
    expect(row.queue).toBe("q:2");
  });

  it("draws each metric a platform could not report as its own em dash, beside the ones it could", () => {
    const partial = farmRunner({ telemetry: runnerTelemetry(null, 5, 64) });
    const row = runnerRow(partial, FARM_READ_AT);

    expect(row.cpu).toBe(NOT_MEASURED);
    expect(row.cpuMeter).toBeNull();
    expect(row.ram).toBe("5.0/64 GB");
    expect(row.dim).toBe(false);
  });

  it("marks a bearer-fallback connection as degraded, and an mTLS one as not", () => {
    expect(runnerRow(farmRunner({ securityMode: "bearer_fallback" }), FARM_READ_AT).degraded).toBe(true);
    expect(runnerRow(farmRunner({ securityMode: "mtls" }), FARM_READ_AT).degraded).toBe(false);
  });

  it("holds nothing but primitives, which is what lets a cell's memo hold", () => {
    for (const runner of seededFarm().runners) {
      for (const value of Object.values(runnerRow(runner, FARM_READ_AT))) {
        expect(value === null || ["string", "number", "boolean"].includes(typeof value)).toBe(true);
      }
    }
  });
});

describe("the order", () => {
  it("is pool, then name, by default — facts that do not move on a heartbeat", () => {
    expect(namesIn("pool")).toEqual(["forge-01", "forge-02", "forge-03", "anvil-mac", "bigiron"]);
  });

  it("is the mockup's own row order when grouped by status", () => {
    expect(namesIn("status")).toEqual(["forge-01", "forge-02", "anvil-mac", "bigiron", "forge-03"]);
  });

  it("does not depend on the order the fleet was served in", () => {
    const shuffled = [...seededFarm().runners].reverse();

    expect(sortRunners(shuffled, "pool").map((runner) => runner.name)).toEqual(namesIn("pool"));
  });

  it("does not move a row when its machine gets busy — unless the reader grouped by status", () => {
    const busy = seededFarm().runners.map((runner) =>
      runner.name === "anvil-mac" ? { ...runner, status: "building" as const } : runner,
    );

    expect(sortRunners(busy, "pool").map((runner) => runner.name)).toEqual(namesIn("pool"));
    expect(sortRunners(busy, "status").map((runner) => runner.name)).toEqual([
      "forge-01",
      "anvil-mac",
      "forge-02",
      "bigiron",
      "forge-03",
    ]);
  });

  it("is a total order, so two machines that tie on everything still stand still", () => {
    const twins = [farmRunner({ id: "b" }), farmRunner({ id: "a" })];

    expect(sortRunners(twins, "pool").map((runner) => runner.id)).toEqual(["a", "b"]);
    expect(sortRunners([...twins].reverse(), "pool").map((runner) => runner.id)).toEqual(["a", "b"]);
  });

  it("leaves the payload as it found it", () => {
    const page = seededFarm();
    const before = page.runners.map((runner) => runner.name);

    sortRunners(page.runners, "status");

    expect(page.runners.map((runner) => runner.name)).toEqual(before);
  });
});

describe("the rows", () => {
  it("is one per runner served, and none for a page that could not be read", () => {
    expect(runnerRows(seededFarm(), FARM_READ_AT, "pool")).toHaveLength(5);
    expect(runnerRows(null, null, "pool")).toEqual([]);
    // No instant to age a row against is no rows, rather than a clock read behind the caller's back.
    expect(runnerRows(seededFarm(), null, "pool")).toEqual([]);
  });

  it("counts what is building for the card head, and says nothing over a fleet at rest", () => {
    const rows = runnerRows(seededFarm(), FARM_READ_AT, "pool");

    expect(buildingPill(rows)).toBe("1 building");
    expect(buildingPill(rows.filter((row) => row.status !== "building"))).toBeNull();
    expect(buildingPill([])).toBeNull();
  });
});

describe("what is said out loud", () => {
  const rows = runnerRows(seededFarm(), FARM_READ_AT, "status");

  it("announces a row by its identity, its state and its build", () => {
    expect(rowAnnouncement(rows[0]!)).toBe("forge-01, pool-a, building, #479 zephyr build");
    expect(rowAnnouncement(rows[1]!)).toBe("forge-02, pool-a, idle");
  });

  it("says how stale an offline row is", () => {
    expect(rowAnnouncement(rows[4]!)).toBe("forge-03, pool-a, offline, last seen 2h ago");
  });

  it("says what was asked of a machine that has not said so yet (#260)", () => {
    const drained = runnerRow(
      farmRunner({ name: "forge-02", status: "online", desiredState: "draining" }),
      FARM_READ_AT,
    );

    expect(drained).toMatchObject({ desiredState: "draining", intent: DRAIN_REQUESTED });
    expect(rowAnnouncement(drained)).toBe("forge-02, pool-a, idle, drain requested");
    // The seeded bigiron was drained long enough ago that the two agree.
    expect(rows.find((row) => row.name === "bigiron")?.intent).toBeNull();
  });

  it("says the degraded-security mark in words — a shield only the sighted are warned by is half a warning", () => {
    expect(rowAnnouncement(rows[2]!)).toBe("anvil-mac, pool-b, idle, bearer-token fallback");
    expect(BEARER_FALLBACK_NOTE).toMatch(/less secure than mTLS/);
  });

  it("names each row's actions for its machine", () => {
    expect(runnerActionsLabel("forge-01")).toBe("Runner actions for forge-01");
  });
});

describe("the job sheet's facts", () => {
  const clock = (atMs: number) => new Date(atMs).toISOString().slice(11, 16);
  const rows = runnerRows(seededFarm(), FARM_READ_AT, "pool");

  it("lists what the farm reports about a build, and how long it has been running", () => {
    expect(jobFacts(rows[0]!, FARM_READ_AT, clock)).toEqual([
      { term: "Job", value: "#479 zephyr build" },
      { term: "Runner", value: "forge-01 · linux/arm64" },
      { term: "Pool", value: "pool-a" },
      { term: "Started", value: "13:58" },
      { term: "Running for", value: "3m" },
    ]);
  });

  it("lists nothing for a machine running nothing", () => {
    expect(jobFacts(rows[1]!, FARM_READ_AT, clock)).toEqual([]);
  });

  it("draws a start the payload does not carry as an em dash rather than as a guess", () => {
    const unstarted = { ...rows[0]!, jobStartedAt: null };
    const facts = jobFacts(unstarted, FARM_READ_AT, clock);

    expect(facts.slice(-2).map((fact) => fact.value)).toEqual([NOT_MEASURED, NOT_MEASURED]);
  });

  it("names the sheet for its job", () => {
    expect(jobSheetLabel("#479")).toBe("Build job #479");
  });
});
