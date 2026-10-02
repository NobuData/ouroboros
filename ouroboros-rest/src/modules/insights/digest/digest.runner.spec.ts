import type { AppConfigService } from "../../config/config.service";
import { RecordingMailer } from "../../mail/mail.fixture";
import type { MailMessage } from "../../mail/mailer";
import type { InsightsPageService } from "../page/page.service";
import { DIGEST_CONTENT_VERSION } from "./digest.assembly";
import { emptyWeekFacts, weekPage } from "./digest.fixture";
import {
  CLAIM_LEASE_MS,
  DIGEST_GRACE_MS,
  DIGEST_MIN_GAP_MS,
  DigestRunner,
  MAX_SEND_ATTEMPTS,
  digestMessageId,
  dueSlot,
} from "./digest.runner";
import { FakeDigestStore } from "./digest.store.fixture";
import { hashUnsubscribeToken } from "./digest.token";

/** The default slot, Monday 09:00 UTC, and five minutes after it. 2026-08-10 is a Monday. */
const SLOT = new Date("2026-08-10T09:00:00.000Z");
const NOW = new Date("2026-08-10T09:05:00.000Z");

const ACME = "org-acme";
const GLOBEX = "org-globex";

const HTTPS = {
  restUrl: "https://api.acme.dev",
  uiUrl: "https://app.acme.dev",
  mailFrom: "no-reply@acme.dev",
} as unknown as AppConfigService;

/** The token in a mail's unsubscribe link. */
function tokenOf(message: MailMessage): string {
  return /unsubscribe\/(ouro_unsub_[\w-]+)/.exec(message.text)?.[1] ?? "";
}

/**
 * A runner over an in-memory store, a recording mailer and a page that answers the fixture week.
 *
 * @param options - A store to share, a mailer to share, or a different configuration.
 * @returns The runner and what it was built over.
 */
function build(
  options: {
    store?: FakeDigestStore;
    mailer?: RecordingMailer;
    config?: AppConfigService;
  } = {},
) {
  const store =
    options.store ??
    new FakeDigestStore()
      .workspace(ACME, "Acme Robotics")
      .member(ACME, "ken", "ken@acme.dev")
      .member(ACME, "maya", "maya@acme.dev");
  const mailer = options.mailer ?? new RecordingMailer();
  const read = jest.fn((_organizationId: string, _request: { range: string; now?: Date }) =>
    Promise.resolve(weekPage()),
  );
  const runner = new DigestRunner(
    store.repository,
    { read } as unknown as InsightsPageService,
    mailer,
    options.config ?? HTTPS,
  );

  return { runner, store, mailer, read };
}

describe("when a slot is due", () => {
  it("is the latest weekly slot, for as long as the grace lasts", () => {
    const state = { schedule: undefined, latestSlotAt: undefined };

    expect(dueSlot(SLOT, state)).toEqual(SLOT);
    expect(dueSlot(new Date(SLOT.getTime() + DIGEST_GRACE_MS), state)).toEqual(SLOT);
    expect(dueSlot(new Date(SLOT.getTime() + DIGEST_GRACE_MS + 1), state)).toBeUndefined();
    // A minute before the slot, the latest slot is last week's — far outside the grace.
    expect(dueSlot(new Date(SLOT.getTime() - 60_000), state)).toBeUndefined();
  });

  it("follows the workspace's own schedule", () => {
    const friday = { schedule: { weeklyDay: 5, weeklyTime: "16:30" }, latestSlotAt: undefined };

    expect(dueSlot(new Date("2026-08-14T16:31:00.000Z"), friday)).toEqual(
      new Date("2026-08-14T16:30:00.000Z"),
    );
    expect(dueSlot(NOW, friday)).toBeUndefined();
  });

  it("finds the slot's own run again, and refuses a second run in the same week", () => {
    const moved = { weeklyDay: 3, weeklyTime: "09:00" };
    const wednesday = new Date("2026-08-12T09:01:00.000Z");

    // The slot's own run: found again, so an open run resumes.
    expect(dueSlot(NOW, { schedule: undefined, latestSlotAt: SLOT })).toEqual(SLOT);
    // Monday's digest went out; the schedule then moved to Wednesday.
    expect(dueSlot(wednesday, { schedule: moved, latestSlotAt: SLOT })).toBeUndefined();
    // Six days on is a new week.
    expect(
      dueSlot(wednesday, {
        schedule: moved,
        latestSlotAt: new Date(wednesday.getTime() - 60_000 - DIGEST_MIN_GAP_MS),
      }),
    ).toEqual(new Date("2026-08-12T09:00:00.000Z"));
    // A schedule moved *earlier* than a run already made this week does not send again either.
    expect(
      dueSlot(NOW, { schedule: undefined, latestSlotAt: new Date("2026-08-13T09:00:00.000Z") }),
    ).toBeUndefined();
  });
});

