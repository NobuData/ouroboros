/**
 * A trail that remembers instead of writing — what a unit test asserts against.
 *
 * AD.4 ([#225](https://github.com/NobuData/ouroboros/issues/225)). Four suites need the same
 * thing and none of them wants a database: `connection.audit.spec.ts` and
 * `lease.audit.spec.ts` assert what a record contains, and
 * `provider-connections.service.spec.ts` and `payloads.spec.ts` need a service that can be
 * constructed at all.
 *
 * **It records rather than counts.** A `jest.fn()` would answer *was something written*, and
 * every claim AD.4 makes is about *what* — one event per operation, under this action, with
 * nothing secret in the payload. So this keeps the records, and the suites read them.
 *
 * The integration counterpart is `audit.integration-spec.ts`, which asserts the same claims
 * against real rows in a real PostgreSQL. Both exist for the reason every fixture/integration
 * pair in this service does: this one is fast and can drive failure paths a database will not
 * produce on demand, and that one proves the SQL is real.
 */

import type { AuditRecord } from "./audit.events";
import type { AuditService } from "./audit.service";

/** A stand-in trail, and everything written to it. */
export interface RecordingAudit {
  /** What to inject wherever an {@link AuditService} is wanted. */
  readonly service: AuditService;
  /** Every record written, in the order it was written. */
  readonly records: AuditRecord[];
  /**
   * Make the next and every subsequent write fail.
   *
   * The one behaviour a `jest.fn()` returning a resolved promise cannot give, and the one
   * AD.4's posture turns on: a failure to record is a failure of the operation *except* when
   * recording a failure. Both halves of that sentence need a trail that can refuse.
   *
   * @param failure - What the write should throw.
   */
  failWith(failure: Error): void;
}

/**
 * Build one.
 *
 * @returns The stand-in, its records, and the switch that makes it refuse.
 */
export function recordingAudit(): RecordingAudit {
  const records: AuditRecord[] = [];
  let failure: Error | undefined;

  const service = {
    record(event: AuditRecord): Promise<string> {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }

      records.push(event);

      // The real service answers with the row's id. Derived from the position rather than
      // random, so a suite that asserts on it is asserting something stable.
      return Promise.resolve(`recorded-${records.length}`);
    },
  };

  return {
    service: service as unknown as AuditService,
    records,
    failWith(next: Error): void {
      failure = next;
    },
  };
}
