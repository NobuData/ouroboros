import { BACKOFF_BASE_MS } from "../webhooks/webhook.backoff";
import type { ChatComposer, ComposedChatMessage } from "./chat.composer";
import {
  CHAT_DISPATCH_LEASE_MS,
  ChatDispatcher,
  MAX_CHAT_ATTEMPTS,
  payloadDigest,
} from "./chat.dispatcher";
import {
  ARCHETYPES,
  CHANNEL,
  CONNECTION,
  FakeChatStore,
  FixtureChatBackend,
  ITEM,
  RUN_1846,
} from "./chat.fixture";
import type { ClaimedChatRow } from "./chat.repository";

/**
 * The dispatcher (#536): the outbox's discipline — a post is recorded before it is sent, a
 * duplicate is absorbed, a rate limit is obeyed, and nothing that fails vanishes.
 */

const NOW = new Date("2026-10-11T14:11:00.000Z");

/** What the stub composer says for each kind of row. */
function composed(row: ClaimedChatRow): ComposedChatMessage {
  if (row.messageKind === "system_line") {
    return {
      model: ARCHETYPES.system_line,
      refs: [],
      facts: { action: "allow_once", answered_by: "Maya Chen" },
      state: null,
      resolution: null,
      digestParts: ["system_line", ITEM, "allow_once"],
    };
  }

  if (row.messageKind === "decision_card") {
    return row.operation === "update"
      ? {
          model: ARCHETYPES.question_resolved,
          refs: [],
          facts: {},
          state: "resolved",
          resolution: { outcome: "allow_once", resolvedBy: "user-maya", resolvedAt: NOW },
          digestParts: ["decision_card", ITEM, "allow_once"],
        }
      : {
          model: ARCHETYPES.question,
          refs: [],
          facts: {},
          state: "open",
          resolution: null,
          digestParts: ["decision_card", ITEM],
        };
  }

  return {
    model: ARCHETYPES.loop_finished,
    refs: [{ type: "run", id: RUN_1846, label: "loop #1846" }],
    facts: { outcome: "merged" },
    state: null,
    resolution: null,
    digestParts: ["loop_finished", String(row.subject.run_id)],
  };
}

/** A dispatcher over an in-memory outbox, the fixture backend and a stub composer. */
function harness() {
  const store = new FakeChatStore();
  const backend = new FixtureChatBackend();
  const compose = jest.fn((row: ClaimedChatRow): ReturnType<ChatComposer["compose"]> =>
    Promise.resolve(composed(row)),
  );
  // No jitter: the middle of the range.
  const dispatcher = new ChatDispatcher(
    store.repository(),
    { compose } as unknown as ChatComposer,
    backend,
    () => 0.5,
  );

  return { store, backend, compose, dispatcher };
}

describe("posting", () => {
  it("records the message before the post, stamps it with the platform's ts, and settles sent", async () => {
    const { store, backend, dispatcher } = harness();
    const row = store.enqueue();

    const report = await dispatcher.tick(NOW);

    expect(report).toMatchObject({ claimed: 1, sent: 1 });
    expect(backend.posts).toEqual([
      expect.objectContaining({ connectionId: CONNECTION, channelId: "C071LOOPS" }),
    ]);
    expect(store.messages).toEqual([
      expect.objectContaining({
        channelId: CHANNEL,
        kind: "event_card",
        cardKind: "loop_finished",
        platformTs: backend.posts[0].ts,
        payloadDigest: payloadDigest(CHANNEL, ["loop_finished", RUN_1846]),
        facts: { outcome: "merged" },
      }),
    ]);
    expect(row).toMatchObject({
      status: "sent",
      attempts: 1,
      nextAttemptAt: null,
      settledAt: NOW,
      messageId: store.messages[0].id,
    });
  });

  it("posts what the backend rendered from the model — the dispatcher adds no words", async () => {
    const { store, backend, dispatcher } = harness();
    store.enqueue();

    await dispatcher.tick(NOW);

    expect(backend.posts[0].rendered).toEqual(backend.render(ARCHETYPES.loop_finished));
  });

  it("leaves a row that is not due yet alone", async () => {
    const { store, backend, dispatcher } = harness();
    store.enqueue({ nextAttemptAt: new Date(NOW.getTime() + 1000) });

    expect(await dispatcher.tick(NOW)).toMatchObject({ claimed: 0 });
    expect(backend.posts).toEqual([]);
  });

  it("leases a claimed row, so a second dispatcher does not send it too", async () => {
    const { store, dispatcher } = harness();
    const row = store.enqueue();
    const repository = store.repository();

    const claimed = await repository.claimDue(
      NOW,
      new Date(NOW.getTime() + CHAT_DISPATCH_LEASE_MS),
      25,
    );

    expect(claimed).toHaveLength(1);
    expect(row.nextAttemptAt).toEqual(new Date(NOW.getTime() + CHAT_DISPATCH_LEASE_MS));
    expect(await dispatcher.tick(NOW)).toMatchObject({ claimed: 0 });
  });
});

