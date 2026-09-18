import { X509Certificate } from "node:crypto";
import type request from "supertest";

import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type {
  AuthorityResource,
  EnrollmentResource,
  EnrollmentTokenResource,
  MintedTokenResource,
  RenewalResource,
  RunnerCertificateResource,
} from "./farm.resources";
import { certificationRequest, keypair } from "./farm.fixture";

/**
 * Decision **B3**'s whole chain, over a socket and against a migrated database
 * ([#250](https://github.com/NobuData/ouroboros/issues/250)).
 *
 * Every one of AH.2's acceptance criteria only exists end to end, and this is where they are
 * asked as a caller would ask them:
 *
 *   * **TTL and use count are enforced**, and a second use of a single-use token fails —
 *     against the statement's own guard, not a service's check.
 *   * **A token scoped to `pool-a` cannot enrol into `pool-b`.**
 *   * **A revoked certificate is refused**, and the runner cannot renew its way back in.
 *   * **The CA private key never leaves**: every response in a full lifecycle is scanned.
 *   * **Renewal works over the authenticated channel** with no second token.
 *   * **Every operation writes an audit row**, read back out of `audit_events`.
 *   * **The full token value is returned once**; every later read is masked.
 *   * **Bearer fallback requires the org setting** and records `security_mode`.
 *   * **Organization isolation**: a token cannot enrol a runner into another workspace.
 *
 * The client certificate arrives through the forwarded-header path, because a Supertest
 * request is plain HTTP — which is also the deployment this service has to support and the one
 * `SECURITY_MODEL.md`'s farm-CA section documents.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The header this suite's application trusts a proxy to forward a certificate in. */
const CLIENT_CERT_HEADER = "x-ouro-client-cert";

/**
 * A certificate as a proxy actually forwards it.
 *
 * Percent-encoded, which is nginx's `$ssl_client_escaped_cert` — and not a convenience: a PEM
 * block contains newlines, and HTTP headers cannot. Every proxy that forwards one therefore
 * encodes it somehow, and a suite that sent the raw block would be testing a request no proxy
 * can make.
 *
 * @param pem - The certificate.
 * @returns The header value.
 */
function forwarded(pem: string): string {
  return encodeURIComponent(pem);
}

const AUTHORITY = "/api/v1/farm/authority";
const TOKENS = "/api/v1/farm/enrollment-tokens";
const REGISTRATIONS = "/api/v1/farm/registrations";
const RENEWAL = "/api/v1/farm/registrations/renewal";

