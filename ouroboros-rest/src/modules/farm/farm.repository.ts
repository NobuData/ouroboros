/**
 * Every statement this module issues, in one class.
 *
 * AH.2 ([#250](https://github.com/NobuData/ouroboros/issues/250)). One repository rather than
 * three, and the reason is that the writes here are not separable: enrolling a runner inserts
 * a `runners` row, a `runner_certificates` row and an increment of `enrollment_tokens.uses`,
 * and renewing one supersedes a certificate and inserts another. Splitting those across
 * repositories would put a transaction boundary between statements that have to be inside one
 * — and the `runner_certificates_live_idx` invariant V041 declares is exactly the thing that
 * two half-applied writes would break.
 *
 * So the transactional operations are **methods here**, each one a `transaction()` whose body
 * is the whole of what must happen together, and the callers above are left with the order of
 * operations rather than with the atomicity.
 *
 * ---------------------------------------------------------------------------
 * **Nothing here decides anything.** Whether a token is live, whether a pool matches, whether
 * a workspace permits the fallback — those are `enrollment.service.ts`'s and
 * `registration.service.ts`'s. What this file owns is that every statement carries
 * `organization_id`, including the ones whose composite foreign keys would have carried it
 * anyway: a `where` that is redundant against the schema is still the thing that makes the
 * *read* paths tenant-scoped, and the schema constrains writes rather than reads.
 *
 * The one statement that does **not** filter by workspace is {@link tokenById}, and it cannot:
 * an enrolling agent holds no session and no workspace, and the token it presents is what
 * establishes both. The row's own `organization_id` is the answer, which is why every caller
 * of that method reads the workspace *out of* the row rather than comparing one against it.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type {
  EnrollmentToken,
  FarmAuthority,
  NewEnrollmentToken,
  NewFarmAuthority,
  NewRunner,
  NewRunnerCertificate,
  Runner,
  RunnerCertificate,
  RunnerPool,
} from "../db/schema";

/** One enrollment, as a single transaction — see this file's header. */
export interface EnrollmentWrite {
  /** The runner row to create. */
  readonly runner: NewRunner;
  /** The certificate row to create beside it, or nothing for a bearer-fallback enrollment. */
  readonly certificate?: NewRunnerCertificate;
  /** Which token to spend. */
  readonly tokenId: string;
}

/** One renewal, as a single transaction. */
export interface RenewalWrite {
  /** The certificate being replaced. */
  readonly supersededId: string;
  /** The one replacing it. */
  readonly certificate: NewRunnerCertificate;
}

