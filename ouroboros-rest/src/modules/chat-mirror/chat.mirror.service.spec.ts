import { NotFoundError } from "../errors/error.envelope";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Logger } from "@nestjs/common";

import { decodeCursor } from "../audit-plane/audit-plane.cursor";
import { CHAT_CHANNEL_NOT_FOUND, CHAT_CURSOR_INVALID } from "../chatops/chatops.errors";
import { ESCALATED_ANNOTATION } from "../chat/chat.cards.decision";
import {
  ASKED_AT,
  CHANNEL,
  ITEM,
  ORGANIZATION,
  PR_512,
  PR_514,
  QUESTION_REFS,
  RUN_1846,
  RUN_1847,
  RUN_1851,
} from "../chat/chat.fixture";
import {
  DM_CHANNEL,
  FakeMirrorStore,
  MAYA_ID,
  MAYA_RESOLUTION,
  OTHER_CHANNEL,
  OTHER_ORGANIZATION,
  QUESTION_ITEM,
  READ_AT,
  ROWS,
  UNBOUND_CHANNEL,
  at,
  commandRow,
  cursorAt,
  messageRow,
  mockupStream,
} from "./chat.mirror.fixture";
import type { MirrorCard, MirrorCommand, MirrorEntry, MirrorLine } from "./chat.mirror.resources";
import { MIRROR_PAGE_DEFAULT, MIRROR_PAGE_MAX } from "./chat.mirror.service";

/**
 * The channel mirror (#542): a channel's stream redrawn from `chat_messages` and `chat_commands`
 * with the publisher's own cards — every archetype, from the record and nothing else; in order,
 * in pages; for this workspace's channels only; and never failing a page over one bad row.
 */

/**
 * Read the bound channel's newest page.
 *
 * @param store - The records.
 * @param query - `before` and `limit`.
 * @returns The page.
 */
function read(store: FakeMirrorStore, query: { before?: string; limit?: number } = {}) {
  return store.service().read(ORGANIZATION, CHANNEL, query, READ_AT);
}

/** One entry of a page, by id and type — or a failure of the test. */
function entry<T extends MirrorEntry["type"]>(
  entries: readonly MirrorEntry[],
  id: string,
  type: T,
): Extract<MirrorEntry, { type: T }> {
  const found = entries.find((candidate) => candidate.id === id);

  if (found?.type !== type) {
    throw new Error(`no ${type} entry ${id}`);
  }

  return found as Extract<MirrorEntry, { type: T }>;
}

let warnings: jest.SpyInstance;

beforeEach(() => {
  warnings = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warnings.mockRestore();
});

describe("the channel and its page", () => {
  it("answers the channel as the channel list does, the platform, and the app's version", async () => {
    const page = await read(mockupStream());

    expect(page.channel).toEqual({
      id: CHANNEL,
      platformChannelId: "C071LOOPS",
      name: "ouroboros-loops",
      isPrivate: false,
      joined: true,
      memberCount: 24,
      purpose: "loops",
      archived: false,
      url: "https://app.slack.com/client/T024AB/C071LOOPS",
      routes: ["custom:loop-finished"],
    });
    expect(page.platform).toBe("slack");
    expect(page.appVersion).toBe("v2.4");
  });

  it("merges messages and commands into one stream, oldest first", async () => {
    const page = await read(mockupStream());

    expect(page.entries.map((each) => [each.type, each.id])).toEqual([
      ["card", ROWS.finished],
      ["card", ROWS.question],
      ["command", ROWS.status],
      ["command", ROWS.dryRun],
      ["card", ROWS.green],
      ["card", ROWS.failed],
      ["command", ROWS.console],
    ]);
    expect(page.olderCursor).toBeNull();
  });

  it("answers an empty stream for a channel nothing was said in", async () => {
    const page = await read(new FakeMirrorStore());

    expect(page.entries).toEqual([]);
    expect(page.olderCursor).toBeNull();
  });

  it("reads an unbound channel: its stream is what it is", async () => {
    const store = new FakeMirrorStore().type(
      [commandRow(ROWS.status, at("14:12"))],
      UNBOUND_CHANNEL,
    );

    const page = await store.service().read(ORGANIZATION, UNBOUND_CHANNEL, {}, READ_AT);

    expect(page.channel).toMatchObject({ id: UNBOUND_CHANNEL, purpose: null, routes: [] });
    expect(page.entries.map((each) => each.id)).toEqual([ROWS.status]);
  });
});

