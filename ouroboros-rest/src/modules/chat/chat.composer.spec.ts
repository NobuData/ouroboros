import type { AppConfigService } from "../config/config.service";
import type { DecisionKindRegistry } from "../decisions/decision-kind.registry";
import { SEEDED_PAYLOADS, SHIPPED_KINDS } from "../decisions/decision.kinds.fixture";
import { renderDecision } from "../decisions/decision.templates";
import type { InboxItemRow, InboxRepository } from "../decisions/inbox.repository";
import { FakeTokenStore, FakeVault } from "../inbox-channels/tokens/action-token.fixture";
import { ActionTokenService } from "../inbox-channels/tokens/action-token.service";
import { DIGEST_STATES, weekPage } from "../insights/digest/digest.fixture";
import type { InsightsPageService } from "../insights/page/page.service";
import type { ChatCard } from "./chat.card";
import { ChatComposer, buildFactsOf, type ComposedChatMessage } from "./chat.composer";
import {
  ASKED_AT,
  DRAWN_AT,
  ITEM,
  LOOP_1846,
  ORGANIZATION,
  QUESTION_REFS,
  RUN_1846,
  RUN_1851,
  UI_URL,
} from "./chat.fixture";
import type { ChatRepository, ChatResolutionRow, ClaimedChatRow } from "./chat.repository";

/**
 * The composer (#536): an outbox row says what is true when it is sent — from the kind registry,
 * the item's facts and its resolution — and its buttons carry values only this service signs.
 */

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
};

const RESOLVED: ChatResolutionRow = {
  resolver: "human",
  policy: null,
  actionId: "allow_once",
  actorId: "user-maya",
  actorName: "Maya Chen",
  channel: "slack",
  resolvedAt: new Date("2026-10-11T14:11:00.000Z"),
};

/** A claimed row. */
function row(overrides: Partial<ClaimedChatRow> = {}): ClaimedChatRow {
  return {
    id: "row-1",
    organizationId: ORGANIZATION,
    connectionId: "connection-1",
    channelId: "channel-1",
    dmPlatformUserId: null,
    operation: "post",
    messageKind: "decision_card",
    cardKind: "protected_path_allow_once",
    decisionItemId: ITEM,
    subject: {},
    routeKind: "custom:blocking-questions",
    attempts: 0,
    messageId: null,
    ...overrides,
  };
}

/** A composer over stubs of what it reads, with a real signer. */
function harness(
  state: { item?: InboxItemRow; resolution?: ChatResolutionRow } = { item: ITEM_ROW },
) {
  const store = new FakeTokenStore();
  const tokens = new ActionTokenService(store.repository(), new FakeVault().service());
  const loopFinishedFacts = jest.fn().mockResolvedValue(LOOP_1846);
  const read = jest.fn().mockResolvedValue(weekPage(DIGEST_STATES.priced()));
  const composer = new ChatComposer(
    {
      resolution: () => Promise.resolve(state.resolution),
      loopFinishedFacts,
    } as unknown as ChatRepository,
    { item: () => Promise.resolve(state.item) } as unknown as InboxRepository,
    {
      pinnedKind: (kindId: string) => Promise.resolve(SHIPPED_KINDS[kindId]),
      render: renderDecision,
    } as unknown as DecisionKindRegistry,
    tokens,
    { read } as unknown as InsightsPageService,
    { uiUrl: UI_URL } as AppConfigService,
  );

  return { composer, tokens, loopFinishedFacts, read, state };
}

/** A composition that is a message, or a failure of the test. */
function message(result: ComposedChatMessage | { skip: string }): ComposedChatMessage {
  if ("skip" in result) {
    throw new Error(`skipped: ${result.skip}`);
  }

  return result;
}

describe("a waiting decision", () => {
  it("is the kind's card, open, with the item's refs and a stable digest", async () => {
    const { composer } = harness();

    const composed = message(await composer.compose(row(), DRAWN_AT));
    const card = composed.model as ChatCard;

    expect(card.headline).toBe("Allow a one-time edit to a protected path?");
    expect(card.footnote).toBe("paused 4m · escalates to the Needs-you inbox in 26m");
    expect(composed).toMatchObject({
      refs: QUESTION_REFS,
      state: "open",
      resolution: null,
      digestParts: ["decision_card", ITEM],
    });
  });

  it("signs each answering button, and the signature verifies for this workspace only", async () => {
    const { composer } = harness();
    const card = message(await composer.compose(row(), DRAWN_AT)).model as ChatCard;
    const buttons = card.actions.flatMap((action) => (action.type === "answer" ? [action] : []));

    expect(buttons.map((button) => button.id)).toEqual(["allow_once", "deny"]);

    for (const button of buttons) {
      await expect(composer.verifiedAction(ORGANIZATION, button.value)).resolves.toEqual({
        itemId: ITEM,
        actionId: button.id,
      });
      await expect(composer.verifiedAction("org-other", button.value)).resolves.toBeUndefined();
    }
  });

  it("refuses a value whose action, item or MAC was changed", async () => {
    const { composer } = harness();
    const card = message(await composer.compose(row(), DRAWN_AT)).model as ChatCard;
    const allow = card.actions.find((action) => action.id === "allow_once") as { value: string };
    const parts = allow.value.split("|");
    const swapped = [...parts.slice(0, 2), "deny", ...parts.slice(3)].join("|");
    const elsewhere = [parts[0], "5eed0082-0000-4000-8000-0000000000ff", ...parts.slice(2)].join(
      "|",
    );
    const forged = [...parts.slice(0, 5), "0".repeat(64)].join("|");

    for (const value of [swapped, elsewhere, forged, "ouro1|nonsense", undefined, 7]) {
      await expect(composer.verifiedAction(ORGANIZATION, value)).resolves.toBeUndefined();
    }
  });

  it("gives two renderings of one decision different values — a nonce per button", async () => {
    const { composer } = harness();
    const first = message(await composer.compose(row(), DRAWN_AT)).model as ChatCard;
    const second = message(await composer.compose(row(), DRAWN_AT)).model as ChatCard;

    expect(JSON.stringify(first.actions)).not.toBe(JSON.stringify(second.actions));
  });
});