describe("the build farm's identity layer", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_FARM_CLIENT_CERT_HEADER: CLIENT_CERT_HEADER });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A workspace with one pool, and an administrator holding a session in it. */
  async function farm(name = "pool-a"): Promise<{
    owner: Awaited<ReturnType<ApiHarness["signIn"]>>;
    workspace: Awaited<ReturnType<ApiHarness["workspace"]>>;
    poolId: string;
  }> {
    const owner = await api.signIn();
    const workspace = await api.workspace(owner);
    const { rows } = await api.sql.query<{ id: string }>(
      `insert into ouroboros.runner_pools (organization_id, name, executor, image)
       values ($1, $2, 'container', 'img:0.17') returning id`,
      [workspace.id, name],
    );

    return { owner, workspace, poolId: rows[0]?.id ?? "" };
  }

  /** Mint a token through the API. */
  async function mint(
    context: Awaited<ReturnType<typeof farm>>,
    body: Record<string, unknown> = { pool: "pool-a" },
  ): Promise<MintedTokenResource> {
    const response = await api
      .as(context.owner)("post", TOKENS)
      .set(TENANT_HEADER, context.workspace.id)
      .send(body)
      .expect(201);

    return bodyOf<MintedTokenResource>(response);
  }

  /** Enrol a machine through the agent-facing route. */
  function enrol(body: Record<string, unknown>): request.Test {
    return api.anonymous("post", REGISTRATIONS).send(body);
  }

  /** This workspace's audit actions, oldest first. */
  async function trail(workspaceId: string): Promise<string[]> {
    const { rows } = await api.sql.query<{ action: string }>(
      `select action from ouroboros.audit_events
        where organization_id = $1 order by occurred_at, action`,
      [workspaceId],
    );

    return rows.map((row) => row.action);
  }

  describe("minting a token", () => {
    it("returns the full value once and masks every later read", async () => {
      const context = await farm();

      const minted = await mint(context);

      expect(minted.token).toMatch(/^orb_enroll_[0-9a-f]{32}\.[A-Za-z0-9_-]{22,}$/);
      expect(minted.masked).not.toBe(minted.token);

      const listed = await api
        .as(context.owner)("get", TOKENS)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      const tokens = bodyOf<EnrollmentTokenResource[]>(listed);

      expect(tokens).toHaveLength(1);
      expect(JSON.stringify(tokens)).not.toContain(minted.token);
      expect(tokens[0]?.masked).toBe(minted.masked);
    });

    it("stores only an envelope — the plaintext is in no column", async () => {
      const context = await farm();
      const minted = await mint(context);

      const { rows } = await api.sql.query<{ token_sealed: string }>(
        "select token_sealed from ouroboros.enrollment_tokens where organization_id = $1",
        [context.workspace.id],
      );

      expect(rows[0]?.token_sealed).toMatch(/^ouro\.v1\./);
      expect(rows[0]?.token_sealed).not.toContain(minted.token.split(".")[1]);
    });

    it("refuses a member, and mints nothing", async () => {
      const context = await farm();
      const member = await api.signIn();
      await api.join(context.workspace.id, member, "member");

      const refused = await api
        .as(member)("post", TOKENS)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ pool: "pool-a" })
        .expect(403);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("forbidden");

      const { rows } = await api.sql.query("select 1 from ouroboros.enrollment_tokens");

      expect(rows).toHaveLength(0);
    });

    it("refuses a pool this workspace does not have", async () => {
      const context = await farm();

      const refused = await api
        .as(context.owner)("post", TOKENS)
        .set(TENANT_HEADER, context.workspace.id)
        .send({ pool: "no-such-pool" })
        .expect(404);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("farm_pool_not_found");
    });
  });

  describe("enrolling a machine", () => {
    it("issues a certificate the workspace's own CA verifies", async () => {
      const context = await farm();
      const minted = await mint(context);

      const response = await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(201);

      const enrollment = bodyOf<EnrollmentResource>(response);
      const ca = await api
        .as(context.owner)("get", AUTHORITY)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      const authority = new X509Certificate(bodyOf<AuthorityResource>(ca).certificate);
      const issued = new X509Certificate(enrollment.certificate as string);

      expect(issued.verify(authority.publicKey)).toBe(true);
      expect(issued.subject).toContain(`CN=${enrollment.runnerId}`);
      expect(issued.subject).toContain(`O=${context.workspace.id}`);
      expect(issued.ca).toBe(false);
    });

    it("puts the runner in the token's workspace, on the token's pool", async () => {
      const context = await farm();
      const minted = await mint(context);

      const response = await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(201);

      const { rows } = await api.sql.query<{
        organization_id: string;
        pool_id: string;
        security_mode: string;
        cert_serial: string;
      }>("select organization_id, pool_id, security_mode, cert_serial from ouroboros.runners");

      expect(rows[0]?.organization_id).toBe(context.workspace.id);
      expect(rows[0]?.pool_id).toBe(context.poolId);
      expect(rows[0]?.security_mode).toBe("mtls");
      expect(rows[0]?.cert_serial).toBe(bodyOf<EnrollmentResource>(response).serial);
    });

    it("ENFORCES THE USE COUNT — a second use of a single-use token fails", async () => {
      const context = await farm();
      const minted = await mint(context, { pool: "pool-a", maxUses: 1 });

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(201);

      const refused = await enrol({
        token: minted.token,
        name: "forge-02",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(401);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("farm_enrollment_refused");

      const { rows } = await api.sql.query("select 1 from ouroboros.runners");

      expect(rows).toHaveLength(1);
    });

    it("ENFORCES THE TTL", async () => {
      const context = await farm();
      const minted = await mint(context);

      // Both stamps, because `enrollment_tokens_ttl_positive` refuses a row that expired before
      // it was minted — which is the constraint doing its job rather than an obstacle.
      await api.sql.query(
        `update ouroboros.enrollment_tokens
            set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
          where id = $1`,
        [minted.id],
      );

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(401);
    });

    it("REFUSES A POOL THE TOKEN IS NOT SCOPED TO", async () => {
      const context = await farm();
      await api.sql.query(
        `insert into ouroboros.runner_pools (organization_id, name, executor)
         values ($1, 'pool-b', 'shell')`,
        [context.workspace.id],
      );

      const minted = await mint(context, { pool: "pool-a" });

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        pool: "pool-b",
        csr: certificationRequest(),
      }).expect(401);

      const { rows } = await api.sql.query("select 1 from ouroboros.runners");

      expect(rows).toHaveLength(0);
    });

    it("CANNOT ENROL INTO ANOTHER ORGANIZATION", async () => {
      // There is no workspace field on the body, so the strongest form of this criterion is
      // that a pool of another workspace is simply not resolvable — the runner lands where the
      // token says and nowhere else.
      const first = await farm();
      const second = await farm("pool-elsewhere");
      const minted = await mint(first);

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        pool: "pool-elsewhere",
        csr: certificationRequest(),
      }).expect(401);

      const withoutPool = await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(201);

      const { rows } = await api.sql.query<{ organization_id: string }>(
        "select organization_id from ouroboros.runners",
      );

      expect(rows[0]?.organization_id).toBe(first.workspace.id);
      expect(rows[0]?.organization_id).not.toBe(second.workspace.id);
      expect(bodyOf<EnrollmentResource>(withoutPool).poolId).toBe(first.poolId);
    });

    it("refuses a revoked token", async () => {
      const context = await farm();
      const minted = await mint(context);

      await api
        .as(context.owner)("delete", `${TOKENS}/${minted.id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(401);
    });

    it("answers a certificate request it cannot sign with a reason", async () => {
      const context = await farm();
      const minted = await mint(context);

      const refused = await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: "-----BEGIN CERTIFICATE REQUEST-----\nbm90LWEtcmVxdWVzdA==\n-----END CERTIFICATE REQUEST-----\n",
      }).expect(422);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("farm_invalid_csr");
    });

    it("refuses a second machine of the same name without spending the token", async () => {
      const context = await farm();
      const minted = await mint(context, { pool: "pool-a", maxUses: 5 });

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(201);

      const refused = await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(409);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("runner_name_taken");

      const { rows } = await api.sql.query<{ uses: number }>(
        "select uses from ouroboros.enrollment_tokens where id = $1",
        [minted.id],
      );

      // The collision refuses the insert inside the transaction that increments `uses`, so the
      // whole write rolls back.
      expect(rows[0]?.uses).toBe(1);
    });
  });

  describe("renewal over the authenticated channel", () => {
    /** Enrol a machine and hand back what it is holding. */
    async function enrolled(
      context: Awaited<ReturnType<typeof farm>>,
    ): Promise<EnrollmentResource> {
      const minted = await mint(context);

      return bodyOf<EnrollmentResource>(
        await enrol({
          token: minted.token,
          name: "forge-01",
          arch: "linux/arm64",
          csr: certificationRequest(keypair()),
        }).expect(201),
      );
    }

    it("issues a new certificate with NO ENROLLMENT TOKEN anywhere", async () => {
      const context = await farm();
      const machine = await enrolled(context);

      const response = await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(machine.certificate as string))
        .send({ csr: certificationRequest() })
        .expect(201);

      const renewal = bodyOf<RenewalResource>(response);

      expect(renewal.serial).not.toBe(machine.serial);
      expect(
        new X509Certificate(renewal.certificate).verify(
          new X509Certificate(renewal.authority.certificate).publicKey,
        ),
      ).toBe(true);
    });

    it("leaves the runner with exactly one live certificate", async () => {
      const context = await farm();
      const machine = await enrolled(context);

      await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(machine.certificate as string))
        .send({ csr: certificationRequest() })
        .expect(201);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*) from ouroboros.runner_certificates
          where not revoked and superseded_at is null`,
      );

      expect(rows[0]?.count).toBe("1");
    });

    it("refuses the superseded certificate on the next renewal", async () => {
      const context = await farm();
      const machine = await enrolled(context);

      await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(machine.certificate as string))
        .send({ csr: certificationRequest() })
        .expect(201);

      const again = await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(machine.certificate as string))
        .send({ csr: certificationRequest() })
        .expect(401);

      expect(bodyOf<ErrorEnvelope>(again).code).toBe("farm_identity_refused");
    });

    it("refuses a request with no client certificate, and says why", async () => {
      await api
        .anonymous("post", RENEWAL)
        .send({ csr: certificationRequest() })
        .expect(401)
        .expect((response) => {
          expect(bodyOf<ErrorEnvelope>(response).code).toBe("farm_client_certificate_required");
          expect(bodyOf<ErrorEnvelope>(response).message).toContain("proxy");
        });
    });

    it("refuses a certificate this farm never issued", async () => {
      const context = await farm();
      await enrolled(context);

      // A well-formed certificate from a CA of its own — which is what an attacker has.
      const { certificate: forge, authority: forgedAuthority } = await import("./farm.fixture");
      const impostor = forgedAuthority("org_impostor");
      const forged = forge(impostor);

      const refused = await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(forged.pem))
        .send({ csr: certificationRequest() })
        .expect(401);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("farm_identity_refused");
    });
  });

  describe("revocation", () => {
    it("REFUSES A REVOKED CERTIFICATE, and the runner cannot renew its way back in", async () => {
      const context = await farm();
      const minted = await mint(context, { pool: "pool-a", maxUses: 5 });
      const machine = bodyOf<EnrollmentResource>(
        await enrol({
          token: minted.token,
          name: "forge-01",
          arch: "linux/arm64",
          csr: certificationRequest(),
        }).expect(201),
      );

      // It works before.
      await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(machine.certificate as string))
        .send({ csr: certificationRequest() })
        .expect(201);

      const live = bodyOf<EnrollmentResource>(
        await enrol({
          token: minted.token,
          name: "forge-02",
          arch: "linux/arm64",
          csr: certificationRequest(),
        }).expect(201),
      );

      const revoked = await api
        .as(context.owner)("delete", `/api/v1/farm/runners/${live.runnerId}/certificate`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      expect(bodyOf<RunnerCertificateResource>(revoked).revoked).toBe(true);

      // …and not after.
      const refused = await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(live.certificate as string))
        .send({ csr: certificationRequest() })
        .expect(401);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("farm_identity_refused");
    });

    it("refuses a runner that holds no live certificate", async () => {
      const context = await farm();
      const minted = await mint(context);
      const machine = bodyOf<EnrollmentResource>(
        await enrol({
          token: minted.token,
          name: "forge-01",
          arch: "linux/arm64",
          csr: certificationRequest(),
        }).expect(201),
      );

      await api
        .as(context.owner)("delete", `/api/v1/farm/runners/${machine.runnerId}/certificate`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      const again = await api
        .as(context.owner)("delete", `/api/v1/farm/runners/${machine.runnerId}/certificate`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(again).code).toBe("farm_no_live_certificate");
    });
  });

  describe("the bearer fallback", () => {
    it("is refused until the workspace switches it on", async () => {
      const context = await farm();
      const minted = await mint(context);

      const refused = await enrol({
        token: minted.token,
        name: "anvil-mac",
        arch: "darwin/arm64",
        securityMode: "bearer_fallback",
      }).expect(403);

      expect(bodyOf<ErrorEnvelope>(refused).code).toBe("farm_bearer_fallback_not_permitted");
    });

    it("records the degraded mode and seals the secret when it is permitted", async () => {
      const context = await farm();
      await api.sql.query(
        `insert into ouroboros.workspace_settings (organization_id, runner_bearer_fallback)
         values ($1, true)`,
        [context.workspace.id],
      );

      const minted = await mint(context);
      const enrollment = bodyOf<EnrollmentResource>(
        await enrol({
          token: minted.token,
          name: "anvil-mac",
          arch: "darwin/arm64",
          securityMode: "bearer_fallback",
        }).expect(201),
      );

      expect(enrollment.securityMode).toBe("bearer_fallback");
      expect(enrollment.certificate).toBeNull();
      expect(enrollment.bearerToken).toEqual(expect.any(String));

      const { rows } = await api.sql.query<{ security_mode: string; bearer_sealed: string }>(
        "select security_mode, bearer_sealed from ouroboros.runners",
      );

      expect(rows[0]?.security_mode).toBe("bearer_fallback");
      expect(rows[0]?.bearer_sealed).toMatch(/^ouro\.v1\./);
      expect(rows[0]?.bearer_sealed).not.toContain(enrollment.bearerToken);
    });
  });

  describe("the audit trail", () => {
    it("records every operation, refusals included", async () => {
      const context = await farm();
      const minted = await mint(context, { pool: "pool-a", maxUses: 5 });

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(201);

      const machine = bodyOf<EnrollmentResource>(
        await enrol({
          token: minted.token,
          name: "forge-02",
          arch: "linux/arm64",
          csr: certificationRequest(),
        }).expect(201),
      );

      await api
        .anonymous("post", RENEWAL)
        .set(CLIENT_CERT_HEADER, forwarded(machine.certificate as string))
        .send({ csr: certificationRequest() })
        .expect(201);

      await api
        .as(context.owner)("delete", `/api/v1/farm/runners/${machine.runnerId}/certificate`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      await api
        .as(context.owner)("delete", `${TOKENS}/${minted.id}`)
        .set(TENANT_HEADER, context.workspace.id)
        .expect(200);

      // A refusal, after the revoke.
      await enrol({
        token: minted.token,
        name: "forge-03",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(401);

      expect((await trail(context.workspace.id)).sort()).toEqual(
        [
          "runner.cert_renewed",
          "runner.cert_revoked",
          "runner.enrolled",
          "runner.enrolled",
          "runner.enrolled",
          "runner.token_minted",
          "runner.token_revoked",
        ].sort(),
      );
    });

    it("records which of the six a refusal was, where the caller is told nothing", async () => {
      const context = await farm();
      const minted = await mint(context, { pool: "pool-a", maxUses: 1 });

      await enrol({
        token: minted.token,
        name: "forge-01",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(201);

      await enrol({
        token: minted.token,
        name: "forge-02",
        arch: "linux/arm64",
        csr: certificationRequest(),
      }).expect(401);

      const { rows } = await api.sql.query<{ detail: { refusal?: string } }>(
        `select detail from ouroboros.audit_events
          where organization_id = $1 and detail ->> 'outcome' = 'refused'`,
        [context.workspace.id],
      );

      expect(rows[0]?.detail.refusal).toBe("spent");
    });
  });

  describe("what never crosses the wire", () => {
    it("is the CA private key, in any response of a full lifecycle", async () => {
      const context = await farm();
      const minted = await mint(context);
      const machine = bodyOf<EnrollmentResource>(
        await enrol({
          token: minted.token,
          name: "forge-01",
          arch: "linux/arm64",
          csr: certificationRequest(),
        }).expect(201),
      );

      const responses = [
        await api.as(context.owner)("get", AUTHORITY).set(TENANT_HEADER, context.workspace.id),
        await api.as(context.owner)("get", TOKENS).set(TENANT_HEADER, context.workspace.id),
        await api
          .anonymous("post", RENEWAL)
          .set(CLIENT_CERT_HEADER, forwarded(machine.certificate as string))
          .send({ csr: certificationRequest() }),
        await api
          .as(context.owner)("delete", `/api/v1/farm/runners/${machine.runnerId}/certificate`)
          .set(TENANT_HEADER, context.workspace.id),
      ];

      const wire = JSON.stringify([minted, machine, ...responses.map((one) => bodyOf(one))]);

      expect(wire).not.toContain("PRIVATE KEY");
      expect(wire).not.toContain("ouro.v1.");

      // And the key is in the database, sealed — so this is a claim about the API rather than
      // about there being nothing to leak.
      const { rows } = await api.sql.query<{ key_sealed: string }>(
        "select key_sealed from ouroboros.farm_authorities where organization_id = $1",
        [context.workspace.id],
      );

      expect(rows[0]?.key_sealed).toMatch(/^ouro\.v1\./);
    });
  });
});
