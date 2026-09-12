import { Logger } from "@nestjs/common";

import { BOOTSTRAP_WORKFLOW_SLUGS, WorkflowRegistryService } from "./registry.service";
import type { WorkflowStatsRepository } from "./stats.repository";

/**
 * The vocabulary a workspace may name — the amendment absorbed from
 * [#124](https://github.com/NobuData/ouroboros/issues/124) (P.4,
 * [#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * Two rules and one fallback, and the suite is about all three: *active only*, *the registry
 * replaces the built-ins rather than joining them*, and *an empty registry answers with the
 * built-ins rather than with nothing*. Which statement finds the active rows is
 * `stats.repository.spec.ts`'; what an empty result *means* is decided here.
 */

const WORKSPACE = "acme-robotics-id";

/**
 * The fallback's own log line, silenced for every case and asserted in one of them.
 *
 * Installed for the whole file rather than for the describe that asserts it, because a suite
 * that prints a `DEBUG` line beside a passing test trains whoever reads the run to ignore the
 * words — `jest.integration.config.mjs` makes the same argument at greater length.
 */
let debugged: jest.SpyInstance;

beforeEach(() => {
  debugged = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
});

/**
 * A registry over a repository a spec writes.
 *
 * @param slugs - What `activeSlugs` answers.
 * @returns The service, and the workspaces it was asked about.
 */
function build(slugs: string[]) {
  const asked: string[] = [];

  const repository = {
    activeSlugs: (organizationId: string) => {
      asked.push(organizationId);
      return Promise.resolve(slugs);
    },
  } as unknown as WorkflowStatsRepository;

  return { service: new WorkflowRegistryService(repository), asked };
}

describe("a workspace with workflows of its own", () => {
  it("is offered exactly those, in the registry's order", async () => {
    // The ticket's fourth criterion at this layer: the menu lists the registry, so the
    // registry is what the vocabulary is — not the four names decision K5 wrote down.
    const { service, asked } = build(["standard-fix", "hotfix-p0", "release-train"]);

    await expect(service.offered(WORKSPACE)).resolves.toEqual({
      slugs: ["standard-fix", "hotfix-p0", "release-train"],
      source: "registry",
    });
    expect(asked).toEqual([WORKSPACE]);
  });

  it("does not keep the built-ins beside them", async () => {
    // A menu offering `docs-loop` to a workspace that deleted it is the dishonesty this ticket
    // is about. One workflow means one option.
    const { service } = build(["release-train"]);

    const { slugs } = await service.offered(WORKSPACE);

    expect(slugs).toEqual(["release-train"]);
    for (const builtin of BOOTSTRAP_WORKFLOW_SLUGS) {
      expect(slugs).not.toContain(builtin);
    }
  });

  it("accepts one of its own and refuses anything else", async () => {
    const { service } = build(["release-train"]);

    await expect(service.accepts(WORKSPACE, "release-train")).resolves.toBe(true);
    // A real slug in another workspace, and a built-in this workspace has replaced: both are
    // the same answer here, because both are workflows it does not have.
    await expect(service.accepts(WORKSPACE, "somebody-elses")).resolves.toBe(false);
    await expect(service.accepts(WORKSPACE, "standard-fix")).resolves.toBe(false);
  });
});

describe("a workspace with no workflows", () => {
  it("is offered the built-in four, so a shipped intake keeps working", async () => {
    // The ordinary state of every installation today: V029's tables have no writer — P.3 is
    // the create and #136 is the seed. An empty vocabulary would not be honest, it would take
    // estimation and the bulk queue offline; `registry.service.ts` argues it at length.
    const { service } = build([]);

    await expect(service.offered(WORKSPACE)).resolves.toEqual({
      slugs: BOOTSTRAP_WORKFLOW_SLUGS,
      source: "bootstrap",
    });
  });

  it("says which answer it gave, so a caller never has to compare against a constant", async () => {
    const { service } = build([]);

    expect((await service.offered(WORKSPACE)).source).toBe("bootstrap");
  });

  it("accepts the built-ins, which is what keeps every stored tag queueable", async () => {
    const { service } = build([]);

    await expect(service.accepts(WORKSPACE, "standard-fix")).resolves.toBe(true);
    await expect(service.accepts(WORKSPACE, "deps-refresh")).resolves.toBe(true);
    await expect(service.accepts(WORKSPACE, "release-train")).resolves.toBe(false);
  });

  it("reports the fallback quietly, because nothing has gone wrong", async () => {
    // `debug` rather than `warn`: this is on the path of every queue write and every estimate,
    // so a warning would be a line per request saying an installation is as it was shipped.
    const { service } = build([]);

    await service.offered(WORKSPACE);

    expect(debugged).toHaveBeenCalledTimes(1);
    expect(debugged).toHaveBeenCalledWith(expect.stringContaining(WORKSPACE));
  });

  it("is quiet when the workspace has even one workflow", async () => {
    const { service } = build(["release-train"]);

    await service.offered(WORKSPACE);

    expect(debugged).not.toHaveBeenCalled();
  });
});

describe("the bootstrap vocabulary", () => {
  it("is decision K5's four, with the estimator's fallback first", () => {
    // `heuristic-v0` falls back through `standard-fix` *by name*, so a reader should not have
    // to check that the list happens to contain it. Moved here from
    // `estimation/estimation.context.ts`, which predicted the move.
    expect(BOOTSTRAP_WORKFLOW_SLUGS).toEqual([
      "standard-fix",
      "docs-loop",
      "feature-loop",
      "deps-refresh",
    ]);
  });

  it("is never empty, so no caller has to decide what an empty vocabulary means", async () => {
    const { service } = build([]);

    expect((await service.offered(WORKSPACE)).slugs.length).toBeGreaterThan(0);
  });
});
