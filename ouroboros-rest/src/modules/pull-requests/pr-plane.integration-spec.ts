import { createHash } from "node:crypto";

import { ApiHarness, type Person, type Workspace } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { routeTable } from "../auth/route.table.fixture";
import { BUILT_IN_GATE_KEYS, PR_GATE_VERDICTS, SCHEMA_NAME } from "../db/schema";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { InMemoryPrHost } from "../ticket-sources/providers/in-memory.pr.fixture";
import {
  IN_MEMORY_PROJECT,
  IN_MEMORY_TOKEN,
} from "../ticket-sources/providers/in-memory.provider.fixture";
import { hasPrCommentMarker } from "../ticket-sources/ticket-source.pr";
import { waiverAnnotationKey } from "./criteria/criteria.annotation";
import { CriteriaService } from "./criteria/criteria.service";
import { aggregate } from "./gates/gate.engine";
import { HEADERLESS } from "./gates/gate.matrix.fixture";
import { EVIDENCE_COMMENT_KEY } from "./merge/merge.evidence";
import { MergeExecutorService } from "./merge/merge.executor";
import { threadMirrorKey } from "./page/page.mirror";
import type {
  PullRequestPageResource,
  ReturnToLoopResource,
  ReviewOutcomeResource,
  ThreadResolutionResource,
} from "./page/page.resources";
import { composeSteer } from "./page/page.steer";
import {
  HIL_RED_EVIDENCE,
  MOCKUP_BRANCH,
  MOCKUP_WAIVER_REASON,
  PrPlaneHosts,
  TESTS_RED_EVIDENCE,
  one,
  prPlaneScene,
  verdict,
  type PrPlaneScene,
} from "./pr-plane.integration.fixture";
import { PrSyncService } from "./pr-sync.service";

/**
 * **The PR plane's integration suites** — AX.6 ([#362](https://github.com/NobuData/ouroboros/issues/362)).
 *
 * The suites guarding the logic whose failures throw nothing: a merge re-check that stopped
 * checking, a comment marker that stopped deduplicating, a gate engine that stopped re-judging.
 * Each runs on the application the harness built, with one provider replaced — the registry — so
 * the routes, the merge executor, the gate engine and the head actions all reach the in-memory git
 * host (`pr-plane.integration.fixture.ts`), and every case reads the host's own ledger.
 *
 *   * **TOCTOU** — a gate flips red, the head moves (recorded, and on the host only), the host
 *     reports a conflict, branch protection refuses: each disarms with its reason and **nothing
 *     merges**. A control case merges the same scene, so the refusals are the re-check's.
 *   * **Publish idempotency** — the evidence summary and waiver annotations are edited under their
 *     keys across repeated publishes and the merge; the host holds one comment per key.
 *   * **Gates** — every gate × every verdict through V056's aggregate and the engine's, which must
 *     agree; a push synced from the host produces a **new** snapshot and leaves the prior intact; a
 *     headerless new file turns the license layer red with the file named.
 *   * **Head actions** — *Return to loop*'s steer is the selected gates' evidence, in the run's
 *     control and transcript; *Request human review* flips human approval and lists the PR as
 *     needing someone; an approval turns it green. *Reply and resolve* (#368) writes the arc
 *     once, mirrors the reply under the entry's key, and leaves who said what untouched.
 *   * **Roles** — arm, merge, waive and approve refused server-side for a role that may not, even
 *     with a request the UI would never send, and nothing written.
 *   * **Isolation** — every route the epic added, enumerated from the route table, is a `404` to
 *     another workspace.
 *
 * The recorded-GitHub half of the comment marker is `ticket-sources/providers/github.pr.integration-spec.ts`,
 * which `.dependency-cruiser.cjs` keeps out of this directory.
 *
 * **Mutation checks** (demonstrated in #362's PR):
 *   * `recheckVerification` skipping its `gate_red` branch → "disarms, never merges, when a gate
 *     flips red…" red, alone; the executor ignoring the whole verification half → every TOCTOU
 *     case red; ignoring the host half → the host-head and conflict cases red.
 *   * `withPrCommentMarker` dropping the marker → both publish cases red, and both of the recorded
 *     GitHub round trip's.
 *   * `PrSyncService.sync` no longer notifying the engine → "judges a revision synced from the
 *     host as a new snapshot…" and the license case red.
 *
 * ```bash
 * env -u OURO_DATABASE_URL yarn test:integration src/modules/pull-requests/pr-plane
 * ```
 */

