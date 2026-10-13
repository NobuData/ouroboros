/**
 * Answering a decision from a Slack button, end to end (BZ.6,
 * [#540](https://github.com/NobuData/ouroboros/issues/540)).
 *
 * `chat.answers.spec.ts` walks the press's branches against doubles. This walks the **chain**,
 * and every link in it is the real one: a driver's report raises the question, the publisher
 * posts its card to Slack (the harness), a person presses the button Slack was actually sent —
 * signed as Slack signs — and the answer goes through the inbox's own executor to the guardrail
 * plane, which lets the run's next report through. Then the part that rots: the card is edited
 * in place by `chat.update` and the system line follows.
 *
 * What must be provably load-bearing here:
 *
 *   - **one answer** however many people press at once;
 *   - **a merge is never completed from chat**, whatever value a press carries;
 *   - **a value is good for one decision, on the card it was issued for** — forged, lifted onto
 *     another message, presented with none, or replayed after the answer, it changes nothing;
 *   - **permissions are the presser's**: without the capability the action asks for, nothing
 *     changes.
 *
 * **Negative control.** The capability is checked twice on this path — `ChatAnswers.press`
 * (step 5, so the refusal can name what is missing) and the executor's own
 * `InboxActionsService.assertMayPress`, which is the one that guards the plane. Removing the
 * executor's check *and* the press's turns *denies a linked member without the capability* red
 * (the member's press answers); removing either alone does not, which is the point of having
 * two.
 */

import { ChatBench, GLOBEX } from "../../testing/chatops.bench.fixture";
import { SCHEMA_NAME } from "../db/schema";
import { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS } from "../decisions/decision.kinds.fixture";
import { ActionTokenService } from "../inbox-channels/tokens/action-token.service";
import { REPLIES } from "./slack.inbound.service";
import { ANSWER_ACTION_PREFIX } from "./slack.blockkit";
import { actionValueMessage, encodeActionValue, newActionNonce } from "../chat/chat.action-payload";
import { CONFIRM_IN_APP_LABEL } from "../chat/chat.cards.decision";
import {
  LOOPS,
  type DecisionScene,
  answerButton,
  ask,
  decisionScene,
  intended,
  linkedMember,
  postedCard,
  press,
  standing,
  touch,
  verdictOf,
} from "./slack.decisions.integration.fixture";
import { SYSTEM_LINE_DELAY_MS } from "../chat/chat.publisher";