describe("an event card comes from its record", () => {
  it("draws a finished loop from the row's facts, finding its pull request by the run", async () => {
    const card = entry((await read(mockupStream())).entries, ROWS.finished, "card");

    expect(card).toEqual<MirrorCard>({
      type: "card",
      id: ROWS.finished,
      at: "2026-10-11T13:58:00.000Z",
      family: "loop_finished",
      severity: "ok",
      mark: "✓",
      headline: "Loop #1846 finished — PR #512 merged",
      lines: ["#474 Debounce e-stop interrupt handler"],
      stats: "14/14 checks · 11m cycle · $0.94 · claude-fable-5",
      actions: [
        { id: "view_pr", label: "View PR ↗", href: `/prs/${PR_512}`, style: "default" },
        { id: "run_console", label: "Run console", href: `/runs/${RUN_1846}`, style: "default" },
      ],
      footnote: null,
      state: null,
      resolution: null,
      escalatedAt: null,
    });
  });

  it.each([
    [
      "issue_title",
      "Tighten the watchdog window",
      (card: MirrorCard) => card.lines[0],
      "#474 Tighten the watchdog window",
    ],
    [
      "checks_passed",
      13,
      (card: MirrorCard) => card.stats,
      "13/14 checks · 11m cycle · $0.94 · claude-fable-5",
    ],
    [
      "cycle_seconds",
      125,
      (card: MirrorCard) => card.stats,
      "14/14 checks · 2m cycle · $0.94 · claude-fable-5",
    ],
    [
      "cost_cents",
      1234,
      (card: MirrorCard) => card.stats,
      "14/14 checks · 11m cycle · $12.34 · claude-fable-5",
    ],
    [
      "model",
      "claude-opus-5",
      (card: MirrorCard) => card.stats,
      "14/14 checks · 11m cycle · $0.94 · claude-opus-5",
    ],
  ] as const)(
    "says something else when the stored %s changes",
    async (fact, value, part, expected) => {
      const store = mockupStream();
      const stored = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.finished);

      (stored as { facts: Record<string, unknown> }).facts = { ...stored?.facts, [fact]: value };

      expect(part(entry((await read(store)).entries, ROWS.finished, "card"))).toBe(expected);
    },
  );

  it("prints no cost for a run whose record holds none — the pricing rule's verdict is the record's", async () => {
    const store = mockupStream();
    const stored = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.finished);
    const { cost_cents: _unpriced, ...facts } = stored?.facts ?? {};

    (stored as { facts: Record<string, unknown> }).facts = facts;

    const card = entry((await read(store)).entries, ROWS.finished, "card");

    expect(card.stats).toBe("14/14 checks · 11m cycle · claude-fable-5");
    expect(card.stats).not.toContain("$");
  });

  it("links no PR page for a pull request that is not mirrored here, and still names it", async () => {
    const store = mockupStream();

    store.pullRequests = [];

    const card = entry((await read(store)).entries, ROWS.finished, "card");

    expect(card.headline).toBe("Loop #1846 finished — PR #512 merged");
    expect(card.actions.map((action) => action.id)).toEqual(["run_console"]);
  });

  it("keeps the loop's number from the ref's label once the run is gone", async () => {
    const store = mockupStream();

    store.runs = [];

    const card = entry((await read(store)).entries, ROWS.finished, "card");

    expect(card.headline).toMatch(/^Loop #1846 finished/);
  });

  it("draws a green build with its counts, build, pull request and revision", async () => {
    const card = entry((await read(mockupStream())).entries, ROWS.green, "card");

    expect(card).toMatchObject({
      family: "build_green",
      severity: "accent",
      mark: "⟳",
      headline: "Loop #1847 build 3 green — 63/63 · publishing PR #514 rev 2",
      lines: [],
      stats: null,
      actions: [
        {
          id: "pr_verification",
          label: "PR verification →",
          href: `/prs/${PR_514}`,
          style: "default",
        },
      ],
      state: null,
    });
  });

  it("draws a build recorded before the build and revision were kept, without them", async () => {
    // What the dev seed's row holds: the two counts, and the run and pr refs.
    const store = new FakeMirrorStore().say([
      messageRow(ROWS.green, at("14:31"), {
        card_kind: "build_green",
        refs: [
          { type: "run", id: RUN_1847, label: "loop #1847" },
          { type: "pr", id: PR_514, label: "PR #514" },
        ],
        facts: { passed: 63, total: 63 },
      }),
    ]);

    expect(entry((await read(store)).entries, ROWS.green, "card").headline).toBe(
      "Loop #1847 build green — 63/63 · publishing PR #514",
    );
  });

  it("draws a failed build from its counts", async () => {
    const card = entry((await read(mockupStream())).entries, ROWS.failed, "card");

    expect(card).toMatchObject({
      family: "build_failed",
      severity: "err",
      mark: "✕",
      headline: "Loop #1847 build 4 failed — 2 of 63 failing",
      actions: [
        { id: "run_console", label: "Run console", href: `/runs/${RUN_1847}`, style: "default" },
      ],
    });
  });

  it("draws a digest from what its record keeps: the headline, the window and the link", async () => {
    const store = new FakeMirrorStore().say([
      messageRow(ROWS.finished, at("09:00"), {
        card_kind: "digest",
        facts: {
          window_from: "2026-10-05",
          window_to: "2026-10-11",
          merged_prs: 12,
          interventions: 3,
        },
      }),
    ]);

    expect(entry((await read(store)).entries, ROWS.finished, "card")).toMatchObject({
      family: "digest",
      severity: "info",
      mark: "✦",
      headline: "Weekly insights — 12 PRs merged this week. 3 needed a human.",
      // The KPI lines and the cost sentence are not on the record, so they are not redrawn.
      lines: [],
      stats: null,
      actions: [
        {
          id: "open_insights",
          label: "Open Insights",
          href: "/insights?range=7d",
          style: "default",
        },
      ],
      footnote: "Oct 5 – Oct 11, 2026",
    });
  });
});