describe("a duplicate publish", () => {
  it("is absorbed by the digest: a second intent for the same thing creates no second message", async () => {
    const { store, backend, dispatcher } = harness();
    store.enqueue();
    await dispatcher.tick(NOW);

    // The same event, enqueued again by a plane that reported twice.
    const again = store.enqueue();
    const report = await dispatcher.tick(new Date(NOW.getTime() + 60_000));

    expect(report).toMatchObject({ claimed: 1, absorbed: 1, sent: 0 });
    expect(backend.posts).toHaveLength(1);
    expect(store.messages).toHaveLength(1);
    expect(again).toMatchObject({ status: "absorbed", messageId: store.messages[0].id });
  });

  it("is absorbed for a decision that already has an open card in the channel", async () => {
    const { store, backend, dispatcher } = harness();
    const card = store.message();
    const row = store.enqueue({
      messageKind: "decision_card",
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      subject: {},
    });

    await dispatcher.tick(NOW);

    expect(backend.posts).toEqual([]);
    expect(row).toMatchObject({ status: "absorbed", messageId: card.id });
  });

  it("does not post again when an earlier attempt's post landed but was never settled", async () => {
    // The dispatcher died between Slack's answer and the settle: the row comes due again with
    // its message already stamped.
    const { store, backend, dispatcher } = harness();
    const message = store.message({ kind: "event_card", cardKind: "loop_finished", state: null });
    const row = store.enqueue({ messageId: message.id, attempts: 1 });

    await dispatcher.tick(NOW);

    expect(backend.posts).toEqual([]);
    expect(row.status).toBe("sent");
  });

  it("reuses the message row of an attempt that never reached the platform", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({ ok: false, error: "unreachable", reason: "retry" });
    const row = store.enqueue();

    await dispatcher.tick(NOW);
    expect(store.messages).toEqual([expect.objectContaining({ platformTs: null })]);
    expect(row.messageId).toBe(store.messages[0].id);

    // The retry crosses the hour: the dedupe bucket would not match, the remembered row does.
    await dispatcher.tick(new Date(NOW.getTime() + 2 * 3_600_000));

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].platformTs).toBe(backend.posts[0].ts);
    expect(row).toMatchObject({ status: "sent", attempts: 2 });
  });
});

