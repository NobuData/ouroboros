/**
 * A database that compiles statements and answers with whatever a test says, without a
 * server.
 *
 * The repositories in this module are thin by design — they hold no rules, only statements —
 * and that makes them the one layer a mocked *method* cannot check. `expect(repository.list)`
 * `.toHaveBeenCalled()` says nothing about whether the statement it issued was scoped to the
 * tenant, and "scoped to the tenant" is the property this API's isolation rests on.
 *
 * So this fixture goes one level lower. It is a real `Kysely` — the real query builder, the
 * real PostgreSQL dialect, the real compiler — over a driver that records the SQL and the
 * parameters instead of sending them, and returns rows a test queued. A repository spec can
 * then assert the two things that matter and nothing else:
 *
 *   * **the SQL**, which is where a missing `where tenant_id = $1` shows up; and
 *   * **the mapping**, which is what the repository does with the rows that come back.
 *
 * The integration suite still runs every one of these statements against a migrated
 * PostgreSQL (`tenancy.integration-spec.ts`), because a statement that compiles is not a
 * statement the server accepts. The two answer different questions: this one is about what
 * was asked, and that one is about whether the answer was right.
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  WithSchemaPlugin,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type Transaction,
} from "kysely";

import type { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME, type Database } from "../db/schema";

/** One statement, as the compiler produced it. */
export interface RecordedStatement {
  /** The SQL, schema-qualified and parameterised exactly as the server would receive it. */
  sql: string;
  /** The values, in order. Kysely parameterises everything, so this is never empty by accident. */
  parameters: readonly unknown[];
}

/** What a queued answer looks like: the rows, and what an `update` or `delete` affected. */
export interface QueuedResult {
  rows?: unknown[];
  numAffectedRows?: bigint;
}

/** A database a test drives, and the record of what was asked of it. */
export interface RecordingDatabase {
  /** What a repository is constructed with. */
  service: DatabaseService;
  /** Every statement issued, in order, `begin` and `commit` included. */
  statements: RecordedStatement[];
  /** Queue what the next statement answers with. Unqueued statements answer with no rows. */
  answers(...results: QueuedResult[]): void;
  /** The SQL of every statement issued, for an assertion that is about the shape only. */
  sql(): string[];
}

/**
 * A connection that writes statements down instead of sending them.
 *
 * One connection is enough: this fixture is single-threaded by construction, and a pool
 * would only add a queue between the caller and the record.
 */
class RecordingConnection implements DatabaseConnection {
  constructor(
    private readonly statements: RecordedStatement[],
    private readonly queue: QueuedResult[],
  ) {}

  /**
   * Record a statement and answer it.
   *
   * @param compiled - The statement, as Kysely compiled it.
   * @returns The next queued answer, or no rows when the test queued none — which is what a
   *   `select` that matched nothing looks like, and the common case in these specs.
   */
  executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    this.statements.push({ sql: compiled.sql, parameters: compiled.parameters });

    const queued = this.queue.shift() ?? {};

    return Promise.resolve({
      rows: (queued.rows ?? []) as R[],
      numAffectedRows: queued.numAffectedRows ?? 0n,
    });
  }

  /**
   * Record a statement the *driver* issued, without consuming a queued answer.
   *
   * `begin` and `commit` have to appear in the record — a spec asserting that a rule ran
   * inside a transaction is asserting on exactly those — and must not eat the rows a test
   * queued for the statement between them, which is the bug this method exists to avoid.
   *
   * @param sql - What the driver sent.
   */
  note(sql: string): void {
    this.statements.push({ sql, parameters: [] });
  }

  /**
   * Not implemented: nothing in this module streams.
   *
   * @returns Never — it throws, so a repository that started streaming fails loudly here
   *   rather than silently returning nothing.
   */
  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("the recording database does not stream");
  }
}

/**
 * A driver over one {@link RecordingConnection}.
 *
 * The transaction methods issue the same `begin`/`commit`/`rollback` the PostgreSQL driver
 * does, through the connection — so a spec can assert that a multi-statement rule really ran
 * inside one, which is the difference between the last-owner check being an invariant and
 * being a comment.
 */
class RecordingDriver implements Driver {
  private readonly connection: RecordingConnection;

  constructor(statements: RecordedStatement[], queue: QueuedResult[]) {
    this.connection = new RecordingConnection(statements, queue);
  }

  init(): Promise<void> {
    return Promise.resolve();
  }

  acquireConnection(): Promise<DatabaseConnection> {
    return Promise.resolve(this.connection);
  }

  beginTransaction(): Promise<void> {
    this.connection.note("begin");
    return Promise.resolve();
  }

  commitTransaction(): Promise<void> {
    this.connection.note("commit");
    return Promise.resolve();
  }

  rollbackTransaction(): Promise<void> {
    this.connection.note("rollback");
    return Promise.resolve();
  }

  releaseConnection(): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Build a database that records instead of connecting.
 *
 * The dialect is PostgreSQL's own adapter, introspector and compiler, and `WithSchemaPlugin`
 * is installed exactly as `db.service.ts` installs it — so the SQL a spec asserts on is the
 * SQL the service would send, schema qualification and `$1` placeholders included. Swapping
 * the compiler for a simpler one would make these assertions about a dialect nothing runs.
 *
 * @returns The database, the record of what was asked of it, and a way to say what it
 *   answers.
 */
export function recordingDatabase(): RecordingDatabase {
  const statements: RecordedStatement[] = [];
  const queue: QueuedResult[] = [];

  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new RecordingDriver(statements, queue),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new WithSchemaPlugin(SCHEMA_NAME)],
  });

  // Only the two members a repository or a service touches. Cast rather than instantiated
  // because the real class opens a pool in its constructor, which is precisely what a suite
  // that starts nothing must not do.
  const service = {
    db,
    transaction: <T>(work: (trx: Transaction<Database>) => Promise<T>) =>
      db.transaction().execute(work),
  } as unknown as DatabaseService;

  return {
    service,
    statements,
    answers: (...results: QueuedResult[]) => queue.push(...results),
    sql: () => statements.map((statement) => statement.sql),
  };
}