@Injectable()
export class FarmRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * One workspace's pool, by the name that travels on a command line.
   *
   * @param organizationId - The workspace.
   * @param name - The pool's name, as `--pool` gave it.
   * @returns The pool, or `undefined`.
   */
  async poolByName(organizationId: string, name: string): Promise<RunnerPool | undefined> {
    return this.database.db
      .selectFrom("runner_pools")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("name", "=", name)
      .executeTakeFirst();
  }

  /**
   * One workspace's pool, by id.
   *
   * @param organizationId - The workspace.
   * @param id - The pool.
   * @returns The pool, or `undefined`.
   */
  async poolById(organizationId: string, id: string): Promise<RunnerPool | undefined> {
    return this.database.db
      .selectFrom("runner_pools")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * Create an enrollment token.
   *
   * @param row - The row, with its id already chosen by the caller: the token's *value*
   *   embeds that id, so it has to exist before the insert that seals it — see
   *   `farm.tokens.ts`.
   * @returns The stored row.
   */
  async insertToken(row: NewEnrollmentToken): Promise<EnrollmentToken> {
    return this.database.db
      .insertInto("enrollment_tokens")
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * A token by its own id, across every workspace.
   *
   * **The one unscoped read in this file**, and the header says why. Callers take the
   * workspace from the row.
   *
   * @param id - The id the presented token carried.
   * @returns The row, or `undefined` — which is what a fabricated id produces, and is
   *   answered identically to a wrong secret.
   */
  async tokenById(id: string): Promise<EnrollmentToken | undefined> {
    return this.database.db
      .selectFrom("enrollment_tokens")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * One workspace's tokens, newest first.
   *
   * Every column including `token_sealed`, because Kysely's `selectAll` is what keeps this
   * mirror-checked — and `farm.resources.ts` is the seam that decides what leaves the
   * process. The envelope is not a secret in the sense the plaintext is; it is unopenable
   * without the workspace's DEK. It still never reaches a response, and
   * `farm.secrecy.spec.ts` is what asserts that.
   *
   * @param organizationId - The workspace.
   * @returns The rows.
   */
  async tokensOf(organizationId: string): Promise<EnrollmentToken[]> {
    return this.database.db
      .selectFrom("enrollment_tokens")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .orderBy("created_at", "desc")
      .execute();
  }

  /**
   * Revoke a token.
   *
   * Idempotent by `where not revoked`: a second revoke of the same token changes nothing and
   * returns nothing, which is what lets the service tell *already revoked* from *no such
   * token* without a second read.
   *
   * @param organizationId - The workspace.
   * @param id - The token.
   * @param at - When.
   * @returns The row as it now stands, or `undefined` if there was nothing live to revoke.
   */
  async revokeToken(
    organizationId: string,
    id: string,
    at: Date,
  ): Promise<EnrollmentToken | undefined> {
    return this.database.db
      .updateTable("enrollment_tokens")
      .set({ revoked: true, revoked_at: at })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("revoked", "=", false)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * One workspace's certificate authority.
   *
   * @param organizationId - The workspace.
   * @returns The row, or `undefined` for a workspace that has never enrolled anything.
   */
  async authorityOf(organizationId: string): Promise<FarmAuthority | undefined> {
    return this.database.db
      .selectFrom("farm_authorities")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /**
   * Create a workspace's authority, unless one arrived first.
   *
   * `onConflict … doNothing` and then a read, rather than an insert that throws: two agents
   * enrolling into a fresh workspace at the same moment is an ordinary race, and the loser
   * should get the winner's CA rather than a `500`. The alternative — a lock around
   * *generate a keypair and sign* — would hold a transaction open across a signature.
   *
   * @param row - The authority to create.
   * @returns Whichever row is now the workspace's. Never `undefined`: either this insert
   *   landed or somebody else's did.
   */
  async insertAuthority(row: NewFarmAuthority): Promise<FarmAuthority> {
    await this.database.db
      .insertInto("farm_authorities")
      .values(row)
      .onConflict((conflict) => conflict.column("organization_id").doNothing())
      .execute();

    return this.database.db
      .selectFrom("farm_authorities")
      .selectAll()
      .where("organization_id", "=", row.organization_id)
      .executeTakeFirstOrThrow();
  }

  /**
   * Enrol a runner: the row, its certificate and the token's use, together or not at all.
   *
   * The `uses` increment is `uses + 1` in SQL rather than a value computed from a row this
   * process read, and it is guarded by `uses < max_uses` **in the statement**. That is what
   * makes *a single-use token cannot be used twice* a property of the database rather than of
   * a check-then-write the service performs: two agents presenting the last use of the same
   * token concurrently both pass the service's check, and exactly one of them updates a row.
   *
   * @param write - The runner, the certificate and the token.
   * @returns The stored runner, or `undefined` when the token had no use left — in which case
   *   nothing was written at all.
   */
  async enrol(write: EnrollmentWrite): Promise<Runner | undefined> {
    return this.database.db.transaction().execute(async (transaction) => {
      const spent = await transaction
        .updateTable("enrollment_tokens")
        .set((builder) => ({ uses: builder("uses", "+", 1) }))
        .where("id", "=", write.tokenId)
        .where("revoked", "=", false)
        .where((builder) => builder(builder.ref("uses"), "<", builder.ref("max_uses")))
        .returning("id")
        .executeTakeFirst();

      if (!spent) return undefined;

      const runner = await transaction
        .insertInto("runners")
        .values(write.runner)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (write.certificate) {
        await transaction.insertInto("runner_certificates").values(write.certificate).execute();
      }

      return runner;
    });
  }

  /**
   * Replace a runner's certificate: supersede the old row and insert the new one.
   *
   * Both inside one transaction, because `runner_certificates_live_idx` refuses the moment
   * both are live — so a renewal that is not atomic is a renewal that fails half the time
   * under concurrency rather than one that quietly leaves two identities.
   *
   * @param write - Which certificate is being replaced, and by what.
   * @param at - When the old one stopped being the live one.
   * @returns The new certificate row.
   */
  async renew(write: RenewalWrite, at: Date): Promise<RunnerCertificate> {
    return this.database.db.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("runner_certificates")
        .set({ superseded_at: at })
        .where("id", "=", write.supersededId)
        .execute();

      const issued = await transaction
        .insertInto("runner_certificates")
        .values(write.certificate)
        .returningAll()
        .executeTakeFirstOrThrow();

      await transaction
        .updateTable("runners")
        .set({ cert_serial: write.certificate.serial })
        .where("id", "=", write.certificate.runner_id)
        .where("organization_id", "=", write.certificate.organization_id)
        .execute();

      return issued;
    });
  }

  /**
   * One workspace's runner, by id.
   *
   * @param organizationId - The workspace.
   * @param id - The runner.
   * @returns The row, or `undefined`.
   */
  async runnerById(organizationId: string, id: string): Promise<Runner | undefined> {
    return this.database.db
      .selectFrom("runners")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .executeTakeFirst();
  }

  /**
   * The certificate a serial names, in the workspace that claims it.
   *
   * **The gateway's read**, on the hot path of every handshake, served by
   * `runner_certificates_serial_key`. It returns revoked and superseded rows too: *not found*
   * and *found and dead* both end in a refusal, and returning the row is what lets the caller
   * say which — to the audit trail, never to the caller.
   *
   * @param organizationId - The workspace the certificate's `O` claims.
   * @param serial - Lowercase hex, as `certificate.ts` writes it.
   * @returns The row, or `undefined`.
   */
  async certificateBySerial(
    organizationId: string,
    serial: string,
  ): Promise<RunnerCertificate | undefined> {
    return this.database.db
      .selectFrom("runner_certificates")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("serial", "=", serial)
      .executeTakeFirst();
  }

  /**
   * The one certificate a runner should currently be presenting.
   *
   * At most one row by `runner_certificates_live_idx`, which is the invariant this read
   * depends on rather than one it checks.
   *
   * @param organizationId - The workspace.
   * @param runnerId - The runner.
   * @returns The live certificate, or `undefined` — a bearer-fallback runner, or one whose
   *   certificate has been revoked.
   */
  async liveCertificate(
    organizationId: string,
    runnerId: string,
  ): Promise<RunnerCertificate | undefined> {
    return this.database.db
      .selectFrom("runner_certificates")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("runner_id", "=", runnerId)
      .where("revoked", "=", false)
      .where("superseded_at", "is", null)
      .executeTakeFirst();
  }

  /**
   * Revoke a certificate.
   *
   * Idempotent by `where not revoked`, as {@link revokeToken} is, and it deliberately does
   * **not** clear `runners.cert_serial`: the column says which certificate was issued, and a
   * runner whose identity was revoked is a runner whose serial an operator still needs to be
   * able to look up. What changes is the answer the handshake gets.
   *
   * @param organizationId - The workspace.
   * @param id - The certificate row.
   * @param at - When.
   * @param by - Who, or `null` for an automatic revocation.
   * @param reason - One short word — `operator`, `runner_removed`.
   * @returns The row as it now stands, or `undefined` if there was nothing live to revoke.
   */
  async revokeCertificate(
    organizationId: string,
    id: string,
    at: Date,
    by: string | null,
    reason: string,
  ): Promise<RunnerCertificate | undefined> {
    return this.database.db
      .updateTable("runner_certificates")
      .set({ revoked: true, revoked_at: at, revoked_by: by, revocation_reason: reason })
      .where("organization_id", "=", organizationId)
      .where("id", "=", id)
      .where("revoked", "=", false)
      .returningAll()
      .executeTakeFirst();
  }

  /**
   * Whether a workspace permits certificate-less enrollment.
   *
   * Read through `workspace_settings_effective` rather than the table, for V011's reason: the
   * default is resolved in the database, so a workspace that has never answered reads `false`
   * from the same place an opinionated one reads `true`.
   *
   * @param organizationId - The workspace.
   * @returns The switch's position. `false` for a workspace the view has no row for at all,
   *   which is unreachable through the pipeline and is still the safe answer.
   */
  async bearerFallbackPermitted(organizationId: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("workspace_settings_effective")
      .select("runner_bearer_fallback")
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    return row?.runner_bearer_fallback ?? false;
  }
}
