/**
 * Reading a build log by offset.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)), decision **B8**: chunks in
 * PostgreSQL, served by offset, polled on the polling contract's cadence (`docs/ARCHITECTURE.md`
 * § 5.4, DASH-I.8 #87) and upgraded to SSE by DASH-J.1 (#89) later.
 *
 * **`live` is the job's state, never how recently a chunk arrived.** The card's blinking cursor
 * (AI.6, #261) is bound to it, and a cursor that keeps blinking after a build finished is a small
 * lie; so a finished job answers `live: false` the moment it is finished, even if its last chunk
 * landed a second ago.
 */

import { Injectable } from "@nestjs/common";

import { isTerminal, phaseOf } from "../dispatch/job.states";
import { jobNotFound, logOffsetOutOfRange } from "../farm.errors";
import { LOG_PAGE_MAX_BYTES, LOG_POLL_DONE_SECONDS, LOG_POLL_LIVE_SECONDS } from "./log.policy";
import { LogRepository } from "./log.repository";
import { cutPage } from "./log.slice";
import type { BuildLogResource } from "./logs.resources";

@Injectable()
export class FarmLogsService {
  /**
   * @param repository - The log's statements.
   */
  constructor(private readonly repository: LogRepository) {}

  /**
   * One page of a job's log, from an offset.
   *
   * @param organizationId - The workspace, from the session.
   * @param jobId - The job.
   * @param after - Where to start — the `nextOffset` the reader last reached, or 0.
   * @returns The page.
   * @throws {NotFoundError} `farm_job_not_found` — including for another workspace's job.
   * @throws {InvalidRequestError} `farm_log_offset_out_of_range` when `after` is past the end.
   */
  async read(organizationId: string, jobId: string, after: number): Promise<BuildLogResource> {
    const job = await this.repository.logJob(organizationId, jobId);
    if (!job) throw jobNotFound();
    if (after > job.logBytes) throw logOffsetOutOfRange(job.logBytes);

    const live = !isTerminal(phaseOf({ status: job.status, runner_id: null }));
    const retained = job.sweptAt === null;

    const page = retained
      ? cutPage({
          chunks: await this.repository.chunks(jobId, after, LOG_PAGE_MAX_BYTES),
          offset: after,
          maxBytes: LOG_PAGE_MAX_BYTES,
          end: job.logBytes,
          live,
        })
      : { text: "", nextOffset: after, elisions: [] };

    return {
      jobId,
      offset: after,
      nextOffset: page.nextOffset,
      end: job.logBytes,
      bytes: page.text,
      live,
      elisions: page.elisions,
      tail:
        job.droppedBytes > 0 || job.missingChunks > 0
          ? {
              bytes: job.droppedBytes,
              missingChunks: job.missingChunks,
              capped: job.logBytes >= job.capBytes,
            }
          : null,
      retained,
      pollAfter: live ? LOG_POLL_LIVE_SECONDS : LOG_POLL_DONE_SECONDS,
    };
  }
}