describe("a decision answered from a Slack button", () => {
  let bench: ChatBench;

  beforeAll(async () => {
    bench = await ChatBench.start();
  });

  afterAll(() => bench.close());
  afterEach(() => bench.reset());

  /**
   * A scene with one question asked and its card standing in the loops channel.
   *
   * @returns The scene, the question, the card and its **Allow once** button.
   */
  async function waiting() {
    const scene = await decisionScene(bench);
    const question = await ask(bench, scene);

    await bench.tick();

    const card = await postedCard(bench, question.item);

    return { scene, question, card, allow: answerButton(bench, card, "Allow once") };
  }

  /**
   * Send what a resolution intended: the card's edit, and the line a moment after it.
   *
   * @param item - The decision.
   */
  async function settle(item: string): Promise<void> {
    await intended(bench, item, "update");
    await bench.tick(new Date(Date.now() + SYSTEM_LINE_DELAY_MS + 1000));
  }

  /**
   * The audit entries of a workspace for one action.
   *
   * @param scene - The scene.
   * @param action - The audit action.
   * @returns Each entry's actor and detail.
   */
  async function audited(scene: DecisionScene, action: string) {
    return bench.rows<{ actor_id: string | null; detail: Record<string, unknown> }>(
      "audit_events",
      "organization_id = $1 and action = $2",
      [scene.ingest.workspace.id, action],
    );
  }

  describe("allow once, driver-backed", () => {
    it("goes card → button → exception → resume → update, and is audited as a Slack answer", async () => {
      const { scene, question, card, allow } = await waiting();

      // The card Slack was sent: the question, and the two answers a button can give.
      expect(card.channel).toBe(LOOPS);
      expect(JSON.stringify(card.attachments) + JSON.stringify(card.blocks)).toContain(
        "Allow a one-time edit to a protected path?",
      );
      expect(
        bench.slack
          .buttonsOf(card)
          .filter((button) => button.actionId?.startsWith(ANSWER_ACTION_PREFIX))
          .map((button) => button.label),
      ).toEqual(["Allow once", "Deny"]);

      const pressed = await press(bench, "U0KEN", allow, card);

      expect(pressed.emitted.response.status).toBe(200);
      expect(pressed.text).toMatch(/^Answered: Allow once — /);

      // The exception, granted through this card's item and by the person who pressed.
      const grants = await bench.rows<{ granted_via: string; granted_by: string; run_id: string }>(
        "guardrail_exceptions",
        "organization_id = $1",
        [scene.ingest.workspace.id],
      );

      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        granted_via: question.item,
        granted_by: scene.owner.id,
        run_id: question.run,
      });

      // The resolution records where it came from.
      expect(
        await bench.rows<{ channel: string; action_id: string; resolved_by_user: string }>(
          "decision_resolutions",
          "item_id = $1",
          [question.item],
        ),
      ).toMatchObject([
        { channel: "slack", action_id: "allow_once", resolved_by_user: scene.owner.id },
      ]);

      // Resume: answering re-judges the change-set that was refused, and the grant is spent on
      // it — the run's standing verdict is now a pass, by an evaluation of this run.
      expect(await verdictOf(bench, question.run)).toBe("pass");
      expect(
        await bench.rows<{ used_by_evaluation: string | null }>(
          "guardrail_exceptions",
          `granted_via = $1 and used_at is not null and used_by_evaluation in
             (select id from ${SCHEMA_NAME}.guardrail_evaluations where run_id = $2)`,
          [question.item, question.run],
        ),
      ).toHaveLength(1);
      // Once: the next touch of the same path is refused again.
      expect(await touch(bench, question.run, question.path, "files-after")).toBe("fail");

      // The card is edited in place — same message, no buttons — and the line follows it.
      await settle(question.item);

      const resolved = await postedCard(bench, question.item);

      expect(resolved.ts).toBe(card.ts);
      expect(resolved.edits).toBe(1);
      expect(
        bench.slack.buttonsOf(resolved).filter((button) => button.value !== undefined),
      ).toEqual([]);
      expect(JSON.stringify(resolved.attachments) + JSON.stringify(resolved.blocks)).toContain(
        scene.owner.displayName,
      );
      expect(bench.slack.callsTo("chat.update").map((call) => call.form.ts)).toEqual([card.ts]);

      const lines = bench.slack.messagesIn(LOOPS).filter((message) => message.ts !== card.ts);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.text).toContain(scene.owner.displayName);

      expect(
        await bench.rows<{ state: string; outcome: string }>(
          "chat_messages",
          "decision_item_id = $1 and kind = 'decision_card'",
          [question.item],
        ),
      ).toMatchObject([{ state: "resolved" }]);

      // Audited as an answer from Slack: who, what let them, and the message it was pressed on.
      const [entry, ...rest] = await audited(scene, "chat.decision_answered");

      expect(rest).toEqual([]);
      expect(entry?.actor_id).toBe(scene.owner.id);
      expect(entry?.detail).toMatchObject({
        surface: "slack",
        actionId: "allow_once",
        permittedBy: "can_approve_loops",
        platformChannelId: LOOPS,
        platformTs: card.ts,
        platformUserId: "U0KEN",
      });
      expect((await audited(scene, "decision.answered")).map((row) => row.detail.channel)).toEqual([
        "slack",
      ]);
    });

    it("lets one of two simultaneous presses through, and tells the other", async () => {
      const { scene, question, card, allow } = await waiting();

      await linkedMember(bench, scene, "admin", "U0MAYA", "Maya Chen");

      const [ken, maya] = await Promise.all([
        press(bench, "U0KEN", allow, card),
        press(bench, "U0MAYA", allow, card),
      ]);
      const texts = [ken.text, maya.text];

      expect(texts.filter((text) => text.startsWith("Answered: Allow once"))).toHaveLength(1);
      expect(
        texts.filter(
          (text) =>
            text.startsWith("This was already answered") || text === REPLIES.pressInProgress,
        ),
      ).toHaveLength(1);

      expect(await standing(bench, question.item)).toMatchObject({
        status: "resolved",
        resolutions: 1,
        grants: 1,
      });
      expect(await audited(scene, "chat.decision_answered")).toHaveLength(1);

      // And only one press's worth of resume.
      expect(await verdictOf(bench, question.run)).toBe("pass");
      expect(await touch(bench, question.run, question.path, "files-after")).toBe("fail");
    });
  });

  describe("the merge-class gate", () => {
    it("never completes a merge from chat: the card offers the app, and a signed press only links to it", async () => {
      const scene = await decisionScene(bench);
      const question = await ask(bench, scene);
      const organizationId = scene.ingest.workspace.id;
      // A pull request of the run, for the merge-approval card to be about.
      const { rows: prs } = await bench.api.sql.query<{ id: string }>(
        `insert into ${SCHEMA_NAME}.pull_requests
                (organization_id, source_id, external_number, external_url, title, head_branch,
                 base_branch, state, run_id, ticket_id, additions, deletions, changed_files)
         select $1, $2, 512, 'https://github.com/acme/helios/pull/512', 'Fix the flake',
                'loop/482-canbus-flake', 'main', 'verifying', $3, t.id, 68, 15, 3
           from ${SCHEMA_NAME}.tickets t where t.organization_id = $1
         returning id`,
        [organizationId, scene.ingest.source, question.run],
      );
      const pr = prs[0]?.id ?? "";
      const { itemId } = await bench.api.nest.get(DecisionKindRegistry, { strict: false }).emit({
        organizationId,
        kindId: "merge_approval",
        payload: SEEDED_PAYLOADS.merge_approval,
        refs: [
          { type: "run", id: question.run, label: "loop #1" },
          { type: "pr", id: pr, label: "PR #512" },
        ],
        key: { plane: "pr.gates", sourceRef: `pr:${pr}` },
      });
      const merge = itemId ?? "";

      await intended(bench, merge, "post");
      await bench.tick();

      // The card: one way forward, a link into the app — and no button that answers.
      const card = await postedCard(bench, merge);
      const buttons = bench.slack.buttonsOf(card);

      expect(buttons.filter((button) => button.actionId?.startsWith(ANSWER_ACTION_PREFIX))).toEqual(
        [],
      );
      expect(buttons.find((button) => button.label === CONFIRM_IN_APP_LABEL)?.url).toContain(
        `/inbox?item=${merge}`,
      );

      // Whatever the card looked like: a value this workspace genuinely signed for the merge,
      // pressed on the merge's own card by somebody who may approve, still completes nothing.
      const unsigned = { itemId: merge, actionId: "approve_merge", nonce: newActionNonce() };
      const signed = await bench.api.nest
        .get(ActionTokenService, { strict: false })
        .sign(organizationId, actionValueMessage(organizationId, unsigned));
      const pressed = await press(
        bench,
        "U0KEN",
        {
          actionId: `${ANSWER_ACTION_PREFIX}approve_merge`,
          value: encodeActionValue({ ...unsigned, ...signed }),
        },
        card,
      );

      expect(pressed.text).toBe(REPLIES.pressConfirmInApp);
      expect(
        bench.slack.buttonsOf({ blocks: pressed.reply.body.blocks as unknown[], attachments: [] }),
      ).toMatchObject([{ label: REPLIES.pressConfirmButton }]);
      expect(
        bench.slack.buttonsOf({
          blocks: pressed.reply.body.blocks as unknown[],
          attachments: [],
        })[0]?.url,
      ).toContain(`/inbox?item=${merge}`);

      expect(await standing(bench, merge)).toMatchObject({ status: "open", resolutions: 0 });
      expect(await bench.rows("decision_action_attempts", "item_id = $1", [merge])).toEqual([]);
      expect(await audited(scene, "chat.decision_answered")).toEqual([]);
    });
  });

  describe("a press that is not what it claims", () => {
    /**
     * Hold that a press changed nothing about a question.
     *
     * @param item - The decision.
     */
    async function untouched(item: string): Promise<void> {
      expect(await standing(bench, item)).toMatchObject({
        status: "open",
        resolutions: 0,
        grants: 0,
      });
      expect(await bench.rows("decision_action_attempts", "item_id = $1", [item])).toEqual([]);
    }

    it("rejects a value whose signature was altered, or that was re-pointed at another action", async () => {
      const { question, card, allow } = await waiting();
      const flipped = allow.value.endsWith("0") ? "1" : "0";
      const deny = answerButton(bench, card, "Deny");

      for (const value of [
        `${allow.value.slice(0, -1)}${flipped}`,
        // A genuine signature for *Deny*, carried under *Allow once*'s action.
        deny.value.replace("|deny|", "|allow_once|"),
        "ouro1|not|a|value",
        "",
      ]) {
        const pressed = await press(bench, "U0KEN", { actionId: allow.actionId, value }, card);

        expect(pressed.text).toBe(REPLIES.pressRejected);
      }

      await untouched(question.item);
    });

    it("rejects a genuine value lifted onto another message, another channel, or no message", async () => {
      const scene = await decisionScene(bench);
      const first = await ask(bench, scene, "a");
      const second = await ask(bench, scene, "b");

      await bench.tick();

      const card = await postedCard(bench, first.item);
      const other = await postedCard(bench, second.item);
      const allow = answerButton(bench, card, "Allow once");

      for (const message of [
        // Another decision's card, which this connection did post.
        { channel: other.channel, ts: other.ts },
        // A message that does not exist, and the right ts in the wrong channel.
        { channel: LOOPS, ts: "1699999999.000900" },
        { channel: "C0ALERTS", ts: card.ts },
        null,
      ]) {
        expect((await press(bench, "U0KEN", allow, message)).text).toBe(REPLIES.pressRejected);
      }

      await untouched(first.item);
      await untouched(second.item);
    });

    it("answers a value replayed after the decision with who answered, and changes nothing", async () => {
      const { scene, question, card, allow } = await waiting();

      await linkedMember(bench, scene, "admin", "U0MAYA", "Maya Chen");
      expect((await press(bench, "U0KEN", allow, card)).text).toMatch(/^Answered: /);
      await settle(question.item);

      const calls = bench.slack.calls.length;

      for (const user of ["U0KEN", "U0MAYA"]) {
        const replayed = await press(bench, user, allow, card);

        expect(replayed.text).toMatch(/^This was already answered — .*Nothing was changed/);
        expect(replayed.text).toContain(scene.owner.displayName);
      }
      // *Deny*, too: the reference is spent with its decision, not with its action.
      expect((await press(bench, "U0MAYA", answerButton(bench, card, "Deny"), card)).text).toMatch(
        /^This was already answered/,
      );

      expect(await standing(bench, question.item)).toMatchObject({ resolutions: 1, grants: 1 });
      expect(await audited(scene, "chat.decision_answered")).toHaveLength(1);

      // Nothing more is said in the channel either: the edit was intended once.
      await bench.tick(new Date(Date.now() + 60_000));
      expect(bench.slack.calls).toHaveLength(calls);
    });

    it("denies a linked member without the capability, naming what it needs", async () => {
      const { scene, question, card, allow } = await waiting();

      // A member: linked, a real member of the workspace, and not an approver.
      await linkedMember(bench, scene, "member", "U0SAM", "Sam Ortiz");
      // An admin whose capability was explicitly taken away.
      const maya = await linkedMember(bench, scene, "admin", "U0MAYA", "Maya Chen");

      await bench.api.capability(scene.ingest.workspace.id, maya, false);

      for (const user of ["U0SAM", "U0MAYA"]) {
        expect((await press(bench, user, allow, card)).text).toBe(
          "Allow once needs the `can_approve_loops` capability, which your account does not have. Nothing was changed.",
        );
      }

      await untouched(question.item);
      expect(await touch(bench, question.run, question.path, "files-after")).toBe("fail");
      expect(await audited(scene, "chat.decision_answered")).toEqual([]);

      // The control: the same button, pressed by somebody who holds it, answers.
      expect((await press(bench, "U0KEN", allow, card)).text).toMatch(/^Answered: Allow once/);
    });

    it("answers an unlinked presser with the link prompt, and nothing else", async () => {
      const { question, card, allow } = await waiting();
      const pressed = await press(bench, "U0MAYA", allow, card);

      expect(pressed.text).toBe(REPLIES.needsLink);
      expect(
        bench.slack.buttonsOf({ blocks: pressed.reply.body.blocks as unknown[], attachments: [] }),
      ).toMatchObject([{ label: REPLIES.linkButton }]);
      await untouched(question.item);
    });

    it("rejects a press arriving through another Slack workspace's connection", async () => {
      const { question, card, allow } = await waiting();
      const emitted = await bench.slack.emitPress({
        team: GLOBEX.id,
        user: "U1HANK",
        action: allow,
        message: card,
      });

      // Globex is installed nowhere: there is no workspace for the press to act in.
      expect(String((await bench.slack.reply(emitted.responseUrl)).body.text)).toBe(
        REPLIES.notConnected,
      );
      await untouched(question.item);
    });
  });
});
