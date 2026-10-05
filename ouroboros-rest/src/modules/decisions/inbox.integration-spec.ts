/**
 * The Needs-You page's reads, snooze and policy card, against a migrated database (#464, BN.4).
 *
 *   - the queue renders its prose, resolves actions per viewer, ages items and computes the head
 *     from this week's per-kind medians — the estimate moves when the kind mix moves;
 *   - snoozing hides an item from the queue and the pill, not from the metrics, and its age runs;
 *     Snooze all is one audited event and un-snooze brings everything back;
 *   - /resolved composes each row and names a policy's answer; /stats is em-dashes on a cold org;
 *   - the policy card derives live: a published rule turned off loses its row, a changed protected
 *     path changes its text, dry-run changes the caption, and the spend row stays absent.
 */

import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { INTERNAL_KEY_HEADER } from "../engine/engine.contract";
import type { PolicyCardResource } from "../inbox-policies/inbox-policies.compose";
import { seedIngestBench, type IngestBench } from "../ingest/ingest.fixture";
import type { RunOpenedResource } from "../ingest/ingest.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { DecisionKindRegistry } from "./decision-kind.registry";
import { SEEDED_PAYLOADS } from "./decision.kinds.fixture";
import type { InboxFeedResource } from "./inbox.feed";
import type {
  InboxQueueResource,
  InboxResolvedResource,
  InboxSnoozeResource,
  InboxStatsResource,
} from "./inbox.queue";

/** A policy document holding the five core rules — human review as given. */
function document(humanReview: Record<string, unknown>): Record<string, unknown> {
  return {
    auto_merge: { enabled: false, conditions: { effort_lte: "s" } },
    human_review: humanReview,
    protected_paths: { enabled: true, conditions: { path_globs: ["boot/**"] } },
    spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250 } },
    dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
  };
}