describe("the Message-ID", () => {
  it("is the same for every attempt at one recipient in one run, and names no user id", () => {
    const id = digestMessageId("run-1", "user-ken", "no-reply@acme.dev");

    expect(id).toBe(digestMessageId("run-1", "user-ken", "no-reply@acme.dev"));
    expect(id).toMatch(/^<digest\.run-1\.[0-9a-f]{16}@acme\.dev>$/);
    expect(id).not.toContain("user-ken");
    expect(id).not.toBe(digestMessageId("run-1", "user-maya", "no-reply@acme.dev"));
    expect(id).not.toBe(digestMessageId("run-2", "user-ken", "no-reply@acme.dev"));
  });
});

describe("the weekly run", () => {
  it("assembles once, as of the slot, and mails each subscriber", async () => {
    const { runner, mailer, read } = build();

    const report = await runner.tick(NOW);

    expect(report).toEqual({
      outcomes: [{ organizationId: ACME, slotAt: SLOT, sent: 2, failed: 0, completed: true }],
      errors: [],
    });
    // One read of the page, for seven days, as of the slot — not as of five minutes later.
    expect(read.mock.calls).toEqual([[ACME, { range: "7d", now: SLOT }]]);
    expect(mailer.sent.map((message) => message.to)).toEqual(["ken@acme.dev", "maya@acme.dev"]);
    expect(new Set(mailer.sent.map((message) => message.subject))).toEqual(
      new Set(["Weekly insights · Acme Robotics · Aug 2 – Aug 8, 2026"]),
    );
    expect(mailer.sent[0].text).toContain("27 PRs merged this week. 12 needed a human.");
  });

  it("records what was sent, to whom, for which window, under which content version", async () => {
    const { runner, store } = build();

    await runner.tick(NOW);

    expect(store.runs).toEqual([
      expect.objectContaining({
        organizationId: ACME,
        slotAt: SLOT,
        window: { from: "2026-08-02", to: "2026-08-08" },
        contentVersion: DIGEST_CONTENT_VERSION,
        completedAt: store.now,
      }),
    ]);
    expect(store.sendRows.map((send) => [send.recipient, send.attempt, send.status])).toEqual([
      ["ken@acme.dev", 1, "sent"],
      ["maya@acme.dev", 1, "sent"],
    ]);
  });

  it("gives each mail its own unsubscribe token, and stores only its hash — before sending", async () => {
    const { runner, store, mailer } = build();
    const claimedWhenSent: boolean[] = [];
    const send = mailer.send.bind(mailer);
    jest.spyOn(mailer, "send").mockImplementation((message) => {
      // The claim, with the token's hash, is already written when the mail leaves.
      claimedWhenSent.push(
        store.sendRows.some(
          (row) =>
            row.status === "claimed" &&
            row.unsubscribeTokenHash === hashUnsubscribeToken(tokenOf(message)),
        ),
      );

      return send(message);
    });

    await runner.tick(NOW);

    const tokens = mailer.sent.map(tokenOf);

    expect(claimedWhenSent).toEqual([true, true]);
    expect(new Set(tokens).size).toBe(2);
    expect(store.sendRows.map((row) => row.unsubscribeTokenHash)).toEqual(
      tokens.map(hashUnsubscribeToken),
    );
    expect(JSON.stringify(store.sendRows)).not.toContain(tokens[0]);
    expect(mailer.sent[0].html).toContain(
      `https://api.acme.dev/api/v1/insights/digest/unsubscribe/${tokens[0]}`,
    );
  });

  it("sends nothing the second time: a completed run is done", async () => {
    const { runner, mailer, read } = build();

    await runner.tick(NOW);
    const again = await runner.tick(new Date(NOW.getTime() + 300_000));

    expect(again.outcomes).toEqual([]);
    expect(mailer.sent).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("does nothing between slots, and writes no run", async () => {
    const { runner, store, mailer, read } = build();

    // Tuesday 10:00: Monday's slot is twenty-five hours gone.
    const report = await runner.tick(new Date("2026-08-11T10:00:00.000Z"));

    expect(report.outcomes).toEqual([]);
    expect(mailer.sent).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(store.runs).toEqual([]);
  });

  it("mails an empty week's honest sentence rather than skipping it", async () => {
    const { runner, mailer, read } = build();
    read.mockResolvedValue(weekPage(emptyWeekFacts()));

    await runner.tick(NOW);

    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0].text).toContain("Nothing to report this week.");
  });
});

