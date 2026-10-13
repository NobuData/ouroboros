/* eslint-disable @typescript-eslint/require-await -- in-memory fakes of async ports: each method keeps the port's `async` signature and answers at once. */
/**
 * Fixtures for the channel mirror's specs (#542): a channel's records in memory — messages,
 * commands, and what they name by id — with the repository's own order and cursor rule, and the
 * real {@link ChatMirrorService} over them.
 *
 * The rows are mockup 19's stream **as records**: facts and refs, never a sentence. Every word
 * a spec asserts on is therefore composed by the service from these rows, which is the point.
 */

import type { AppConfigService } from "../config/config.service";
import type { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { renderDecision } from "../decisions/decision.templates";
import type { InboxItemRow, InboxRepository } from "../decisions/inbox.repository";
import type { ChatChannel, ChatConnectionPublic } from "../db/schema";
import type { ChannelRouteRow, SlackRepository } from "../slack/slack.repository";
import type { EscalationTimerState } from "../chat/chat.cards.decision";
import type { ChatEscalationRepository } from "../chat/chat.escalation.repository";
import {
  ASKED_AT,
  CHANNEL,
  CONNECTION,
  ITEM,
  ORGANIZATION,
  PR_512,
  PR_514,
  QUESTION_REFS,
  QUESTION_TIMER,
  RUN_1846,
  RUN_1847,
  RUN_1851,
  UI_URL,
} from "../chat/chat.fixture";
import type {
  ChatMirrorRepository,
  MirrorCommandRow,
  MirrorCursor,
  MirrorMessageRow,
  MirrorPullRequest,
  MirrorRun,
} from "./chat.mirror.repository";
import { ChatMirrorService } from "./chat.mirror.service";
import { DM_PURPOSE_TAG } from "../chat/chat.outbox";
import type { ChatRepository, ChatResolutionRow } from "../chat/chat.repository";

/** The instant the mirror is read in most cases: four minutes after the question was asked. */
export const READ_AT = new Date(ASKED_AT.getTime() + 4 * 60_000);

/** A second workspace, with a channel of its own. */
export const OTHER_ORGANIZATION = "org-other";
export const OTHER_CHANNEL = "c5360000-0000-4000-8000-0000000000b1";

/** A DM conversation the publisher opened, and a channel nobody bound. */
export const DM_CHANNEL = "c5360000-0000-4000-8000-0000000000d1";
export const UNBOUND_CHANNEL = "c5360000-0000-4000-8000-0000000000e1";

/** Maya, who answers. */
export const MAYA_ID = "user-maya";

/**
 * An instant as the repository's cursor text carries it.
 *
 * @param at - The instant.
 * @returns UTC text with microseconds.
 */
export function cursorAt(at: Date): string {
  return at.toISOString().replace("Z", "000Z");
}

/**
 * A channel row.
 *
 * @param overrides - What differs from the bound `#ouroboros-loops`.
 * @returns The row.
 */
export function channelRow(overrides: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id: CHANNEL,
    organization_id: ORGANIZATION,
    connection_id: CONNECTION,
    platform: "slack",
    channel_id: "C071LOOPS",
    channel_name: "ouroboros-loops",
    is_private: false,
    joined: true,
    joined_at: new Date("2026-10-01T09:00:00.000Z"),
    member_count: 24,
    purpose_tag: "loops",
    archived: false,
    created_at: new Date("2026-10-01T09:00:00.000Z"),
    updated_at: new Date("2026-10-01T09:00:00.000Z"),
    ...overrides,
  };
}

/**
 * A message row.
 *
 * @param id - Its id.
 * @param at - When it was posted.
 * @param overrides - What it is; a loop-finished event card with no facts unless said.
 * @returns The row.
 */