describe("the PR plane, on the application's own services", () => {
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

  /** Let every scheduled merge finish, then empty the database. */
  async function clean(): Promise<void> {
    await executor().settled();
    await api.truncate();
  }

  /** @returns The application's merge executor. */
  function executor(): MergeExecutorService {
    return api.nest.get(MergeExecutorService);
  }

  /** The owner, as the executor names an actor. */
  function ownerOf(at: PrPlaneScene) {
    return { id: at.owner.id, roles: ["owner" as const] };
  }

  /** The plan row. */
  function plan(prId: string) {
    return one<{
      armed: boolean;
      disarm_reason: string | null;
      merged_result: { actions_executed: string[] } | null;
    }>(
      api,
      `select armed, disarm_reason, merged_result from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1`,
      [prId],
    );
  }

  /** The PR's state. */
  async function stateOf(prId: string): Promise<string> {
    return (
      await one<{ state: string }>(
        api,
        `select state from ${SCHEMA_NAME}.pull_requests where id = $1`,
        [prId],
      )
    ).state;
  }

  /** The comments the host holds on the scene's PR: `[commentId, body]`. */
  function commentsOn(at: PrPlaneScene): (readonly [string, string])[] {
    return host
      .ledger()
      .comments.filter(([number]) => number === at.prNumber)
      .map(([, id, body]) => [id, body] as const);
  }

  /** A call to the public API as somebody, in the scene's workspace. */
  function as(person: Person, at: PrPlaneScene, method: "get" | "post", path: string) {
    return api.as(person)(method, path).set(TENANT_HEADER, at.bench.workspace.slug);
  }

  /** Arm as the owner against revision 1, and let the arm's own re-check settle (still pending). */
  async function arm(at: PrPlaneScene): Promise<void> {
    await executor().arm(at.org, at.prId, ownerOf(at), at.revisionId);
    await executor().settled();

    expect(await plan(at.prId)).toMatchObject({ armed: true, merged_result: null });
  }

  /** What the gate engine's listener does after an evaluation: re-check the armed plan. */
  async function fire(at: PrPlaneScene): Promise<void> {
    executor().schedule(at.org, at.prId);
    await executor().settled();
  }

  describe("TOCTOU: the merge re-check between arming and firing", () => {
    afterEach(async () => {
      host.protect(false);
      await clean();
    });

    /**
     * The four promises of the re-check: disarmed with the reason's code, no merge on the host, no
     * issue closed by it, no merge recorded, and the PR not merged.
     */
    async function expectRefused(at: PrPlaneScene, code: string): Promise<void> {
      const stored = await plan(at.prId);

      expect(host.ledger().merged).not.toContain(at.prNumber);
      expect(host.ledger().closedIssues).not.toContain(at.issue);
      expect(stored.armed).toBe(false);
      expect(stored.merged_result).toBeNull();
      expect(stored.disarm_reason).toMatch(new RegExp(`^${code}: `));
      expect(["verifying", "blocked"]).toContain(await stateOf(at.prId));
    }

    it("merges the same scene when nothing moved — the refusals below are the re-check's", async () => {
      const at = await prPlaneScene(api, host);

      await arm(at);
      await verdict(api, at.gates.test_suite, at.revisionId, "green", "63/63 after attempt 4");
      await fire(at);

      expect(host.ledger().merged).toEqual([at.prNumber]);
      expect((await plan(at.prId)).merged_result).not.toBeNull();
    });

    it("disarms, never merges, when a gate flips red between arm and fire", async () => {
      const at = await prPlaneScene(api, host);

      await arm(at);
      await verdict(api, at.gates.build, at.revisionId, "red", "forge-01 · exit 2");
      await verdict(api, at.gates.test_suite, at.revisionId, "green", "63/63 after attempt 4");
      await fire(at);

      await expectRefused(at, "gate_red");
      expect((await plan(at.prId)).disarm_reason).toBe("gate_red: Build is red on revision 1.");
    });

    it("disarms, never merges, when a new revision is recorded after arming", async () => {
      const at = await prPlaneScene(api, host);

      await arm(at);
      await verdict(api, at.gates.test_suite, at.revisionId, "green", "63/63 after attempt 4");
      host.push(MOCKUP_BRANCH, [
        { path: "drivers/can/telemetry_buf.c", additions: 2, deletions: 0 },
      ]);
      await api.nest.get(PrSyncService).sync(at.org, at.sourceId, at.prNumber);
      await fire(at);

      await expectRefused(at, "head_moved");
    });

    it("disarms, never merges, when the host's head moved and the mirror has not seen it", async () => {
      const at = await prPlaneScene(api, host);

      await arm(at);
      await verdict(api, at.gates.test_suite, at.revisionId, "green", "63/63 after attempt 4");
      host.push(MOCKUP_BRANCH, [
        { path: "drivers/can/telemetry_buf.c", additions: 2, deletions: 0 },
      ]);
      await fire(at);

      await expectRefused(at, "host_head_moved");
    });

    it("disarms, never merges, when the host reports a conflict", async () => {
      const at = await prPlaneScene(api, host);

      await arm(at);
      await verdict(api, at.gates.test_suite, at.revisionId, "green", "63/63 after attempt 4");
      host.conflict(at.prNumber);
      await fire(at);

      await expectRefused(at, "host_conflict");
    });

    it("disarms, never merges, when branch protection refuses the merge", async () => {
      const at = await prPlaneScene(api, host);

      await arm(at);
      await verdict(api, at.gates.test_suite, at.revisionId, "green", "63/63 after attempt 4");
      host.protect();
      await fire(at);

      await expectRefused(at, "host_refused");
      expect((await plan(at.prId)).disarm_reason).toContain("branch protection");
    });
  });

  describe("publish idempotency: comments and annotations are edited, never duplicated", () => {
    afterEach(clean);

    it("edits the evidence summary across repeated publishes — one comment, the latest body", async () => {
      const at = await prPlaneScene(api, host);
      const sync = api.nest.get(PrSyncService);
      const publish = (body: string) =>
        sync.comment(at.org, at.sourceId, at.prNumber, { key: EVIDENCE_COMMENT_KEY, body });

      const first = await publish("Evidence · revision 1");
      const second = await publish("Evidence · revision 1 (re-published)");
      const third = await publish("Evidence · revision 2");
      const comments = commentsOn(at);

      expect([first.mode, second.mode, third.mode]).toEqual(["created", "edited", "edited"]);
      expect(new Set([first.commentId, second.commentId, third.commentId]).size).toBe(1);
      expect(comments).toHaveLength(1);
      expect(comments[0][1]).toContain("Evidence · revision 2");
      expect(comments[0][1]).not.toContain("revision 1");
    });

    it("keeps one comment per key through re-waives and the merge — the merge edits a summary a previous attempt left", async () => {
      const at = await prPlaneScene(api, host);
      const criteria = api.nest.get(CriteriaService);
      const actor = { id: at.owner.id, name: at.owner.displayName };
      const claim = await criteria.create(at.org, at.prId, actor, {
        claim: "Flake must not reappear across temperature range",
      });

      await criteria.waive(at.org, at.prId, claim.id, actor, { reason: "chamber down" });
      await criteria.waive(at.org, at.prId, claim.id, actor, { reason: MOCKUP_WAIVER_REASON });
      // A summary an earlier attempt published before its transaction was lost.
      await api.nest.get(PrSyncService).comment(at.org, at.sourceId, at.prNumber, {
        key: EVIDENCE_COMMENT_KEY,
        body: "stale summary from an earlier attempt",
      });

      await arm(at);
      await verdict(api, at.gates.test_suite, at.revisionId, "green", "63/63 after attempt 4");
      await fire(at);

      const comments = commentsOn(at);
      const waivers = comments.filter(([, body]) =>
        hasPrCommentMarker(body, waiverAnnotationKey(claim.id)),
      );
      const summaries = comments.filter(([, body]) =>
        hasPrCommentMarker(body, EVIDENCE_COMMENT_KEY),
      );

      expect(host.ledger().merged).toEqual([at.prNumber]);
      expect((await plan(at.prId)).merged_result?.actions_executed).toContain("comment_evidence");
      expect(comments).toHaveLength(2);
      expect(waivers).toHaveLength(1);
      expect(waivers[0][1]).toContain(MOCKUP_WAIVER_REASON);
      expect(waivers[0][1]).not.toContain("chamber down");
      expect(summaries).toHaveLength(1);
      expect(summaries[0][1]).not.toContain("stale summary");
      expect(summaries[0][1]).toContain(MOCKUP_WAIVER_REASON);
    });
  });

  describe("gates: the verdict matrix, snapshots per revision, license evidence", () => {
    afterEach(clean);

    /** A distinct forty-character head for a synthetic revision. */
    function sha(label: string): string {
      return createHash("sha1").update(label).digest("hex");
    }

    it("counts every gate × every verdict by one rule — V056's aggregate and the engine's agree", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const keys = BUILT_IN_GATE_KEYS.filter((key) => at.gates[key] !== undefined);
      let seq = 1;

      expect(keys).toHaveLength(BUILT_IN_GATE_KEYS.length);
      // Every gate required, so every cell decides the aggregate.
      await api.sql.query(
        `update ${SCHEMA_NAME}.pr_gate_definitions set required = true where pr_id = $1`,
        [at.prId],
      );

      for (const gate of keys) {
        for (const value of PR_GATE_VERDICTS) {
          seq += 1;

          const revision = await one<{ id: string }>(
            api,
            `insert into ${SCHEMA_NAME}.pr_revisions (pr_id, revision_seq, head_sha, pushed_at)
             values ($1, $2, $3, now()) returning id`,
            [at.prId, seq, sha(`${gate}:${value}`)],
          );
          const verdicts = keys.map((key) => (key === gate ? value : "green"));

          await api.sql.query(
            `insert into ${SCHEMA_NAME}.pr_gate_results
                    (definition_id, revision_id, verdict, evidence, provider_version, evaluated_at)
             select d, $2, v, 'the matrix', 'gate-test@1.0.0',
                    clock_timestamp()
               from unnest($1::uuid[], $3::text[]) as cell(d, v)`,
            [keys.map((key) => at.gates[key]), revision.id, verdicts],
          );

          const database = await one<{
            required_count: number;
            green_count: number;
            red_count: number;
            satisfied_count: number;
            merge_ready: boolean;
          }>(api, `select * from ${SCHEMA_NAME}.pr_gate_aggregate($1)`, [revision.id]);
          const engine = aggregate(verdicts.map((each) => ({ required: true, verdict: each })));
          const satisfies = ["green", "waived", "not_required"].includes(value);

          expect({ gate, value, ...database }).toEqual({
            gate,
            value,
            required_count: engine.requiredCount,
            green_count: engine.greenCount,
            red_count: engine.redCount,
            satisfied_count: engine.satisfiedCount,
            merge_ready: engine.mergeReady,
          });
          expect({ gate, value, mergeReady: database.merge_ready }).toEqual({
            gate,
            value,
            mergeReady: satisfies,
          });
          expect(database.red_count).toBe(value === "red" ? 1 : 0);
        }
      }
    });

    it("judges a revision synced from the host as a new snapshot, leaving the prior one intact", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const rows = async (seq: number) =>
        (
          await api.sql.query<Record<string, unknown>>(
            `select r.* from ${SCHEMA_NAME}.pr_gate_results r
               join ${SCHEMA_NAME}.pr_revisions v on v.id = r.revision_id
              where v.pr_id = $1 and v.revision_seq = $2 order by r.id`,
            [at.prId, seq],
          )
        ).rows;
      const before = await rows(1);

      expect(before).toHaveLength(BUILT_IN_GATE_KEYS.length);

      host.push(MOCKUP_BRANCH, [
        { path: "drivers/can/telemetry_buf.c", additions: 2, deletions: 1 },
      ]);

      const synced = await api.nest.get(PrSyncService).sync(at.org, at.sourceId, at.prNumber);

      expect(synced).toMatchObject({ revisionSeq: 2, newRevision: true });
      expect(await rows(2)).toHaveLength(BUILT_IN_GATE_KEYS.length);
      expect(await rows(1)).toEqual(before);
    });

    it("turns the license layer red for a headerless new file, naming the file", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const patch = HEADERLESS.slice(HEADERLESS.indexOf("\n") + 1);

      host.push(MOCKUP_BRANCH, [
        { path: "drivers/can/can_filter.c", additions: 2, deletions: 0, patch },
      ]);
      await api.nest.get(PrSyncService).sync(at.org, at.sourceId, at.prNumber);

      const latest = await one<{ verdict: string; evidence: string }>(
        api,
        `select l.verdict, l.evidence from ${SCHEMA_NAME}.pr_gate_results_latest l
           join ${SCHEMA_NAME}.pr_revisions v on v.id = l.revision_id
          where v.pr_id = $1 and v.revision_seq = 2 and l.gate_key = 'secrets_license'`,
        [at.prId],
      );

      expect(latest).toEqual({
        verdict: "red",
        evidence: expect.stringContaining(
          "license: missing SPDX header in drivers/can/can_filter.c",
        ) as unknown,
      });
    });
  });

  /**
   * Write one open, blocking review-thread entry — a seeded second opinion, watermarked.
   *
   * @param at - The scene.
   * @returns The entry's id.
   */
  async function objection(at: PrPlaneScene): Promise<string> {
    const { id } = await one<{ id: string }>(
      api,
      `insert into ${SCHEMA_NAME}.pr_thread_entries
         (pr_id, revision_id, author_kind, author_name, tag, body, blocking, simulated)
       values ($1, $2, 'model', 'cursor/composer-2', 'second opinion',
               'PID velocity sample now lags by one telemetry period.', true, true)
       returning id`,
      [at.prId, at.revisionId],
    );

    return id;
  }

  describe("head actions, over HTTP", () => {
    afterEach(clean);

    /** The engine's scene with Revision 1's two red gates, as mockup 12 draws them. */
    async function redScene(): Promise<PrPlaneScene> {
      const at = await prPlaneScene(api, host, "engine");

      await verdict(api, at.gates.test_suite, at.revisionId, "red", TESTS_RED_EVIDENCE);
      await verdict(api, at.gates.physical_hil, at.revisionId, "red", HIL_RED_EVIDENCE);

      return at;
    }

    it("Return to loop: the run's steer and transcript are the selected gates' evidence, in the card's order", async () => {
      const at = await redScene();
      const note = "keep the PID loop on its own timer";
      const expected = composeSteer(
        [
          { key: "test_suite", evidence: TESTS_RED_EVIDENCE },
          { key: "physical_hil", evidence: HIL_RED_EVIDENCE },
        ],
        note,
      );
      const answered = bodyOf<ReturnToLoopResource>(
        await as(at.owner, at, "post", `/api/v1/pull-requests/${at.prId}/return-to-loop`)
          .send({ gates: ["physical_hil", "test_suite"], note })
          .expect(200),
      );
      const control = await one<{ kind: string; payload: string; retry_stage: boolean }>(
        api,
        `select kind, payload, retry_stage from ${SCHEMA_NAME}.run_controls where id = $1`,
        [answered.control.id],
      );
      const transcript = await one<{ body: string }>(
        api,
        `select body from ${SCHEMA_NAME}.run_events
          where run_id = $1 and payload->>'controlId' = $2`,
        [at.runId, answered.control.id],
      );
      const loopReturn = await one<{ gate_keys: string[]; revision_id: string }>(
        api,
        `select gate_keys, revision_id from ${SCHEMA_NAME}.pr_loop_returns where pr_id = $1`,
        [at.prId],
      );

      expect(answered.payload).toBe(expected);
      expect(control).toEqual({ kind: "steer", payload: expected, retry_stage: true });
      expect(transcript.body).toBe(expected);
      expect(loopReturn).toEqual({
        gate_keys: ["test_suite", "physical_hil"],
        revision_id: at.revisionId,
      });
    });

    it("Return to loop refuses a gate that is not red, and queues nothing", async () => {
      const at = await redScene();

      await as(at.owner, at, "post", `/api/v1/pull-requests/${at.prId}/return-to-loop`)
        .send({ gates: ["build"] })
        .expect(422)
        .expect((response) => {
          expect((response.body as { code: string }).code).toBe("pr_gate_not_red");
        });

      const { rows } = await api.sql.query(
        `select 1 from ${SCHEMA_NAME}.run_controls where run_id = $1`,
        [at.runId],
      );

      expect(rows).toEqual([]);
    });

    it("Request human review flips human approval to required, asks the host, and lists the PR as needing someone; approving turns it green", async () => {
      const at = await redScene();
      const before = await one<{ verdict: string }>(
        api,
        `select verdict from ${SCHEMA_NAME}.pr_gate_results_latest
          where revision_id = $1 and gate_key = 'human_approval'`,
        [at.revisionId],
      );
      const requested = bodyOf<ReviewOutcomeResource>(
        await as(at.owner, at, "post", `/api/v1/pull-requests/${at.prId}/request-review`)
          .send({ reviewer: "octo-reviewer" })
          .expect(200),
      );
      const needsYou = await as(
        at.owner,
        at,
        "get",
        "/api/v1/pull-requests?reviewRequested=true",
      ).expect(200);
      const trail = await one<{ action: string; actor_id: string }>(
        api,
        `select action, actor_id from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and subject_type = 'pr_approval'`,
        [at.org],
      );

      expect(before.verdict).toBe("not_required");
      expect(requested.created).toBe(true);
      expect(requested.humanApproval).toMatchObject({ required: true, verdict: "pending" });
      expect(requested.review.host).toEqual({
        reviewer: "octo-reviewer",
        state: "requested",
        detail: null,
      });
      expect([...host.pull(IN_MEMORY_TOKEN, IN_MEMORY_PROJECT, at.prNumber).reviewers]).toEqual([
        "octo-reviewer",
      ]);
      expect(JSON.stringify(needsYou.body)).toContain(at.prId);
      expect(trail).toEqual({ action: "pr_approval.requested", actor_id: at.owner.id });

      const approved = bodyOf<ReviewOutcomeResource>(
        await as(at.owner, at, "post", `/api/v1/pull-requests/${at.prId}/approvals`)
          .send({ decision: "approve", note: "reviewed the ISR path" })
          .expect(200),
      );

      expect(approved.humanApproval).toMatchObject({ verdict: "green" });
    });

    it("Reply and resolve writes the arc once, mirrors the reply under the entry's key, and the page reads it back (#368)", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const entryId = await objection(at);
      const path = `/api/v1/pull-requests/${at.prId}/thread/${entryId}/resolve`;
      const reply = "Addressed in attempt 4 — sampling decoupled from telemetry drain.";

      const resolved = bodyOf<ThreadResolutionResource>(
        await as(at.owner, at, "post", path).send({ reply, mirror: true }).expect(200),
      );
      const page = bodyOf<PullRequestPageResource>(
        await as(at.owner, at, "get", `/api/v1/pull-requests/${at.prId}`).expect(200),
      );
      const trail = await one<{ action: string; actor_id: string; detail: string }>(
        api,
        `select action, actor_id, detail::text as detail from ${SCHEMA_NAME}.audit_events
          where organization_id = $1 and subject_type = 'pr_thread_entry' and subject_id = $2`,
        [at.org, entryId],
      );
      const mirrored = commentsOn(at).filter(([, body]) =>
        hasPrCommentMarker(body, threadMirrorKey(entryId)),
      );

      expect(resolved.entry).toMatchObject({
        id: entryId,
        authorKind: "model",
        authorName: "cursor/composer-2",
        simulated: true,
        blocking: true,
        resolved: true,
        resolutionBody: reply,
      });
      expect(resolved.mirror).toMatchObject({ state: "posted", error: null });
      expect(page.thread).toMatchObject({ entryCount: 1, openCount: 0 });
      expect(page.thread.entries[0]).toEqual(resolved.entry);
      expect(mirrored).toHaveLength(1);
      expect(mirrored[0][1]).toContain(`> ${reply}`);
      expect(mirrored[0][1]).toContain("cursor/composer-2 · second opinion · rev 1 · simulated");
      expect(mirrored[0][1]).toContain(`**Resolved by:** ${at.owner.displayName}`);
      expect(trail).toMatchObject({ action: "pr_thread.resolved", actor_id: at.owner.id });
      expect(trail.detail).not.toContain("Addressed in attempt 4");

      // One-way: a second resolution is refused, and the reply stands.
      const again = await as(at.owner, at, "post", path).send({ reply: "Never mind." }).expect(409);
      const stored = await one<{ resolution_body: string }>(
        api,
        `select resolution_body from ${SCHEMA_NAME}.pr_thread_entries where id = $1`,
        [entryId],
      );

      expect(again.body).toMatchObject({ code: "pr_thread_entry_resolved" });
      expect(stored.resolution_body).toBe(reply);
      expect(
        commentsOn(at).filter(([, body]) => hasPrCommentMarker(body, threadMirrorKey(entryId))),
      ).toHaveLength(1);
    });
  });

  describe("role gates, held server-side", () => {
    afterEach(clean);

    it("refuses a viewer every write — arm, merge, approve, waive, return, review, resolve — even with a well-formed request", async () => {
      const at = await prPlaneScene(api, host, "engine");
      const entryId = await objection(at);
      const viewer = await api.signUp();
      const criterion = await api.nest.get(CriteriaService).create(
        at.org,
        at.prId,
        { id: at.owner.id, name: at.owner.displayName },
        {
          claim: "Telemetry frames must arrive in ISR order under load",
        },
      );

      await api.join(at.org, viewer, "viewer");

      const base = `/api/v1/pull-requests/${at.prId}`;
      const writes: [string, object][] = [
        [`${base}/merge-plan/arm`, { revisionId: at.revisionId }],
        [`${base}/merge-plan/merge`, {}],
        [`${base}/approvals`, { decision: "approve" }],
        [`${base}/criteria/${criterion.id}/waive`, { reason: MOCKUP_WAIVER_REASON }],
        [`${base}/return-to-loop`, { gates: ["physical_hil"] }],
        [`${base}/request-review`, {}],
        [`${base}/thread/${entryId}/resolve`, { reply: "Looks fine to me." }],
      ];

      for (const [path, body] of writes) {
        await as(viewer, at, "post", path).send(body).expect(403);
      }

      const written = await one<{
        armed: number;
        approvals: number;
        waivers: number;
        controls: number;
        resolved: number;
      }>(
        api,
        `select (select count(*) from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1 and armed)::int as armed,
                (select count(*) from ${SCHEMA_NAME}.pr_approvals where pr_id = $1)::int as approvals,
                (select count(*) from ${SCHEMA_NAME}.pr_waivers where organization_id = $2)::int as waivers,
                (select count(*) from ${SCHEMA_NAME}.run_controls where run_id = $3)::int as controls,
                (select count(*) from ${SCHEMA_NAME}.pr_thread_entries where pr_id = $1 and resolved)::int as resolved`,
        [at.prId, at.org, at.runId],
      );

      expect(written).toEqual({ armed: 0, approvals: 0, waivers: 0, controls: 0, resolved: 0 });
      expect(host.ledger().merged).toEqual([]);
    });

    it("refuses a member the waive, and the arm and merge of a PR whose policy does not auto-merge", async () => {
      const at = await prPlaneScene(api, host);
      const member = await api.signUp();
      const criterion = await api.nest.get(CriteriaService).create(
        at.org,
        at.prId,
        { id: at.owner.id, name: at.owner.displayName },
        {
          claim: "No regression in e-stop response envelope",
        },
      );

      await api.join(at.org, member, "member");
      // No run, so no pinned workflow to auto-merge under: arming is an administrator's.
      await api.sql.query(`update ${SCHEMA_NAME}.pull_requests set run_id = null where id = $1`, [
        at.prId,
      ]);

      const base = `/api/v1/pull-requests/${at.prId}`;

      await as(member, at, "post", `${base}/criteria/${criterion.id}/waive`)
        .send({ reason: MOCKUP_WAIVER_REASON })
        .expect(403);

      for (const path of [`${base}/merge-plan/arm`, `${base}/merge-plan/merge`]) {
        await as(member, at, "post", path)
          .send(path.endsWith("arm") ? { revisionId: at.revisionId } : {})
          .expect(403)
          .expect((response) => {
            expect((response.body as { code: string }).code).toBe("merge_not_policy_eligible");
          });
      }

      expect(await plan(at.prId)).toBeUndefined();
      expect(host.ledger().merged).toEqual([]);
    });
  });

  describe("isolation: every route of the epic is a 404 to another workspace", () => {
    let at: PrPlaneScene;
    let criterionId: string;
    let evidenceId: string;
    let entryId: string;
    let stranger: Person;
    let elsewhere: Workspace;
    /** The scene's host — the top-level `beforeEach` swaps `host` before every case. */
    let sceneHost: InMemoryPrHost;

    beforeAll(async () => {
      sceneHost = hosts.reset();
      at = await prPlaneScene(api, sceneHost, "engine");

      const criteria = api.nest.get(CriteriaService);
      const created = await criteria.create(
        at.org,
        at.prId,
        { id: at.owner.id, name: at.owner.displayName },
        { claim: "Telemetry frames must arrive in ISR order under load" },
      );
      const cited = await criteria.attach(at.org, at.prId, created.id, {
        kind: "analysis_note",
        note: "static K_MSGQ_DEFINE · stack analysis clean",
      });

      criterionId = created.id;
      evidenceId = cited.evidence[0].id;
      entryId = await objection(at);
      stranger = await api.signUp();
      elsewhere = await api.workspace(stranger);
    });

    afterAll(clean);

    /** The PR's routes: the path filled from the scene, and the body a write sends. */
    const CASES: Record<string, { path: () => string; body?: () => object }> = {
      "GET /api/v1/pull-requests/:id": { path: () => pr("") },
      "POST /api/v1/pull-requests/:id/return-to-loop": {
        path: () => pr("/return-to-loop"),
        body: () => ({ gates: ["physical_hil"] }),
      },
      "POST /api/v1/pull-requests/:id/request-review": { path: () => pr("/request-review") },
      "POST /api/v1/pull-requests/:id/approvals": {
        path: () => pr("/approvals"),
        body: () => ({ decision: "approve" }),
      },
      "POST /api/v1/pull-requests/:id/thread/:entryId/resolve": {
        path: () => pr(`/thread/${entryId}/resolve`),
        body: () => ({ reply: "a stranger's reply" }),
      },
      "GET /api/v1/pull-requests/:id/merge-plan": { path: () => pr("/merge-plan") },
      "POST /api/v1/pull-requests/:id/merge-plan/arm": {
        path: () => pr("/merge-plan/arm"),
        body: () => ({ revisionId: at.revisionId }),
      },
      "POST /api/v1/pull-requests/:id/merge-plan/disarm": { path: () => pr("/merge-plan/disarm") },
      "POST /api/v1/pull-requests/:id/merge-plan/merge": { path: () => pr("/merge-plan/merge") },
      "GET /api/v1/pull-requests/:id/criteria": { path: () => pr("/criteria") },
      "POST /api/v1/pull-requests/:id/criteria": {
        path: () => pr("/criteria"),
        body: () => ({ claim: "A stranger's claim" }),
      },
      "POST /api/v1/pull-requests/:id/criteria/import": { path: () => pr("/criteria/import") },
      "PUT /api/v1/pull-requests/:id/criteria/order": {
        path: () => pr("/criteria/order"),
        body: () => ({ criterionIds: [criterionId] }),
      },
      "PATCH /api/v1/pull-requests/:id/criteria/:criterionId": {
        path: () => pr(`/criteria/${criterionId}`),
        body: () => ({ claim: "A stranger's edit" }),
      },
      "DELETE /api/v1/pull-requests/:id/criteria/:criterionId": {
        path: () => pr(`/criteria/${criterionId}`),
      },
      "POST /api/v1/pull-requests/:id/criteria/:criterionId/evidence": {
        path: () => pr(`/criteria/${criterionId}/evidence`),
        body: () => ({ kind: "analysis_note", note: "a stranger's note" }),
      },
      "DELETE /api/v1/pull-requests/:id/criteria/:criterionId/evidence/:evidenceId": {
        path: () => pr(`/criteria/${criterionId}/evidence/${evidenceId}`),
      },
      "POST /api/v1/pull-requests/:id/criteria/:criterionId/verify": {
        path: () => pr(`/criteria/${criterionId}/verify`),
      },
      "POST /api/v1/pull-requests/:id/criteria/:criterionId/unverify": {
        path: () => pr(`/criteria/${criterionId}/unverify`),
      },
      "POST /api/v1/pull-requests/:id/criteria/:criterionId/waive": {
        path: () => pr(`/criteria/${criterionId}/waive`),
        body: () => ({ reason: "a stranger's waiver" }),
      },
    };

    /**
     * @param tail - The route's tail.
     * @returns The scene's PR route.
     */
    function pr(tail: string): string {
      return `/api/v1/pull-requests/${at.prId}${tail}`;
    }

    /** The epic's routes the application registered. */
    function epicRoutes(): string[] {
      return routeTable(api.nest)
        .map((route) => route.signature)
        .filter((signature) => / \/api\/v1\/pull-requests(\/|$)/.test(signature));
    }

    it("has a case for every route the epic added — enumerated, not sampled", () => {
      expect(epicRoutes().sort()).toEqual(
        [...Object.keys(CASES), "GET /api/v1/pull-requests"].sort(),
      );
    });

    it("finds the PR by its run for its own workspace, and nothing for another (#363)", async () => {
      const listed = await as(
        at.owner,
        at,
        "get",
        `/api/v1/pull-requests?runId=${at.runId}`,
      ).expect(200);
      const elsewhereListed = await api
        .as(stranger)("get", `/api/v1/pull-requests?runId=${at.runId}`)
        .set(TENANT_HEADER, elsewhere.slug)
        .expect(200);
      const otherRun = "00000000-0000-4000-8000-000000000000";

      expect((listed.body as { items: { id: string }[] }).items.map((row) => row.id)).toEqual([
        at.prId,
      ]);
      expect((elsewhereListed.body as { items: unknown[] }).items).toEqual([]);
      expect(
        (
          (await as(at.owner, at, "get", `/api/v1/pull-requests?runId=${otherRun}`).expect(200))
            .body as { items: unknown[] }
        ).items,
      ).toEqual([]);
      expect(
        (
          (
            await as(
              at.owner,
              at,
              "get",
              `/api/v1/pull-requests?runId=${otherRun},${at.runId}`,
            ).expect(200)
          ).body as { items: { id: string }[] }
        ).items.map((row) => row.id),
      ).toEqual([at.prId]);
      await as(at.owner, at, "get", "/api/v1/pull-requests?runId=482").expect(422);
    });

    it("lists none of the PR to another workspace", async () => {
      const listed = await api
        .as(stranger)("get", "/api/v1/pull-requests")
        .set(TENANT_HEADER, elsewhere.slug)
        .expect(200);

      expect(JSON.stringify(listed.body)).not.toContain(at.prId);
    });

    it.each(Object.keys(CASES))("%s is a 404 to another workspace", async (signature) => {
      const entry = CASES[signature];
      const method = signature.slice(0, signature.indexOf(" ")).toLowerCase() as
        "get" | "post" | "put" | "patch" | "delete";

      if (method === "get") {
        await as(at.owner, at, "get", entry.path()).expect(200);
      }

      const answer = await api
        .as(stranger)(method, entry.path())
        .set(TENANT_HEADER, elsewhere.slug)
        .send(entry.body?.() ?? {})
        .expect(404);

      expect(answer.body).toMatchObject({ code: "pull_request_not_found" });
    });

    it("left the PR as it was — no stranger's write landed", async () => {
      const state = await one<{
        criteria: number;
        evidence: number;
        claim: string;
        approvals: number;
        armed: number;
        resolved: number;
      }>(
        api,
        `select (select count(*) from ${SCHEMA_NAME}.pr_thread_entries where pr_id = $1 and resolved)::int as resolved,
                (select count(*) from ${SCHEMA_NAME}.pr_criteria where pr_id = $1)::int as criteria,
                (select count(*) from ${SCHEMA_NAME}.pr_criteria_evidence where criterion_id = $2)::int as evidence,
                (select claim from ${SCHEMA_NAME}.pr_criteria where id = $2) as claim,
                (select count(*) from ${SCHEMA_NAME}.pr_approvals where pr_id = $1)::int as approvals,
                (select count(*) from ${SCHEMA_NAME}.pr_merge_plans where pr_id = $1 and armed)::int as armed`,
        [at.prId, criterionId],
      );

      expect(state).toEqual({
        criteria: 1,
        evidence: 1,
        claim: "Telemetry frames must arrive in ISR order under load",
        approvals: 0,
        armed: 0,
        resolved: 0,
      });
      expect(sceneHost.ledger().merged).toEqual([]);
    });
  });
});