describe("who a run mails", () => {
  it("leaves out somebody who subscribed after the slot — next week is theirs", async () => {
    const store = new FakeDigestStore()
      .workspace(ACME, "Acme Robotics")
      .member(ACME, "ken", "ken@acme.dev")
      .member(ACME, "late", "late@acme.dev", new Date(SLOT.getTime() + 60_000));
    const { runner, mailer } = build({ store });

    await runner.tick(NOW);

    expect(mailer.sent.map((message) => message.to)).toEqual(["ken@acme.dev"]);
  });

  it("starts no run for a workspace whose only subscribers came after the slot", async () => {
    const store = new FakeDigestStore()
      .workspace(ACME, "Acme Robotics")
      .member(ACME, "late", "late@acme.dev", new Date(SLOT.getTime() + 60_000));
    const { runner, mailer, read } = build({ store });

    expect((await runner.tick(NOW)).outcomes).toEqual([]);
    expect(store.runs).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(mailer.sent).toEqual([]);
  });

  it("leaves out a subscriber who is no longer a member", async () => {
    const { runner, store, mailer } = build();
    store.members.delete(`${ACME}:maya`);

    await runner.tick(NOW);

    expect(mailer.sent.map((message) => message.to)).toEqual(["ken@acme.dev"]);
  });

  it("sends each workspace its own digest, to its own members only", async () => {
    const store = new FakeDigestStore()
      .workspace(ACME, "Acme Robotics")
      .workspace(GLOBEX, "Globex")
      .member(ACME, "ken", "ken@acme.dev")
      // Maya is in both; Hank only in Globex; Jorge is a Globex member who never subscribed.
      .member(ACME, "maya", "maya@acme.dev")
      .member(GLOBEX, "maya", "maya@acme.dev")
      .member(GLOBEX, "hank", "hank@globex.example")
      .member(GLOBEX, "jorge", "jorge@globex.example", null);
    const { runner, mailer, read } = build({ store });
    read.mockImplementation((organizationId) =>
      Promise.resolve(organizationId === ACME ? weekPage() : weekPage(emptyWeekFacts())),
    );

    await runner.tick(NOW);

    const to = (workspace: string) =>
      mailer.sent
        .filter((message) => message.subject.includes(workspace))
        .map((message) => message.to)
        .sort();

    expect(read.mock.calls.map(([organizationId]) => organizationId)).toEqual([ACME, GLOBEX]);
    expect(to("Acme Robotics")).toEqual(["ken@acme.dev", "maya@acme.dev"]);
    expect(to("Globex")).toEqual(["hank@globex.example", "maya@acme.dev"]);
    // Each workspace's readers got that workspace's numbers.
    for (const message of mailer.sent) {
      expect(message.text.includes("27 PRs merged")).toBe(message.subject.includes("Acme"));
      expect(message.text.includes("Nothing to report")).toBe(message.subject.includes("Globex"));
    }
    expect(mailer.to("jorge@globex.example")).toEqual([]);
  });
});