describe("a decision card comes from its record and its item", () => {
  it("draws an open question with its answers leading to the inbox item, and nothing signed", async () => {
    const card = entry((await read(mockupStream())).entries, ROWS.question, "card");

    expect(card).toEqual<MirrorCard>({
      type: "card",
      id: ROWS.question,
      at: "2026-10-11T14:07:00.000Z",
      family: "protected_path_allow_once",
      severity: "warn",
      mark: "⏸",
      headline: "Allow a one-time edit to a protected path?",
      lines: [
        "The OTA rollback fix wants to add one line to boot/rollback_flag.c — a protected path. Diff is 3 lines, shown in the run console.",
        "loop #1851 · issue #479 · boot/rollback_flag.c",
      ],
      stats: null,
      actions: [
        { id: "allow_once", label: "Allow once", href: `/inbox?item=${ITEM}`, style: "primary" },
        // A link keeps its own target.
        {
          id: "view_diff",
          label: "View diff →",
          href: `/runs/${RUN_1851}#run-changes`,
          style: "default",
        },
        { id: "deny", label: "Deny", href: `/inbox?item=${ITEM}`, style: "default" },
        {
          id: "edit_protected_paths",
          label: "Edit protected paths →",
          href: "/knowledge#repo-profile",
          style: "default",
        },
      ],
      // Read off the timer at the instant of reading, as the Slack card is when it is rendered.
      footnote: "paused 4m · escalates to the Needs-you inbox in 26m",
      state: "open",
      resolution: null,
      escalatedAt: null,
    });
    expect(JSON.stringify(card)).not.toContain("signed");
  });

  it("draws an escalated question: the row's instant, and the timer's annotation", async () => {
    const store = mockupStream();
    const fired = new Date(ASKED_AT.getTime() + 30 * 60_000);
    const stored = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.question);

    (stored as { escalated_at: Date | null }).escalated_at = fired;
    store.timers.set(ITEM, { dueAt: fired, firedAt: fired, cancelledAt: null });

    const card = entry(
      (await store.service().read(ORGANIZATION, CHANNEL, {}, new Date(fired.getTime() + 60_000)))
        .entries,
      ROWS.question,
      "card",
    );

    expect(card.escalatedAt).toBe(fired.toISOString());
    expect(card.footnote).toBe(`paused 31m · ${ESCALATED_ANNOTATION}`);
    expect(card.state).toBe("open");
    expect(card.actions.map((action) => action.id)).toContain("allow_once");
  });

  /** The stream after Maya answered: the card resolved in place, and the line under it. */
  function answered(): FakeMirrorStore {
    const store = mockupStream();
    const stored = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.question);

    Object.assign(stored as object, {
      state: "resolved",
      outcome: "allow_once",
      resolved_by: MAYA_ID,
      resolved_at: at("14:11"),
    });
    store.resolutions.set(ITEM, MAYA_RESOLUTION);

    return store.say([
      messageRow(ROWS.line, new Date(at("14:11").getTime() + 1000), {
        kind: "system_line",
        card_kind: "protected_path_allow_once",
        decision_item_id: ITEM,
        refs: QUESTION_REFS,
        facts: { action: "allow_once", answered_by: "Maya Chen" },
      }),
    ]);
  }

  it("draws a resolved question as the edit left it: no buttons, the outcome and who", async () => {
    const card = entry((await read(answered())).entries, ROWS.question, "card");

    expect(card).toMatchObject({
      // The card model's resolved form, whatever the decision's own severity was.
      severity: "info",
      mark: "✓",
      headline: "Allow a one-time edit to a protected path?",
      actions: [],
      footnote: "Maya Chen answered: allowed once · in Slack",
      state: "resolved",
      resolution: { outcome: "allow once", actor: "Maya Chen", at: "2026-10-11T14:11:00.000Z" },
    });
  });

  it("takes the outcome and the answerer from the row", async () => {
    const store = answered();
    const stored = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.question);

    Object.assign(stored as object, { outcome: "deny", resolved_by: "user-ken" });
    store.people.set("user-ken", "Ken Suenobu");

    const card = entry((await read(store)).entries, ROWS.question, "card");

    expect(card.resolution).toMatchObject({ outcome: "deny", actor: "Ken Suenobu" });
    expect(card.footnote).toMatch(/^Ken Suenobu answered: /);
  });

  it("names nobody for a policy's answer, and says what the policy did", async () => {
    const store = answered();
    const stored = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.question);

    Object.assign(stored as object, { resolved_by: null });
    store.resolutions.set(ITEM, {
      ...MAYA_RESOLUTION,
      resolver: "policy",
      policy: "auto",
      actorId: null,
      actorName: null,
    });

    const card = entry((await read(store)).entries, ROWS.question, "card");

    expect(card.resolution).toMatchObject({ outcome: "auto-accepted by policy", actor: null });
    expect(card.footnote).toBe("Auto-accepted by policy");
  });

  it("draws the line an answer left from the row's facts", async () => {
    const line = entry((await read(answered())).entries, ROWS.line, "line");

    expect(line).toEqual<MirrorLine>({
      type: "line",
      id: ROWS.line,
      at: "2026-10-11T14:11:01.000Z",
      text: "✓ Maya Chen answered: allow once — loop #1851",
    });
  });

  it("says something else when the line's stored facts change", async () => {
    const store = answered();
    const stored = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.line);

    (stored as { facts: Record<string, unknown> }).facts = {
      action: "deny",
      answered_by: "Ken Suenobu",
    };

    expect(entry((await read(store)).entries, ROWS.line, "line").text).toBe(
      "✓ Ken Suenobu answered: deny — loop #1851",
    );
  });
});

