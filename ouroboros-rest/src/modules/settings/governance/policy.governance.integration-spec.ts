import { ApiHarness, type Person, type Workspace } from "../../../testing/harness.fixture";
import { bodyOf } from "../../../testing/integration.fixture";
import { SCHEMA_NAME } from "../../db/schema";
import { INTERNAL_KEY_HEADER } from "../../engine/engine.contract";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import type {
  PolicyPreviewResource,
  PolicyResource,
  PublishedPolicyResource,
} from "../../policies/policy-publish.service";
import { MergeExecutorService } from "../../pull-requests/merge/merge.executor";
import {
  PrPlaneHosts,
  prPlaneScene,
  type PrPlaneScene,
} from "../../pull-requests/pr-plane.integration.fixture";
import { PrSyncService } from "../../pull-requests/pr-sync.service";
import type { Resolution } from "../../routing/resolution";
import { BENCH_MAX_COST_CENTS, seedRoutingBench } from "../../routing/workspace.fixture";
import { TENANT_HEADER } from "../../tenancy/tenant.resolver";
import type { InMemoryPrHost } from "../../ticket-sources/providers/in-memory.pr.fixture";

/**
 * Policy enforcement, end to end through the publish route
 * ([#490](https://github.com/NobuData/ouroboros/issues/490), BR.6 — the governance core of epic
 * #477).
 *
 *   * **One round-trip per rule** — edit → `POST /api/v1/policies` → observe the change **at the
 *     rule's real consumer**: `auto_merge` and `dry_run_new_repos` at the merge executor's arm,
 *     `human_review` at the gate engine's `human_approval` definition, `protected_paths` at AP.3's
 *     `allowed_paths` verdict, `spend_guard` at the routing resolution's cost cap.
 *   * **Version/audit coupling** — every publish is the next version and one `policy.published`
 *     row naming it, its predecessor and its classification; a refused publish writes neither.
 *   * **Loosening requires the owner** — the admin × tighten/loosen matrix, the preview's
 *     `requiresOwner`/`mayPublish`, and member/viewer refused outright.
 *
 * Written to the issue's adversarial bar: the publish goes through the HTTP route, never the SQL
 * function, so the owner check, each consumer's read of its rule, and the publish's cache
 * invalidation are each on the path a test asserts. The `protected_paths` and `spend_guard`
 * consumers read the policy **through the 30-second cache** and each judges once *before* the
 * publish, so a publish that stopped invalidating it would leave the next judgement on the old
 * version — and red.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/settings/governance/policy
 * ```
 */

/** One rule of a policy document — `schemas/org-policy/v1.json`. */
interface RuleBody {
  readonly enabled: boolean;
  readonly conditions: Readonly<Record<string, unknown>>;
}

/** The five core rules a document carries. */
type CoreRule =
  "auto_merge" | "human_review" | "protected_paths" | "spend_guard" | "dry_run_new_repos";

/** A policy document, as the publish route takes it. */
type PolicyDocument = Readonly<Record<CoreRule, RuleBody>>;

/** The document every scene starts from: mockup 17's v7, with the dry-run rule off. */
const BASE: PolicyDocument = {
  auto_merge: { enabled: true, conditions: { not: { label: "refactor" } } },
  human_review: { enabled: true, conditions: { any: [{ label: "refactor" }] } },
  protected_paths: { enabled: true, conditions: { path_globs: ["keys/**"] } },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60000 } },
  dry_run_new_repos: { enabled: false, conditions: { first_n_loops: 10 } },
};

/** The path AP.3 judges — protected only once a published glob names it. */
const BOOT_FILE = "boot/rollback_flag.c";