describe("a decision answered in the meantime", () => {
  it("is posted already resolved — never open and then edited", async () => {
    const { composer } = harness({
      item: { ...ITEM_ROW, status: "resolved" },
      resolution: RESOLVED,
    });

    const composed = message(await composer.compose(row(), DRAWN_AT));
    const card = composed.model as ChatCard;

    expect(card.actions).toEqual([]);
    expect(card.footnote).toBe("Maya Chen answered: allowed once · in Slack");
    expect(composed).toMatchObject({
      state: "resolved",
      resolution: {
        outcome: "allow_once",
        resolvedBy: "user-maya",
        resolvedAt: RESOLVED.resolvedAt,
      },
      digestParts: ["decision_card", ITEM, "allow_once"],
    });
  });

  it("composes the same resolved card for the update", async () => {
    const { composer } = harness({ item: ITEM_ROW, resolution: RESOLVED });

    const composed = message(await composer.compose(row({ operation: "update" }), DRAWN_AT));

    expect(composed.state).toBe("resolved");
  });

  it("composes the system line, recording who answered with what", async () => {
    const { composer } = harness({ item: ITEM_ROW, resolution: RESOLVED });

    const composed = message(await composer.compose(row({ messageKind: "system_line" }), DRAWN_AT));

    expect(composed.model).toEqual({
      kind: "line",
      text: "✓ Maya Chen answered: allow once — loop #1851",
    });
    expect(composed).toMatchObject({
      facts: { action: "allow_once", answered_by: "Maya Chen" },
      state: null,
      digestParts: ["system_line", ITEM, "allow_once"],
    });
  });

  it("records a policy's closure with no person", async () => {
    const { composer } = harness({
      item: ITEM_ROW,
      resolution: {
        ...RESOLVED,
        resolver: "policy",
        policy: "source_resolved",
        actionId: "source_resolved",
        actorId: null,
        actorName: null,
      },
    });

    const card = message(await composer.compose(row(), DRAWN_AT));
    const line = message(await composer.compose(row({ messageKind: "system_line" }), DRAWN_AT));

    expect(card.resolution).toMatchObject({ outcome: "source_resolved", resolvedBy: null });
    expect(line.facts).toEqual({ action: "source_resolved" });
  });
});

describe("nothing to say", () => {
  it.each([
    ["a decision that no longer exists", {}, row(), "the decision no longer exists"],
    [
      "an update of an unresolved decision",
      { item: ITEM_ROW },
      row({ operation: "update" }),
      "the decision is not resolved",
    ],
    [
      "a line for an unresolved decision",
      { item: ITEM_ROW },
      row({ messageKind: "system_line" }),
      "the decision is not resolved",
    ],
    [
      "a decision that expired",
      { item: { ...ITEM_ROW, status: "expired" as const } },
      row(),
      "the decision expired unanswered",
    ],
    [
      "a row naming no decision",
      { item: ITEM_ROW },
      row({ decisionItemId: null }),
      "the row names no decision",
    ],
  ])("skips %s", async (_label, state, claimed, reason) => {
    const { composer } = harness(state);

    await expect(composer.compose(claimed, DRAWN_AT)).resolves.toEqual({ skip: reason });
  });

  it("skips an event family it has no card for, a run that is gone and a malformed subject", async () => {
    const { composer, loopFinishedFacts } = harness();
    const event = (overrides: Partial<ClaimedChatRow>) =>
      row({ messageKind: "event_card", decisionItemId: null, ...overrides });

    await expect(composer.compose(event({ cardKind: "stage_changed" }), DRAWN_AT)).resolves.toEqual(
      {
        skip: "no card is composed for the event family stage_changed",
      },
    );
    await expect(composer.compose(event({ cardKind: "loop_finished" }), DRAWN_AT)).resolves.toEqual(
      {
        skip: "the row names no run",
      },
    );
    loopFinishedFacts.mockResolvedValueOnce(undefined);
    await expect(
      composer.compose(
        event({ cardKind: "loop_finished", subject: { run_id: RUN_1846 } }),
        DRAWN_AT,
      ),
    ).resolves.toEqual({ skip: "the run no longer exists" });
    await expect(composer.compose(event({ cardKind: "digest" }), DRAWN_AT)).resolves.toEqual({
      skip: "the row names no digest slot",
    });
    await expect(composer.compose(event({ cardKind: "build_green" }), DRAWN_AT)).resolves.toEqual({
      skip: "the row carries no build facts",
    });
  });
});

