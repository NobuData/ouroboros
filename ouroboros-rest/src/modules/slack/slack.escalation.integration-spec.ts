/**
 * What happens when nobody answers, against the real timers (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * `chat.escalation.spec.ts` drives the pass against a fake store. Here the timers are V135's own
 * rows: started by the database when a question's card is intended, due at the question's filing
 * instant plus its window, fired and cancelled by the database's functions and triggers. The
 * question is one a real run raised, and what an escalation says goes out through Slack (the
 * harness).
 *
 * **Timing is behaviour, and nothing here waits for it.** The window is made short the way a
 * workspace makes it short — its own `decision_escalation_overrides` row, one minute — and the
 * window is crossed by handing the pass a later `now` (`bench.tick(at)`), which is the only
 * clock the pass reads.
 *
 * Proved: the priority bump (the item is stamped, and the inbox lists it first), the on-call DM,
 * the annotation of the card already in the channel, a timer cancelled by an answer never
 * firing, and — after simulated downtime — every overdue timer firing exactly once.
 */

import { ChatBench } from "../../testing/chatops.bench.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { InboxQueueResource } from "../decisions/inbox.queue";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { ESCALATED_ANNOTATION } from "../chat/chat.cards.decision";
import { ChatEscalation } from "../chat/chat.escalation";
import {
  ALLOW_ONCE_KIND,
  LOOPS,
  type DecisionScene,
  answerButton,
  ask,
  cardOf,
  decisionScene,
  designateOnCall,
  linkedMember,
  postedCard,
  press,
  standing,
} from "./slack.decisions.integration.fixture";

/** The DM conversation the harness opens with Ken (`U0KEN`). */
const KEN_DM = "D0KEN";

/** One minute, in milliseconds — the window every scene here runs under. */
const WINDOW_MS = 60_000;

/** Everything a message says, as one string. */
function said(message: {
  text: string;
  blocks: readonly unknown[];
  attachments: readonly unknown[];
}) {
  return `${message.text} ${JSON.stringify(message.blocks)} ${JSON.stringify(message.attachments)}`;
}

