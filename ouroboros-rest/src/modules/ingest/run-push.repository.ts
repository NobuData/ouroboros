/**
 * The rows a push grant is decided from (DI.2,
 * [#1310](https://github.com/NobuData/ouroboros/issues/1310)) — reads only; a push writes no row
 * of its own beyond its audit trail and, for the result, an ingestion receipt.
 */

import { Injectable } from "@nestjs/common";

import type { Writer } from "./ingest.repository";
import type { LatestGuardrail } from "./run-push.policy";

@Injectable()
export class RunPushRepository {
  /**
   * The run's latest verdict per guardrail check (`v_run_guardrails_latest`, V048/V148).
   *
   * @param writer - The connection or the open transaction.
   * @param run - The run.
   * @returns One row per check that has been evaluated, in no particular order.
   */
  async latestGuardrails(writer: Writer, run: string): Promise<LatestGuardrail[]> {
    const rows = await writer
      .selectFrom("v_run_guardrails_latest")
      .select(["check", "verdict", "mode", "change_set_seq"])
      .where("run_id", "=", run)
      .execute();

    return rows.map((row) => ({
      check: row.check,
      verdict: row.verdict,
      mode: row.mode,
      changeSetSeq: row.change_set_seq,
    }));
  }
}
