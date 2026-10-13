/**
 * The chat outbox against Slack as it misbehaves (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * `chat.dispatcher.spec.ts` holds the dispatcher to a fake store and a fake backend. Here the
 * store is PostgreSQL — V134's unique indexes, its claim under `skip locked` — and the backend is
 * the real Slack client over HTTP, so a `429`'s `Retry-After` header, a Web API error code and a
 * race between two writers are each the real thing:
 *
 *   - **retry with backoff**: a failed post is tried again, not before its backoff and not twice;
 *   - **`Retry-After`**: the row that heard it waits at least that long, and so does every other
 *     row of the connection — untried, rather than sent into the same refusal;
 *   - **dedupe**: the same intent enqueued concurrently is one row, the same digest slot noticed
 *     by several replicas is one message, and an intent that reaches a channel a second time by
 *     another road is absorbed by the message record rather than posted;
 *   - **dead letters**: a message Slack will never take is given up at once, one that keeps
 *     failing is given up after {@link MAX_CHAT_ATTEMPTS}, and either way the connection's status
 *     says so — nothing vanishes.
 *
 * Time is crossed by naming a later instant to the pass, never by waiting.
 *
 * **Negative controls.** Two mutations turn this suite red (#540's third):
 * `chatDedupeKey` made unique per call (`chat.outbox.ts`) fails *is one row, however many writers
 * intend it*; `payloadDigest` made unique per call (`chat.dispatcher.ts`) fails *is absorbed*.
 */