describe("an unanswered decision, escalated", () => {
  let bench: ChatBench;

  beforeAll(async () => {
    bench = await ChatBench.start();
  });

  afterAll(() => bench.close());
  afterEach(() => bench.reset());

  /**
   * Set the workspace's own escalation window for the allow-once kind.
   *
   * @param scene - The scene.
   * @param window - The window, as an interval literal.
   */
  async function windowOf(scene: DecisionScene, window: string): Promise<void> {
    await bench.api.sql.query(
      `insert into ${SCHEMA_NAME}.decision_escalation_overrides
              (organization_id, kind_id, escalation_window)
       values ($1, $2, $3::interval)
       on conflict (organization_id, kind_id)
       do update set escalation_window = excluded.escalation_window`,
      [scene.ingest.workspace.id, ALLOW_ONCE_KIND, window],
    );
  }

  /**
   * A scene whose questions escalate after one minute.
   *
   * @returns The scene.
   */
  async function shortWindowScene(): Promise<DecisionScene> {
    const scene = await decisionScene(bench);

    await windowOf(scene, "1 minute");

    return scene;
  }

  /**
   * A decision's timer.
   *
   * @param item - The decision.
   * @returns The timer row.
   */
  async function timerOf(item: string) {
    const rows = await bench.rows<{
      started_at: Date;
      due_at: Date;
      fired_at: Date | null;
      cancelled_at: Date | null;
      cancel_reason: string | null;
    }>("decision_escalation_timers", "decision_item_id = $1", [item]);

    expect(rows).toHaveLength(1);

    return rows[0];
  }

  /** An instant comfortably past a one-minute window that started just now. */
  function pastTheWindow(): Date {
    return new Date(Date.now() + WINDOW_MS + 30_000);
  }

  it("starts the timer with the card, due one window after the question was asked", async () => {
    const scene = await shortWindowScene();
    const question = await ask(bench, scene);
    const timer = await timerOf(question.item);
    const [item] = await bench.rows<{ created_at: Date }>("decision_items", "id = $1", [
      question.item,
    ]);

    expect(timer.started_at).toEqual(item?.created_at);
    expect(timer.due_at.getTime() - timer.started_at.getTime()).toBe(WINDOW_MS);
    expect(timer).toMatchObject({ fired_at: null, cancelled_at: null });

    // Inside the window nothing escalates — the card is posted, and it counts down.
    const early = await bench.tick(new Date(timer.started_at.getTime() + WINDOW_MS - 1000));

    expect(early.escalation).toEqual({ escalated: 0, cardEdits: 0, directMessages: 0 });
    expect((await standing(bench, question.item)).escalatedAt).toBeNull();

    const card = await postedCard(bench, question.item);

    expect(said(card)).toMatch(/paused \d+s · escalates to the Needs-you inbox in \d+s/);
    expect(said(card)).not.toContain(ESCALATED_ANNOTATION);
  });

  it("bumps the item, annotates the posted card in place and DMs the on-call person", async () => {
    const scene = await shortWindowScene();
    const question = await ask(bench, scene);

    await bench.tick();

    const card = await postedCard(bench, question.item);

    // Designated after the card went out, so the DM below is the escalation's and not the
    // route's own *+ DM on-call* at filing.
    await designateOnCall(bench, scene, scene.owner);
    expect(bench.slack.callsTo("conversations.open")).toEqual([]);

    const at = pastTheWindow();
    const fired = await bench.tick(at);

    expect(fired.escalation).toEqual({ escalated: 1, cardEdits: 1, directMessages: 1 });

    // The priority bump: stamped on the item, at the instant of the pass.
    expect((await standing(bench, question.item)).escalatedAt).toEqual(at);
    expect(await timerOf(question.item)).toMatchObject({ fired_at: at, cancelled_at: null });

    // The card annotation: the same message, edited, still answerable.
    const annotated = await postedCard(bench, question.item);

    expect(annotated.ts).toBe(card.ts);
    expect(annotated.edits).toBe(1);
    expect(said(card)).not.toContain(ESCALATED_ANNOTATION);
    expect(said(annotated)).toContain(ESCALATED_ANNOTATION);
    expect(answerButton(bench, annotated, "Allow once").value).not.toBe("");

    // The on-call DM: a conversation opened with them, and the card posted into it, escalated.
    expect(bench.slack.callsTo("conversations.open").map((call) => call.form.users)).toEqual([
      "U0KEN",
    ]);

    const dm = await postedCard(bench, question.item, KEN_DM);

    expect(said(dm)).toContain("Allow a one-time edit to a protected path?");
    expect(said(dm)).toContain(ESCALATED_ANNOTATION);

    // And the DM's button answers the question like the channel's does.
    const pressed = await press(bench, "U0KEN", answerButton(bench, dm, "Allow once"), dm);

    expect(pressed.text).toMatch(/^Answered: Allow once/);
    expect(await standing(bench, question.item)).toMatchObject({ status: "resolved", grants: 1 });
  });

  it("lists the escalated item first in the inbox, ahead of a newer one", async () => {
    const scene = await shortWindowScene();
    const older = await ask(bench, scene, "older");

    // The newer question runs under a long window: it will not have escalated.
    await windowOf(scene, "6 hours");

    const newer = await ask(bench, scene, "newer");
    const queue = async () =>
      bodyOf<InboxQueueResource>(
        await bench.api
          .as(scene.owner)("get", "/api/v1/inbox")
          .set(TENANT_HEADER, scene.ingest.workspace.slug)
          .expect(200),
      ).items.map((item) => ({ id: item.id, escalated: item.escalatedAt !== null }));

    // Newest first, until one of them escalates.
    expect(await queue()).toEqual([
      { id: newer.item, escalated: false },
      { id: older.item, escalated: false },
    ]);

    expect((await bench.tick(pastTheWindow())).escalation.escalated).toBe(1);

    expect(await queue()).toEqual([
      { id: older.item, escalated: true },
      { id: newer.item, escalated: false },
    ]);
  });

  it("does not DM twice when the route already sent the on-call person the card", async () => {
    const scene = await shortWindowScene();

    // On call before the question: *Blocking questions · + DM on-call* sends the card at filing.
    await designateOnCall(bench, scene, scene.owner);

    const question = await ask(bench, scene);

    await bench.tick();
    expect(bench.slack.messagesIn(KEN_DM)).toHaveLength(1);

    const fired = await bench.tick(pastTheWindow());

    expect(fired.escalation.escalated).toBe(1);
    // Both cards are annotated by an edit; the escalation's own DM is absorbed, not sent.
    expect(fired.escalation.cardEdits).toBe(2);
    expect(bench.slack.messagesIn(KEN_DM)).toHaveLength(1);
    expect(bench.slack.messagesIn(LOOPS)).toHaveLength(1);

    for (const channel of [LOOPS, KEN_DM]) {
      const card = await postedCard(bench, question.item, channel);

      expect(card.edits).toBe(1);
      expect(said(card)).toContain(ESCALATED_ANNOTATION);
    }
  });

  it("escalates with nobody on call: the bump and the annotation, and no DM", async () => {
    const scene = await shortWindowScene();
    const question = await ask(bench, scene);

    await bench.tick();

    const fired = await bench.tick(pastTheWindow());

    expect(fired.escalation).toEqual({ escalated: 1, cardEdits: 1, directMessages: 0 });
    expect(bench.slack.callsTo("conversations.open")).toEqual([]);
    expect((await standing(bench, question.item)).escalatedAt).not.toBeNull();
  });

  it("never fires a timer whose question was answered first", async () => {
    const scene = await shortWindowScene();

    await designateOnCall(bench, scene, scene.owner);
    await linkedMember(bench, scene, "admin", "U0MAYA", "Maya Chen");

    const question = await ask(bench, scene);

    await bench.tick();

    const card = await postedCard(bench, question.item);

    expect(
      (await press(bench, "U0MAYA", answerButton(bench, card, "Allow once"), card)).text,
    ).toMatch(/^Answered: /);

    // Cancelled by the database, in the answer's own transaction — nothing had to hear of it.
    expect(await timerOf(question.item)).toMatchObject({
      fired_at: null,
      cancel_reason: "resolved",
    });

    const later = await bench.tick(pastTheWindow());

    expect(later.escalation).toEqual({ escalated: 0, cardEdits: 0, directMessages: 0 });
    expect(await standing(bench, question.item)).toMatchObject({
      status: "resolved",
      escalatedAt: null,
    });
    expect(await timerOf(question.item)).toMatchObject({ fired_at: null });

    // The card closed as answered, never as escalated — in the channel and in the DM — and
    // nothing anywhere says otherwise.
    for (const channel of [LOOPS, KEN_DM]) {
      expect((await postedCard(bench, question.item, channel)).edits).toBe(1);

      for (const message of bench.slack.messagesIn(channel)) {
        expect(said(message)).not.toContain(ESCALATED_ANNOTATION);
      }
    }
  });

  it("fires each overdue timer exactly once after downtime, and nothing on the next pass", async () => {
    const scene = await shortWindowScene();
    const questions = [
      await ask(bench, scene, "a"),
      await ask(bench, scene, "b"),
      await ask(bench, scene, "c"),
    ];

    await bench.tick();
    await designateOnCall(bench, scene, scene.owner);

    const posted = bench.slack.callsTo("chat.postMessage").length;

    expect(posted).toBe(3);

    // Nothing ran for three days. Every timer is long overdue when the process comes back.
    const back = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const recovery = await bench.tick(back);

    expect(recovery.escalation).toEqual({ escalated: 3, cardEdits: 3, directMessages: 3 });

    for (const question of questions) {
      expect((await standing(bench, question.item)).escalatedAt).toEqual(back);
      expect((await postedCard(bench, question.item)).edits).toBe(1);
      expect(await cardOf(bench, question.item, KEN_DM)).toBeDefined();
    }

    // One edit and one DM per question — a DM conversation is opened per message sent.
    expect(bench.slack.callsTo("chat.update")).toHaveLength(3);
    expect(bench.slack.messagesIn(KEN_DM)).toHaveLength(3);
    expect(bench.slack.callsTo("chat.postMessage")).toHaveLength(posted + 3);

    // The passes after it — a storm would show here — fire nothing and say nothing.
    const calls = bench.slack.calls.length;

    for (const minutes of [1, 5, 60]) {
      const again = await bench.tick(new Date(back.getTime() + minutes * 60_000));

      expect(again.escalation).toEqual({ escalated: 0, cardEdits: 0, directMessages: 0 });
      expect(again.dispatch.sent).toBe(0);
    }

    expect(bench.slack.calls).toHaveLength(calls);
    expect(
      await bench.rows("decision_escalation_timers", "organization_id = $1 and fired_at = $2", [
        scene.ingest.workspace.id,
        back,
      ]),
    ).toHaveLength(3);
  });

  it("takes a batch at a time: the rest of a backlog waits for the next pass, and still fires once", async () => {
    const scene = await shortWindowScene();
    const questions = [await ask(bench, scene, "a"), await ask(bench, scene, "b")];
    const at = pastTheWindow();
    const pass = bench.api.nest.get(ChatEscalation);

    // A pass limited to one timer takes the oldest and leaves the other pending.
    expect((await pass.pass(at, 1)).escalated).toBe(1);
    expect((await standing(bench, questions[0].item)).escalatedAt).toEqual(at);
    expect((await standing(bench, questions[1].item)).escalatedAt).toBeNull();

    expect((await pass.pass(at, 1)).escalated).toBe(1);
    expect((await pass.pass(at, 1)).escalated).toBe(0);
    expect((await standing(bench, questions[1].item)).escalatedAt).toEqual(at);
  });
});