describe("event cards", () => {
  const event = (overrides: Partial<ClaimedChatRow>) =>
    row({
      messageKind: "event_card",
      decisionItemId: null,
      routeKind: "custom:loop-finished",
      ...overrides,
    });

  it("composes the finished loop from the run, with refs that resolve and the figures it printed", async () => {
    const { composer, loopFinishedFacts } = harness();

    const composed = message(
      await composer.compose(
        event({ cardKind: "loop_finished", subject: { run_id: RUN_1846 } }),
        DRAWN_AT,
      ),
    );

    expect(loopFinishedFacts).toHaveBeenCalledWith(ORGANIZATION, RUN_1846);
    expect((composed.model as ChatCard).stats).toBe(
      "14/14 checks · 11m cycle · $0.94 · claude-fable-5",
    );
    expect(composed.refs).toEqual([
      { type: "run", id: RUN_1846, label: "loop #1846" },
      { type: "pr", id: LOOP_1846.prId, label: "PR #512" },
    ]);
    expect(composed.facts).toEqual({
      outcome: "merged",
      issue_number: 474,
      issue_title: "Debounce e-stop interrupt handler",
      pr_number: 512,
      checks_passed: 14,
      checks_total: 14,
      cycle_seconds: 660,
      cost_cents: 94,
      model: "claude-fable-5",
    });
    expect(composed.digestParts).toEqual(["loop_finished", RUN_1846]);
  });

  it("records no cost for an unpriced run — the key is absent, not zero", async () => {
    const { composer, loopFinishedFacts } = harness();
    loopFinishedFacts.mockResolvedValueOnce({ ...LOOP_1846, costCents: null, unpricedEvents: 9 });

    const composed = message(
      await composer.compose(
        event({ cardKind: "loop_finished", subject: { run_id: RUN_1846 } }),
        DRAWN_AT,
      ),
    );

    expect(composed.facts).not.toHaveProperty("cost_cents");
    expect((composed.model as ChatCard).stats).not.toMatch(/\$/);
  });

  it("composes the digest from the Insights page at the row's slot", async () => {
    const { composer, read } = harness();
    const slot = "2026-10-05T09:00:00.000Z";

    const composed = message(
      await composer.compose(
        event({ cardKind: "digest", subject: { slot }, routeKind: "custom:weekly-insights" }),
        DRAWN_AT,
      ),
    );

    expect(read).toHaveBeenCalledWith(ORGANIZATION, { range: "7d", now: new Date(slot) });
    expect((composed.model as ChatCard).headline).toMatch(/^Weekly insights — /);
    expect(composed.digestParts).toEqual(["digest", slot]);
    expect(composed.refs).toEqual([]);
  });

  it("composes a build card from the facts on the row", async () => {
    const { composer } = harness();
    const subject = { run_id: RUN_1846, loop_seq: 1847, build_number: 3, passed: 61, total: 63 };

    const green = message(
      await composer.compose(
        event({ cardKind: "build_green", subject: { ...subject, passed: 63 } }),
        DRAWN_AT,
      ),
    );
    const failed = message(
      await composer.compose(event({ cardKind: "build_failed", subject }), DRAWN_AT),
    );

    expect((green.model as ChatCard).headline).toBe("Loop #1847 build 3 green — 63/63");
    expect((failed.model as ChatCard).headline).toBe("Loop #1847 build 3 failed — 2 of 63 failing");
    expect(failed.facts).toEqual({ passed: 61, total: 63 });
    expect(failed.digestParts).toEqual(["build_failed", RUN_1846, "3"]);
  });
});

describe("build facts on a row", () => {
  it("reads what a plane wrote", () => {
    expect(
      buildFactsOf({
        run_id: "r",
        loop_seq: 7,
        passed: 1,
        total: 2,
        pr_number: 5,
        pr_id: "p",
        revision: 2,
      }),
    ).toEqual({
      runId: "r",
      loopSeq: 7,
      buildNumber: null,
      passed: 1,
      total: 2,
      prNumber: 5,
      prId: "p",
      revision: 2,
    });
  });

  it.each([
    [{}],
    [{ run_id: "r", loop_seq: 7, passed: 3, total: 2 }],
    [{ run_id: "r", loop_seq: 7, passed: -1, total: 2 }],
    [{ run_id: "", loop_seq: 7, passed: 1, total: 2 }],
    [{ run_id: "r", loop_seq: "7", passed: 1, total: 2 }],
    [{ run_id: "r", loop_seq: 7, passed: 1.5, total: 2 }],
  ])("refuses %j rather than print a count it cannot trust", (subject) => {
    expect(buildFactsOf(subject)).toBeUndefined();
  });
});
