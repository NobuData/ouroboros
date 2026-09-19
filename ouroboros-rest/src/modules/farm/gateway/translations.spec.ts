import { decode } from "../protocol/protocol";
import type { HeartbeatPayload, JobFinishPayload } from "../protocol/protocol.messages";
import { capabilitiesOf, supportsExecutor } from "./capabilities";
import { fixtureBytes } from "./gateway.fixture";
import { MIB } from "./gateway.policy";
import { isBuilding, telemetryOf } from "./telemetry";
import { terminalState } from "./terminal";

/**
 * The three translations from the wire to V040's columns — capabilities, telemetry and a job's
 * terminal state — each driven from the golden fixtures and then varied a field at a time.
 */

/**
 * A fixture's payload, decoded.
 *
 * @param name - The fixture.
 * @returns Its payload.
 */
function payloadOf<T>(name: string): T {
  const envelope = decode(fixtureBytes(name)).envelope;
  if (!envelope) throw new Error(`${name} did not decode`);

  return envelope.payload as T;
}

describe("capabilities", () => {
  const hello = payloadOf<{ capabilities: Parameters<typeof capabilitiesOf>[0] }>(
    "valid/hello.json",
  );

  it("stores what the hello reported, with the executors dispatch reads derived once", () => {
    expect(capabilitiesOf(hello.capabilities)).toEqual({
      docker: true,
      shell: true,
      ccache: true,
      cpu_count: 8,
      memory_mb: 16384,
      executors: ["container", "shell"],
    });
  });

  it("offers no container executor without a daemon, and no shell executor an operator refused", () => {
    expect(capabilitiesOf({ ...hello.capabilities, docker: false }).executors).toEqual(["shell"]);
    expect(capabilitiesOf({ ...hello.capabilities, shell: false }).executors).toEqual([
      "container",
    ]);
    expect(
      capabilitiesOf({ ...hello.capabilities, docker: false, shell: false }).executors,
    ).toEqual([]);
  });

  it("answers dispatch eligibility from the stored document", () => {
    const stored = capabilitiesOf({ ...hello.capabilities, docker: false });

    expect(supportsExecutor(stored, "shell")).toBe(true);
    expect(supportsExecutor(stored, "container")).toBe(false);
  });

  it("assumes nothing of a runner that has never said", () => {
    for (const unanswered of [
      {},
      null,
      undefined,
      "x",
      { executors: "container" },
      { docker: true },
    ]) {
      expect(supportsExecutor(unanswered, "container")).toBe(false);
    }
  });
});

describe("telemetry", () => {
  const idle = payloadOf<HeartbeatPayload>("valid/heartbeat.json");
  const busy = payloadOf<HeartbeatPayload>("valid/heartbeat-busy.json");

  it("maps a heartbeat onto the five fields the runners table draws", () => {
    expect(telemetryOf(idle)).toEqual({
      cpu_pct: 4.5,
      ram_used_bytes: 1280 * MIB,
      ram_total_bytes: 16384 * MIB,
      queue_depth: 0,
      sampled_at: "2026-09-18T12:00:00.000Z",
    });
  });

  it("clamps used memory to total rather than write a bar past the end of its track", () => {
    expect(telemetryOf({ ...idle, memory_used_mb: 99999 }).ram_used_bytes).toBe(16384 * MIB);
  });

  it("leaves out every measurement the agent could not take — never a zero in its place", () => {
    const unmeasured = payloadOf<HeartbeatPayload>("valid/heartbeat-unmeasured.json");

    expect(telemetryOf(unmeasured)).toEqual({
      queue_depth: 0,
      sampled_at: "2026-09-18T12:00:00.000Z",
    });
  });

  it("leaves out each null measurement on its own, keeping the ones that were taken", () => {
    expect(telemetryOf({ ...idle, cpu_pct: null })).toEqual({
      ram_used_bytes: 1280 * MIB,
      ram_total_bytes: 16384 * MIB,
      queue_depth: 0,
      sampled_at: "2026-09-18T12:00:00.000Z",
    });
    expect(telemetryOf({ ...idle, memory_used_mb: null })).toEqual({
      cpu_pct: 4.5,
      ram_total_bytes: 16384 * MIB,
      queue_depth: 0,
      sampled_at: "2026-09-18T12:00:00.000Z",
    });
  });

  it("keeps a used figure whose total is unknown, with nothing to clamp it to", () => {
    expect(telemetryOf({ ...idle, memory_total_mb: null })).toEqual({
      cpu_pct: 4.5,
      ram_used_bytes: 1280 * MIB,
      queue_depth: 0,
      sampled_at: "2026-09-18T12:00:00.000Z",
    });
  });

  it("keeps a measured zero, which is a reading and not an absence", () => {
    expect(telemetryOf({ ...idle, cpu_pct: 0 }).cpu_pct).toBe(0);
  });

  it("calls a beat that reports a job building, whatever its state", () => {
    expect(isBuilding(idle)).toBe(false);
    expect(isBuilding(busy)).toBe(true);
    expect(isBuilding({ ...busy, state: "draining" })).toBe(true);
    expect(isBuilding({ ...idle, state: "busy" })).toBe(true);
  });
});