describe("a command carries what it said", () => {
  it("draws a Slack command answered at once, with its reply and no result", async () => {
    const command = entry((await read(mockupStream())).entries, ROWS.status, "command");

    expect(command).toEqual<MirrorCommand>({
      type: "command",
      id: ROWS.status,
      at: "2026-10-11T14:12:00.000Z",
      surface: "slack",
      text: "/ouro status",
      author: { name: "Ken Suenobu" },
      outcome: "ok",
      reply: { text: "3 loops live · 12 queued", link: null, at: "2026-10-11T14:12:01.000Z" },
      result: null,
    });
  });

  it("draws an async command with its acknowledgement, then its result when it finished", async () => {
    const command = entry((await read(mockupStream())).entries, ROWS.dryRun, "command");

    expect(command.reply).toEqual({
      text: "Rehearsing feature-loop on #486 with no writes — the result follows.",
      // The binding stored an absolute URL on the UI origin; the mirror answers the path.
      link: { label: "Workflow Copilot", href: "/workflows/feature-loop/copilot" },
      // Said when it was typed — `completed_at` is the result's instant.
      at: "2026-10-11T14:13:00.000Z",
    });
    expect(command.result).toEqual({
      text: "Dry run of feature-loop on #486 passed in 3m — no writes.",
      link: null,
      at: "2026-10-11T14:16:00.000Z",
    });
  });

  it("draws a command still running: acknowledged, no result yet", async () => {
    const store = new FakeMirrorStore().type([
      commandRow(ROWS.dryRun, at("14:13"), {
        outcome: "async_pending",
        completed_at: null,
        reply: { text: "Rehearsing — the result follows." },
      }),
    ]);

    expect(entry((await read(store)).entries, ROWS.dryRun, "command")).toMatchObject({
      outcome: "async_pending",
      reply: { text: "Rehearsing — the result follows.", at: "2026-10-11T14:13:00.000Z" },
      result: null,
    });
  });

  it("draws a console command typed under the mirror, its link a path as stored", async () => {
    const command = entry((await read(mockupStream())).entries, ROWS.console, "command");

    expect(command).toMatchObject({
      surface: "console",
      text: "/ouro queue #485 standard-fix",
      author: { name: "Maya Chen" },
      reply: {
        text: "Queued #485 on standard-fix.",
        link: { label: "Open in the backlog", href: "/backlog?ticket=485" },
      },
    });
  });

  it.each([
    ["denied", "`/ouro route` is for workspace owners and admins."],
    ["error", "Usage: queue <ticket> [workflow]"],
    ["unlinked", "You're not linked."],
  ] as const)("draws a %s command with the words it was refused with", async (outcome, text) => {
    const store = new FakeMirrorStore().type([
      commandRow(ROWS.status, at("14:12"), {
        outcome,
        reply: { text },
        author_name: outcome === "unlinked" ? null : "Ken Suenobu",
      }),
    ]);
    const command = entry((await read(store)).entries, ROWS.status, "command");

    expect(command).toMatchObject({ outcome, reply: { text } });
    expect(command.author).toEqual(outcome === "unlinked" ? null : { name: "Ken Suenobu" });
  });

  it("answers no reply for a command recorded before replies were kept, and an off-origin link whole", async () => {
    const store = new FakeMirrorStore().type([
      commandRow(ROWS.status, at("14:12"), { reply: null }),
      commandRow(ROWS.dryRun, at("14:13"), {
        reply: { text: "See the run.", link: { label: "CI", url: "https://ci.example.test/1" } },
      }),
    ]);
    const { entries } = await read(store);

    expect(entry(entries, ROWS.status, "command").reply).toBeNull();
    expect(entry(entries, ROWS.dryRun, "command").reply?.link).toEqual({
      label: "CI",
      href: "https://ci.example.test/1",
    });
  });

  it("never reads a command_reply message as an entry: the repository is not asked for them", () => {
    // The exclusion is the query's (`chat.mirror.repository.spec.ts`); nothing here re-adds one.
    const source = readFileSync(join(__dirname, "chat.mirror.service.ts"), "utf8");

    expect(source).not.toMatch(/case "command_reply"/);
  });
});

