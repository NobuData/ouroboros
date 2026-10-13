import { Logger } from "@nestjs/common";

import { ChatEscalation, ESCALATION_BATCH } from "./chat.escalation";
import type {
  ChatEscalationRepository,
  DueEscalationTimer,
  EscalationIntents,
} from "./chat.escalation.repository";
import { ORGANIZATION } from "./chat.fixture";

/**
 * The escalation pass (#538): each due timer is claimed, fired and said in its own transaction;
 * a backlog left by downtime fires once each, a bounded number per pass — never in a storm.
 */

const NOW = new Date("2026-10-11T14:37:00.000Z");

/** A due timer for the nth decision. */
function due(n: number): DueEscalationTimer {
  return {
    id: `timer-${String(n)}`,
    organizationId: ORGANIZATION,
    decisionItemId: `item-${String(n)}`,
    kindId: "protected_path_allow_once",
  };
}

/**
 * The pass over an in-memory set of due timers.
 *
 * A timer leaves the set when it is fired — or when the database refuses to fire it, which is
 * what a timer cancelled in the meantime looks like.
 *
 * @param count - How many timers are due.
 * @param options.refused - Timers the database refuses to fire.
 * @param options.intents - What each firing intends, when not one card edit and one DM.
 */
function harness(
  count: number,
  options: { refused?: readonly string[]; intents?: Record<string, EscalationIntents> } = {},
) {
  const pending = Array.from({ length: count }, (_, index) => due(index + 1));
  // Every call, in order, tagged with the transaction it ran in.
  const calls: string[] = [];
  let transactions = 0;
  let open: string | undefined;
  const repository = {
    transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => {
      transactions += 1;
      const name = `tx${String(transactions)}`;

      expect(open).toBeUndefined();
      open = name;
      calls.push(`${name}:begin`);

      try {
        const result = await work({ name });
        calls.push(`${name}:commit`);

        return result;
      } catch (error) {
        calls.push(`${name}:rollback`);
        throw error;
      } finally {
        open = undefined;
      }
    }),
    claimDue: jest.fn((transaction: { name: string }, _now: Date) => {
      calls.push(`${transaction.name}:claim`);

      return Promise.resolve(pending[0]);
    }),
    fire: jest.fn((transaction: { name: string }, timerId: string, _now: Date) => {
      calls.push(`${transaction.name}:fire:${timerId}`);
      pending.splice(
        pending.findIndex((timer) => timer.id === timerId),
        1,
      );

      return Promise.resolve(!(options.refused ?? []).includes(timerId));
    }),
    enqueue: jest.fn((transaction: { name: string }, timer: DueEscalationTimer) => {
      calls.push(`${transaction.name}:enqueue:${timer.id}`);

      return Promise.resolve(options.intents?.[timer.id] ?? { cardEdits: 1, directMessages: 1 });
    }),
  };
  const escalation = new ChatEscalation(repository as unknown as ChatEscalationRepository);

  return { escalation, repository, pending, calls };
}