describe("the Needs-You reads, snooze and policy card, against a migrated database", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({ OURO_BACKLOG_SYNC_INTERVAL_SECONDS: "86400" });
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  /** A workspace with a run and its ticket. */
  async function workspace(): Promise<{
    owner: Person;
    bench: IngestBench;
    run: string;
    ticket: string;
  }> {
    const owner = await api.signUp();
    const bench = await seedIngestBench(api, owner);
    const run = bodyOf<RunOpenedResource>(
      await api
        .anonymous("post", "/internal/runs")
        .set(INTERNAL_KEY_HEADER, api.configuration.engineSharedSecret)
        .send({ idempotencyKey: "open", ...bench.open })
        .expect(201),
    );
    const ticket = await api.sql.query<{ id: string }>(
      `select id from ${SCHEMA_NAME}.tickets where organization_id = $1 limit 1`,
      [bench.workspace.id],
    );

    return { owner, bench, run: run.id, ticket: ticket.rows[0].id };
  }

  /** File one item of a kind, asked `minutesAgo` before now. */
  async function file(
    org: string,
    kindId: string,
    key: string,
    refs: { type: string; id: string; label: string }[],
    minutesAgo: number,
  ): Promise<string> {
    const { itemId } = await api.nest.get(DecisionKindRegistry, { strict: false }).emit({
      organizationId: org,
      kindId,
      payload: SEEDED_PAYLOADS[kindId],
      refs: refs as never,
      key: { plane: "suite", sourceRef: key },
    });

    // An item's age is fixed when it is filed; the suite files them in the past by owner's rights.
    await api.sql.query(
      `alter table ${SCHEMA_NAME}.decision_items disable trigger decision_items_pinned;
       update ${SCHEMA_NAME}.decision_items set created_at = now() - make_interval(mins => ${String(minutesAgo)})
        where id = '${String(itemId)}';
       alter table ${SCHEMA_NAME}.decision_items enable trigger decision_items_pinned;`,
    );

    return itemId ?? "";
  }

  /** Answer an item as a person, `latency` seconds after it was asked. */
  async function answer(
    itemId: string,
    org: string,
    action: string,
    userId: string,
    latency: number,
    note: string | null = null,
  ) {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.decision_resolutions
              (item_id, organization_id, action_id, resolver, resolved_by_user, channel, note, resolved_at)
       select id, organization_id, $2, 'human', $3, 'web', $6, created_at + make_interval(secs => $4)
         from ${SCHEMA_NAME}.decision_items where id = $1 and organization_id = $5`,
      [itemId, action, userId, latency, org, note],
    );
  }

  /** GET as somebody in the workspace. */
  function get(person: Person, slug: string, path: string) {
    return api.as(person)("get", path).set(TENANT_HEADER, slug);
  }

  /** POST as somebody in the workspace. */
  function post(person: Person, slug: string, path: string, body: Record<string, unknown> = {}) {
    return api.as(person)("post", path).set(TENANT_HEADER, slug).send(body);
  }

  it("renders the queue newest first, ages it, resolves actions per viewer, and computes the head", async () => {
    const { owner, bench, run, ticket } = await workspace();
    const org = bench.workspace.id;
    const member = await api.signUp();
    await api.join(org, member, "member");

    await file(org, "fact_review", "fact-1", [], 34);
    await file(org, "run_needs_human", "run-1", [{ type: "run", id: run, label: "loop #1" }], 21);
    await file(
      org,
      "resize_review",
      "resize-1",
      [{ type: "ticket", id: ticket, label: "issue #482" }],
      8,
    );

    const cold = bodyOf<InboxQueueResource>(
      await get(owner, bench.workspace.slug, "/api/v1/inbox").expect(200),
    );

    expect(cold.items.map((card) => card.kindId)).toEqual([
      "resize_review",
      "run_needs_human",
      "fact_review",
    ]);
    expect(cold.items.map((card) => Math.round(card.ageSeconds / 60))).toEqual([8, 21, 34]);
    expect(cold.items[0]).toMatchObject({
      question: "Accept a re-size of #486 from L to M?",
      facts: SEEDED_PAYLOADS.resize_review,
      refs: [{ type: "ticket", id: ticket, label: "issue #482" }],
    });
    // No answers this week: the head claims no time.
    expect(cold.head.sentence).toBe("3 decisions.");

    // This week's answers give each kind a median; the head is the queue's sum.
    const answered = [
      await file(org, "fact_review", "fact-old", [], 120),
      await file(
        org,
        "run_needs_human",
        "run-old",
        [{ type: "run", id: run, label: "loop #1" }],
        120,
      ),
    ];
    await answer(answered[0], org, "confirm", owner.id, 20);
    await answer(answered[1], org, "retry_with_note", owner.id, 100, "Retry it.");

    const warm = bodyOf<InboxQueueResource>(
      await get(owner, bench.workspace.slug, "/api/v1/inbox").expect(200),
    );

    // fact 20 + run 100 + resize (no answers: the week's median, 60) = 180 → 3 minutes.
    expect(warm.head).toMatchObject({ count: 3, noun: "decisions", estimateSeconds: 180 });
    expect(warm.head.sentence).toBe("3 decisions. About 3 minutes of your time.");

    const asMember = bodyOf<InboxQueueResource>(
      await get(member, bench.workspace.slug, "/api/v1/inbox").expect(200),
    );
    const retry = asMember.items
      .find((card) => card.kindId === "run_needs_human")
      ?.actions.find((action) => action.id === "retry_with_note");

    expect(retry).toMatchObject({ allowed: true, disabledReason: null });
  });

  it("computes this week's stat card exactly as an independent oracle does", async () => {
    const { owner, bench, run } = await workspace();
    const org = bench.workspace.id;
    // Mockup 16's week: eleven answers, a median of 41 s, a longest loop wait of 6 minutes.
    const latencies = [12, 41, 300, 41, 7, 95, 41, 18, 420, 60, 33];
    const waits: Record<number, { wait: number; unblocked: boolean }> = {
      2: { wait: 120, unblocked: true },
      4: { wait: 7, unblocked: false },
      8: { wait: 360, unblocked: true },
    };

    for (const [index, latency] of latencies.entries()) {
      const itemId = await file(
        org,
        "run_needs_human",
        `oracle-${String(index)}`,
        [{ type: "run", id: run, label: "loop #1" }],
        10,
      );
      const block = waits[index];

      if (block !== undefined) {
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.run_blocks (organization_id, decision_item_id, run_id, blocked_at, unblocked_at)
           select organization_id, id, $2, created_at,
                  case when $4 then created_at + make_interval(secs => $3) end
             from ${SCHEMA_NAME}.decision_items where id = $1`,
          [itemId, run, block.wait, block.unblocked],
        );
      }

      await answer(itemId, org, "retry_with_note", owner.id, latency, "Retry it.");
    }

    // An out-of-band closure answered nothing: it is left out of every figure.
    const closed = await file(org, "fact_review", "oracle-closed", [], 10);

    await api.sql.query(
      `select ouroboros.decision_item_source_resolve($1, 'web', '{"source": "fact_resolved"}')`,
      [closed],
    );

    // The oracle: percentile_cont(0.5) over the answers; each wait capped at its answer.
    const sorted = [...latencies].sort((a, b) => a - b);
    const middle = (sorted.length - 1) / 2;
    const median = (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2;
    const longest = Math.max(
      ...Object.entries(waits).map(([index, block]) =>
        block.unblocked ? Math.min(block.wait, latencies[Number(index)]) : latencies[Number(index)],
      ),
    );
    const stats = bodyOf<InboxStatsResource>(
      await get(owner, bench.workspace.slug, "/api/v1/inbox/stats").expect(200),
    );

    expect(stats).toMatchObject({
      decisions: latencies.length,
      medianAnswerSeconds: median,
      maxLoopWaitSeconds: longest,
      policyResolutions: 0,
    });
    expect(stats.display).toEqual({ decisions: "11", medianAnswer: "41s", maxLoopWait: "6m" });
  });

  it("snoozes out of the queue and the pill but not the metrics, its age still running; Snooze all is one event", async () => {
    const { owner, bench } = await workspace();
    const org = bench.workspace.id;
    const slug = bench.workspace.slug;
    const first = await file(org, "fact_review", "fact-a", [], 10);
    await file(org, "fact_review", "fact-b", [], 5);
    const done = await file(org, "fact_review", "fact-c", [], 60);
    await answer(done, org, "confirm", owner.id, 30);

    const statsBefore = bodyOf<InboxStatsResource>(
      await get(owner, slug, "/api/v1/inbox/stats").expect(200),
    );
    const snoozed = bodyOf<InboxSnoozeResource>(
      await post(owner, slug, `/api/v1/inbox/items/${first}/snooze`, {
        minutes: 60,
        reason: "after lunch",
      }).expect(200),
    );
    const queue = bodyOf<InboxQueueResource>(await get(owner, slug, "/api/v1/inbox").expect(200));
    const feed = bodyOf<InboxFeedResource>(
      await get(owner, slug, "/api/v1/inbox/feed").expect(200),
    );
    const statsAfter = bodyOf<InboxStatsResource>(
      await get(owner, slug, "/api/v1/inbox/stats").expect(200),
    );

    expect(snoozed.snoozed).toEqual([first]);
    expect(queue.items.map((card) => card.id)).not.toContain(first);
    expect(queue.snoozed[0]).toMatchObject({ id: first, reason: "after lunch" });
    expect(Math.round(queue.snoozed[0].ageSeconds / 60)).toBe(10);
    expect(feed).toMatchObject({ open: 1, snoozed: 1 });
    expect(statsAfter).toEqual(statsBefore);

    const all = bodyOf<InboxSnoozeResource>(
      await post(owner, slug, "/api/v1/inbox/snooze-all", {}).expect(200),
    );
    const events = await api.sql.query<{ scope: string; items: string[] }>(
      `select scope, items::text[] as items from ${SCHEMA_NAME}.decision_snooze_events
        where organization_id = $1 and scope = 'all'`,
      [org],
    );

    expect(all.snoozed).toHaveLength(1);
    expect(events.rows).toEqual([{ scope: "all", items: all.snoozed }]);
    expect((await get(owner, slug, "/api/v1/inbox/feed").expect(200)).body).toMatchObject({
      open: 0,
    });

    await post(owner, slug, "/api/v1/inbox/unsnooze-all").expect(200);

    expect(
      bodyOf<InboxQueueResource>(await get(owner, slug, "/api/v1/inbox").expect(200)).items,
    ).toHaveLength(2);

    const trail = await api.sql.query<{ action: string }>(
      `select action from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action like 'decision.%snooze%' order by occurred_at, id`,
      [org],
    );

    expect(trail.rows.map((row) => row.action)).toEqual([
      "decision.snoozed",
      "decision.snoozed_all",
      "decision.unsnoozed",
    ]);
  });

  it("lets a viewer read but not snooze, and refuses an item of another workspace", async () => {
    const { owner, bench } = await workspace();
    const viewer = await api.signUp();
    await api.join(bench.workspace.id, viewer, "viewer");
    const item = await file(bench.workspace.id, "fact_review", "fact-a", [], 1);
    const other = await workspace();

    await get(viewer, bench.workspace.slug, "/api/v1/inbox").expect(200);
    await post(viewer, bench.workspace.slug, `/api/v1/inbox/items/${item}/snooze`).expect(403);
    await post(
      other.owner,
      other.bench.workspace.slug,
      `/api/v1/inbox/items/${item}/snooze`,
    ).expect(404);
    await post(owner, bench.workspace.slug, `/api/v1/inbox/items/${item}/snooze`, {
      minutes: 0,
    }).expect(422);
  });

  it("composes the resolved day, naming a policy's answer, and reads em-dashes on a cold org", async () => {
    const { owner, bench, ticket } = await workspace();
    const org = bench.workspace.id;
    const slug = bench.workspace.slug;

    expect(
      bodyOf<InboxStatsResource>(await get(owner, slug, "/api/v1/inbox/stats").expect(200)).display,
    ).toEqual({
      decisions: "—",
      medianAnswer: "—",
      maxLoopWait: "—",
    });

    const resize = await file(
      org,
      "resize_review",
      "resize-1",
      [{ type: "ticket", id: ticket, label: "issue #486" }],
      2,
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.decision_resolutions
              (item_id, organization_id, action_id, resolver, resolved_by_policy, channel, outcome)
       values ($1, $2, 'accept_resize', 'policy', 'auto_accept_resize', 'api', '{"org_policy_version": 7}')`,
      [resize, org],
    );

    const day = bodyOf<InboxResolvedResource>(
      await get(owner, slug, "/api/v1/inbox/resolved").expect(200),
    );

    expect(day).toMatchObject({ count: 1, nextDay: null, previousDay: null });
    expect(day.rows[0]).toMatchObject({
      summary: "Estimator re-size #486 L→M — auto-accepted by policy",
      resolver: "policy",
      policy: "auto_accept_resize",
      channel: "api",
      actor: null,
    });
    await get(owner, slug, "/api/v1/inbox/resolved?day=2026-13-01").expect(422);
  });

  it("derives the policy card live from the published policy, BA.1's paths and dry-run", async () => {
    const { owner, bench } = await workspace();
    const org = bench.workspace.id;
    const slug = bench.workspace.slug;
    const card = async () =>
      bodyOf<PolicyCardResource>(await get(owner, slug, "/api/v1/inbox/policies").expect(200));

    await api.sql.query(
      `select ${SCHEMA_NAME}.org_policy_publish($1, $2::jsonb, $3, 'refactor needs a human')`,
      [
        org,
        JSON.stringify(document({ enabled: true, conditions: { any: [{ label: "refactor" }] } })),
        owner.id,
      ],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.protected_path_policies (organization_id, repo_ref, path_glob)
       values ($1, 'acme/helios', 'boot/**')`,
      [org],
    );

    const on = await card();

    expect(on.rows.map((row) => `${row.rule} → ${row.outcome}`)).toEqual([
      "refactor label → human review",
      "protected paths → allow-once",
      "unverifiable claims → explicit waiver",
    ]);
    expect(on.rows.find((row) => row.id === "protected_paths")?.detail).toBe("boot/**");
    expect(on.caption).toBe("Everything else merges itself when gates are green.");

    await api.sql.query(
      `select ${SCHEMA_NAME}.org_policy_publish($1, $2::jsonb, $3, 'no review rule')`,
      [
        org,
        JSON.stringify(document({ enabled: false, conditions: { any: [{ label: "refactor" }] } })),
        owner.id,
      ],
    );
    await api.sql.query(
      `update ${SCHEMA_NAME}.protected_path_policies set path_glob = 'keys/**' where organization_id = $1`,
      [org],
    );
    await api
      .as(owner)("patch", "/api/v1/policies/dry-run")
      .set(TENANT_HEADER, slug)
      .send({ dryRun: true })
      .expect(200);

    const off = await card();

    expect(off.rows.map((row) => row.id)).toEqual(["protected_paths", "claim_waiver"]);
    expect(off.rows[0].detail).toBe("keys/**");
    expect(off.caption).toMatch(/^Dry-run is on/);
    expect(off.rows.map((row) => row.id)).not.toContain("spend_guard");
  });
});
