import { HttpStatus } from "@nestjs/common";

import type { GithubClientFactory } from "../github/github.client.factory";
import type { GithubCredentialsService } from "../github/github.credentials.service";
import { GITHUB_FAILURES, GithubApiError } from "../github/github.errors";
import { DRY_RUN_COMMIT_UNREADABLE, PinnedCommitReader } from "./dry-runs.commit";
import { PINNED_SHA, WORKSPACE } from "./dry-runs.store.fixture";

function bench(answer: unknown) {
  const request = jest
    .fn()
    .mockImplementation(() =>
      answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ data: answer }),
    );
  const clients = { forOrganization: jest.fn().mockResolvedValue({ request }) };
  const credentials = { tokenFor: jest.fn().mockResolvedValue("ghp_read_only") };
  const reader = new PinnedCommitReader(
    clients as unknown as GithubClientFactory,
    credentials as unknown as GithubCredentialsService,
  );

  return { reader, request, clients, credentials };
}

describe("pinning the commit a dry run reads at", () => {
  it("asks GitHub for the head of the mirror's default branch, and opens the token for the run", async () => {
    const { reader, request, clients } = bench({ sha: PINNED_SHA });

    const pinned = await reader.pin(WORKSPACE, "acme-robotics", "helios-firmware", "main");

    expect(pinned).toEqual({
      slug: "acme-robotics/helios-firmware",
      sha: PINNED_SHA,
      token: "ghp_read_only",
    });
    expect(clients.forOrganization).toHaveBeenCalledWith(WORKSPACE);
    expect(request).toHaveBeenCalledWith("GET /repos/{owner}/{repo}/commits/{ref}", {
      owner: "acme-robotics",
      repo: "helios-firmware",
      ref: "main",
    });
  });

  it("pins HEAD when the mirror never learned a default branch", async () => {
    const { reader, request } = bench({ sha: PINNED_SHA });

    await reader.pin(WORKSPACE, "acme-robotics", "helios-firmware", null);

    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ ref: "HEAD" }),
    );
  });

  it.each([[{ sha: "b7e4c2a" }], [{ sha: 7 }], [{}], [undefined]])(
    "refuses an answer that names no full commit: %j",
    async (answer) => {
      const { reader, credentials } = bench(answer);

      await expect(
        reader.pin(WORKSPACE, "acme-robotics", "helios-firmware", "main"),
      ).rejects.toMatchObject({ code: DRY_RUN_COMMIT_UNREADABLE, status: HttpStatus.BAD_GATEWAY });
      expect(credentials.tokenFor).not.toHaveBeenCalled();
    },
  );

  it("answers a workspace with no GitHub token, and a repository GitHub does not show it, the way every GitHub read does", async () => {
    const unconfigured = bench({ sha: PINNED_SHA });
    unconfigured.clients.forOrganization.mockRejectedValue(
      new GithubApiError(GITHUB_FAILURES.notConfigured, "no token"),
    );
    await expect(
      unconfigured.reader.pin(WORKSPACE, "acme-robotics", "helios-firmware", "main"),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    const hidden = bench(new GithubApiError(GITHUB_FAILURES.notFound, "404"));
    await expect(
      hidden.reader.pin(WORKSPACE, "acme-robotics", "helios-firmware", "main"),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it("lets anything that is not GitHub's refusal through untouched", async () => {
    const { reader } = bench(new Error("socket hang up"));

    await expect(reader.pin(WORKSPACE, "o", "r", "main")).rejects.toThrow("socket hang up");
  });
});
