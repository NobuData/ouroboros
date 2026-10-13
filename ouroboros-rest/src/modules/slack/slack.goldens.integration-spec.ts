/**
 * What reaches a channel, archetype by archetype (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * `slack.blockkit.spec.ts` holds the renderer to a golden per card *model*. This holds the whole
 * chain to one: a real row — a run, a decision, a route — goes through the outbox, the composer
 * and the Slack backend, and what is compared is the `chat.postMessage` / `chat.update` Slack
 * received. A change to any card's content model, to the facts a card is composed from, or to
 * its Block Kit, moves a golden and fails here with the diff.
 *
 * | Case | Produced by |
 * |---|---|
 * | `blocking_question_open` | AP.3 refusing a protected path → the decision's lifecycle → publisher |
 * | `blocking_question_resolved` | the inbox's own action route answering it → `chat.update` |
 * | `system_line` | the same resolution, a second later |
 * | `loop_finished` | the merge store's `finalizeRun`, in its transaction |
 * | `digest` | the publisher's digest pass, on a due weekly slot |
 * | `build_green`, `build_failed` | `enqueueBuildCard` — which no plane calls yet (#536), so it is called here |
 *
 * **What is normalised, and only that:** ids the database mints (`<uuid>`), the workspace's
 * random slug (`<workspace>`), and a button's signed value, which carries a nonce (`<signed>`).
 * Every instant a card prints is pinned by the test instead — the pass's `now` is a fixed offset
 * from the row's own timestamp — so the countdown and the durations are compared literally.
 *
 * ```bash
 * OURO_UPDATE_GOLDENS=1 yarn test:integration src/modules/slack/slack.goldens.integration-spec.ts
 * ```
 */

import { join } from "node:path";

import { ChatBench } from "../../testing/chatops.bench.fixture";
import { GoldenFile } from "../../testing/golden.fixture";
import type { PostedMessage } from "../../testing/slack.harness.fixture";
import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME } from "../db/schema";
import { MergeRepository } from "../pull-requests/merge/merge.repository";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { shortDuration } from "../chat/chat.card";
import {
  type BoundScene,
  boundScene,
  openRun,
  protectBoot,
  touchingRun,
} from "./slack.decisions.integration.fixture";
import { enqueueBuildCard } from "../chat/chat.outbox";

const GOLDEN_PATH = join(__dirname, "slack.goldens.integration.golden.json");

/** The cases the file records, in the order the suite produces them. */
const CASES = [
  "blocking_question_open",
  "blocking_question_resolved",
  "system_line",
  "loop_finished",
  "build_green",
  "build_failed",
  "digest",
] as const;

/** The protected path the question is about. */
const PROTECTED = "boot/rollback_flag.c";

/** A weekly slot long before anything a test writes: Monday 1 January 2024, 09:00 UTC. */
const DIGEST_DUE = new Date("2024-01-01T09:05:00.000Z");

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** A connected workspace with a repository, a ticket and a workflow. */
type Scene = BoundScene;