describe("when a send fails", () => {
  it("records why, leaves the run open, and retries next tick under the same Message-ID", async () => {
    const { runner, store, mailer, read } = build();
    mailer.failFor("maya@acme.dev", 1);

    const first = await runner.tick(NOW);

    expect(first.outcomes).toEqual([
      { organizationId: ACME, slotAt: SLOT, sent: 1, failed: 1, completed: false },
    ]);
    expect(store.sendRows.at(-1)).toMatchObject({
      recipient: "maya@acme.dev",
      status: "failed",
      error: "connect ECONNREFUSED 127.0.0.1:1025",
    });
    expect(store.runs[0].completedAt).toBeNull();

    const second = await runner.tick(new Date(NOW.getTime() + 300_000));
    const [failed, retried] = mailer.to("maya@acme.dev");

    expect(second.outcomes).toEqual([
      { organizationId: ACME, slotAt: SLOT, sent: 1, failed: 0, completed: true },
    ]);
    // Ken is not mailed again; Maya's retry is attempt 2.
    expect(mailer.to("ken@acme.dev")).toHaveLength(1);
    expect(store.sendRows.at(-1)).toMatchObject({ attempt: 2, status: "sent" });
    expect(retried.messageId).toBe(failed.messageId);
    // A new token for the new attempt; the content is the run's stored copy, read once.
    expect(tokenOf(retried)).not.toBe(tokenOf(failed));
    expect(retried.text.replace(tokenOf(retried), "")).toBe(
      failed.text.replace(tokenOf(failed), ""),
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it(`gives up on a recipient after ${String(MAX_SEND_ATTEMPTS)} attempts and completes the run`, async () => {
    const { runner, store, mailer } = build();
    mailer.failFor("maya@acme.dev", 10);

    for (let tick = 0; tick < MAX_SEND_ATTEMPTS + 2; tick += 1) {
      await runner.tick(new Date(NOW.getTime() + tick * 300_000));
    }

    expect(mailer.to("maya@acme.dev")).toHaveLength(MAX_SEND_ATTEMPTS);
    expect(
      store.sendRows.filter((row) => row.recipient === "maya@acme.dev").map((row) => row.status),
    ).toEqual(["failed", "failed", "failed"]);
    expect(store.runs[0].completedAt).not.toBeNull();
  });

  it("does not try an exhausted recipient again while the run stays open for somebody else", async () => {
    const { runner, store, mailer } = build();
    mailer.failFor("maya@acme.dev", 10);
    // Another sender holds a live claim on Ken for the whole test, so the run never completes.
    await store.claimRun(ACME, () => SLOT);
    await store.claimSend({
      organizationId: ACME,
      runId: "run-1",
      userId: "ken",
      recipient: "ken@acme.dev",
      attempt: 1,
      messageId: "<held@acme.dev>",
      unsubscribeTokenHash: "a".repeat(64),
    });

    for (let tick = 0; tick < MAX_SEND_ATTEMPTS + 3; tick += 1) {
      await runner.tick(NOW);
    }

    expect(store.runs[0].completedAt).toBeNull();
    expect(mailer.to("maya@acme.dev")).toHaveLength(MAX_SEND_ATTEMPTS);
    expect(mailer.to("ken@acme.dev")).toEqual([]);
  });

  it("keeps a failure reason short", async () => {
    const { runner, store, mailer } = build();
    jest.spyOn(mailer, "send").mockRejectedValue(new Error("x".repeat(5_000)));

    await runner.tick(NOW);

    expect(store.sendRows[0].error).toHaveLength(500);
  });

  it("costs one workspace its tick when its page cannot be read, and not the next one its digest", async () => {
    const store = new FakeDigestStore()
      .workspace(ACME, "Acme Robotics")
      .workspace(GLOBEX, "Globex")
      .member(ACME, "ken", "ken@acme.dev")
      .member(GLOBEX, "hank", "hank@globex.example");
    const { runner, mailer, read } = build({ store });
    read.mockImplementation((organizationId) =>
      organizationId === ACME
        ? Promise.reject(new Error("rollup registry unreadable"))
        : Promise.resolve(weekPage()),
    );

    const report = await runner.tick(NOW);

    expect(report.errors).toEqual([
      {
        organizationId: ACME,
        error: expect.stringContaining("rollup registry unreadable") as string,
      },
    ]);
    expect(mailer.sent.map((message) => message.to)).toEqual(["hank@globex.example"]);
    // Acme's run stays claimed and unassembled: the next tick assembles and sends it.
    read.mockResolvedValue(weekPage());
    await runner.tick(new Date(NOW.getTime() + 300_000));
    expect(mailer.to("ken@acme.dev")).toHaveLength(1);
  });
});

describe("claims", () => {
  it("never mails one recipient twice when two replicas tick together", async () => {
    const store = new FakeDigestStore()
      .workspace(ACME, "Acme Robotics")
      .member(ACME, "ken", "ken@acme.dev")
      .member(ACME, "maya", "maya@acme.dev")
      .member(ACME, "jorge", "jorge@acme.dev");
    const mailer = new RecordingMailer();
    const a = build({ store, mailer });
    const b = build({ store, mailer });

    await Promise.all([a.runner.tick(NOW), b.runner.tick(NOW)]);

    expect(mailer.sent.map((message) => message.to).sort()).toEqual([
      "jorge@acme.dev",
      "ken@acme.dev",
      "maya@acme.dev",
    ]);
    expect(store.runs).toHaveLength(1);
    expect(store.sendRows.every((row) => row.status === "sent")).toBe(true);

    // Whichever replica lost a claim left the run open; the next tick finds nothing to send.
    await a.runner.tick(new Date(NOW.getTime() + 300_000));
    expect(mailer.sent).toHaveLength(3);
    expect(store.runs[0].completedAt).not.toBeNull();
  });

  it("leaves a live claim to the sender that holds it", async () => {
    const { runner, store, mailer } = build();
    await store.claimRun(ACME, () => SLOT);
    store.now = NOW;
    await store.claimSend({
      organizationId: ACME,
      runId: "run-1",
      userId: "maya",
      recipient: "maya@acme.dev",
      attempt: 1,
      messageId: "<held@acme.dev>",
      unsubscribeTokenHash: "a".repeat(64),
    });

    const report = await runner.tick(NOW);

    expect(mailer.sent.map((message) => message.to)).toEqual(["ken@acme.dev"]);
    expect(report.outcomes[0]).toMatchObject({ sent: 1, completed: false });
  });

  it("takes a claim older than the lease for dead, and retries it", async () => {
    const { runner, store, mailer } = build();
    await store.claimRun(ACME, () => SLOT);
    store.now = new Date(NOW.getTime() - CLAIM_LEASE_MS - 1);
    await store.claimSend({
      organizationId: ACME,
      runId: "run-1",
      userId: "maya",
      recipient: "maya@acme.dev",
      attempt: 1,
      messageId: "<dead@acme.dev>",
      unsubscribeTokenHash: "a".repeat(64),
    });
    store.now = NOW;

    await runner.tick(NOW);

    expect(
      store.sendRows.filter((row) => row.userId === "maya").map((row) => [row.attempt, row.status]),
    ).toEqual([
      [1, "failed"],
      [2, "sent"],
    ]);
    expect(store.sendRows[0].error).toBe("The send was claimed and never confirmed.");
    expect(mailer.to("maya@acme.dev")).toHaveLength(1);
  });
});

describe("the schedule and the run", () => {
  it("does not send a second digest in a week whose schedule was moved", async () => {
    const { runner, store, mailer } = build();

    await runner.tick(NOW);
    store.schedules.set(ACME, { weeklyDay: 3, weeklyTime: "09:00" });
    await runner.tick(new Date("2026-08-12T09:05:00.000Z"));

    expect(mailer.sent).toHaveLength(2);
    expect(store.runs).toHaveLength(1);

    // The Wednesday after is a new week.
    await runner.tick(new Date("2026-08-19T09:05:00.000Z"));

    expect(mailer.sent).toHaveLength(4);
    expect(store.runs.map((run) => run.slotAt.toISOString())).toEqual([
      "2026-08-10T09:00:00.000Z",
      "2026-08-19T09:00:00.000Z",
    ]);
  });
});

describe("the mail a run sends", () => {
  it("carries List-Unsubscribe, and one-click when the link is https", async () => {
    const { runner, mailer } = build();

    await runner.tick(NOW);

    const [message] = mailer.sent;
    const link = `https://api.acme.dev/api/v1/insights/digest/unsubscribe/${tokenOf(message)}`;

    expect(message.headers).toEqual({
      "List-Unsubscribe": `<${link}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(message.text).toContain("Open Insights: https://app.acme.dev/insights?range=7d");
  });

  it("does not claim one-click for an http link — RFC 8058 defines it for https only", async () => {
    const { runner, mailer } = build({
      config: {
        restUrl: "http://localhost:4000",
        uiUrl: "http://localhost:3000",
        mailFrom: "no-reply@ouroboros.localhost",
      } as unknown as AppConfigService,
    });

    await runner.tick(NOW);

    expect(Object.keys(mailer.sent[0].headers ?? {})).toEqual(["List-Unsubscribe"]);
    expect(mailer.sent[0].messageId).toMatch(/@ouroboros\.localhost>$/);
  });
});

describe("a deployment that sends no mail", () => {
  it("does nothing at all — it does not even read who subscribed", async () => {
    const { runner, store, read } = build({ mailer: new RecordingMailer("none") });
    const workspaces = jest.spyOn(store, "subscribedWorkspaces");

    expect(await runner.tick(NOW)).toEqual({ outcomes: [], errors: [] });
    expect(workspaces).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("shutting down mid-run", () => {
  it("stops after the recipient in hand and leaves the run open for the next process", async () => {
    const { runner, store, mailer } = build();
    const send = mailer.send.bind(mailer);
    jest.spyOn(mailer, "send").mockImplementation((message) => {
      runner.stop();

      return send(message);
    });

    const report = await runner.tick(NOW);

    expect(mailer.sent.map((message) => message.to)).toEqual(["ken@acme.dev"]);
    expect(report.outcomes).toEqual([
      { organizationId: ACME, slotAt: SLOT, sent: 1, failed: 0, completed: false },
    ]);
    expect(store.runs[0].completedAt).toBeNull();

    // The next process finishes it.
    const next = build({ store, mailer: new RecordingMailer() });
    await next.runner.tick(new Date(NOW.getTime() + 300_000));

    expect(next.mailer.sent.map((message) => message.to)).toEqual(["maya@acme.dev"]);
    expect(store.runs[0].completedAt).not.toBeNull();
  });
});