describe("policy governance — edit → publish → enforce (#490)", () => {
  const hosts = new PrPlaneHosts();
  let api: ApiHarness;
  let host: InMemoryPrHost;

  beforeAll(async () => {
    api = await ApiHarness.start(
      { OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" },
      hosts.overrides(),
    );
  });

  afterAll(() => api.close());

  beforeEach(() => {
    host = hosts.reset();
  });

  afterEach(async () => {
    await api.nest.get(MergeExecutorService).settled();
    await api.truncate();
  });

  /**
   * {@link BASE} with some rules replaced.
   *
   * @param rules - The rules to replace, whole.
   * @returns The document.
   */
  function documentWith(rules: Partial<PolicyDocument> = {}): PolicyDocument {
    return { ...BASE, ...rules };
  }

  /**
   * A request as somebody, in a workspace.
   *
   * @param person - Who.
   * @param slug - The workspace's slug.
   * @param method - The verb.
   * @param path - The path.
   * @returns The pending request.
   */
  function as(person: Person, slug: string, method: "get" | "post" | "put", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, slug);
  }

  /**
   * Publish through the route.
   *
   * @param person - Who publishes.
   * @param slug - The workspace's slug.
   * @param document - The document.
   * @param baseVersion - The version the edit began from.
   * @returns The pending request.
   */
  function publish(
    person: Person,
    slug: string,
    document: PolicyDocument,
    baseVersion: number | null,
  ) {
    return as(person, slug, "post", "/api/v1/policies").send({
      document,
      baseVersion,
      changeNote: "governance suite",
    });
  }

  /**
   * The version in force, as the read route answers.
   *
   * @param person - Who reads.
   * @param slug - The workspace's slug.
   * @returns The version, or null.
   */
  async function inForce(person: Person, slug: string): Promise<number | null> {
    return bodyOf<PolicyResource>(await as(person, slug, "get", "/api/v1/policies").expect(200))
      .version;
  }

  /**
   * Every `policy.published` row of a workspace, oldest first.
   *
   * @param organizationId - The workspace.
   * @returns Each row's actor and the detail facts this suite asserts.
   */
  async function publishedTrail(organizationId: string) {
    const { rows } = await api.sql.query<{
      actor_id: string;
      detail: Record<string, unknown>;
    }>(
      `select actor_id, detail from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = 'policy.published'
        order by occurred_at, id`,
      [organizationId],
    );

    return rows.map((row) => ({
      actor: row.actor_id,
      version: row.detail.version,
      previous: row.detail.previous_version,
      classification: row.detail.classification,
      loosening: row.detail.loosening_rules,
    }));
  }

  /**
   * The error code of a refusal.
   *
   * @param response - The response.
   * @returns Its envelope.
   */
  function errorOf(response: { body: unknown }): ErrorEnvelope {
    return response.body as ErrorEnvelope;
  }

  /**
   * Label the scene's ticket — the issue run #482 was opened for — so the predicates see it.
   *
   * @param at - The scene.
   * @param labels - Its labels.
   */
  async function labelTicket(at: PrPlaneScene, labels: string[]): Promise<void> {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.github_issues
              (organization_id, github_repo_id, number, title, body, state, labels,
               gh_created_at, gh_updated_at, gh_url, sizing_status)
       values ($1, $2, 482, 'Refactor the telemetry ring buffer', null, 'open', $3::jsonb,
               now(), now(), 'https://github.com/acme/helios/issues/482', 'unsized')`,
      [at.org, at.bench.workspace.repoId, JSON.stringify(labels)],
    );
  }

  describe("the publish route", () => {
    it("couples every version to one audit row, refuses conflicts and no-ops, and holds loosening to the owner", async () => {
      const owner = await api.signUp();
      const workspace: Workspace = await api.workspace(owner);
      const admin = await api.signUp();
      const member = await api.signUp();
      const viewer = await api.signUp();

      await api.join(workspace.id, admin, "admin");
      await api.join(workspace.id, member, "member");
      await api.join(workspace.id, viewer, "viewer");

      const slug = workspace.slug;

      // Below administrator: refused by the roles guard, whatever the document.
      for (const person of [member, viewer]) {
        await publish(person, slug, BASE, null)
          .expect(403)
          .expect((response) => expect(errorOf(response).code).toBe("forbidden"));
        await as(person, slug, "post", "/api/v1/policies/preview")
          .send({ document: BASE })
          .expect(403);
      }

      // From no policy — everything auto-merges, nothing is protected or capped — v7 tightens,
      // so an administrator may publish it.
      const previewed = bodyOf<PolicyPreviewResource>(
        await as(admin, slug, "post", "/api/v1/policies/preview")
          .send({ document: BASE })
          .expect(200),
      );

      expect(previewed).toMatchObject({
        baseVersion: null,
        classification: "tightening",
        requiresOwner: false,
        mayPublish: true,
      });

      const v1 = bodyOf<PublishedPolicyResource>(
        await publish(admin, slug, BASE, null).expect(201),
      );

      expect(v1).toMatchObject({ version: 1, classification: "tightening", publishedBy: admin.id });

      // v2 — an admin may tighten: one more protected glob.
      const tighter = documentWith({
        protected_paths: { enabled: true, conditions: { path_globs: ["keys/**", "boot/**"] } },
      });
      const v2 = bodyOf<PublishedPolicyResource>(
        await publish(admin, slug, tighter, 1).expect(201),
      );

      expect(v2).toMatchObject({ version: 2, classification: "tightening", publishedBy: admin.id });

      // An admin may not loosen: a raised cap is refused with nothing stored or audited.
      const looser = documentWith({
        protected_paths: tighter.protected_paths,
        spend_guard: {
          enabled: true,
          conditions: { per_run_cap_cents: 900, monthly_cap_cents: 60000 },
        },
      });

      await publish(admin, slug, looser, 2)
        .expect(403)
        .expect((response) => {
          expect(errorOf(response)).toMatchObject({
            code: "policy_loosening_requires_owner",
            details: { loosening: ["spend_guard"] },
          });
        });
      expect(
        bodyOf<PolicyPreviewResource>(
          await as(admin, slug, "post", "/api/v1/policies/preview")
            .send({ document: looser })
            .expect(200),
        ),
      ).toMatchObject({ baseVersion: 2, requiresOwner: true, mayPublish: false });
      expect(
        bodyOf<PolicyPreviewResource>(
          await as(owner, slug, "post", "/api/v1/policies/preview")
            .send({ document: looser })
            .expect(200),
        ),
      ).toMatchObject({ classification: "loosening", requiresOwner: true, mayPublish: true });
      expect(await inForce(owner, slug)).toBe(2);
      expect(await publishedTrail(workspace.id)).toHaveLength(2);

      // A stale edit and a no-op are refused, whoever sends them.
      await publish(owner, slug, looser, 1)
        .expect(409)
        .expect((response) => {
          expect(errorOf(response)).toMatchObject({
            code: "policy_version_conflict",
            details: { baseVersion: 1, currentVersion: 2 },
          });
        });
      await publish(owner, slug, tighter, 2)
        .expect(422)
        .expect((response) => expect(errorOf(response).code).toBe("policy_unchanged"));

      expect(await inForce(owner, slug)).toBe(2);

      // v3 — the owner loosens.
      await publish(owner, slug, looser, 2).expect(201);

      expect(await inForce(viewer, slug)).toBe(3);
      expect(await publishedTrail(workspace.id)).toEqual([
        {
          actor: admin.id,
          version: 1,
          previous: null,
          classification: "tightening",
          loosening: "",
        },
        { actor: admin.id, version: 2, previous: 1, classification: "tightening", loosening: "" },
        {
          actor: owner.id,
          version: 3,
          previous: 2,
          classification: "loosening",
          loosening: "spend_guard",
        },
      ]);

      const versions = await api.sql.query<{ version: number; published_by: string }>(
        `select version, published_by from ${SCHEMA_NAME}.org_policy_versions
          where organization_id = $1 order by version`,
        [workspace.id],
      );

      expect(versions.rows).toEqual([
        { version: 1, published_by: admin.id },
        { version: 2, published_by: admin.id },
        { version: 3, published_by: owner.id },
      ]);
    });
  });

  describe("each rule, at its consumer", () => {
    it("auto_merge: a member's arm follows the published rule — refused under v1, admitted under v2", async () => {
      const at = await prPlaneScene(api, host);
      const slug = at.bench.workspace.slug;
      const member = await api.signUp();

      await api.join(at.org, member, "member");
      // Granted explicitly (#485), so what refuses below is the policy, not the capability.
      await api.capability(at.org, member, true);
      await labelTicket(at, ["refactor"]);

      await publish(at.owner, slug, BASE, null).expect(201);

      const arm = () =>
        as(member, slug, "post", `/api/v1/pull-requests/${at.prId}/merge-plan/arm`).send({
          revisionId: at.revisionId,
        });

      await arm()
        .expect(403)
        .expect((response) => {
          expect(errorOf(response)).toMatchObject({
            code: "merge_not_policy_eligible",
            details: { ruleId: "auto_merge", policyVersion: 1 },
          });
        });

      // v2 drops the refactor exclusion: the same member, the same PR, now armable.
      await publish(
        at.owner,
        slug,
        documentWith({ auto_merge: { enabled: true, conditions: { label: "refactor" } } }),
        1,
      ).expect(201);

      await arm().expect(200);
    });

    it("dry_run_new_repos: the owner's arm is held inside the first loops, and released when the rule is", async () => {
      const at = await prPlaneScene(api, host);
      const slug = at.bench.workspace.slug;

      await publish(at.owner, slug, BASE, null).expect(201);

      // An admin may turn the rule on — tightening — and run #482 is loop 1 of its repository.
      const admin = await api.signUp();

      await api.join(at.org, admin, "admin");
      await publish(
        admin,
        slug,
        documentWith({ dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } } }),
        1,
      ).expect(201);

      const arm = () =>
        as(at.owner, slug, "post", `/api/v1/pull-requests/${at.prId}/merge-plan/arm`).send({
          revisionId: at.revisionId,
        });

      await arm()
        .expect(409)
        .expect((response) => {
          expect(errorOf(response)).toMatchObject({
            code: "dry_run_policy_active",
            details: { source: "dry_run_new_repos", policyVersion: 2 },
          });
        });

      // Lowering N loosens — the owner's — and zero loops is a rule that never applies.
      await publish(
        at.owner,
        slug,
        documentWith({ dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 0 } } }),
        2,
      ).expect(201);

      await arm().expect(200);
    });

    it("human_review: the gate engine's human_approval names the version that requires it, and drops it when the rule does", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const slug = at.bench.workspace.slug;

      await labelTicket(at, ["refactor"]);

      /** Re-sync the PR and read its human_approval definition. */
      const humanApproval = async () => {
        await api.nest.get(PrSyncService).sync(at.org, at.sourceId, at.prNumber);

        return (
          await api.sql.query<{ required: boolean; source: string }>(
            `select required, source from ${SCHEMA_NAME}.pr_gate_definitions
              where pr_id = $1 and gate_key = 'human_approval'`,
            [at.prId],
          )
        ).rows[0];
      };

      await publish(at.owner, slug, BASE, null).expect(201);

      expect(await humanApproval()).toEqual({
        required: true,
        source: "standard-fix@v1 pin + org policy v1: refactor → human review",
      });

      // v2 reviews only security work: the refactor PR no longer needs a human by policy.
      await publish(
        at.owner,
        slug,
        documentWith({ human_review: { enabled: true, conditions: { label: "security" } } }),
        1,
      ).expect(201);

      expect((await humanApproval()).source).not.toContain("org policy");
    });

    it("protected_paths: a published glob fails the very next change-set that touches it — the cache does not hold the old version", async () => {
      const at = await prPlaneScene(api, host);
      const slug = at.bench.workspace.slug;
      let changeSet = 0;

      /** Report a change-set touching the boot file, and read AP.3's verdict on it. */
      const judged = async () => {
        changeSet += 1;
        await api
          .anonymous("put", `/internal/runs/${at.runId}/files`)
          .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
          .send({
            idempotencyKey: `files-${String(changeSet)}`,
            files: [{ path: BOOT_FILE, status: "modified", additions: 2, deletions: 1 }],
          })
          .expect(200);

        return (
          await api.sql.query<{ verdict: string }>(
            `select verdict from ${SCHEMA_NAME}.v_run_guardrails_latest
              where run_id = $1 and "check" = 'allowed_paths'`,
            [at.runId],
          )
        ).rows[0]?.verdict;
      };

      await publish(at.owner, slug, BASE, null).expect(201);

      // Judged under v1 — `keys/**` only — which also warms the resolver's cache with v1.
      expect(await judged()).toBe("pass");

      const admin = await api.signUp();

      await api.join(at.org, admin, "admin");
      await publish(
        admin,
        slug,
        documentWith({
          protected_paths: { enabled: true, conditions: { path_globs: ["keys/**", "boot/**"] } },
        }),
        1,
      ).expect(201);

      expect(await judged()).toBe("fail");

      const filed = await api.sql.query<{ count: number }>(
        `select count(*)::int as count from ${SCHEMA_NAME}.decision_items
          where organization_id = $1 and kind_id = 'protected_path_allow_once'`,
        [at.org],
      );

      expect(filed.rows[0].count).toBe(1);
    });

    it("spend_guard: the routing resolution's per-run cap is the guard's while it is stricter, and the route's once it is not", async () => {
      const owner = await api.signUp();
      const bench = await seedRoutingBench(api, owner);
      const admin = await api.signUp();

      await api.join(bench.id, admin, "admin");

      /** The implement route's resolution. */
      const resolved = async () =>
        bodyOf<Resolution>(
          await as(owner, bench.slug, "post", "/api/v1/routing/simulate")
            .send({ taskKind: "implement" })
            .expect(200),
        );

      // No policy — the route's own cap — and the resolver's cache now holds "none".
      expect(await resolved()).toMatchObject({
        maxCostCents: BENCH_MAX_COST_CENTS,
        costCap: { limit: "route", ruleId: null },
      });

      await publish(owner, bench.slug, BASE, null).expect(201);
      // An admin lowers the guard below the route's cap — tightening.
      await publish(
        admin,
        bench.slug,
        documentWith({
          spend_guard: {
            enabled: true,
            conditions: { per_run_cap_cents: 100, monthly_cap_cents: 60000 },
          },
        }),
        1,
      ).expect(201);

      expect(await resolved()).toMatchObject({
        maxCostCents: 100,
        costCap: { limit: "spend_guard", ruleId: "spend_guard", policyVersion: 2 },
      });

      // The owner raises it above the route's: the stricter of the two is the route's again.
      await publish(
        owner,
        bench.slug,
        documentWith({
          spend_guard: {
            enabled: true,
            conditions: { per_run_cap_cents: 900, monthly_cap_cents: 60000 },
          },
        }),
        2,
      ).expect(201);

      expect(await resolved()).toMatchObject({
        maxCostCents: BENCH_MAX_COST_CENTS,
        costCap: { limit: "route", ruleId: null },
      });
    });
  });
});
