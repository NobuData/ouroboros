import { COMMIT, JOB, RUNNER, jobView } from "./dispatch.fixture";
import { buildJobResource } from "./jobs.resources";

/** A build job as the API returns it (#252). */
describe("the build job resource", () => {
  it("describes a waiting job — nobody's yet, nothing happened", () => {
    expect(buildJobResource(jobView())).toEqual({
      id: JOB,
      number: 479,
      status: "queued",
      pool: "pool-a",
      repository: "acme-robotics/helios-firmware",
      ref: "refs/heads/main",
      commit: COMMIT,
      command: ["west", "build", "-b", "helios_mainboard", "app"],
      commandLine: "west build -b helios_mainboard app",
      executor: "container",
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      label: "zephyr build",
      title: "Add OTA rollback on failed checksum",
      runnerId: null,
      runId: null,
      retryOf: null,
      queuedAt: "2026-09-19T12:00:00.000Z",
      offeredAt: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
    });
  });

  it("describes a retried attempt's successor, on a runner, finished", () => {
    const resource = buildJobResource(
      jobView({
        status: "succeeded",
        runner_id: RUNNER,
        retry_of: "5eed0028-0000-4000-8000-000000000457",
        offered_at: new Date("2026-09-19T12:00:01.000Z"),
        started_at: new Date("2026-09-19T12:00:02.000Z"),
        finished_at: new Date("2026-09-19T12:04:14.000Z"),
        exit_code: 0,
      }),
    );

    expect(resource).toMatchObject({
      status: "succeeded",
      runnerId: RUNNER,
      retryOf: "5eed0028-0000-4000-8000-000000000457",
      offeredAt: "2026-09-19T12:00:01.000Z",
      startedAt: "2026-09-19T12:00:02.000Z",
      finishedAt: "2026-09-19T12:04:14.000Z",
      exitCode: 0,
    });
  });

  it("says null rather than guessing at a stored command it cannot read as argv", () => {
    const resource = buildJobResource(jobView({ command: 'sh -c "make all"' }));

    expect(resource.command).toBeNull();
    expect(resource.commandLine).toBe('sh -c "make all"');
  });
});