describe("the escalation pass", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => log.mockRestore());

  it("does nothing when no timer is due", async () => {
    const { escalation, repository, calls } = harness(0);

    await expect(escalation.pass(NOW)).resolves.toEqual({
      escalated: 0,
      cardEdits: 0,
      directMessages: 0,
    });
    expect(calls).toEqual(["tx1:begin", "tx1:claim", "tx1:commit"]);
    expect(repository.fire).not.toHaveBeenCalled();
    expect(repository.enqueue).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("claims, fires and says one due timer in one transaction, at the instant of the pass", async () => {
    const { escalation, repository, calls } = harness(1);

    await expect(escalation.pass(NOW)).resolves.toEqual({
      escalated: 1,
      cardEdits: 1,
      directMessages: 1,
    });
    expect(calls).toEqual([
      "tx1:begin",
      "tx1:claim",
      "tx1:fire:timer-1",
      "tx1:enqueue:timer-1",
      "tx1:commit",
      // Then it looks again, and stops when nothing more is due.
      "tx2:begin",
      "tx2:claim",
      "tx2:commit",
    ]);
    expect(repository.claimDue).toHaveBeenCalledWith({ name: "tx1" }, NOW);
    expect(repository.fire).toHaveBeenCalledWith({ name: "tx1" }, "timer-1", NOW);
    expect(repository.enqueue).toHaveBeenCalledWith({ name: "tx1" }, due(1));
    expect(log).toHaveBeenCalledWith(
      "Decision item-1 escalated unanswered: 1 card(s) annotated, 1 on-call DM(s).",
    );
  });

  it("gives each due timer its own transaction, and sums what they intended", async () => {
    const { escalation, repository, calls } = harness(3, {
      intents: {
        "timer-1": { cardEdits: 2, directMessages: 1 },
        // Nobody on call, or they have not linked: the card is annotated and that is all.
        "timer-2": { cardEdits: 1, directMessages: 0 },
        // Never posted anywhere: the item is escalated in the inbox alone.
        "timer-3": { cardEdits: 0, directMessages: 0 },
      },
    });

    await expect(escalation.pass(NOW)).resolves.toEqual({
      escalated: 3,
      cardEdits: 3,
      directMessages: 1,
    });
    expect(repository.transaction).toHaveBeenCalledTimes(4);
    expect(calls.filter((call) => /:(fire|enqueue):/.test(call))).toEqual([
      "tx1:fire:timer-1",
      "tx1:enqueue:timer-1",
      "tx2:fire:timer-2",
      "tx2:enqueue:timer-2",
      "tx3:fire:timer-3",
      "tx3:enqueue:timer-3",
    ]);
  });

  it("fires missed timers once each, a bounded number per pass — the rest wait for the next", async () => {
    // Five came due while nothing was running.
    const { escalation, repository, pending } = harness(5);

    await expect(escalation.pass(NOW, 2)).resolves.toMatchObject({ escalated: 2 });
    expect(repository.transaction).toHaveBeenCalledTimes(2);
    expect(pending.map((timer) => timer.id)).toEqual(["timer-3", "timer-4", "timer-5"]);

    const next = new Date(NOW.getTime() + 5000);
    await expect(escalation.pass(next, 2)).resolves.toMatchObject({ escalated: 2 });
    await expect(escalation.pass(next, 2)).resolves.toMatchObject({ escalated: 1 });
    await expect(escalation.pass(next, 2)).resolves.toMatchObject({ escalated: 0 });

    // Each fired, and was said, exactly once.
    expect(repository.fire.mock.calls.map(([, timerId]) => timerId)).toEqual([
      "timer-1",
      "timer-2",
      "timer-3",
      "timer-4",
      "timer-5",
    ]);
    expect(repository.enqueue).toHaveBeenCalledTimes(5);
  });

  it("takes at most the batch when no limit is given", async () => {
    const { escalation, repository, pending } = harness(ESCALATION_BATCH + 3);

    await expect(escalation.pass(NOW)).resolves.toEqual({
      escalated: ESCALATION_BATCH,
      cardEdits: ESCALATION_BATCH,
      directMessages: ESCALATION_BATCH,
    });
    expect(ESCALATION_BATCH).toBe(50);
    expect(repository.transaction).toHaveBeenCalledTimes(ESCALATION_BATCH);
    expect(pending).toHaveLength(3);
  });

  it("takes nothing for a limit of zero", async () => {
    const { escalation, repository } = harness(2);

    await expect(escalation.pass(NOW, 0)).resolves.toMatchObject({ escalated: 0 });
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  it("says nothing, and counts nothing, for a timer the database refused to fire", async () => {
    // Answered between the claim's snapshot and its lock: the trigger cancelled it.
    const { escalation, repository, calls } = harness(3, { refused: ["timer-2"] });

    await expect(escalation.pass(NOW)).resolves.toEqual({
      escalated: 2,
      cardEdits: 2,
      directMessages: 2,
    });
    expect(repository.enqueue.mock.calls.map(([, timer]) => timer.id)).toEqual([
      "timer-1",
      "timer-3",
    ]);
    expect(calls).toContain("tx2:fire:timer-2");
    expect(calls).not.toContain("tx2:enqueue:timer-2");
    // It goes on to the next timer rather than ending the pass.
    expect(calls).toContain("tx3:fire:timer-3");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("counts a refused timer against the limit, so a pass is always bounded", async () => {
    const { escalation, repository } = harness(3, { refused: ["timer-1"] });

    await expect(escalation.pass(NOW, 2)).resolves.toMatchObject({ escalated: 1 });
    expect(repository.transaction).toHaveBeenCalledTimes(2);
  });

  it("rolls a firing back whole when its intents cannot be written, and leaves the rest for the next pass", async () => {
    const { escalation, repository, calls } = harness(3);
    repository.enqueue
      .mockResolvedValueOnce({ cardEdits: 1, directMessages: 1 })
      .mockRejectedValueOnce(new Error("the database went away"));

    await expect(escalation.pass(NOW)).rejects.toThrow("the database went away");

    expect(calls.slice(-4)).toEqual(["tx2:begin", "tx2:claim", "tx2:fire:timer-2", "tx2:rollback"]);
    // The first committed before the failure; the third was never claimed.
    expect(calls).toContain("tx1:commit");
    expect(repository.transaction).toHaveBeenCalledTimes(2);
  });
});
