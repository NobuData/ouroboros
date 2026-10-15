/**
 * The ingestion ledger's replay and receipt — steps 3 and 5 of every keyed write on
 * `/internal/runs` (AP.1, [#303](https://github.com/NobuData/ouroboros/issues/303)).
 *
 * Shared by `ingest.service.ts`'s six reports and `run-execution.service.ts`'s finish (#160), so
 * a keyed write anywhere on the surface replays and races the same way: a key already answered
 * returns its stored response and touches nothing, a key presented with a different body is
 * refused, and two concurrent first deliveries of one key end as one write and one replay.
 */

import type { Transaction } from "kysely";

import type { Database, RunIngestOperation } from "../db/schema";
import { isDatabaseFailure } from "../tenancy/constraints";
import { idempotencyKeyReused } from "./ingest.errors";
import type { IngestRepository, Writer } from "./ingest.repository";

/**
 * The constraint a concurrent first delivery collides on.
 *
 * Named rather than matched on SQLSTATE, so a rename in V049 stops matching here rather than
 * silently changing an answer — `workflows.errors.ts` makes the same argument.
 */
export const RECEIPT_KEY_CONSTRAINT = "run_ingest_receipts_scope_key";

/** What a replay lookup found. */
export type Replay<T> =
  /** This key has never been used: do the work. */
  | { readonly replayed: false }
  /** This key answered this request: hand back what it was told. */
  | { readonly replayed: true; readonly response: T };

/** Who the receipt is for: the workspace the key is unique within, and the operation. */
export interface ReceiptScope {
  /** The workspace. */
  readonly organizationId: string;
  /** Which operation. */
  readonly operation: RunIngestOperation;
  /** The caller's key. */
  readonly idempotencyKey: string;
  /** The digest of *this* request. */
  readonly digest: string;
}

/**
 * Has this key already been answered?
 *
 * @param runs - The ledger's statements.
 * @param writer - The transaction.
 * @param scope - The workspace, the operation, the key and this request's digest.
 * @returns The stored response when the key answered this same request, and *not replayed*
 *   when the key is new.
 * @throws {ConflictError} `409 idempotency_key_reused` when the key answered a different one.
 *   The stored response is never included: it belongs to whatever request first used the key.
 */
export async function replayedReceipt<T>(
  runs: IngestRepository,
  writer: Writer,
  scope: ReceiptScope,
): Promise<Replay<T>> {
  const receipt = await runs.findReceipt(
    writer,
    scope.organizationId,
    scope.operation,
    scope.idempotencyKey,
  );

  if (receipt === undefined) {
    return { replayed: false };
  }

  if (receipt.request_digest !== scope.digest) {
    throw idempotencyKeyReused(scope.operation, scope.idempotencyKey);
  }

  return { replayed: true, response: receipt.response as T };
}

/**
 * Record the answer, and hand it back.
 *
 * The last statement of every keyed write, so the receipt and the rows it describes commit
 * together or not at all.
 *
 * **The `catch` is the concurrent-first-delivery case.** Two deliveries of one key can both
 * pass {@link replayedReceipt} and race to insert; PostgreSQL refuses the second on
 * {@link RECEIPT_KEY_CONSTRAINT}. That loser is a replay that arrived a moment too early, so it
 * is answered as one: re-read, compare digests, hand back the winner's response. The rows this
 * transaction wrote roll back with it, which is correct — the winner wrote the same ones.
 *
 * @param runs - The ledger's statements.
 * @param trx - The transaction.
 * @param scope - The workspace, the operation, the key and the request's digest.
 * @param run - The run this submission was about.
 * @param response - The answer.
 * @returns The answer — this one, or the winner's when a concurrent delivery got there first.
 * @throws {ConflictError} `409 idempotency_key_reused`, when the concurrent delivery that won
 *   the race was a different request under the same key.
 */
export async function commitReceipt<T>(
  runs: IngestRepository,
  trx: Transaction<Database>,
  scope: ReceiptScope,
  run: string,
  response: T,
): Promise<T> {
  try {
    await runs.insertReceipt(trx, {
      organization_id: scope.organizationId,
      run_id: run,
      operation: scope.operation,
      idempotency_key: scope.idempotencyKey,
      request_digest: scope.digest,
      response,
    });

    return response;
  } catch (error) {
    if (!isDatabaseFailure(error) || error.constraint !== RECEIPT_KEY_CONSTRAINT) {
      throw error;
    }

    // The losing transaction is poisoned once PostgreSQL has refused a statement inside it, so
    // the winner's receipt is read on a fresh connection rather than on `trx`. This one then
    // rolls back, taking its duplicate rows with it.
    const replay = await replayedReceipt<T>(runs, runs.db, scope);

    if (!replay.replayed) {
      // The key collided and is now absent, which means the winner rolled back after
      // colliding with *us*. Nothing to replay and nothing to be done here: rethrow, and the
      // caller's retry finds a clean slate.
      throw error;
    }

    return replay.response;
  }
}