describe("what reaches a channel, archetype by archetype", () => {
  let bench: ChatBench;

  const golden = new GoldenFile(
    GOLDEN_PATH,
    "What Slack receives for each chat archetype, from real rows through the outbox, the composer " +
      "and the Block Kit backend (#540). Regenerate with OURO_UPDATE_GOLDENS=1 yarn " +
      "test:integration src/modules/slack/slack.goldens.integration-spec.ts",
    "OURO_UPDATE_GOLDENS=1 yarn test:integration src/modules/slack/slack.goldens.integration-spec.ts",
  );

  beforeAll(async () => {
    bench = await ChatBench.start();
  });

  afterAll(async () => {
    golden.save();
    await bench.close();
  });

  afterEach(() => bench.reset());

  /**
   * Have a run touch a protected path, so AP.3 refuses it and files the allow-once question.
   *
   * @param at - The scene.
   * @param key - What keeps this run's requests apart from another's.
   * @returns The decision item's id and when it was filed.
   */
  async function question(at: Scene, key: string): Promise<{ item: string; askedAt: Date }> {
    const organization = at.ingest.workspace.id;

    await protectBoot(bench, at.ingest.workspace);

    const { run } = await touchingRun(bench, at.ingest, key, PROTECTED);

    // The publisher hears the lifecycle after the request has answered.
    return bench.slack.waitFor(async () => {
      const [item] = await bench.rows<{ id: string; created_at: Date }>(
        "decision_items",
        `organization_id = $1 and refs::text like $2
           and exists (select 1 from ${SCHEMA_NAME}.chat_outbox o where o.decision_item_id = decision_items.id)`,
        [organization, `%${run}%`],
      );

      return item === undefined ? undefined : { item: item.id, askedAt: item.created_at };
    }, `the decision card of run ${run} to be intended`);
  }

  /**
   * A message as the golden records it.
   *
   * @param at - The scene, for the slug to mask.
   * @param message - What Slack holds.
   * @returns Its text, blocks and attachments, with what the database minted masked.
   */
  function recorded(at: Scene, message: PostedMessage | undefined): unknown {
    if (message === undefined) {
      throw new Error("Slack holds no such message.");
    }

    const mask = (node: unknown): unknown => {
      if (typeof node === "string") {
        return node.replace(UUID, "<uuid>").split(at.ingest.workspace.slug).join("<workspace>");
      }
      if (Array.isArray(node)) {
        return node.map(mask);
      }
      if (typeof node === "object" && node !== null) {
        const record = node as Record<string, unknown>;

        return Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            key,
            // A button's value is signed over a fresh nonce: it is never the same twice.
            record.type === "button" && key === "value" ? "<signed>" : mask(value),
          ]),
        );
      }

      return node;
    };

    return mask({
      text: message.text,
      blocks: message.blocks,
      attachments: message.attachments,
    });
  }

  it("publishes a blocking question, edits it in place when answered, then says who answered", async () => {
    const at = await boundScene(bench);
    const asked = await question(at, "q1");

    // Four minutes into the wait: the footnote is a function of this instant and the timer.
    await bench.tick(new Date(asked.askedAt.getTime() + 4 * 60_000));

    const [card] = bench.slack.messagesIn("C0LOOPS");

    expect(bench.slack.messagesIn("C0LOOPS")).toHaveLength(1);
    expect(card?.edits).toBe(0);
    expect(bench.slack.buttonsOf(card).map((button) => button.label)).toContain("Allow once");
    golden.hold("blocking_question_open", recorded(at, card));

    await bench.api
      .as(at.owner)("post", `/api/v1/inbox/items/${asked.item}/actions/allow_once`)
      .set(TENANT_HEADER, at.ingest.workspace.slug)
      .send({})
      .expect(200);
    await bench.slack.waitFor(
      async () =>
        (
          await bench.rows("chat_outbox", "decision_item_id = $1 and status = 'pending'", [
            asked.item,
          ])
        ).length === 2,
      "the card's edit and its system line to be intended",
    );

    // The edit is due now and the line a second after it; one pass, late enough for both.
    const pass = await bench.tick(new Date(Date.now() + 5000));
    const standing = bench.slack.messagesIn("C0LOOPS");

    expect(pass.dispatch).toMatchObject({ claimed: 2, sent: 2 });
    expect(bench.slack.callsTo("chat.update")).toHaveLength(1);
    expect(bench.slack.callsTo("chat.update")[0]?.form.ts).toBe(card?.ts);
    // The same message, edited — not a second card beside the first.
    expect(standing.map((message) => message.ts)).toEqual([card?.ts, standing[1]?.ts]);
    expect(standing[0]).toMatchObject({ ts: card?.ts, edits: 1 });
    expect(bench.slack.buttonsOf(standing[0])).toEqual([]);
    golden.hold("blocking_question_resolved", recorded(at, standing[0]));
    golden.hold("system_line", recorded(at, standing[1]));

    // The record agrees with the channel: one resolved card, one line, each with its `ts`.
    expect(
      (
        await bench.rows<{ kind: string; state: string | null; platform_ts: string }>(
          "chat_messages",
          "channel_id = $1 order by platform_ts",
          [at.loops.id],
        )
      ).map((row) => [row.kind, row.state, row.platform_ts]),
    ).toEqual([
      ["decision_card", "resolved", card?.ts],
      ["system_line", null, standing[1]?.ts],
    ]);

    // Nothing is left to say, however often the clock ticks.
    expect((await bench.tick(new Date(Date.now() + 3_600_000))).dispatch.claimed).toBe(0);
    expect(bench.slack.messagesIn("C0LOOPS")).toHaveLength(2);
  });

  it("computes the countdown from the instant a card is sent, not from when it was asked", async () => {
    const at = await boundScene(bench);
    const footnote = (message: PostedMessage | undefined) =>
      /paused [^"]*?escalat[^"]*/.exec(JSON.stringify(message?.attachments))?.[0];

    const first = await question(at, "early");

    await bench.tick(new Date(first.askedAt.getTime() + 2 * 60_000));

    const second = await question(at, "late");

    await bench.tick(new Date(second.askedAt.getTime() + 9 * 60_000));

    const [early, late] = bench.slack.messagesIn("C0LOOPS");
    const [timer] = await bench.rows<{ due_at: Date }>(
      "decision_escalation_timers",
      "decision_item_id = $1",
      [second.item],
    );
    const [earlyTimer] = await bench.rows<{ due_at: Date }>(
      "decision_escalation_timers",
      "decision_item_id = $1",
      [first.item],
    );
    /** What is left of a timer at an offset into the wait, as the card writes a duration. */
    const left = (due: Date | undefined, askedAt: Date, minutes: number) =>
      shortDuration(((due?.getTime() ?? 0) - askedAt.getTime()) / 1000 - minutes * 60);

    expect(footnote(early)).toBe(
      `paused 2m · escalates to the Needs-you inbox in ${left(earlyTimer?.due_at, first.askedAt, 2)}`,
    );
    expect(footnote(late)).toBe(
      `paused 9m · escalates to the Needs-you inbox in ${left(timer?.due_at, second.askedAt, 9)}`,
    );
    // Seven minutes later, seven minutes less: the line is computed, not stored.
    expect(footnote(early)).not.toBe(footnote(late));
  });

  it("publishes a finished loop from the merge's own transaction", async () => {
    const at = await boundScene(bench);
    const run = await openRun(bench, at.ingest, "merged");

    // The figures a real loop would have recorded by now.
    await bench.api.sql.query(
      `update ${SCHEMA_NAME}.runs set checks_passed = 14, checks_total = 14 where id = $1`,
      [run],
    );

    const merged = await bench.api.nest
      .get(MergeRepository)
      .transaction((tx) => tx.finalizeRun(at.ingest.workspace.id, run, 512));

    expect(merged).toBe(true);

    // Eleven minutes, start to finish: the cycle time the card prints.
    await bench.api.sql.query(
      `update ${SCHEMA_NAME}.runs set started_at = finished_at - interval '11 minutes' where id = $1`,
      [run],
    );
    await bench.tick(bench.soon());

    expect(bench.slack.messagesIn("C0LOOPS")).toHaveLength(1);
    golden.hold("loop_finished", recorded(at, bench.slack.messagesIn("C0LOOPS")[0]));

    // A run that already finished keeps its outcome, and its card is not intended twice.
    expect(
      await bench.api.nest
        .get(MergeRepository)
        .transaction((tx) => tx.finalizeRun(at.ingest.workspace.id, run, 512)),
    ).toBe(false);
    expect((await bench.tick(bench.soon())).dispatch.claimed).toBe(0);
  });

  it("publishes a green build and a failed one, each where its route points", async () => {
    const at = await boundScene(bench);
    const run = await openRun(bench, at.ingest, "built");
    const { db } = bench.api.nest.get(DatabaseService);
    const report = {
      organizationId: at.ingest.workspace.id,
      runId: run,
      loopSeq: 1847,
      buildNumber: 3,
      prNumber: 514,
      revision: 2,
    };

    // Stage transitions are the mockup's noisy row: off until somebody switches it on.
    expect(await enqueueBuildCard(db, "build_green", { ...report, passed: 63, total: 63 })).toBe(0);

    await bench.api
      .as(at.owner)("patch", "/api/v1/settings/notifications/custom:stage-transitions")
      .set(TENANT_HEADER, at.ingest.workspace.slug)
      .send({ enabled: true })
      .expect(200);

    expect(await enqueueBuildCard(db, "build_green", { ...report, passed: 63, total: 63 })).toBe(1);
    expect(await enqueueBuildCard(db, "build_failed", { ...report, passed: 61, total: 63 })).toBe(
      1,
    );

    await bench.tick(bench.soon());

    expect(bench.slack.messagesIn("C0LOOPS")).toHaveLength(1);
    expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(1);
    golden.hold("build_green", recorded(at, bench.slack.messagesIn("C0LOOPS")[0]));
    golden.hold("build_failed", recorded(at, bench.slack.messagesIn("C0ALERTS")[0]));
  });

  it("publishes the weekly digest to its bound channel when its slot comes", async () => {
    const at = await boundScene(bench);

    await bench.digestPass(DIGEST_DUE);
    await bench.tick(bench.soon());

    expect(bench.slack.messagesIn("C0LEADS")).toHaveLength(1);
    expect(bench.slack.messagesIn("C0LOOPS")).toEqual([]);
    golden.hold("digest", recorded(at, bench.slack.messagesIn("C0LEADS")[0]));
  });

  it("records every archetype, and no case nobody produces", () => {
    if (!golden.updating) {
      expect(golden.names()).toEqual([...CASES]);
    }
  });
});
