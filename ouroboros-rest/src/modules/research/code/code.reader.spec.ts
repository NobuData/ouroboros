/* eslint-disable @typescript-eslint/require-await -- fakes answer at once; async keeps the real signatures */
/**
 * One code read — repository resolution, the per-call token, and every failure classified (#617).
 */

import { z } from "zod";

import { UpstreamError } from "../../errors/error.envelope";
import { CodeReader, CodeRefusal, refusalOf } from "./code.reader";
import type { CodeWorkspace, EnabledRepository } from "./code.workspace";

/**
 * An asymmetric matcher for a substring, typed as the field it stands in for.
 *
 * @param text - The substring.
 * @returns The matcher.
 */
function containing(text: string): string {
  return expect.stringContaining(text) as string;
}

const HELIOS: EnabledRepository = {
  id: "r1",
  slug: "acme-robotics/helios-firmware",
  name: "helios-firmware",
  defaultBranch: "main",
};

function reader(answer: () => Promise<unknown>, resolved: unknown = HELIOS) {
  const engine = { code: jest.fn(answer) };
  const workspace = {
    resolve: jest.fn(async () => resolved),
    repositoryRef: jest.fn(async () => ({
      workspace: "org-acme",
      slug: HELIOS.slug,
      remote: "https://github.com/acme-robotics/helios-firmware.git",
      token: "ghp_secret",
    })),
  };
  const config = { researchCodeTimeoutMs: 120_000 };
  return {
    engine,
    reader: new CodeReader(workspace as unknown as CodeWorkspace, engine as never, config as never),
  };
}

describe("a code read", () => {
  it("hands the engine the repository, this call's token and the operation's fields", async () => {
    const { engine, reader: subject } = reader(async () => ({ ok: true, data: { sha: "x" } }));

    const answer = await subject.read("org-acme", HELIOS, "blame", { ref: "main" }, z.unknown());

    expect(answer).toEqual({ sha: "x" });
    expect(engine.code).toHaveBeenCalledWith(
      "blame",
      {
        repository: {
          workspace: "org-acme",
          slug: HELIOS.slug,
          remote: "https://github.com/acme-robotics/helios-firmware.git",
          token: "ghp_secret",
        },
        ref: "main",
      },
      expect.anything(),
      120_000,
    );
  });

  it("names an unreachable engine network — without its envelope", async () => {
    const { reader: subject } = reader(() =>
      Promise.reject(new UpstreamError("engine_unavailable", "x")),
    );

    await expect(subject.read("org-acme", HELIOS, "blame", {}, z.unknown())).rejects.toEqual(
      new CodeRefusal(
        "network",
        "the engine that keeps the repository clones could not be reached",
      ),
    );
  });

  it("classifies each engine refusal, never quoting the token", () => {
    const of = (code: string, message = "m") =>
      refusalOf({ status: 404, code: code as never, message }, HELIOS.slug);

    expect(of("code_remote_auth").refusalClass).toBe("auth");
    expect(of("code_remote_unreachable").refusalClass).toBe("network");
    expect(of("code_remote_refused").refusalClass).toBe("upstream");
    expect(of("code_ref_not_found", "The ref gone names no commit.")).toEqual(
      new CodeRefusal("unsupported", "The ref gone names no commit."),
    );
    expect(of("code_not_ancestor").refusalClass).toBe("unsupported");
    expect(of("code_remote_auth").detail).not.toContain("ghp_");
  });

  it("refuses a repository the workspace has not enabled, or a bare name two share", async () => {
    await expect(
      reader(async () => null, { reason: "unknown" }).reader.repository("org-acme", "acme/other"),
    ).rejects.toMatchObject({
      refusalClass: "unsupported",
      detail: containing("not a repository"),
    });
    await expect(
      reader(async () => null, {
        reason: "ambiguous",
        candidates: ["acme-robotics/helios-firmware", "acme-labs/helios-firmware"],
      }).reader.repository("org-acme", "helios-firmware"),
    ).rejects.toMatchObject({
      detail: containing("acme-labs/helios-firmware"),
    });
  });
});