describe("a failure", () => {
  it("is retried with backoff, keeping its error", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({ ok: false, error: "unreachable", reason: "retry" });
    const row = store.enqueue();

    const report = await dispatcher.tick(NOW);

    expect(report).toMatchObject({ retried: 1 });
    expect(row).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "unreachable",
      nextAttemptAt: new Date(NOW.getTime() + BACKOFF_BASE_MS),
    });
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({
      ok: false,
      error: "ratelimited",
      reason: "retry",
      retryAfterSeconds: 90,
    });
    const row = store.enqueue();

    await dispatcher.tick(NOW);

    expect(row.nextAttemptAt).toEqual(new Date(NOW.getTime() + 90_000));
  });

  it("never retries sooner than its own backoff, however short Retry-After is", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({
      ok: false,
      error: "ratelimited",
      reason: "retry",
      retryAfterSeconds: 1,
    });
    const row = store.enqueue();

    await dispatcher.tick(NOW);

    expect(row.nextAttemptAt).toEqual(new Date(NOW.getTime() + BACKOFF_BASE_MS));
  });

  it("puts the rest of a rate-limited connection's rows back untried, to wait as long", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({
      ok: false,
      error: "ratelimited",
      reason: "retry",
      retryAfterSeconds: 30,
    });
    const first = store.enqueue({ nextAttemptAt: new Date(1) });
    const second = store.enqueue({ nextAttemptAt: new Date(2), subject: { run_id: "run-2" } });
    const third = store.enqueue({ nextAttemptAt: new Date(3), subject: { run_id: "run-3" } });

    const report = await dispatcher.tick(NOW);

    expect(report).toMatchObject({ claimed: 3, retried: 1, deferred: 2, sent: 0 });
    expect(backend.posts).toEqual([]);
    expect(first.attempts).toBe(1);
    // Untried: no attempt is counted against them.
    expect([second.attempts, third.attempts]).toEqual([0, 0]);
    expect(second.nextAttemptAt).toEqual(new Date(NOW.getTime() + 30_000));
    expect(third.nextAttemptAt).toEqual(new Date(NOW.getTime() + 30_000));
  });

  it("does not hold another connection up for it", async () => {
    const { store, backend, dispatcher } = harness();
    const other = "c5360000-0000-4000-8000-000000000002";
    const otherChannel = "c5360000-0000-4000-8000-0000000000b1";
    store.channels.push({
      id: otherChannel,
      connectionId: other,
      platformChannelId: "C900OTHER",
      archived: false,
      joined: true,
      purposeTag: null,
    });
    backend.answers.push({
      ok: false,
      error: "ratelimited",
      reason: "retry",
      retryAfterSeconds: 30,
    });
    store.enqueue({ nextAttemptAt: new Date(1) });
    const elsewhere = store.enqueue({
      nextAttemptAt: new Date(2),
      connectionId: other,
      channelId: otherChannel,
    });

    await dispatcher.tick(NOW);

    expect(elsewhere.status).toBe("sent");
  });

  it("sends a connection's rows one at a time, in the order they came due", async () => {
    const { store, backend, dispatcher } = harness();
    store.enqueue({ nextAttemptAt: new Date(2), subject: { run_id: "second" } });
    store.enqueue({ nextAttemptAt: new Date(1), subject: { run_id: "first" } });
    let inFlight = 0;
    let most = 0;
    const post = backend.post.bind(backend);

    backend.post = async (input) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;

      return post(input);
    };

    await dispatcher.tick(NOW);

    expect(most).toBe(1);
    expect(store.messages.map((message) => message.payloadDigest)).toEqual([
      payloadDigest(CHANNEL, ["loop_finished", "first"]),
      payloadDigest(CHANNEL, ["loop_finished", "second"]),
    ]);
  });

  it("dead-letters a row whose attempts run out, with its last error — it does not vanish", async () => {
    const { store, backend, dispatcher } = harness();
    const row = store.enqueue({ attempts: MAX_CHAT_ATTEMPTS - 1 });
    backend.answers.push({ ok: false, error: "service_unavailable", reason: "retry" });

    const report = await dispatcher.tick(NOW);

    expect(report).toMatchObject({ dead_lettered: 1 });
    expect(row).toMatchObject({
      status: "dead_lettered",
      attempts: MAX_CHAT_ATTEMPTS,
      lastError: "service_unavailable",
      nextAttemptAt: null,
      settledAt: NOW,
    });
    expect(store.outbox).toContain(row);
  });

  it("retries every attempt before the last", async () => {
    const { store, backend, dispatcher } = harness();
    const row = store.enqueue();
    let now = NOW;

    for (let attempt = 1; attempt < MAX_CHAT_ATTEMPTS; attempt += 1) {
      backend.answers.push({ ok: false, error: "unreachable", reason: "retry" });
      await dispatcher.tick(now);
      expect(row).toMatchObject({ status: "pending", attempts: attempt });
      now = row.nextAttemptAt ?? now;
    }

    backend.answers.push({ ok: false, error: "unreachable", reason: "retry" });
    await dispatcher.tick(now);

    expect(row.status).toBe("dead_lettered");
  });

  it("dead-letters at once a message the platform will never take", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({ ok: false, error: "invalid_blocks", reason: "rejected" });
    const row = store.enqueue();

    await dispatcher.tick(NOW);

    expect(row).toMatchObject({
      status: "dead_lettered",
      attempts: 1,
      lastError: "invalid_blocks",
    });
  });

  it("skips, and remembers the channel is gone, when the bot is no longer in it", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({ ok: false, error: "not_in_channel", reason: "gone" });
    const row = store.enqueue();

    const report = await dispatcher.tick(NOW);

    expect(report).toMatchObject({ skipped: 1 });
    expect(row).toMatchObject({
      status: "skipped",
      lastError: "the destination takes no messages: not_in_channel",
    });
    expect(store.channels[0]).toMatchObject({ joined: false, archived: false });
  });

  it("archives the channel when the platform says it is archived", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({ ok: false, error: "is_archived", reason: "gone" });
    store.enqueue();

    await dispatcher.tick(NOW);

    expect(store.channels[0].archived).toBe(true);
  });

  it("skips when the install was revoked mid-flight", async () => {
    const { store, backend, dispatcher } = harness();
    backend.answers.push({ ok: false, error: "token_revoked", reason: "revoked" });
    const row = store.enqueue();

    await dispatcher.tick(NOW);

    expect(row).toMatchObject({
      status: "skipped",
      lastError: "the connection was revoked: token_revoked",
    });
  });

  it("treats an unexpected throw as a failed attempt, not a lost row", async () => {
    const { store, compose, dispatcher } = harness();
    compose.mockRejectedValueOnce(new Error("the database went away"));
    const row = store.enqueue();

    const report = await dispatcher.tick(NOW);

    expect(report).toMatchObject({ retried: 1 });
    expect(row).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "the database went away",
    });
  });
});