import { ChatBench } from "../../testing/chatops.bench.fixture";
import type { Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { DatabaseService } from "../db/db.service";
import { SCHEMA_NAME } from "../db/schema";
import type { IngestBench } from "../ingest/ingest.fixture";
import type { SlackConnectionResource } from "./slack.resources";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { BACKOFF_BASE_MS, BACKOFF_JITTER } from "../webhooks/webhook.backoff";
import { boundScene, openRun } from "./slack.decisions.integration.fixture";
import { MAX_CHAT_ATTEMPTS } from "../chat/chat.dispatcher";
import { enqueueBuildCard } from "../chat/chat.outbox";

/** A weekly slot long before anything a test writes: Monday 1 January 2024, 09:00 UTC. */
const DIGEST_DUE = new Date("2024-01-01T09:05:00.000Z");

/** An outbox row, as the assertions read it. */
interface OutboxRow extends Record<string, unknown> {
  readonly id: string;
  readonly status: string;
  readonly attempts: number;
  readonly next_attempt_at: Date | null;
  readonly last_error: string | null;
  readonly message_id: string | null;
}

/** A connected workspace with a run to report builds of. */
interface Scene {
  readonly owner: Person;
  readonly ingest: IngestBench;
  readonly run: string;
}

describe("the chat outbox, against Slack as it misbehaves", () => {
  let bench: ChatBench;

  beforeAll(async () => {
    bench = await ChatBench.start();
  });

  afterAll(() => bench.close());
  afterEach(() => bench.reset());

  /**
   * A workspace with Slack installed, a channel bound for each purpose, and one open run.
   *
   * @returns The scene.
   */
  async function scene(): Promise<Scene> {
    const { owner, ingest } = await boundScene(bench);

    return { owner, ingest, run: await openRun(bench, ingest, "open") };
  }

  /**
   * Intend a *build failed* card — one message for the alerts channel per build number.
   *
   * @param at - The scene.
   * @param buildNumber - Which build; a different number is a different message.
   * @returns How many rows were written.
   */
  function failedBuild(at: Scene, buildNumber: number): Promise<number> {
    return enqueueBuildCard(bench.api.nest.get(DatabaseService).db, "build_failed", {
      organizationId: at.ingest.workspace.id,
      runId: at.run,
      loopSeq: 1847,
      buildNumber,
      passed: 61,
      total: 63,
    });
  }

  /** @returns Every outbox row, oldest first. */
  function outbox(): Promise<OutboxRow[]> {
    return bench.rows<OutboxRow>("chat_outbox", "true order by created_at, id");
  }

  /**
   * The connection's delivery health, as the status API reports it.
   *
   * @param at - The scene.
   * @returns `delivery` of `GET /api/v1/slack/connection`.
   */
  async function health(at: Scene): Promise<SlackConnectionResource["delivery"]> {
    return bodyOf<SlackConnectionResource>(
      await bench.api
        .as(at.owner)("get", "/api/v1/slack/connection")
        .set(TENANT_HEADER, at.ingest.workspace.slug)
        .expect(200),
    ).delivery;
  }

  /**
   * An instant, measured from one no earlier than any row the test has written.
   *
   * @param start - The first pass's instant.
   * @param seconds - How long after it.
   * @returns The later instant.
   */
  function after(start: Date, seconds: number): Date {
    return new Date(start.getTime() + seconds * 1000);
  }

  describe("a post that fails", () => {
    it("is retried after its backoff — not before, and not twice", async () => {
      const at = await scene();

      await failedBuild(at, 1);
      bench.slack.script("chat.postMessage", { error: "internal_error" });

      const start = bench.soon();

      expect((await bench.tick(start)).dispatch).toMatchObject({ claimed: 1, retried: 1, sent: 0 });

      const [failed] = await outbox();
      const wait = (failed?.next_attempt_at?.getTime() ?? 0) - start.getTime();

      expect(failed).toMatchObject({
        status: "pending",
        attempts: 1,
        last_error: "internal_error",
      });
      // The webhook pipeline's first step: thirty seconds, jittered a tenth either way.
      expect(wait).toBeGreaterThanOrEqual(BACKOFF_BASE_MS * (1 - BACKOFF_JITTER));
      expect(wait).toBeLessThanOrEqual(BACKOFF_BASE_MS * (1 + BACKOFF_JITTER));
      expect(bench.slack.messagesIn("C0ALERTS")).toEqual([]);
      expect(await health(at)).toMatchObject({ state: "retrying", retrying: 1, deadLettered: 0 });

      // Before the backoff has run out, a pass leaves it alone.
      expect((await bench.tick(after(start, 20))).dispatch.claimed).toBe(0);
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(1);

      // After it, the same row is sent — once.
      expect((await bench.tick(after(start, 40))).dispatch).toMatchObject({ claimed: 1, sent: 1 });
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(2);
      expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(1);
      expect(await outbox()).toMatchObject([{ id: failed?.id, status: "sent", attempts: 2 }]);
      // The record the failed attempt wrote is the one the second attempt stamped: one message.
      expect(await bench.rows("chat_messages")).toMatchObject([
        { id: failed?.message_id, platform_ts: bench.slack.messagesIn("C0ALERTS")[0]?.ts },
      ]);
      expect(await health(at)).toMatchObject({ state: "healthy", retrying: 0 });

      expect((await bench.tick(after(start, 7200))).dispatch.claimed).toBe(0);
      expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(1);
    });

    it("doubles the wait with each failure", async () => {
      const at = await scene();

      await failedBuild(at, 1);
      bench.slack.script(
        "chat.postMessage",
        { error: "internal_error" },
        { error: "internal_error" },
        { error: "internal_error" },
      );

      let now = bench.soon();
      const waits: number[] = [];

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await bench.tick(now);

        const [row] = await outbox();
        const next = row?.next_attempt_at ?? now;

        expect(row).toMatchObject({ status: "pending", attempts: attempt });
        waits.push(next.getTime() - now.getTime());
        now = new Date(next.getTime() + 1);
      }

      for (const [index, wait] of waits.entries()) {
        const base = BACKOFF_BASE_MS * 2 ** index;

        expect(wait).toBeGreaterThanOrEqual(base * (1 - BACKOFF_JITTER));
        expect(wait).toBeLessThanOrEqual(base * (1 + BACKOFF_JITTER));
      }
    });
  });

  describe("a rate limit", () => {
    it("holds the row that heard it, and the connection's other rows untried, for Retry-After", async () => {
      const at = await scene();

      for (const build of [1, 2, 3]) {
        await failedBuild(at, build);
      }
      bench.slack.script("chat.postMessage", { rateLimit: 120 });

      const start = bench.soon();
      const first = await bench.tick(start);

      expect(first.dispatch).toMatchObject({ claimed: 3, retried: 1, deferred: 2, sent: 0 });
      // One call was refused; the other two rows were never sent into the same refusal.
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(1);
      expect(bench.slack.callsTo("chat.postMessage")[0]).toMatchObject({ status: 429 });

      const held = await outbox();

      expect(held.map((row) => row.status)).toEqual(["pending", "pending", "pending"]);
      // Only the row that was tried counts an attempt.
      expect(held.map((row) => row.attempts).sort()).toEqual([0, 0, 1]);
      expect(held.find((row) => row.attempts === 1)?.last_error).toBe("ratelimited");
      for (const row of held) {
        expect(row.next_attempt_at?.getTime()).toBeGreaterThanOrEqual(start.getTime() + 120_000);
      }

      // Well past the backoff's thirty seconds, still inside Slack's two minutes: nothing moves.
      expect((await bench.tick(after(start, 90))).dispatch.claimed).toBe(0);
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(1);
      expect(bench.slack.messagesIn("C0ALERTS")).toEqual([]);

      // Once Slack's wait is over, everything goes — each message once.
      expect((await bench.tick(after(start, 125))).dispatch).toMatchObject({ claimed: 3, sent: 3 });
      expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(3);
      expect(new Set(bench.slack.messagesIn("C0ALERTS").map((message) => message.text)).size).toBe(
        3,
      );
      expect((await outbox()).map((row) => row.status)).toEqual(["sent", "sent", "sent"]);
    });

    it("waits Slack's time when it is longer than the backoff, and the backoff when it is not", async () => {
      const at = await scene();

      await failedBuild(at, 1);
      bench.slack.script("chat.postMessage", { rateLimit: 1 });

      const start = bench.soon();

      await bench.tick(start);

      const [row] = await outbox();

      // A one-second Retry-After does not shorten the thirty-second backoff.
      expect((row?.next_attempt_at?.getTime() ?? 0) - start.getTime()).toBeGreaterThanOrEqual(
        BACKOFF_BASE_MS * (1 - BACKOFF_JITTER),
      );
    });
  });

  describe("the same thing, intended more than once", () => {
    it("is one row, however many writers intend it", async () => {
      const at = await scene();
      const written = await Promise.all(Array.from({ length: 8 }, () => failedBuild(at, 7)));

      // Eight writers at once; V134's index let exactly one of them in.
      expect(written.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(await outbox()).toHaveLength(1);
      // And a ninth, later, is no different.
      expect(await failedBuild(at, 7)).toBe(0);

      await bench.tick(bench.soon());

      expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(1);
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(1);

      // A reported-again build after it was sent is still the same build.
      expect(await failedBuild(at, 7)).toBe(0);
      expect((await bench.tick(bench.soon())).dispatch.claimed).toBe(0);
    });

    it("is one digest, however many replicas notice the slot", async () => {
      await scene();

      await Promise.all(Array.from({ length: 6 }, () => bench.digestPass(DIGEST_DUE)));

      const intended = await outbox();

      expect(intended).toHaveLength(1);
      expect(intended[0]).toMatchObject({ card_kind: "digest", status: "pending" });

      // Two passes at once, as two replicas' timers would run them.
      const [one, two] = await Promise.all([bench.tick(bench.soon()), bench.tick(bench.soon())]);

      expect(one.dispatch.sent + two.dispatch.sent).toBe(1);
      expect(bench.slack.messagesIn("C0LEADS")).toHaveLength(1);

      // The slot is spent: noticing it again, minutes later, intends nothing.
      await bench.digestPass(new Date(DIGEST_DUE.getTime() + 10 * 60_000));

      expect(await outbox()).toHaveLength(1);
      expect((await bench.tick(bench.soon())).dispatch.claimed).toBe(0);
      expect(bench.slack.messagesIn("C0LEADS")).toHaveLength(1);
    });

    it("is absorbed by the message record when it reaches the channel by another road", async () => {
      const at = await scene();

      await failedBuild(at, 9);
      await bench.tick(bench.soon());

      expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(1);

      // The same build, intended again under a key the outbox's index does not recognise — as a
      // row re-enqueued after the first was pruned would be. Everything else is the first row's.
      await bench.api.sql.query(
        `insert into ${SCHEMA_NAME}.chat_outbox
           (organization_id, connection_id, channel_id, message_kind, card_kind, subject,
            route_kind, dedupe_key)
         select organization_id, connection_id, channel_id, message_kind, card_kind, subject,
                route_kind, encode(sha256('by another road'), 'hex')
           from ${SCHEMA_NAME}.chat_outbox`,
      );

      const pass = await bench.tick(bench.soon());
      const rows = await outbox();

      expect(pass.dispatch).toMatchObject({ claimed: 1, absorbed: 1, sent: 0 });
      expect(rows.map((row) => row.status).sort()).toEqual(["absorbed", "sent"]);
      // Both rows point at the one message, and Slack was asked once.
      expect(new Set(rows.map((row) => row.message_id)).size).toBe(1);
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(1);
      expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(1);
      expect(await bench.rows("chat_messages")).toHaveLength(1);
    });
  });

  describe("a message that cannot be delivered", () => {
    it("is dead-lettered at once when Slack will never take it, and the status says so", async () => {
      const at = await scene();

      expect(await health(at)).toMatchObject({ state: "idle", deadLettered: 0, lastError: null });

      await failedBuild(at, 1);
      bench.slack.script("chat.postMessage", { error: "invalid_blocks" });

      expect((await bench.tick(bench.soon())).dispatch).toMatchObject({
        claimed: 1,
        dead_lettered: 1,
      });
      expect(await outbox()).toMatchObject([
        { status: "dead_lettered", attempts: 1, last_error: "invalid_blocks" },
      ]);

      const delivery = await health(at);

      expect(delivery).toMatchObject({
        state: "dead_lettered",
        deadLettered: 1,
        retrying: 0,
        lastError: "invalid_blocks",
      });
      expect(delivery.lastDeadLetteredAt).not.toBeNull();

      // Given up, not forgotten and not retried.
      expect((await bench.tick(after(bench.soon(), 86_400))).dispatch.claimed).toBe(0);
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(1);
      expect(bench.slack.messagesIn("C0ALERTS")).toEqual([]);
    });

    it(`is dead-lettered after ${String(MAX_CHAT_ATTEMPTS)} attempts, and the status says so`, async () => {
      const at = await scene();

      await failedBuild(at, 1);
      bench.slack.script(
        "chat.postMessage",
        ...Array.from({ length: MAX_CHAT_ATTEMPTS }, () => ({ error: "internal_error" })),
      );

      let now = bench.soon();

      for (let attempt = 1; attempt < MAX_CHAT_ATTEMPTS; attempt += 1) {
        expect((await bench.tick(now)).dispatch).toMatchObject({ claimed: 1, retried: 1 });

        const [row] = await outbox();

        expect(row).toMatchObject({ status: "pending", attempts: attempt });
        now = new Date((row?.next_attempt_at?.getTime() ?? now.getTime()) + 1);
      }

      expect(await health(at)).toMatchObject({ state: "retrying", retrying: 1, deadLettered: 0 });

      // The last attempt allowed.
      expect((await bench.tick(now)).dispatch).toMatchObject({ claimed: 1, dead_lettered: 1 });
      expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(MAX_CHAT_ATTEMPTS);
      expect(await outbox()).toMatchObject([
        { status: "dead_lettered", attempts: MAX_CHAT_ATTEMPTS, last_error: "internal_error" },
      ]);
      expect(await health(at)).toMatchObject({
        state: "dead_lettered",
        deadLettered: 1,
        retrying: 0,
        lastError: "internal_error",
      });

      // Slack is well again, and the dead letter stays one: nothing is sent behind anyone's back.
      expect((await bench.tick(after(now, 86_400))).dispatch.claimed).toBe(0);
      expect(bench.slack.messagesIn("C0ALERTS")).toEqual([]);
    });

    it("does not hold up what comes after it", async () => {
      const at = await scene();

      await failedBuild(at, 1);
      bench.slack.script("chat.postMessage", { error: "invalid_blocks" });
      await bench.tick(bench.soon());
      await failedBuild(at, 2);

      expect((await bench.tick(bench.soon())).dispatch).toMatchObject({ claimed: 1, sent: 1 });
      expect(bench.slack.messagesIn("C0ALERTS")).toHaveLength(1);
      // The dead letter still shows after a later success.
      expect(await health(at)).toMatchObject({ state: "dead_lettered", deadLettered: 1 });
      expect((await health(at)).lastSentAt).not.toBeNull();
    });
  });
});