describe("the words are the record's, not this service's", () => {
  it("holds no sentence in the service or its resources: nothing there can word an entry", () => {
    const literals = ["chat.mirror.service.ts", "chat.mirror.resources.ts"]
      .map((file) => readFileSync(join(__dirname, file), "utf8"))
      // Comments explain with examples; only code can say something to a reader of the page.
      .map((source) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))
      .flatMap((source) => source.match(/"[^"\n]*"|`[^`]*`/g) ?? []);

    // Every string in the code is an id, a key or a path — but for the one log line, which no
    // reader of the page sees. A card's words are composed by `chat.cards.*` from the record.
    expect(literals.filter((literal) => /\s/.test(literal))).toEqual([
      "`Chat message ${row.id} could not be mirrored: ${String(error)}`",
    ]);
  });
});

describe("a row that cannot be drawn does not fail the page", () => {
  /** A stream of one good command around rows that cannot be drawn. */
  async function around(...rows: ReturnType<typeof messageRow>[]) {
    const store = new FakeMirrorStore().say(rows).type([commandRow(ROWS.status, at("14:12"))]);

    return (await read(store)).entries;
  }

  it.each([
    [
      "an event family this service has no card for",
      { card_kind: "stage_changed", refs: [{ type: "run", id: RUN_1846, label: "loop #1846" }] },
    ],
    ["an event card with no family", { card_kind: null }],
    ["an event card whose refs name no run", { card_kind: "loop_finished", refs: [] }],
    ["an event card whose refs are not a list", { card_kind: "loop_finished", refs: "run" }],
    [
      "a build with no counts",
      {
        card_kind: "build_green",
        refs: [{ type: "run", id: RUN_1847, label: "loop #1847" }],
        facts: {},
      },
    ],
    [
      "a build that passed more than it ran",
      {
        card_kind: "build_failed",
        refs: [{ type: "run", id: RUN_1847, label: "loop #1847" }],
        facts: { passed: 9, total: 3 },
      },
    ],
    ["a digest that names no week", { card_kind: "digest", facts: { merged_prs: 1 } }],
    ["a decision card that names no decision", { kind: "decision_card", decision_item_id: null }],
    [
      "a decision card whose item no longer exists",
      { kind: "decision_card", decision_item_id: "5eed0082-0000-4000-8000-00000000dead" },
    ],
    [
      "a system line that records no action",
      { kind: "system_line", decision_item_id: ITEM, facts: {} },
    ],
    ["a kind of message this service does not know", { kind: "banner" as never }],
  ] as const)("skips %s", async (_which, overrides) => {
    const entries = await around(messageRow(ROWS.finished, at("13:58"), overrides));

    expect(entries.map((each) => each.id)).toEqual([ROWS.status]);
  });

  it("skips, and logs, a decision whose kind can no longer be read", async () => {
    const store = new FakeMirrorStore().say([
      messageRow(ROWS.question, at("14:07"), { kind: "decision_card", decision_item_id: ITEM }),
    ]);

    store.items.set(ITEM, { ...QUESTION_ITEM, kindId: "retired_kind" });

    expect((await read(store)).entries).toEqual([]);
    expect(warnings.mock.calls).toEqual([[expect.stringContaining(ROWS.question)]]);
  });

  it("still draws a system line whose decision is gone, saying the action as its id in words", async () => {
    const entries = await around(
      messageRow(ROWS.line, at("14:11"), {
        kind: "system_line",
        decision_item_id: "5eed0082-0000-4000-8000-00000000dead",
        refs: [{ type: "run", id: RUN_1851, label: "loop #1851" }],
        facts: { action: "allow_once", answered_by: "Maya Chen" },
      }),
    );

    expect(entry(entries, ROWS.line, "line").text).toBe(
      "✓ Maya Chen answered: allow once — loop #1851",
    );
  });

  it("asks the database only for ids that can name a row", async () => {
    const store = new FakeMirrorStore().say([
      messageRow(ROWS.finished, at("13:58"), {
        refs: [
          { type: "run", id: "not-a-uuid", label: "loop #7" },
          { type: "pr", id: "'; drop table runs; --", label: "PR #1" },
        ],
        facts: { pr_number: 1 },
      }),
    ]);

    const card = entry((await read(store)).entries, ROWS.finished, "card");

    expect(
      store.reads.filter(([method]) => method === "runs" || method === "pullRequests"),
    ).toEqual([
      ["runs", ORGANIZATION, []],
      ["pullRequests", ORGANIZATION, [], []],
    ]);
    // The label still says which loop; nothing off the UI origin is linked.
    expect(card.headline).toBe("Loop #7 finished — PR #1 merged");
    expect(card.actions.every((action) => action.href.startsWith("/"))).toBe(true);
  });
});

