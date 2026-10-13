/* eslint-disable @typescript-eslint/require-await -- in-memory fakes of async ports: each method keeps the port's `async` signature and answers at once. */
/**
 * Fixtures for the chat publisher's specs (#536): a second backend, an in-memory outbox, and
 * mockup 19's archetypes as card models.
 *
 * **The fixture backend is the proof the port has no Slack in it.** It renders a card to plain
 * text lines and records what it was asked to send; every archetype goes through it in
 * `chat.card.spec.ts`, and the dispatcher's whole spec runs on it.
 */

import { randomUUID } from "node:crypto";

import { MOCKUP_PROSE, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import type { DecisionRef } from "../decisions/decision.types";
import type { ChatBackend, ChatRendered, ChatSendResult } from "./chat.backend";
import type { ChatCard, ChatMessageModel, ChatSystemLine } from "./chat.card";
import {
  decisionCard,
  decisionSystemLine,
  resolvedDecisionCard,
  type DecisionCardResolution,
  type DecisionCardSubject,
} from "./chat.cards.decision";
import {
  buildFailedCard,
  buildGreenCard,
  loopFinishedCard,
  type BuildFacts,
  type LoopFinishedFacts,
} from "./chat.cards.events";
import { DM_PURPOSE_TAG } from "./chat.outbox";
import type {
  ChatChannelTarget,
  ChatMessageResolution,
  ChatMessageWrite,
  ChatRepository,
  ClaimedChatRow,
  StoredChatMessage,
} from "./chat.repository";

/** The UI origin every fixture link is built on. */
export const UI_URL = "https://app.example.test";

/** Ids the archetypes name. */
export const RUN_1846 = "a1360000-0000-4000-8000-000000001846";
export const RUN_1847 = "a1360000-0000-4000-8000-000000001847";
export const RUN_1851 = "a1360000-0000-4000-8000-000000001851";
export const PR_512 = "a1370000-0000-4000-8000-000000000512";
export const PR_514 = "a1370000-0000-4000-8000-000000000514";
export const ITEM = "5eed0082-0000-4000-8000-000000000002";

/** The finished loop of mockup 19's first card. */
export const LOOP_1846: LoopFinishedFacts = {
  runId: RUN_1846,
  loopSeq: 1846,
  issueNumber: 474,
  issueTitle: "Debounce e-stop interrupt handler",
  prNumber: 512,
  prId: PR_512,
  checksPassed: 14,
  checksTotal: 14,
  cycleSeconds: 11 * 60,
  costCents: "94",
  unpricedEvents: 0,
  model: "claude-fable-5",
};

/** The green build of mockup 19's third card. */
export const BUILD_1847: BuildFacts = {
  runId: RUN_1847,
  loopSeq: 1847,
  buildNumber: 3,
  passed: 63,
  total: 63,
  prNumber: 514,
  prId: PR_514,
  revision: 2,
};

/** The refs of mockup 19's question: loop #1851, issue #479, the protected path. */
export const QUESTION_REFS: readonly DecisionRef[] = [
  { type: "run", id: RUN_1851, label: "loop #1851" },
  { type: "ticket", id: "a1330000-0000-4000-8000-000000000479", label: "issue #479" },
  { type: "path", id: "boot/rollback_flag.c", label: "boot/rollback_flag.c" },
];

/** When mockup 19's question was asked, and the instant its card is drawn: four minutes on. */
export const ASKED_AT = new Date("2026-10-11T14:07:00.000Z");
export const DRAWN_AT = new Date("2026-10-11T14:11:00.000Z");

/** The protected-path question, as the kind registry declares and renders it. */
export const QUESTION: DecisionCardSubject = {
  kind: SHIPPED_KINDS.protected_path_allow_once,
  rendered: MOCKUP_PROSE.protected_path_allow_once,
  severity: "warn",
  refs: QUESTION_REFS,
  sourceRef: `run:${RUN_1851}:path:boot/rollback_flag.c`,
  askedAt: ASKED_AT,
};

/** A signed value per answering action — opaque here; `chat.composer.spec.ts` signs real ones. */
export const QUESTION_VALUES: ReadonlyMap<string, string> = new Map([
  ["allow_once", "signed:allow_once"],
  ["deny", "signed:deny"],
]);

/** Maya answering *allow once* in Slack. */
export const MAYA_ALLOWED: DecisionCardResolution = {
  resolver: "human",
  policy: null,
  actionId: "allow_once",
  actorName: "Maya Chen",
  channel: "slack",
};

/** Mockup 19's archetypes, as card models — what every backend must be able to draw. */
export const ARCHETYPES = {
  loop_finished: loopFinishedCard(LOOP_1846, UI_URL),
  question: decisionCard(QUESTION, { uiUrl: UI_URL, values: QUESTION_VALUES, now: DRAWN_AT }),
  question_resolved: resolvedDecisionCard(QUESTION, MAYA_ALLOWED),
  system_line: decisionSystemLine(QUESTION, MAYA_ALLOWED),
  build_green: buildGreenCard(BUILD_1847, UI_URL),
  build_failed: buildFailedCard({ ...BUILD_1847, passed: 61 }, UI_URL),
} as const satisfies Record<string, ChatCard | ChatSystemLine>;

/** A plain-text rendering of a card: one string per drawn row. */
export function plainLines(message: ChatMessageModel): string[] {
  if (message.kind === "line") {
    return [message.text];
  }

  return [
    `[${message.severity}] ${message.mark} ${message.headline}`,
    ...message.lines,
    ...(message.stats === null ? [] : [`mono: ${message.stats}`]),
    ...(message.actions.length === 0
      ? []
      : [
          message.actions
            .map((action) =>
              action.type === "link" ? `(${action.label} → ${action.url})` : `<${action.label}>`,
            )
            .join(" "),
        ]),
    ...(message.footnote === null ? [] : [`note: ${message.footnote}`]),
  ];
}

/** A backend that is not Slack: plain text out, everything it was asked recorded. */
export class FixtureChatBackend implements ChatBackend {
  /** Every post, in order. */
  readonly posts: {
    connectionId: string;
    channelId: string;
    rendered: ChatRendered;
    ts: string;
  }[] = [];
  /** Every edit, in order. */
  readonly updates: {
    connectionId: string;
    channelId: string;
    ts: string;
    rendered: ChatRendered;
  }[] = [];
  /** Every DM opened, in order. */
  readonly opened: string[] = [];
  /** Scripted answers for the next posts and updates; a call with none scripted succeeds. */
  readonly answers: ChatSendResult<{ ts: string }>[] = [];
  /** A scripted refusal to open a DM. */
  dmFailure: ChatSendResult<{ channelId: string }> | undefined;

  render(message: ChatMessageModel): ChatRendered {
    const lines = plainLines(message);

    return { text: lines[0] ?? "", payload: { lines } };
  }

  async post(input: {
    connectionId: string;
    channelId: string;
    rendered: ChatRendered;
  }): Promise<ChatSendResult<{ ts: string }>> {
    const scripted = this.answers.shift();

    if (scripted !== undefined && !scripted.ok) {
      return scripted;
    }

    const ts = scripted?.ts ?? `1760000000.${String(this.posts.length + 1).padStart(6, "0")}`;
    this.posts.push({ ...input, ts });

    return { ok: true, ts };
  }

  async update(input: {
    connectionId: string;
    channelId: string;
    ts: string;
    rendered: ChatRendered;
  }): Promise<ChatSendResult<{ ts: string }>> {
    const scripted = this.answers.shift();

    if (scripted !== undefined && !scripted.ok) {
      return scripted;
    }

    this.updates.push(input);

    return { ok: true, ts: input.ts };
  }

  async openDm(input: {
    connectionId: string;
    platformUserId: string;
  }): Promise<ChatSendResult<{ channelId: string }>> {
    this.opened.push(input.platformUserId);

    return this.dmFailure ?? { ok: true, channelId: `D-${input.platformUserId}` };
  }
}

/** An outbox row as the fake store holds it. */
export interface FakeOutboxRow extends ClaimedChatRow {
  status: "pending" | "sent" | "absorbed" | "skipped" | "dead_lettered";
  nextAttemptAt: Date | null;
  lastError: string | null;
  settledAt: Date | null;
  attempts: number;
  messageId: string | null;
}

/** A message row as the fake store holds it. */
export interface FakeMessageRow extends ChatMessageWrite {
  readonly id: string;
  platformTs: string | null;
  state: "open" | "resolved" | null;
  resolution: ChatMessageResolution | null;
  payloadDigest: string;
  editedAt: Date | null;
}

/** A channel row as the fake store holds it. */
export interface FakeChannelRow {
  readonly id: string;
  readonly connectionId: string;
  readonly platformChannelId: string;
  archived: boolean;
  joined: boolean;
  readonly purposeTag: string | null;
}

/** The connection and channel most cases use. */
export const CONNECTION = "c5360000-0000-4000-8000-000000000001";
export const CHANNEL = "c5360000-0000-4000-8000-0000000000a1";
export const ORGANIZATION = "org-acme";

/** `chat_outbox`, `chat_messages` and `chat_channels`, in memory, with the tables' own rules. */
export class FakeChatStore {
  readonly outbox: FakeOutboxRow[] = [];
  readonly messages: FakeMessageRow[] = [];
  readonly channels: FakeChannelRow[] = [
    {
      id: CHANNEL,
      connectionId: CONNECTION,
      platformChannelId: "C071LOOPS",
      archived: false,
      joined: true,
      purposeTag: "loops",
    },
  ];
  /** Connections that are not active. */
  readonly inactive = new Set<string>();

  /**
   * Put a row in the outbox, due at once.
   *
   * @param row - What differs from a loop-finished post to the default channel.
   * @returns The row.
   */
  enqueue(row: Partial<FakeOutboxRow> = {}): FakeOutboxRow {
    const stored: FakeOutboxRow = {
      id: randomUUID(),
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
      channelId: CHANNEL,
      dmPlatformUserId: null,
      operation: "post",
      messageKind: "event_card",
      cardKind: "loop_finished",
      decisionItemId: null,
      subject: { run_id: RUN_1846 },
      routeKind: "custom:loop-finished",
      attempts: 0,
      messageId: null,
      status: "pending",
      nextAttemptAt: new Date(0),
      lastError: null,
      settledAt: null,
      ...row,
    };

    this.outbox.push(stored);

    return stored;
  }

  /**
   * Put a posted message in a channel.
   *
   * @param message - What differs from an open decision card in the default channel.
   * @returns The row.
   */
  message(message: Partial<FakeMessageRow> = {}): FakeMessageRow {
    const stored: FakeMessageRow = {
      id: randomUUID(),
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      kind: "decision_card",
      cardKind: "protected_path_allow_once",
      decisionItemId: ITEM,
      refs: [],
      facts: {},
      state: "open",
      resolution: null,
      payloadDigest: "0".repeat(64),
      at: new Date("2026-10-11T14:07:00.000Z"),
      platformTs: "1760000000.000001",
      editedAt: null,
      ...message,
    };

    this.messages.push(stored);

    return stored;
  }

  /**
   * The repository over this store.
   *
   * @returns A stand-in with the real repository's dispatch methods.
   */
  repository(): ChatRepository {
    const stored = (message: FakeMessageRow): StoredChatMessage => ({
      id: message.id,
      channelId: message.channelId,
      platformTs: message.platformTs,
      state: message.state,
    });
    const target = (channel: FakeChannelRow): ChatChannelTarget => ({
      id: channel.id,
      platformChannelId: channel.platformChannelId,
      archived: channel.archived,
    });
    const hourOf = (at: Date): number => Math.floor(at.getTime() / 3_600_000);

    return {
      claimDue: async (now: Date, leaseUntil: Date, limit: number) => {
        const due = this.outbox
          .filter(
            (row) =>
              row.status === "pending" &&
              row.nextAttemptAt !== null &&
              row.nextAttemptAt.getTime() <= now.getTime(),
          )
          .sort((a, b) => (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0))
          .slice(0, limit);

        for (const row of due) {
          row.nextAttemptAt = leaseUntil;
        }

        return due.map((row) => ({ ...row }));
      },
      connectionActive: async (connectionId: string) => !this.inactive.has(connectionId),
      channel: async (id: string) => {
        const channel = this.channels.find((row) => row.id === id);

        return channel === undefined ? undefined : target(channel);
      },
      ensureDmChannel: async (
        row: Pick<ClaimedChatRow, "organizationId" | "connectionId">,
        _platformUserId: string,
        platformChannelId: string,
      ) => {
        let channel = this.channels.find(
          (known) =>
            known.connectionId === row.connectionId &&
            known.platformChannelId === platformChannelId,
        );

        if (channel === undefined) {
          channel = {
            id: randomUUID(),
            connectionId: row.connectionId,
            platformChannelId,
            archived: false,
            joined: true,
            purposeTag: DM_PURPOSE_TAG,
          };
          this.channels.push(channel);
        }

        return target(channel);
      },
      markChannelGone: async (id: string, error: string) => {
        const channel = this.channels.find((row) => row.id === id);

        if (channel !== undefined) {
          if (error === "is_archived") {
            channel.archived = true;
          } else {
            channel.joined = false;
          }
        }
      },
      message: async (id: string) => {
        const message = this.messages.find((row) => row.id === id);

        return message === undefined ? undefined : stored(message);
      },
      insertMessage: async (write: ChatMessageWrite) => {
        // V131's two rules: same content in the same channel within the hour, and one open card
        // per decision per channel.
        const existing = this.messages.find(
          (row) =>
            row.channelId === write.channelId &&
            ((row.payloadDigest === write.payloadDigest && hourOf(row.at) === hourOf(write.at)) ||
              (write.kind === "decision_card" &&
                row.kind === "decision_card" &&
                row.state === "open" &&
                write.state === "open" &&
                row.decisionItemId === write.decisionItemId)),
        );

        if (existing !== undefined) {
          return { created: false as const, existing: stored(existing) };
        }

        const message: FakeMessageRow = {
          ...write,
          id: randomUUID(),
          platformTs: null,
          editedAt: null,
        };

        this.messages.push(message);

        return { created: true as const, id: message.id };
      },
      stampPosted: async (messageId: string, ts: string) => {
        const message = this.messages.find((row) => row.id === messageId);

        if (message !== undefined && message.platformTs === null) {
          message.platformTs = ts;
        }
      },
      recordResolved: async (
        messageId: string,
        resolution: ChatMessageResolution,
        payloadDigest: string,
        at: Date,
      ) => {
        const message = this.messages.find((row) => row.id === messageId);

        if (message !== undefined) {
          message.state = "resolved";
          message.resolution = resolution;
          message.payloadDigest = payloadDigest;
          message.editedAt = at;
        }
      },
      settle: async (
        id: string,
        status: FakeOutboxRow["status"],
        detail: { error?: string; messageId?: string | null; attempts?: number },
        at: Date,
      ) => {
        const row = this.outbox.find((candidate) => candidate.id === id);

        if (row === undefined || row.status !== "pending") {
          return false;
        }

        row.status = status;
        row.nextAttemptAt = null;
        row.settledAt = at;
        row.lastError = detail.error ?? row.lastError;
        row.messageId = detail.messageId ?? row.messageId;
        row.attempts = detail.attempts ?? row.attempts;

        return true;
      },
      retry: async (
        id: string,
        retry: { attempts: number; nextAttemptAt: Date; error: string; messageId?: string | null },
      ) => {
        const row = this.outbox.find((candidate) => candidate.id === id);

        if (row !== undefined && row.status === "pending") {
          row.attempts = retry.attempts;
          row.nextAttemptAt = retry.nextAttemptAt;
          row.lastError = retry.error;
          row.messageId = retry.messageId ?? row.messageId;
        }
      },
      defer: async (ids: readonly string[], nextAttemptAt: Date) => {
        for (const row of this.outbox) {
          if (ids.includes(row.id) && row.status === "pending") {
            row.nextAttemptAt = nextAttemptAt;
          }
        }
      },
    } as unknown as ChatRepository;
  }
}