describe("nowhere to say it, or nothing to say", () => {
  it("skips a row whose connection is no longer active, without calling the platform", async () => {
    const { store, backend, compose, dispatcher } = harness();
    store.inactive.add(CONNECTION);
    const row = store.enqueue();

    await dispatcher.tick(NOW);

    expect(row).toMatchObject({ status: "skipped", lastError: "the connection is not active" });
    expect(backend.posts).toEqual([]);
    expect(compose).not.toHaveBeenCalled();
  });

  it("skips an archived channel and a channel that no longer exists", async () => {
    const { store, backend, dispatcher } = harness();
    store.channels[0].archived = true;
    const archived = store.enqueue();
    const missing = store.enqueue({ channelId: "c5360000-0000-4000-8000-0000000000ff" });

    await dispatcher.tick(NOW);

    expect(archived.lastError).toBe("the channel is archived");
    expect(missing.lastError).toBe("the channel no longer exists");
    expect(backend.posts).toEqual([]);
  });

  it("skips with the composer's reason when there is nothing to say any more", async () => {
    const { store, compose, backend, dispatcher } = harness();
    compose.mockResolvedValueOnce({ skip: "the decision no longer exists" });
    const row = store.enqueue();

    await dispatcher.tick(NOW);

    expect(row).toMatchObject({ status: "skipped", lastError: "the decision no longer exists" });
    expect(backend.posts).toEqual([]);
    expect(store.messages).toEqual([]);
  });
});

describe("a DM", () => {
  it("goes through the same publisher and records the same message row", async () => {
    const { store, backend, dispatcher } = harness();
    const row = store.enqueue({
      channelId: null,
      dmPlatformUserId: "U07KEN",
      messageKind: "decision_card",
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      subject: {},
      routeKind: "custom:blocking-questions",
    });

    await dispatcher.tick(NOW);

    expect(backend.opened).toEqual(["U07KEN"]);
    expect(backend.posts).toEqual([expect.objectContaining({ channelId: "D-U07KEN" })]);
    const dm = store.channels.find((channel) => channel.platformChannelId === "D-U07KEN");

    expect(dm).toMatchObject({ purposeTag: "dm", joined: true });
    expect(store.messages).toEqual([
      expect.objectContaining({
        channelId: dm?.id,
        kind: "decision_card",
        decisionItemId: ITEM,
        state: "open",
        platformTs: backend.posts[0].ts,
      }),
    ]);
    expect(row.status).toBe("sent");
  });

  it("opens one conversation per person, however often they are DMed", async () => {
    const { store, dispatcher } = harness();
    store.enqueue({ channelId: null, dmPlatformUserId: "U07KEN" });
    await dispatcher.tick(NOW);
    store.enqueue({ channelId: null, dmPlatformUserId: "U07KEN", subject: { run_id: "another" } });
    await dispatcher.tick(NOW);

    expect(store.channels.filter((channel) => channel.purposeTag === "dm")).toHaveLength(1);
    expect(store.messages).toHaveLength(2);
  });

  it("retries, skips or dead-letters a DM that cannot be opened, by the same rules", async () => {
    const { store, backend, dispatcher } = harness();
    backend.dmFailure = { ok: false, error: "user_not_found", reason: "gone" };
    const gone = store.enqueue({ channelId: null, dmPlatformUserId: "U0GONE" });

    await dispatcher.tick(NOW);

    expect(gone).toMatchObject({
      status: "skipped",
      lastError: "the destination takes no messages: user_not_found",
    });

    backend.dmFailure = { ok: false, error: "unreachable", reason: "retry" };
    const later = store.enqueue({ channelId: null, dmPlatformUserId: "U07KEN" });

    await dispatcher.tick(NOW);

    expect(later).toMatchObject({ status: "pending", attempts: 1, lastError: "unreachable" });
  });
});