export function messageRow(
  id: string,
  at: Date,
  overrides: Partial<MirrorMessageRow> = {},
): MirrorMessageRow {
  return {
    id,
    kind: "event_card",
    card_kind: "loop_finished",
    decision_item_id: null,
    refs: [],
    facts: {},
    state: null,
    outcome: null,
    resolved_by: null,
    resolved_at: null,
    escalated_at: null,
    posted_at: at,
    cursor_at: cursorAt(at),
    ...overrides,
  };
}

/**
 * A command row.
 *
 * @param id - Its id.
 * @param at - When it was typed.
 * @param overrides - What differs from Ken's `/ouro status` in Slack, answered a second later.
 * @returns The row.
 */
export function commandRow(
  id: string,
  at: Date,
  overrides: Partial<MirrorCommandRow> = {},
): MirrorCommandRow {
  return {
    id,
    surface: "slack",
    raw_text: "/ouro status",
    outcome: "ok",
    result_ref: null,
    reply: { text: "3 loops live · 12 queued" },
    settled_reply: null,
    invoked_at: at,
    completed_at: new Date(at.getTime() + 1000),
    author_name: "Ken Suenobu",
    cursor_at: cursorAt(at),
    ...overrides,
  };
}

/** The item behind the stream's question — mockup 19's protected-path edit. */
export const QUESTION_ITEM: InboxItemRow = {
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

/** How Maya answered it, as `decision_resolutions` holds it. */
export const MAYA_RESOLUTION: ChatResolutionRow = {
  resolver: "human",
  policy: null,
  actionId: "allow_once",
  actorId: MAYA_ID,
  actorName: "Maya Chen",
  channel: "slack",
  resolvedAt: new Date(ASKED_AT.getTime() + 4 * 60_000),
};

/** Ids of the stream's rows — message ids sort in the order they are listed. */
export const ROWS = {
  finished: "a5420000-0000-4000-8000-000000000101",
  question: "a5420000-0000-4000-8000-000000000102",
  line: "a5420000-0000-4000-8000-000000000103",
  status: "a5420000-0000-4000-8000-000000000201",
  dryRun: "a5420000-0000-4000-8000-000000000202",
  green: "a5420000-0000-4000-8000-000000000104",
  failed: "a5420000-0000-4000-8000-000000000105",
  console: "a5420000-0000-4000-8000-000000000203",
} as const;

/**
 * A minute of the stream's afternoon.
 *
 * @param hhmm - `13:58`.
 * @returns That minute of 11 October 2026, UTC.
 */
export function at(hhmm: string): Date {
  return new Date(`2026-10-11T${hhmm}:00.000Z`);
}

/** What the mirror reads, in memory. */
export class FakeMirrorStore {
  channels: ChatChannel[] = [
    channelRow(),
    channelRow({
      id: UNBOUND_CHANNEL,
      channel_id: "C074RANDOM",
      channel_name: "random",
      purpose_tag: null,
    }),
    channelRow({
      id: DM_CHANNEL,
      channel_id: "D07MAYA",
      channel_name: "D07MAYA",
      purpose_tag: DM_PURPOSE_TAG,
    }),
    channelRow({ id: OTHER_CHANNEL, organization_id: OTHER_ORGANIZATION }),
  ];
  connection: ChatConnectionPublic | undefined = {
    id: CONNECTION,
    organization_id: ORGANIZATION,
    workspace_id: "T024AB",
    workspace_name: "Acme Robotics",
    status: "active",
    install_meta: { app_id: "A07OUROBOROS", app_version: "v2.4", scopes: [] },
  } as unknown as ChatConnectionPublic;
  routes: ChannelRouteRow[] = [{ kind: "custom:loop-finished", chatChannelId: CHANNEL }];
  /** Message and command rows by channel. */
  readonly messages = new Map<string, MirrorMessageRow[]>();
  readonly commands = new Map<string, MirrorCommandRow[]>();
  runs: MirrorRun[] = [
    { id: RUN_1846, loopSeq: 1846 },
    { id: RUN_1847, loopSeq: 1847 },
  ];
  pullRequests: MirrorPullRequest[] = [
    { id: PR_512, runId: RUN_1846, number: 512 },
    { id: PR_514, runId: RUN_1847, number: 514 },
  ];
  people = new Map<string, string>([[MAYA_ID, "Maya Chen"]]);
  items = new Map<string, InboxItemRow>([[ITEM, QUESTION_ITEM]]);
  resolutions = new Map<string, ChatResolutionRow>();
  timers = new Map<string, EscalationTimerState>([[ITEM, QUESTION_TIMER]]);
  /** Every read the repository double was asked for, as `[method, organization, …]`. */
  readonly reads: unknown[][] = [];

  /**
   * Put message rows in a channel.
   *
   * @param rows - The rows.
   * @param channelId - The channel; the bound one unless said.
   * @returns This store.
   */
  say(rows: readonly MirrorMessageRow[], channelId: string = CHANNEL): this {
    this.messages.set(channelId, [...(this.messages.get(channelId) ?? []), ...rows]);

    return this;
  }

  /**
   * Put command rows in a channel.
   *
   * @param rows - The rows.
   * @param channelId - The channel; the bound one unless said.
   * @returns This store.
   */
  type(rows: readonly MirrorCommandRow[], channelId: string = CHANNEL): this {
    this.commands.set(channelId, [...(this.commands.get(channelId) ?? []), ...rows]);

    return this;
  }

  /**
   * The real service over this store.
   *
   * @returns The service.
   */
  service(): ChatMirrorService {
    /** The repository's page rule: strictly older than the cursor, newest first, bounded. */
    const page = <Row extends { id: string; cursor_at: string }>(
      rows: readonly Row[],
      before: MirrorCursor | undefined,
      limit: number,
    ): Row[] =>
      rows
        .filter(
          (row) =>
            before === undefined ||
            row.cursor_at < before.at ||
            (row.cursor_at === before.at && row.id < before.id),
        )
        .sort((a, b) =>
          a.cursor_at === b.cursor_at ? (a.id < b.id ? 1 : -1) : a.cursor_at < b.cursor_at ? 1 : -1,
        )
        .slice(0, limit);
    const owned = (organizationId: string, channelId: string): boolean =>
      this.channels.some((row) => row.id === channelId && row.organization_id === organizationId);
    const mirror = {
      messages: async (
        organizationId: string,
        channelId: string,
        before: MirrorCursor | undefined,
        limit: number,
      ) => {
        this.reads.push(["messages", organizationId, channelId, before, limit]);

        return owned(organizationId, channelId)
          ? page(this.messages.get(channelId) ?? [], before, limit)
          : [];
      },
      commands: async (
        organizationId: string,
        channelId: string,
        before: MirrorCursor | undefined,
        limit: number,
      ) => {
        this.reads.push(["commands", organizationId, channelId, before, limit]);

        return owned(organizationId, channelId)
          ? page(this.commands.get(channelId) ?? [], before, limit)
          : [];
      },
      runs: async (organizationId: string, ids: readonly string[]) => {
        this.reads.push(["runs", organizationId, [...ids]]);

        return this.runs.filter((run) => ids.includes(run.id));
      },
      pullRequests: async (
        organizationId: string,
        ids: readonly string[],
        runIds: readonly string[],
      ) => {
        this.reads.push(["pullRequests", organizationId, [...ids], [...runIds]]);

        return this.pullRequests.filter(
          (pr) => ids.includes(pr.id) || (pr.runId !== null && runIds.includes(pr.runId)),
        );
      },
      people: async (userIds: readonly string[]) =>
        new Map([...this.people].filter(([id]) => userIds.includes(id))),
    } as unknown as ChatMirrorRepository;
    const slack = {
      channel: async (organizationId: string, id: string) =>
        this.channels.find((row) => row.id === id && row.organization_id === organizationId),
      connection: async () => this.connection,
      channelRoutes: async () => this.routes,
    } as unknown as SlackRepository;

    return new ChatMirrorService(
      mirror,
      {
        resolution: async (itemId: string) => this.resolutions.get(itemId),
      } as unknown as ChatRepository,
      {
        timer: async (itemId: string) => this.timers.get(itemId),
      } as unknown as ChatEscalationRepository,
      slack,
      {
        item: async (organizationId: string, itemId: string) =>
          organizationId === ORGANIZATION ? this.items.get(itemId) : undefined,
      } as unknown as InboxRepository,
      {
        pinnedKind: async (kindId: string) => {
          if (!Object.hasOwn(SHIPPED_KINDS, kindId)) {
            throw new Error(`decision kind ${kindId} is not declared`);
          }

          return SHIPPED_KINDS[kindId];
        },
        render: renderDecision,
      } as unknown as DecisionKindRegistry,
      { uiUrl: `${UI_URL}/` } as AppConfigService,
    );
  }
}

/**
 * Mockup 19's stream, as the records of one afternoon in `#ouroboros-loops`.
 *
 * ```
 * 13:58  ✓ loop finished             event_card   facts + run ref (the PR is found by the run)
 * 14:07  ⏸ the question              decision_card, open
 * 14:12  /ouro status                slack command, answered at once
 * 14:13  /ouro dry-run #486          slack command, acknowledged — result at 14:16
 * 14:31  ⟳ build green               event_card   facts + run and pr refs
 * 14:40  ✕ build failed              event_card
 * 14:45  /ouro queue #485            console command typed under the mirror
 * ```
 *
 * @returns A store holding it.
 */
export function mockupStream(): FakeMirrorStore {
  return new FakeMirrorStore()
    .say([
      messageRow(ROWS.finished, at("13:58"), {
        card_kind: "loop_finished",
        refs: [{ type: "run", id: RUN_1846, label: "loop #1846" }],
        facts: {
          outcome: "merged",
          issue_number: 474,
          issue_title: "Debounce e-stop interrupt handler",
          pr_number: 512,
          checks_passed: 14,
          checks_total: 14,
          cycle_seconds: 660,
          cost_cents: 94,
          model: "claude-fable-5",
        },
      }),
      messageRow(ROWS.question, at("14:07"), {
        kind: "decision_card",
        card_kind: "protected_path_allow_once",
        decision_item_id: ITEM,
        refs: QUESTION_REFS,
        state: "open",
      }),
      messageRow(ROWS.green, at("14:31"), {
        card_kind: "build_green",
        refs: [
          { type: "run", id: RUN_1847, label: "loop #1847" },
          { type: "pr", id: PR_514, label: "PR #514" },
        ],
        facts: { passed: 63, total: 63, build_number: 3, revision: 2 },
      }),
      messageRow(ROWS.failed, at("14:40"), {
        card_kind: "build_failed",
        refs: [{ type: "run", id: RUN_1847, label: "loop #1847" }],
        facts: { passed: 61, total: 63, build_number: 4 },
      }),
    ])
    .type([
      commandRow(ROWS.status, at("14:12")),
      commandRow(ROWS.dryRun, at("14:13"), {
        raw_text: "/ouro dry-run #486 feature-loop",
        result_ref: { message: "m-ack", result_message: "m-result" },
        reply: {
          text: "Rehearsing feature-loop on #486 with no writes — the result follows.",
          link: { label: "Workflow Copilot", url: `${UI_URL}/workflows/feature-loop/copilot` },
        },
        settled_reply: { text: "Dry run of feature-loop on #486 passed in 3m — no writes." },
        completed_at: at("14:16"),
      }),
      commandRow(ROWS.console, at("14:45"), {
        surface: "console",
        raw_text: "/ouro queue #485 standard-fix",
        reply: {
          text: "Queued #485 on standard-fix.",
          link: { label: "Open in the backlog", url: "/backlog?ticket=485" },
        },
        author_name: "Maya Chen",
      }),
    ]);
}
