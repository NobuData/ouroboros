import type { DatabaseService } from "../db/db.service";
import { RecordingMailer } from "../mail/mail.fixture";
import type { TicketSourceRegistry } from "../ticket-sources/ticket-source.registry";
import { ChannelsService } from "./channels.service";
import { channelTruth } from "./channels.truth";

/** Each row's id and state, in order. */
const states = (facts: Parameters<typeof channelTruth>[0]) =>
  channelTruth(facts).channels.map(({ id, state, until }) => ({ id, state, until }));

describe("the channel truth payload (#463)", () => {
  it("is correct on a default self-hosted install — no fake ✓", () => {
    expect(states({ commentingSources: 1, mailTransport: "smtp", slackConnected: false })).toEqual([
      { id: "slack", state: "available", until: null },
      { id: "email", state: "connected", until: null },
      { id: "push", state: "unavailable-until", until: "BP.2" },
      { id: "github", state: "connected", until: null },
    ]);
  });

  it("says Email is only available, and why, without a mail server", () => {
    const email = channelTruth({
      commentingSources: 1,
      mailTransport: "none",
      slackConnected: false,
    }).channels.find((row) => row.id === "email");

    expect(email).toMatchObject({
      state: "available",
      reason: expect.stringContaining("OURO_SMTP_URL") as string,
    });
  });

  it("says GitHub is only available, and why, without a git host that can comment", () => {
    const github = channelTruth({
      commentingSources: 0,
      mailTransport: "smtp",
      slackConnected: false,
    }).channels.find((row) => row.id === "github");

    expect(github?.state).toBe("available");
    expect(github?.reason).toMatch(/git host/);
  });

  it("explains the GitHub comment's whole life — posted when asked, edited when answered (#469)", () => {
    const github = channelTruth({
      commentingSources: 1,
      mailTransport: "smtp",
      slackConnected: false,
    }).channels.find((row) => row.id === "github");

    expect(github?.summary).toBe(
      "Every decision is mirrored as a PR comment — posted when it is asked, edited when it is answered.",
    );
  });

  it("says what each channel does in the card's own words, connected or not", () => {
    for (const row of channelTruth({
      commentingSources: 0,
      mailTransport: "none",
      slackConnected: false,
    }).channels) {
      expect(row.label).not.toBe("");
      expect(row.summary).toMatch(/\.$/);
    }
  });

  it("never connects Push, whatever else is configured", () => {
    const rows = channelTruth({
      commentingSources: 5,
      mailTransport: "smtp",
      slackConnected: true,
    }).channels;

    expect(rows.find((row) => row.id === "push")?.state).toBe("unavailable-until");
  });

  it("connects Slack exactly while the workspace has an active Slack connection (#538)", () => {
    const slack = (slackConnected: boolean) =>
      channelTruth({ commentingSources: 0, mailTransport: "none", slackConnected }).channels.find(
        (row) => row.id === "slack",
      );

    expect(slack(true)).toMatchObject({ state: "connected", until: null, reason: null });
    expect(slack(false)).toMatchObject({
      state: "available",
      until: null,
      reason: expect.stringContaining("Connect Slack") as string,
    });
  });

  it("gives a connected row no reason and every other row one", () => {
    for (const row of channelTruth({
      commentingSources: 0,
      mailTransport: "none",
      slackConnected: false,
    }).channels) {
      expect(row.reason).not.toBeNull();
    }

    for (const row of channelTruth({
      commentingSources: 1,
      mailTransport: "smtp",
      slackConnected: false,
    }).channels) {
      expect(row.reason === null).toBe(row.state === "connected");
    }
  });
});

describe("ChannelsService (#463)", () => {
  /** A database answering the workspace's unpaused sources and its active Slack connection. */
  function database(kinds: string[], slack = false): DatabaseService {
    const chain = {
      select: () => chain,
      where: () => chain,
      execute: () => Promise.resolve(kinds.map((kind) => ({ kind }))),
      executeTakeFirst: () => Promise.resolve(slack ? { id: "connection-1" } : undefined),
    };

    return { db: { selectFrom: () => chain } } as unknown as DatabaseService;
  }

  /** A registry where only `github` carries the PR capability. */
  const registry = {
    find: (kind: string) =>
      kind === "github"
        ? { capabilities: () => ({ pr: { pullRequests: true } }), commentPR: () => undefined }
        : kind === "jira"
          ? { capabilities: () => ({ pr: { pullRequests: false } }) }
          : undefined,
  } as unknown as TicketSourceRegistry;

  it("counts only sources whose provider can comment on a PR", async () => {
    const service = new ChannelsService(
      database(["jira", "github"]),
      registry,
      new RecordingMailer(),
    );
    const github = (await service.truth("org-1")).channels.find((row) => row.id === "github");

    expect(github?.state).toBe("connected");
  });

  it("is available-only for a workspace with nothing but a tracker", async () => {
    const service = new ChannelsService(database(["jira"]), registry, new RecordingMailer("none"));
    const rows = (await service.truth("org-1")).channels;

    expect(rows.find((row) => row.id === "github")?.state).toBe("available");
    expect(rows.find((row) => row.id === "email")?.state).toBe("available");
  });

  it("reads Slack as connected from the workspace's active connection (#538)", async () => {
    const state = async (slack: boolean) =>
      (
        await new ChannelsService(database([], slack), registry, new RecordingMailer()).truth(
          "org-1",
        )
      ).channels.find((row) => row.id === "slack")?.state;

    expect(await state(true)).toBe("connected");
    expect(await state(false)).toBe("available");
  });
});
