import type { TicketSourceRegistry } from "../../ticket-sources/ticket-source.registry";
import type { SyncSource } from "../../ticket-sources/ticket-sources.repository";
import type { TicketSourcesService } from "../../ticket-sources/ticket-sources.service";
import { ProviderRepoGateway } from "./pipeline.repo";

const SOURCE: SyncSource = {
  sourceId: "source-1",
  organizationId: "org-acme",
  kind: "github",
  displayName: "GitHub · acme-robotics",
  config: {},
  cursor: null,
  syncedAt: null,
};
const CONTEXT = { sourceId: "source-1", credentials: "sealed-and-opened" };

function provider(change: Record<string, unknown> = {}) {
  return {
    capabilities: () => ({ pr: { pullRequests: true } }),
    defaultBranch: jest.fn().mockResolvedValue("main"),
    fileAt: jest.fn().mockResolvedValue(null),
    commitFile: jest.fn().mockResolvedValue({ commitSha: "abc1234", changed: true }),
    updatePR: jest.fn().mockResolvedValue(undefined),
    createPR: jest.fn().mockResolvedValue({ number: 88, url: "u", draft: false }),
    getPR: jest.fn().mockResolvedValue({ state: "merged", number: 88 }),
    ...change,
  };
}

function gateway(found: unknown) {
  const withCredentials = jest.fn(
    (_source: SyncSource, run: (context: unknown) => Promise<unknown>) => run(CONTEXT),
  );

  return {
    withCredentials,
    gateway: new ProviderRepoGateway(
      { find: () => found } as unknown as TicketSourceRegistry,
      { withCredentials } as unknown as TicketSourcesService,
    ),
  };
}

describe("the pipeline's repository gateway", () => {
  it("opens the source's credential once and hands every operation the same context", async () => {
    const host = provider();
    const { gateway: repo, withCredentials } = gateway(host);
    const input = {
      path: "docs/ROADMAP.md",
      content: "#",
      message: "m",
      branch: "b",
      base: "main",
    };
    const pr = { branch: "b", base: "main", title: "t", body: null };

    const answer = await repo.open(SOURCE, async (ops) => ({
      branch: await ops.defaultBranch(),
      file: await ops.fileAt("docs/ROADMAP.md", "main"),
      commit: await ops.commitFile(input),
      pr: await ops.openPR(pr),
      updated: await ops.updatePR(88, { title: "t2" }),
      state: await ops.prState(88),
    }));

    expect(answer).toEqual({
      branch: "main",
      file: null,
      commit: { commitSha: "abc1234", changed: true },
      pr: { number: 88, url: "u", draft: false },
      updated: undefined,
      state: "merged",
    });
    expect(withCredentials).toHaveBeenCalledTimes(1);
    expect(host.defaultBranch).toHaveBeenCalledWith(CONTEXT);
    expect(host.fileAt).toHaveBeenCalledWith(CONTEXT, "docs/ROADMAP.md", "main");
    expect(host.commitFile).toHaveBeenCalledWith(CONTEXT, input);
    expect(host.createPR).toHaveBeenCalledWith(CONTEXT, pr);
    expect(host.updatePR).toHaveBeenCalledWith(CONTEXT, 88, { title: "t2" });
    expect(host.getPR).toHaveBeenCalledWith(CONTEXT, 88);
  });

  it.each([
    ["no provider for the kind", undefined],
    [
      "a tracker that opens no pull requests",
      provider({ capabilities: () => ({ pr: { pullRequests: false } }) }),
    ],
    ["a git host that cannot commit a file", provider({ commitFile: undefined })],
  ])(
    "answers undefined for %s, without opening a credential or running the work",
    async (_name, found) => {
      const { gateway: repo, withCredentials } = gateway(found);
      const work = jest.fn();

      expect(await repo.open(SOURCE, work)).toBeUndefined();
      expect(work).not.toHaveBeenCalled();
      expect(withCredentials).not.toHaveBeenCalled();
    },
  );

  it("refuses a provider that declares pull requests and opens none", async () => {
    const { gateway: repo } = gateway(provider({ createPR: jest.fn().mockResolvedValue(null) }));

    await expect(
      repo.open(SOURCE, (ops) => ops.openPR({ branch: "b", base: "main", title: "t", body: null })),
    ).rejects.toThrow("declared pull requests and opened none");
  });

  it("lets the host's refusal through to the caller", async () => {
    const refused = new Error("the token was refused");
    const { gateway: repo } = gateway(
      provider({ defaultBranch: jest.fn().mockRejectedValue(refused) }),
    );

    await expect(repo.open(SOURCE, (ops) => ops.defaultBranch())).rejects.toBe(refused);
  });
});
