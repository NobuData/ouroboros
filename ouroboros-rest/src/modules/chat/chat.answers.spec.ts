import { Logger } from "@nestjs/common";

import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import type { AppConfigService } from "../config/config.service";
import type { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { renderDecision } from "../decisions/decision.templates";
import type { InboxItemRow, InboxRepository } from "../decisions/inbox.repository";
import { ConflictError, ForbiddenError, InvalidRequestError } from "../errors/error.envelope";
import type { InboxActionsService } from "../inbox-actions/inbox-actions.service";
import { FakeTokenStore, FakeVault } from "../inbox-channels/tokens/action-token.fixture";
import { ActionTokenService } from "../inbox-channels/tokens/action-token.service";
import type { InsightsPageService } from "../insights/page/page.service";
import type { CapabilityRepository } from "../tenancy/capability.repository";
import type { OrganizationRepository } from "../tenancy/organization.repository";
import { actionValueMessage, encodeActionValue, newActionNonce } from "./chat.action-payload";
import { APPROVER_CAPABILITY, ChatAnswers, requirementWords, type ChatPress } from "./chat.answers";
import type { ChatCard } from "./chat.card";
import { ChatComposer } from "./chat.composer";
import type { ChatEscalationRepository, PressedMessage } from "./chat.escalation.repository";
import {
  ASKED_AT,
  CONNECTION,
  DRAWN_AT,
  ITEM,
  ORGANIZATION,
  QUESTION_REFS,
  QUESTION_TIMER,
  RUN_1851,
  UI_URL,
} from "./chat.fixture";
import type { ChatPublisher } from "./chat.publisher";
import type { ChatRepository, ChatResolutionRow } from "./chat.repository";

/**
 * A button pressed on a decision card (#538): answered through the inbox's action executor, as
 * the person who pressed it — and only `answered` changes anything. The values are signed by a
 * real composer over a real token service, so a forgery here fails the way one would in Slack.
 */

const MESSAGE = "c5380000-0000-4000-8000-0000000000e1";
const PLATFORM_CHANNEL = "C071LOOPS";
const PLATFORM_TS = "1760000000.000001";
const MAYA = "user-maya";
const OTHER_ITEM = "5eed0082-0000-4000-8000-0000000000ff";

const ITEM_ROW: InboxItemRow = {
  id: ITEM,
  shortSeq: 2,
  kindId: "protected_path_allow_once",
  kindVersion: 1,
  severity: "warn",
  status: "open",
  payload: SEEDED_PAYLOADS.protected_path_allow_once,
  refs: QUESTION_REFS,
  sourceRef: `run:${RUN_1851}:path:boot/rollback_flag.c`,
  createdAt: ASKED_AT,
  snoozedUntil: null,
  snoozedBy: null,
  snoozeReason: null,
  escalatedAt: null,
};

/** The card the question was posted as. */
const CARD: PressedMessage = {
  id: MESSAGE,
  organizationId: ORGANIZATION,
  kind: "decision_card",
  decisionItemId: ITEM,
  state: "open",
};

const RESOLVED: ChatResolutionRow = {
  resolver: "human",
  policy: null,
  actionId: "allow_once",
  actorId: "user-priya",
  actorName: "Priya Nair",
  channel: "web",
  resolvedAt: new Date("2026-10-11T14:10:00.000Z"),
};

/** What the executor answers a pressed action with — the parts a press reads. */
const RESULT = {
  itemId: ITEM,
  status: "resolved",
  attempt: { id: "attempt-9" },
  receipt: { effects: ["allowed the write once", "loop #1851 resumed"], links: [] },
};

/** What a spec may set up differently from Maya, a capable member, pressing an open question. */
interface Setup {
  item?: InboxItemRow | null;
  message?: PressedMessage | null;
  roles?: string[] | null;
  /** `member_capabilities.can_approve_loops`; null when it was never set. */
  explicit?: boolean | null;
  name?: string | null;
  resolution?: ChatResolutionRow;
}

/** The answering service over stubs of what it reads, with a real composer and signer. */
function harness(setup: Setup = {}) {
  const tokens = new ActionTokenService(
    new FakeTokenStore().repository(),
    new FakeVault().service(),
  );
  const item = setup.item === null ? undefined : (setup.item ?? ITEM_ROW);
  const inbox = {
    item: jest.fn((_organizationId: string, _itemId: string) => Promise.resolve(item)),
  };
  const registry = {
    pinnedKind: jest.fn((kindId: string) => Promise.resolve(SHIPPED_KINDS[kindId])),
    render: renderDecision,
  };
  const repository = {
    resolution: jest.fn((_itemId: string) => Promise.resolve(setup.resolution)),
  };
  const messages = {
    timer: jest.fn(() => Promise.resolve(QUESTION_TIMER)),
    pressedMessage: jest.fn((_connectionId: string, _channelId: string, _ts: string) =>
      Promise.resolve(setup.message === null ? undefined : (setup.message ?? CARD)),
    ),
    personName: jest.fn((_userId: string) =>
      Promise.resolve(setup.name === null ? undefined : (setup.name ?? "Maya Chen")),
    ),
  };
  const config = { uiUrl: UI_URL } as AppConfigService;
  const composer = new ChatComposer(
    repository as unknown as ChatRepository,
    messages as unknown as ChatEscalationRepository,
    inbox as unknown as InboxRepository,
    registry as unknown as DecisionKindRegistry,
    tokens,
    {} as InsightsPageService,
    config,
  );
  const publisher = { decisionResolved: jest.fn(() => Promise.resolve(2)) };
  const actions = { execute: jest.fn((): Promise<unknown> => Promise.resolve(RESULT)) };
  const organizations = {
    rolesFor: jest.fn((_organizationId: string, _userId: string) =>
      Promise.resolve(setup.roles === null ? undefined : (setup.roles ?? ["member"])),
    ),
  };
  const capabilities = {
    explicitFor: jest.fn((_organizationId: string, _userId: string) =>
      Promise.resolve(setup.explicit === undefined ? true : setup.explicit),
    ),
  };
  const audit = { record: jest.fn((_record: AuditRecord) => Promise.resolve("audit-1")) };
  const answers = new ChatAnswers(
    composer,
    messages as unknown as ChatEscalationRepository,
    repository as unknown as ChatRepository,
    publisher as unknown as ChatPublisher,
    inbox as unknown as InboxRepository,
    registry as unknown as DecisionKindRegistry,
    actions as unknown as InboxActionsService,
    organizations as unknown as OrganizationRepository,
    capabilities as unknown as CapabilityRepository,
    audit as unknown as AuditService,
    config,
  );

  /**
   * A value signed the way the composer signs a button's.
   *
   * @param actionId - The action it names.
   * @param itemId - The decision it names.
   * @param organizationId - The workspace whose key signs it.
   * @returns The value.
   */
  async function signed(
    actionId: string,
    itemId: string = ITEM,
    organizationId: string = ORGANIZATION,
  ): Promise<string> {
    const unsigned = { itemId, actionId, nonce: newActionNonce() };
    const { keyRef, mac } = await tokens.sign(
      organizationId,
      actionValueMessage(organizationId, unsigned),
    );

    return encodeActionValue({ ...unsigned, keyRef, mac });
  }

  /**
   * The value on a button of the card as the composer draws it now.
   *
   * @param actionId - The button.
   * @returns Its value.
   */
  async function onTheCard(actionId: string): Promise<string> {
    const composed = await composer.compose(
      {
        id: "row-1",
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        channelId: "channel-1",
        dmPlatformUserId: null,
        operation: "post",
        messageKind: "decision_card",
        cardKind: ITEM_ROW.kindId,
        decisionItemId: ITEM,
        subject: {},
        routeKind: "custom:blocking-questions",
        attempts: 0,
        messageId: null,
      },
      DRAWN_AT,
    );

    if ("skip" in composed) {
      throw new Error(`no card: ${composed.skip}`);
    }

    const button = (composed.model as ChatCard).actions.find(
      (action) => action.type === "answer" && action.id === actionId,
    );

    if (button?.type !== "answer") {
      throw new Error(`the card has no ${actionId} button`);
    }

    return button.value;
  }

  /**
   * Whether anything at all was changed.
   *
   * @returns True when the executor, the audit log or the publisher was called.
   */
  const touched = (): boolean =>
    actions.execute.mock.calls.length +
      audit.record.mock.calls.length +
      publisher.decisionResolved.mock.calls.length >
    0;

  return {
    answers,
    composer,
    signed,
    onTheCard,
    touched,
    inbox,
    registry,
    repository,
    messages,
    publisher,
    actions,
    organizations,
    capabilities,
    audit,
  };
}

/** A press by Maya, linked, on the card. */
function press(value: unknown, overrides: Partial<ChatPress> = {}): ChatPress {
  return {
    organizationId: ORGANIZATION,
    connectionId: CONNECTION,
    platformChannelId: PLATFORM_CHANNEL,
    platformTs: PLATFORM_TS,
    value,
    platformUserId: "U07MAYA",
    userId: MAYA,
    ...overrides,
  };
}

describe("ChatAnswers", () => {
  let quiet: jest.SpyInstance;

  beforeEach(() => {
    quiet = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => quiet.mockRestore());

  describe("the allow-once chain", () => {
    it("answers through the inbox's executor, as the person who pressed, on the slack channel", async () => {
      const { answers, onTheCard, actions, messages } = harness();

      const outcome = await answers.press(press(await onTheCard("allow_once")), DRAWN_AT);

      expect(outcome).toEqual({
        kind: "answered",
        action: "Allow once",
        effects: ["allowed the write once", "loop #1851 resumed"],
      });
      expect(messages.pressedMessage).toHaveBeenCalledWith(
        CONNECTION,
        PLATFORM_CHANNEL,
        PLATFORM_TS,
      );
      expect(actions.execute).toHaveBeenCalledTimes(1);
      expect(actions.execute).toHaveBeenCalledWith(
        ORGANIZATION,
        ITEM,
        "allow_once",
        { id: MAYA, name: "Maya Chen", roles: ["member"] },
        {},
        "slack",
      );
    });

    it("writes one audit entry: who, the capability that permitted it, and where the press came from", async () => {
      const { answers, onTheCard, audit } = harness();

      await answers.press(press(await onTheCard("allow_once")), DRAWN_AT);

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith({
        organizationId: ORGANIZATION,
        actorId: MAYA,
        action: "chat.decision_answered",
        subjectType: "decision_item",
        subjectId: ITEM,
        at: DRAWN_AT,
        detail: {
          surface: "slack",
          actionId: "allow_once",
          permittedBy: "can_approve_loops",
          attemptId: "attempt-9",
          connectionId: CONNECTION,
          messageId: MESSAGE,
          platformChannelId: PLATFORM_CHANNEL,
          platformTs: PLATFORM_TS,
          platformUserId: "U07MAYA",
        },
      });
    });

    it("writes no resolution, no card edit and no line itself — those follow the executor's answer", async () => {
      const { answers, onTheCard, publisher, repository } = harness();

      await answers.press(press(await onTheCard("allow_once")), DRAWN_AT);

      expect(publisher.decisionResolved).not.toHaveBeenCalled();
      expect(repository.resolution).toHaveBeenCalledTimes(1); // the composer's, drawing the card
    });

    it("answers the other button the same way", async () => {
      const { answers, onTheCard, actions } = harness();

      const outcome = await answers.press(press(await onTheCard("deny")), DRAWN_AT);

      expect(outcome).toMatchObject({ kind: "answered", action: "Deny" });
      expect(actions.execute).toHaveBeenCalledWith(
        ORGANIZATION,
        ITEM,
        "deny",
        expect.objectContaining({ id: MAYA }),
        {},
        "slack",
      );
    });

    it("lets an owner through on the role's default, with no explicit capability", async () => {
      const { answers, signed, actions } = harness({ roles: ["owner"], explicit: null });

      await expect(answers.press(press(await signed("allow_once")))).resolves.toMatchObject({
        kind: "answered",
      });
      expect(actions.execute).toHaveBeenCalledWith(
        ORGANIZATION,
        ITEM,
        "allow_once",
        { id: MAYA, name: "Maya Chen", roles: ["owner"] },
        {},
        "slack",
      );
    });

    it("answers a snoozed question too — a snooze hides it, it does not close it", async () => {
      const { answers, signed, actions } = harness({
        item: { ...ITEM_ROW, status: "snoozed", snoozedUntil: new Date(DRAWN_AT.getTime() + 1) },
      });

      await expect(answers.press(press(await signed("allow_once")))).resolves.toMatchObject({
        kind: "answered",
      });
      expect(actions.execute).toHaveBeenCalledTimes(1);
    });

    it("records the role, not the capability, for an action a role permits", async () => {
      const { answers, signed, audit } = harness({
        item: { ...ITEM_ROW, kindId: "fact_review", payload: SEEDED_PAYLOADS.fact_review },
        explicit: null,
      });

      await expect(answers.press(press(await signed("confirm")))).resolves.toMatchObject({
        kind: "answered",
        action: "Confirm",
      });
      expect(audit.record.mock.calls[0][0].detail).toMatchObject({
        actionId: "confirm",
        permittedBy: "role:member",
      });
    });

    it("sends an answer that takes a note to the app — a button carries no text", async () => {
      const { answers, signed, actions, audit } = harness({
        item: { ...ITEM_ROW, kindId: "plan_sign_off", payload: SEEDED_PAYLOADS.plan_sign_off },
      });

      await expect(answers.press(press(await signed("return_to_loop")))).resolves.toEqual({
        kind: "needs_note",
        action: "Return to loop with note",
        url: expect.stringMatching(new RegExp(`/inbox\\?item=${ITEM}$`)) as string,
      });
      expect(actions.execute).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("still answers when the audit entry cannot be written — the answer already happened", async () => {
      const { answers, signed, audit, actions } = harness();
      audit.record.mockRejectedValueOnce(new Error("the audit log is unreachable"));

      await expect(answers.press(press(await signed("allow_once")), DRAWN_AT)).resolves.toEqual({
        kind: "answered",
        action: "Allow once",
        effects: RESULT.receipt.effects,
      });
      expect(actions.execute).toHaveBeenCalledTimes(1);
      expect(quiet).toHaveBeenCalledWith(
        `Could not audit the chat answer on message ${MESSAGE}.`,
        expect.anything(),
      );
    });
  });

  describe("a second press", () => {
    it("reports who answered, executes nothing, and re-intends the card's resolved form", async () => {
      const { answers, signed, actions, audit, publisher } = harness({
        item: { ...ITEM_ROW, status: "resolved" },
        resolution: RESOLVED,
      });

      const outcome = await answers.press(press(await signed("allow_once")), DRAWN_AT);

      expect(outcome).toEqual({
        kind: "already_answered",
        summary: "Priya Nair answered: allowed once · in Ouroboros",
      });
      expect(actions.execute).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      // The repair for a presser looking at a stale card: its edit is intended again.
      expect(publisher.decisionResolved).toHaveBeenCalledTimes(1);
      expect(publisher.decisionResolved).toHaveBeenCalledWith(ITEM, "allow_once");
    });

    it("says the same for the other button of an answered card — the reference is spent with its decision", async () => {
      const { answers, signed, actions } = harness({
        item: { ...ITEM_ROW, status: "resolved" },
        resolution: RESOLVED,
      });

      await expect(answers.press(press(await signed("deny")))).resolves.toMatchObject({
        kind: "already_answered",
      });
      expect(actions.execute).not.toHaveBeenCalled();
    });

    it("names a policy's closure in the policy's words", async () => {
      const { answers, signed } = harness({
        item: { ...ITEM_ROW, status: "resolved" },
        resolution: {
          ...RESOLVED,
          resolver: "policy",
          policy: "source_resolved",
          actionId: "source_resolved",
          actorId: null,
          actorName: null,
          channel: "api",
        },
      });

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "already_answered",
        summary: "Closed — settled elsewhere",
      });
    });

    it("has no summary, and re-intends nothing, when the resolution is not on record", async () => {
      const { answers, signed, publisher } = harness({
        item: { ...ITEM_ROW, status: "resolved" },
      });

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "already_answered",
        summary: undefined,
      });
      expect(publisher.decisionResolved).not.toHaveBeenCalled();
    });

    it("reports the winner when two people press at once and the executor lets the other through", async () => {
      const { answers, signed, actions, audit, publisher } = harness({ resolution: RESOLVED });
      actions.execute.mockRejectedValueOnce(
        new ConflictError("decision_already_answered", "Priya answered it first."),
      );

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "already_answered",
        summary: "Priya Nair answered: allowed once · in Ouroboros",
      });
      expect(actions.execute).toHaveBeenCalledTimes(1);
      expect(audit.record).not.toHaveBeenCalled();
      expect(publisher.decisionResolved).toHaveBeenCalledWith(ITEM, "allow_once");
    });

    it("reports a press that is still executing, and never retries it", async () => {
      const { answers, signed, actions, audit } = harness();
      actions.execute.mockRejectedValueOnce(
        new ConflictError("decision_action_in_progress", "Priya's answer is running."),
      );

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "in_progress",
      });
      expect(actions.execute).toHaveBeenCalledTimes(1);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe("a forged payload", () => {
    it.each([
      ["nothing", undefined],
      ["a number", 7],
      ["garbage", "allow_once"],
      ["the opaque value of an unsigned fixture", "signed:allow_once"],
      [
        "the right shape with no signature behind it",
        `ouro1|${ITEM}|allow_once|n|k|${"0".repeat(64)}`,
      ],
    ])("is rejected, and changes nothing: %s", async (_what, value) => {
      const { answers, touched, messages } = harness();

      await expect(answers.press(press(value))).resolves.toEqual({ kind: "rejected" });
      expect(touched()).toBe(false);
      expect(messages.pressedMessage).not.toHaveBeenCalled();
    });

    it.each([
      ["its MAC replaced", (parts: string[]) => [...parts.slice(0, 5), "0".repeat(64)]],
      [
        "its action swapped",
        (parts: string[]) => [...parts.slice(0, 2), "deny", ...parts.slice(3)],
      ],
      ["its item swapped", (parts: string[]) => [parts[0], OTHER_ITEM, ...parts.slice(2)]],
      ["its nonce changed", (parts: string[]) => [...parts.slice(0, 3), "x", ...parts.slice(4)]],
    ])("is rejected when a genuine value has %s", async (_what, alter) => {
      const { answers, onTheCard, touched } = harness();
      const genuine = await onTheCard("allow_once");

      await expect(answers.press(press(alter(genuine.split("|")).join("|")))).resolves.toEqual({
        kind: "rejected",
      });
      expect(touched()).toBe(false);
    });

    it("is rejected when another workspace signed it", async () => {
      const { answers, signed, touched } = harness();

      await expect(
        answers.press(press(await signed("allow_once", ITEM, "org-other"))),
      ).resolves.toEqual({ kind: "rejected" });
      expect(touched()).toBe(false);
    });

    it("is rejected when this workspace's value arrives for another workspace's connection", async () => {
      const { answers, signed, touched } = harness();

      await expect(
        answers.press(press(await signed("allow_once"), { organizationId: "org-other" })),
      ).resolves.toEqual({ kind: "rejected" });
      expect(touched()).toBe(false);
    });
  });

  describe("a replayed payload", () => {
    it.each<[string, Setup]>([
      ["a message this connection never posted", { message: null }],
      ["another decision's card", { message: { ...CARD, decisionItemId: OTHER_ITEM } }],
      ["the system line under the card", { message: { ...CARD, kind: "system_line" } }],
      [
        "an event card, which names no decision",
        { message: { ...CARD, kind: "event_card", decisionItemId: null, state: null } },
      ],
      ["a message of another workspace", { message: { ...CARD, organizationId: "org-other" } }],
    ])("is rejected when a genuine value is pressed on %s", async (_what, setup) => {
      const { answers, onTheCard, touched } = harness(setup);

      await expect(answers.press(press(await onTheCard("allow_once")))).resolves.toEqual({
        kind: "rejected",
      });
      expect(touched()).toBe(false);
    });

    it.each<[string, Partial<ChatPress>]>([
      ["no channel", { platformChannelId: undefined }],
      ["no message timestamp", { platformTs: undefined }],
      ["neither", { platformChannelId: undefined, platformTs: undefined }],
    ])("is rejected when a genuine value arrives with %s", async (_what, overrides) => {
      const { answers, onTheCard, touched, messages } = harness();

      await expect(answers.press(press(await onTheCard("allow_once"), overrides))).resolves.toEqual(
        { kind: "rejected" },
      );
      expect(touched()).toBe(false);
      expect(messages.pressedMessage).not.toHaveBeenCalled();
    });

    it("looks the message up by the connection the press arrived through", async () => {
      const { answers, onTheCard, messages } = harness();

      await answers.press(
        press(await onTheCard("allow_once"), {
          connectionId: "c5360000-0000-4000-8000-000000000002",
          platformChannelId: "D0DIRECT",
          platformTs: "1760000000.000777",
        }),
      );

      expect(messages.pressedMessage).toHaveBeenCalledWith(
        "c5360000-0000-4000-8000-000000000002",
        "D0DIRECT",
        "1760000000.000777",
      );
    });

    it("is rejected for a decision that no longer exists", async () => {
      const { answers, signed, touched } = harness({ item: null });

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "rejected",
      });
      expect(touched()).toBe(false);
    });

    it.each([
      ["a link action, which answers nothing", "view_diff"],
      ["an action the kind does not declare", "approve_merge"],
    ])("is rejected for a genuine signature over %s", async (_what, actionId) => {
      const { answers, signed, touched } = harness();

      await expect(answers.press(press(await signed(actionId)))).resolves.toEqual({
        kind: "rejected",
      });
      expect(touched()).toBe(false);
    });
  });

  describe("who pressed it", () => {
    it("tells an unlinked presser to link, having read nothing about them and changed nothing", async () => {
      const { answers, onTheCard, touched, organizations, capabilities, inbox } = harness();
      const value = await onTheCard("allow_once");
      inbox.item.mockClear();

      await expect(answers.press(press(value, { userId: undefined }))).resolves.toEqual({
        kind: "unlinked",
      });
      expect(touched()).toBe(false);
      expect(organizations.rolesFor).not.toHaveBeenCalled();
      expect(capabilities.explicitFor).not.toHaveBeenCalled();
      expect(inbox.item).not.toHaveBeenCalled();
    });

    it("does not offer a link for a forged value: the signature is checked before the presser", async () => {
      const { answers } = harness();

      await expect(
        answers.press(press("signed:allow_once", { userId: undefined })),
      ).resolves.toEqual({ kind: "rejected" });
    });

    it.each<[string, Setup]>([
      ["is no longer a member of the workspace", { roles: null }],
      ["no longer exists", { name: null }],
    ])("refuses somebody whose linked account %s", async (_what, setup) => {
      const { answers, signed, touched } = harness(setup);

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "not_a_member",
      });
      expect(touched()).toBe(false);
    });

    it("denies a linked member without the capability, naming it — and nothing changes", async () => {
      const { answers, onTheCard, touched, capabilities } = harness({ explicit: null });

      const outcome = await answers.press(press(await onTheCard("allow_once")), DRAWN_AT);

      expect(outcome).toEqual({
        kind: "denied",
        action: "Allow once",
        needs: "the `can_approve_loops` capability",
      });
      expect(capabilities.explicitFor).toHaveBeenCalledWith(ORGANIZATION, MAYA);
      expect(touched()).toBe(false);
    });

    it("denies an admin whose capability was revoked explicitly", async () => {
      const { answers, signed, touched } = harness({ roles: ["admin"], explicit: false });

      await expect(answers.press(press(await signed("deny")))).resolves.toEqual({
        kind: "denied",
        action: "Deny",
        needs: "the `can_approve_loops` capability",
      });
      expect(touched()).toBe(false);
    });

    it("names the role for an action gated by one", async () => {
      const { answers, signed, touched } = harness({
        item: { ...ITEM_ROW, kindId: "plan_sign_off", payload: SEEDED_PAYLOADS.plan_sign_off },
        roles: ["viewer"],
        // The capability does not stand in for a role.
        explicit: true,
      });

      await expect(answers.press(press(await signed("return_to_loop")))).resolves.toEqual({
        kind: "denied",
        action: "Return to loop with note",
        needs: "the member role",
      });
      expect(touched()).toBe(false);
    });

    it("reports the executor's own refusal the same way, should it disagree", async () => {
      const { answers, signed, actions, audit } = harness();
      actions.execute.mockRejectedValueOnce(
        new ForbiddenError("decision_action_forbidden", "That answer needs an approver."),
      );

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "denied",
        action: "Allow once",
        needs: "the `can_approve_loops` capability",
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("words each requirement as a person reads it", () => {
      expect(APPROVER_CAPABILITY).toBe("can_approve_loops");
      expect(requirementWords("approver")).toBe("the `can_approve_loops` capability");
      expect(requirementWords("admin")).toBe("the admin role");
      expect(requirementWords("member")).toBe("the member role");
    });
  });

  describe("a merge-class decision (X5)", () => {
    const MERGE: InboxItemRow = {
      ...ITEM_ROW,
      kindId: "merge_approval",
      severity: "err",
      payload: SEEDED_PAYLOADS.merge_approval,
    };

    it.each(["approve_merge", "return_to_loop"])(
      "sends a genuine %s press to the app, and executes nothing",
      async (actionId) => {
        const { answers, signed, touched } = harness({ item: MERGE, roles: ["owner"] });

        await expect(answers.press(press(await signed(actionId)), DRAWN_AT)).resolves.toEqual({
          kind: "confirm_in_app",
          url: `${UI_URL}/inbox?item=${ITEM}`,
        });
        expect(touched()).toBe(false);
      },
    );

    it("says so before it asks whether they may press: no capability is read", async () => {
      const { answers, signed, capabilities } = harness({ item: MERGE, explicit: null });

      await expect(answers.press(press(await signed("approve_merge")))).resolves.toMatchObject({
        kind: "confirm_in_app",
      });
      expect(capabilities.explicitFor).not.toHaveBeenCalled();
    });

    it("still rejects a forged value for one, and still tells an unlinked presser to link", async () => {
      const { answers, signed } = harness({ item: MERGE });

      await expect(answers.press(press("signed:approve_merge"))).resolves.toEqual({
        kind: "rejected",
      });
      await expect(
        answers.press(press(await signed("approve_merge"), { userId: undefined })),
      ).resolves.toEqual({ kind: "unlinked" });
    });

    it("maps the executor's own refusal to the same outcome — the second lock on the same door", async () => {
      // The kind was not merge-class when the press was checked; the executor read it as one.
      const { answers, signed, actions, audit } = harness();
      actions.execute.mockRejectedValueOnce(
        new ForbiddenError(
          "decision_action_confirm_in_app",
          "A merge is confirmed in Ouroboros, signed in — it cannot be answered from chat.",
          { itemId: ITEM },
        ),
      );

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "confirm_in_app",
        url: `${UI_URL}/inbox?item=${ITEM}`,
      });
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe("nothing left to answer, or a refusal", () => {
    it("says an expired question is closed", async () => {
      const { answers, signed, touched } = harness({ item: { ...ITEM_ROW, status: "expired" } });

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "closed",
      });
      expect(touched()).toBe(false);
    });

    it("reports a plane's refusal in the plane's words — nothing was answered, nothing audited", async () => {
      const { answers, signed, actions, audit, publisher } = harness();
      actions.execute.mockRejectedValueOnce(
        new InvalidRequestError(
          "allow_once_still_blocked",
          "The path is still blocked by an organisation policy.",
        ),
      );

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "refused",
        message: "The path is still blocked by an organisation policy.",
      });
      expect(actions.execute).toHaveBeenCalledTimes(1);
      expect(audit.record).not.toHaveBeenCalled();
      expect(publisher.decisionResolved).not.toHaveBeenCalled();
    });

    it("says closed when the question expires between the check and the executor", async () => {
      const { answers, signed, actions, audit } = harness();
      actions.execute.mockRejectedValueOnce(
        new ConflictError("decision_item_expired", "The decision expired unanswered."),
      );

      await expect(answers.press(press(await signed("allow_once")))).resolves.toEqual({
        kind: "closed",
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("rethrows a failure nobody named", async () => {
      const { answers, signed, actions, audit } = harness();
      const lost = new Error("the database went away");
      actions.execute.mockRejectedValueOnce(lost);

      await expect(answers.press(press(await signed("allow_once")))).rejects.toBe(lost);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
