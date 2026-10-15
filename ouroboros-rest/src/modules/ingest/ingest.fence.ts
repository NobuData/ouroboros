/**
 * The execution epoch's fence — ADR decision A's rule that a worker which lost a run to a newer
 * start cannot write into it (#160).
 *
 * Every run-scoped write takes the run's lock first, so the epoch read here is the one the write
 * commits under: a start that bumps the epoch either committed before this write locked the run
 * (and the write is refused) or waits for it (and the write landed under the old epoch, before
 * the new worker began).
 */

import type { Run } from "../db/schema";
import { fenced } from "./ingest.errors";

/**
 * Refuse a write whose epoch is not the run's.
 *
 * @param run - The run, locked.
 * @param epoch - The epoch the write carried, or `undefined` when it carried none — the
 *   simulator and every caller written before #160, which are never fenced.
 * @throws {ConflictError} `409 fenced`, naming the run's current epoch.
 */
export function assertEpoch(run: Pick<Run, "exec_epoch">, epoch: number | undefined): void {
  if (epoch !== undefined && epoch !== run.exec_epoch) {
    throw fenced(run.exec_epoch);
  }
}
