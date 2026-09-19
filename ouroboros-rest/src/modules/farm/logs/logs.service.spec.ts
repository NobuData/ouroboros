import type { BuildJobStatus } from "../../db/schema";
import { LOG_PAGE_MAX_BYTES, LOG_POLL_DONE_SECONDS, LOG_POLL_LIVE_SECONDS } from "./log.policy";
import type { LogJob, LogRepository } from "./log.repository";
import type { StoredChunk } from "./log.slice";
import { FarmLogsService } from "./logs.service";

/**
 * The read (#253): a page from an offset, the truthful `live` flag, the tail, the tombstone and
 * the two refusals.
 */

const ORG = "org-farm";
const JOB = "5eed0028-0000-4000-8000-000000000479";
const TEXT = Buffer.from("[6/7] Linking zephyr.elf\n");

/** A job row as the read sees it. */
function logJob(overrides: Partial<LogJob> = {}): LogJob {
  return {
    status: "running",
    logBytes: TEXT.length,
    droppedBytes: 0,
    missingChunks: 0,
    capBytes: 67_108_864,
    sweptAt: null,
    ...overrides,
  };
}

const CHUNK: StoredChunk = { byteStart: 0, content: TEXT, elidedBytes: 0, missingChunks: 0 };

/** A caught throw. */
async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("reading a build log", () => {
  let repository: jest.Mocked<Pick<LogRepository, "logJob" | "chunks">>;
  let logs: FarmLogsService;

  beforeEach(() => {
    repository = {
      logJob: jest.fn().mockResolvedValue(logJob()),
      chunks: jest.fn().mockResolvedValue([CHUNK]),
    };
    logs = new FarmLogsService(repository as unknown as LogRepository);
  });

  it("answers a page from an offset, in the workspace asked for", async () => {
    const page = await logs.read(ORG, JOB, 6);

    expect(repository.logJob).toHaveBeenCalledWith(ORG, JOB);
    expect(repository.chunks).toHaveBeenCalledWith(JOB, 6, LOG_PAGE_MAX_BYTES);
    expect(page).toEqual({
      jobId: JOB,
      offset: 6,
      nextOffset: TEXT.length,
      end: TEXT.length,
      bytes: "Linking zephyr.elf\n",
      live: true,
      elisions: [],
      tail: null,
      retained: true,
      pollAfter: LOG_POLL_LIVE_SECONDS,
    });
  });

  it.each<[BuildJobStatus, boolean]>([
    ["queued", true],
    ["offered", true],
    ["running", true],
    ["succeeded", false],
    ["failed", false],
    ["retried", false],
    ["canceled", false],
  ])("IS LIVE EXACTLY WHILE THE JOB IS NOT FINISHED — %s is live: %s", async (status, live) => {
    repository.logJob.mockResolvedValue(logJob({ status }));

    const page = await logs.read(ORG, JOB, 0);

    expect(page.live).toBe(live);
    expect(page.pollAfter).toBe(live ? LOG_POLL_LIVE_SECONDS : LOG_POLL_DONE_SECONDS);
  });

  it("reports the tail — the cap, the agent's own drops, the lost frames — as one figure", async () => {
    repository.logJob.mockResolvedValue(
      logJob({
        status: "succeeded",
        droppedBytes: 4_200_000,
        missingChunks: 1,
        logBytes: 65_536,
        capBytes: 65_536,
      }),
    );

    const page = await logs.read(ORG, JOB, 0);

    expect(page.tail).toEqual({ bytes: 4_200_000, missingChunks: 1, capped: true });
  });

  it("says a swept log was removed by retention rather than serving an empty one", async () => {
    repository.logJob.mockResolvedValue(
      logJob({ status: "succeeded", sweptAt: new Date("2026-09-19T12:00:00.000Z") }),
    );

    const page = await logs.read(ORG, JOB, 0);

    expect(page).toMatchObject({ retained: false, bytes: "", nextOffset: 0, live: false });
    expect(repository.chunks).not.toHaveBeenCalled();
  });

  it("answers 404 for a job this workspace does not have — another workspace's included", async () => {
    repository.logJob.mockResolvedValue(undefined);

    expect(await refusal(logs.read(ORG, JOB, 0))).toMatchObject({
      status: 404,
      code: "farm_job_not_found",
    });
  });

  it("refuses an offset past the end rather than answering from somewhere else", async () => {
    expect(await refusal(logs.read(ORG, JOB, TEXT.length + 1))).toMatchObject({
      status: 422,
      code: "farm_log_offset_out_of_range",
      details: { end: TEXT.length },
    });
    await expect(logs.read(ORG, JOB, TEXT.length)).resolves.toMatchObject({ bytes: "" });
  });
});