describe("post → resolve → update → system line", () => {
  it("edits the stored card into its resolved form, then posts the line", async () => {
    const { store, backend, dispatcher } = harness();
    const decision = {
      messageKind: "decision_card" as const,
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      subject: {},
      routeKind: "custom:blocking-questions",
    };

    // 1. The question is posted.
    store.enqueue(decision);
    await dispatcher.tick(NOW);
    const [card] = store.messages;
    const posted = backend.posts[0];

    expect(card).toMatchObject({ state: "open", platformTs: posted.ts });
    expect(JSON.stringify(posted.rendered.payload)).toContain("<Allow once>");

    // 2. It is answered: an update of that message, and a line a second later.
    const later = new Date(NOW.getTime() + 240_000);
    const update = store.enqueue({ ...decision, operation: "update", messageId: card.id });
    const line = store.enqueue({
      ...decision,
      messageKind: "system_line",
      nextAttemptAt: new Date(later.getTime() + 1000),
    });

    await dispatcher.tick(later);

    expect(backend.updates).toEqual([
      expect.objectContaining({ channelId: "C071LOOPS", ts: posted.ts }),
    ]);
    // The updated card offers no live buttons.
    expect(JSON.stringify(backend.updates[0].rendered.payload)).not.toMatch(/<Allow once>|<Deny>/);
    expect(JSON.stringify(backend.updates[0].rendered.payload)).toContain(
      "Maya Chen answered: allowed once · in Slack",
    );
    expect(card).toMatchObject({
      state: "resolved",
      resolution: { outcome: "allow_once", resolvedBy: "user-maya", resolvedAt: NOW },
      editedAt: later,
      payloadDigest: payloadDigest(CHANNEL, ["decision_card", ITEM, "allow_once"]),
    });
    expect(update).toMatchObject({ status: "sent", messageId: card.id });
    // The line is not due until after the edit.
    expect(line.status).toBe("pending");

    // 3. The line follows.
    await dispatcher.tick(new Date(later.getTime() + 1000));

    expect(backend.posts).toHaveLength(2);
    expect(backend.posts[1].rendered.text).toBe("✓ Maya Chen answered: allow once — loop #1851");
    expect(store.messages).toHaveLength(2);
    expect(store.messages[1]).toMatchObject({
      kind: "system_line",
      decisionItemId: ITEM,
      state: null,
      facts: { action: "allow_once", answered_by: "Maya Chen" },
    });
    expect(line.status).toBe("sent");
  });

  it("absorbs a second update of a card that is already resolved — a race is not an error", async () => {
    const { store, backend, dispatcher } = harness();
    const card = store.message({ state: "resolved" });
    const row = store.enqueue({
      operation: "update",
      messageKind: "decision_card",
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      messageId: card.id,
    });

    await dispatcher.tick(NOW);

    expect(backend.updates).toEqual([]);
    expect(row.status).toBe("absorbed");
  });

  it("skips an update whose card never reached the platform", async () => {
    const { store, backend, dispatcher } = harness();
    const card = store.message({ platformTs: null });
    const row = store.enqueue({
      operation: "update",
      messageKind: "decision_card",
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      messageId: card.id,
    });

    await dispatcher.tick(NOW);

    expect(backend.updates).toEqual([]);
    expect(row).toMatchObject({
      status: "skipped",
      lastError: "the card to edit was never posted",
    });
  });

  it("retries a failed update and leaves the card open until it lands", async () => {
    const { store, backend, dispatcher } = harness();
    const card = store.message();
    backend.answers.push({
      ok: false,
      error: "ratelimited",
      reason: "retry",
      retryAfterSeconds: 5,
    });
    const row = store.enqueue({
      operation: "update",
      messageKind: "decision_card",
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      messageId: card.id,
    });

    await dispatcher.tick(NOW);

    expect(card.state).toBe("open");
    expect(row).toMatchObject({ status: "pending", attempts: 1 });

    await dispatcher.tick(row.nextAttemptAt ?? NOW);

    expect(card.state).toBe("resolved");
    expect(row.status).toBe("sent");
  });
});

describe("the payload digest", () => {
  it("is over what the message is and where it goes — not how it happened to render", () => {
    const a = payloadDigest(CHANNEL, ["decision_card", ITEM]);

    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadDigest(CHANNEL, ["decision_card", ITEM])).toBe(a);
    expect(payloadDigest("another-channel", ["decision_card", ITEM])).not.toBe(a);
    expect(payloadDigest(CHANNEL, ["decision_card", ITEM, "allow_once"])).not.toBe(a);
  });
});
