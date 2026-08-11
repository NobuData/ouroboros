/**
 * The two things every repository in this module does, defined once.
 *
 * Small, and worth a file anyway: both of them are places where getting it wrong is silent.
 * A statement issued on the pool while a transaction is open is not part of that transaction
 * and rolls back with nothing; a `count(*)` read as a number without going through `Number`
 * is a string, and `"12" > 5` is not the comparison anyone meant.
 */

import type { Kysely, Transaction } from "kysely";

import type { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";

/**
 * The connection a statement should run on.
 *
 * Every repository method takes an optional transaction and passes it here, so the same
 * query can be issued inside a unit of work or outside one and the *caller* decides which.
 * Reaching for `database.db` directly instead is the one mistake
 * `DatabaseService.transaction` cannot prevent: the statement takes its own connection from
 * the pool, commits on its own, and is not undone when the transaction rolls back.
 *
 * @param database - The service holding the pool.
 * @param trx - The transaction to run in, when the caller is inside one.
 * @returns The transaction if there is one, and the pooled instance otherwise. `Transaction`
 *   is a `Kysely` with the same typed surface, which is what lets one return type cover both.
 */
export function queryOn(database: DatabaseService, trx?: Transaction<Database>): Kysely<Database> {
  return trx ?? database.db;
}

/**
 * Read a `count(*)` as a number.
 *
 * PostgreSQL counts in `bigint` and `pg` hands those back as strings rather than risk a
 * silent loss of precision above 2^53 — correct in general, and the reason a total that is
 * never compared, added or divided would still be wrong on the wire, where the specification
 * says `integer`.
 *
 * @param total - What the driver returned for the aggregate.
 * @returns It, as a number. Safe for these tables specifically: a row count this service is
 *   willing to page through fits in a double many times over.
 */
export function asCount(total: string | number | bigint): number {
  return Number(total);
}