describe("paging", () => {
  /** Twelve commands a minute apart, `…0001` the oldest. */
  function twelve(): FakeMirrorStore {
    return new FakeMirrorStore().type(
      Array.from({ length: 12 }, (_, index) =>
        commandRow(
          `a5420000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          new Date(at("12:00").getTime() + index * 60_000),
        ),
      ),
    );
  }

  /** The last four digits of each entry's id. */
  const tails = (entries: readonly MirrorEntry[]): number[] =>
    entries.map((each) => Number(each.id.slice(-4)));

  it("answers the newest page first, and a cursor for the page before while there is one", async () => {
    const store = twelve();
    const newest = await read(store, { limit: 5 });

    expect(tails(newest.entries)).toEqual([8, 9, 10, 11, 12]);
    expect(decodeCursor(newest.olderCursor ?? "")).toEqual({
      at: cursorAt(new Date(at("12:00").getTime() + 7 * 60_000)),
      id: "a5420000-0000-4000-8000-000000000008",
    });

    const middle = await read(store, { limit: 5, before: newest.olderCursor ?? undefined });
    const oldest = await read(store, { limit: 5, before: middle.olderCursor ?? undefined });

    expect(tails(middle.entries)).toEqual([3, 4, 5, 6, 7]);
    expect(tails(oldest.entries)).toEqual([1, 2]);
    // The start of the channel's history.
    expect(oldest.olderCursor).toBeNull();
  });

  it("answers no cursor when the page ends exactly at the start of history", async () => {
    expect((await read(twelve(), { limit: 12 })).olderCursor).toBeNull();
  });

  it("pages across both tables by one order: instant, then id", async () => {
    const instant = at("14:00");
    const store = new FakeMirrorStore()
      .say([
        messageRow("a5420000-0000-4000-8000-000000000002", instant, {
          kind: "system_line",
          facts: { action: "deny" },
        }),
        messageRow("a5420000-0000-4000-8000-000000000004", instant, {
          kind: "system_line",
          facts: { action: "deny" },
        }),
      ])
      .type([
        commandRow("a5420000-0000-4000-8000-000000000001", instant),
        commandRow("a5420000-0000-4000-8000-000000000003", instant),
      ]);
    const newest = await read(store, { limit: 3 });
    const older = await read(store, { limit: 3, before: newest.olderCursor ?? undefined });

    expect(tails(newest.entries)).toEqual([2, 3, 4]);
    expect(tails(older.entries)).toEqual([1]);
  });

  it("counts a row it cannot draw towards its page, so the cursor still moves past it", async () => {
    const store = twelve().say([
      // Newest of all, and of a family with no card.
      messageRow("a5420000-0000-4000-8000-000000000099", at("13:00"), {
        card_kind: "stage_changed",
      }),
    ]);
    const newest = await read(store, { limit: 5 });

    expect(tails(newest.entries)).toEqual([9, 10, 11, 12]);
    expect(
      tails((await read(store, { limit: 5, before: newest.olderCursor ?? undefined })).entries),
    ).toEqual([4, 5, 6, 7, 8]);
  });

  it("asks each table for one row more than a page, fifty by default, a hundred at most", async () => {
    const store = twelve();

    await read(store);
    await read(store, { limit: 100 });
    await read(store, { limit: 5000 });

    expect(store.reads.filter(([method]) => method === "messages").map((call) => call[4])).toEqual([
      MIRROR_PAGE_DEFAULT + 1,
      MIRROR_PAGE_MAX + 1,
      MIRROR_PAGE_MAX + 1,
    ]);
  });

  it.each([
    ["garbage"],
    ["e30"],
    [Buffer.from('{"at":"yesterday","id":"x"}').toString("base64url")],
  ])("refuses a cursor it did not issue, rather than restart the scroll (%s)", async (before) => {
    const store = twelve();
    const refused = read(store, { before });

    await expect(refused).rejects.toMatchObject({ code: CHAT_CURSOR_INVALID, status: 422 });
    expect(store.reads).toEqual([]);
  });
});

describe("whose channel it is", () => {
  it.each([
    ["an id that is not a UUID", ORGANIZATION, "loops"],
    ["an id that names nothing", ORGANIZATION, "c5360000-0000-4000-8000-00000000ffff"],
    ["another workspace's channel", ORGANIZATION, OTHER_CHANNEL],
    ["this workspace's channel, asked for from another", OTHER_ORGANIZATION, CHANNEL],
    ["a DM conversation the publisher opened", ORGANIZATION, DM_CHANNEL],
  ])("answers 404 for %s, and reads no stream", async (_which, organizationId, channelId) => {
    const store = mockupStream();
    const refused = store.service().read(organizationId, channelId, {}, READ_AT);

    await expect(refused).rejects.toBeInstanceOf(NotFoundError);
    await expect(refused).rejects.toMatchObject({ code: CHAT_CHANNEL_NOT_FOUND, status: 404 });
    expect(store.reads).toEqual([]);
  });

  it("names the workspace on every read it makes", async () => {
    const store = mockupStream();

    await read(store);

    expect(store.reads.length).toBeGreaterThan(0);
    expect(store.reads.every(([, organizationId]) => organizationId === ORGANIZATION)).toBe(true);
  });

  it("shows another workspace's channel none of this one's stream", async () => {
    const store = mockupStream();
    const page = await store.service().read(OTHER_ORGANIZATION, OTHER_CHANNEL, {}, READ_AT);

    expect(page.channel.id).toBe(OTHER_CHANNEL);
    expect(page.entries).toEqual([]);
  });

  it("does not draw a decision of another workspace's that a row names", async () => {
    // The item is read by workspace and id; one that is not this workspace's is not found.
    const store = new FakeMirrorStore().say(
      [messageRow(ROWS.question, at("14:07"), { kind: "decision_card", decision_item_id: ITEM })],
      OTHER_CHANNEL,
    );

    expect(
      (await store.service().read(OTHER_ORGANIZATION, OTHER_CHANNEL, {}, READ_AT)).entries,
    ).toEqual([]);
  });
});