describe("a job's terminal state", () => {
  const succeeded = payloadOf<JobFinishPayload>("valid/job-finish.json");
  const failed = payloadOf<JobFinishPayload>("valid/job-finish-failed.json");

  it("finishes a clean build as succeeded, with its ccache converted to bytes", () => {
    expect(terminalState(succeeded)).toEqual({
      status: "succeeded",
      exitCode: 0,
      ccacheStats: { hits: 812, misses: 140, size_bytes: 1024 * MIB, max_size_bytes: 4096 * MIB },
      infrastructure: false,
    });
  });

  it("finishes a failed build as failed with its exit code, and no ccache as null", () => {
    expect(terminalState(failed)).toEqual({
      status: "failed",
      exitCode: failed.exit_code,
      ccacheStats: null,
      infrastructure: false,
    });
  });

  it("lets the exit code win when an agent reports success with a non-zero status", () => {
    expect(terminalState({ ...succeeded, exit_code: 2 })).toMatchObject({
      status: "failed",
      exitCode: 2,
    });
  });

  it("never stores a failure that exited zero, which V040 refuses", () => {
    expect(terminalState({ ...failed, exit_code: 0 })).toMatchObject({
      status: "failed",
      exitCode: null,
    });
    expect(terminalState({ ...failed, outcome: "timed_out", exit_code: 0 }).exitCode).toBeNull();
    expect(terminalState({ ...failed, outcome: "errored", exit_code: 0 }).exitCode).toBeNull();
  });

  it("maps the five outcomes onto the three statuses an agent can cause", () => {
    expect(terminalState({ ...failed, outcome: "cancelled", exit_code: null }).status).toBe(
      "canceled",
    );
    expect(terminalState({ ...failed, outcome: "cancelled", exit_code: 0 })).toMatchObject({
      status: "canceled",
      exitCode: 0,
    });
    expect(terminalState({ ...failed, outcome: "timed_out", exit_code: null }).status).toBe(
      "failed",
    );
    expect(terminalState({ ...failed, outcome: "errored", exit_code: -1 })).toMatchObject({
      status: "failed",
      exitCode: -1,
    });
  });

  it("stores a cache that counted nothing as not measured, rather than 0/0", () => {
    const empty = { hits: 0, misses: 0, hit_rate_pct: 0, size_mb: 0, max_size_mb: 4096 };

    expect(terminalState({ ...succeeded, ccache: empty }).ccacheStats).toBeNull();
  });

  it("classes only an agent that could not run the job as the farm's failure (#252)", () => {
    // The retry policy's one input: `errored` is information about the farm, and is retried;
    // a build that failed or ran out of time is information about the code, and is not.
    expect(terminalState({ ...failed, outcome: "errored", exit_code: null }).infrastructure).toBe(
      true,
    );
    for (const outcome of ["failed", "timed_out", "cancelled"] as const) {
      expect(terminalState({ ...failed, outcome }).infrastructure).toBe(false);
    }
    expect(terminalState(succeeded).infrastructure).toBe(false);
  });
});
