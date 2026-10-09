/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */
/**
 * The workspace's repositories as the code tool sees them — name resolution and detected stacks
 * (#617). The SQL is the repository's; what is asserted here is the rule over its rows.
 */

import { GITHUB_FAILURES, GithubApiError } from "../../github/github.errors";
import { CodeWorkspace, type EnabledRepository, languageOf } from "./code.workspace";

const REPOS: EnabledRepository[] = [
  {
    id: "1",
    slug: "acme-robotics/helios-firmware",
    name: "helios-firmware",
    defaultBranch: "main",
  },
  { id: "2", slug: "acme-labs/helios-firmware", name: "helios-firmware", defaultBranch: null },
  { id: "3", slug: "acme-robotics/ground-station", name: "ground-station", defaultBranch: "main" },
];

function workspace(token: () => Promise<string>) {
  const subject = new CodeWorkspace({} as never, { tokenFor: token } as never);
  jest.spyOn(subject, "enabled").mockResolvedValue(REPOS);
  return subject;
}

describe("the code tool's workspace", () => {
  it("resolves owner/name exactly, and a bare name only when one repository has it", async () => {
    const subject = workspace(async () => "t");

    expect(await subject.resolve("org", "ACME-LABS/helios-firmware")).toBe(REPOS[1]);
    expect(await subject.resolve("org", "ground-station")).toBe(REPOS[2]);
    expect(await subject.resolve("org", "helios-firmware")).toEqual({
      reason: "ambiguous",
      candidates: ["acme-robotics/helios-firmware", "acme-labs/helios-firmware"],
    });
    expect(await subject.resolve("org", "acme/nope")).toEqual({ reason: "unknown" });
  });

  it("hands the engine the token for one call, and none when the workspace has none", async () => {
    expect(await workspace(async () => "ghp_x").repositoryRef("org", REPOS[0])).toEqual({
      workspace: "org",
      slug: "acme-robotics/helios-firmware",
      remote: "https://github.com/acme-robotics/helios-firmware.git",
      token: "ghp_x",
    });
    const none = workspace(() =>
      Promise.reject(new GithubApiError(GITHUB_FAILURES.notConfigured, "no token")),
    );
    expect((await none.repositoryRef("org", REPOS[2])).token).toBeNull();
    const broken = workspace(() => Promise.reject(new Error("vault down")));
    await expect(broken.repositoryRef("org", REPOS[2])).rejects.toThrow("vault down");
  });

  it("reads the detected top language from a language row's evidence", () => {
    expect(languageOf({ top: { language: "C", percent: 81 } })).toBe("C");
    expect(languageOf({ top: {} })).toBeNull();
    expect(languageOf(null)).toBeNull();
  });
});
