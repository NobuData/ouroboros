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
    expect(states({ commentingSources: 1, mailTransport: "smtp" })).toEqual([
      { id: "slack", state: "unavailable-until", until: "Chat Ops" },
      { id: "email", state: "connected", until: null },
      { id: "push", state: "unavailable-until", until: "BP.2" },
      { id: "github", state: "connected", until: null },
    ]);
  });

  it("says Email is only available, and why, without a mail server", () => {
    const email = channelTruth({ commentingSources: 1, mailTransport: "none" }).channels.find(
      (row) => row.id === "email",
    );

    expect(email).toMatchObject({
      state: "available",
      reason: expect.stringContaining("OURO_SMTP_URL") as string,
    });
  });

  it("says GitHub is only available, and why, without a git host that can comment", () => {
    const github = channelTruth({ commentingSources: 0, mailTransport: "smtp" }).channels.find(
      (row) => row.id === "github",
    );

    expect(github?.state).toBe("available");
    expect(github?.reason).toMatch(/git host/);
  });

  it("never connects Slack or Push, whatever else is configured", () => {
    const rows = channelTruth({ commentingSources: 5, mailTransport: "smtp" }).channels;

    for (const id of ["slack", "push"]) {
      expect(rows.find((row) => row.id === id)?.state).toBe("unavailable-until");
    }
  });

  it("gives a connected row no reason and every other row one", () => {
    for (const row of channelTruth({ commentingSources: 0, mailTransport: "none" }).channels) {
      expect(row.reason).not.toBeNull();
    }

    for (const row of channelTruth({ commentingSources: 1, mailTransport: "smtp" }).channels) {
      expect(row.reason === null).toBe(row.state === "connected");
    }
  });
});

describe("ChannelsService (#463)", () => {
  /** A database answering the workspace's unpaused sources. */
  function database(kinds: string[]): DatabaseService {
    const chain = {
      select: () => chain,
      where: () => chain,
      execute: () => Promise.resolve(kinds.map((kind) => ({ kind }))),
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
});
