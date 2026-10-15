import { repositoryDryRun, type PolicyLoopSource } from "./repository-dry-run";

const ORG = "acme-robotics-id";
const REPO = "a1312000-0000-4000-8000-0000000000aa";

/**
 * A resolver whose `dry_run_new_repos` verdict is fixed.
 *
 * @param active - What the rule says.
 * @returns The resolver and its spies.
 */
function resolverSaying(active: boolean) {
  const resolve = jest.fn().mockReturnValue({ value: { active }, version: 7 });
  const resolver = {
    snapshot: jest.fn().mockResolvedValue({ policy: null, resolve }),
    nextLoop: jest.fn().mockResolvedValue(3),
  };

  return { resolver: resolver as unknown as PolicyLoopSource, spies: { ...resolver, resolve } };
}

/** The org-wide switch, read now. */
function policyAt(override: boolean) {
  return { dryRun: jest.fn(), dryRunNow: jest.fn().mockResolvedValue(override) };
}

describe("whether a repository is in dry-run now", () => {
  it("is in dry-run where no policy is wired — the safe answer", async () => {
    await expect(repositoryDryRun(undefined, undefined, ORG, REPO)).resolves.toBe(true);
  });

  it("is in dry-run while the org-wide switch is on, without asking the per-repository rule", async () => {
    const { resolver, spies } = resolverSaying(false);
    const policy = policyAt(true);

    await expect(repositoryDryRun(policy, resolver, ORG, REPO)).resolves.toBe(true);
    expect(policy.dryRunNow).toHaveBeenCalledWith(ORG);
    expect(spies.snapshot).not.toHaveBeenCalled();
  });

  it("follows the switch alone when no resolver is wired", async () => {
    await expect(repositoryDryRun(policyAt(false), undefined, ORG, REPO)).resolves.toBe(false);
  });

  it.each([true, false])(
    "otherwise follows dry_run_new_repos for the repository's next loop (%p)",
    async (active) => {
      const { resolver, spies } = resolverSaying(active);

      await expect(repositoryDryRun(policyAt(false), resolver, ORG, REPO)).resolves.toBe(active);
      expect(spies.snapshot).toHaveBeenCalledWith(ORG, true);
      expect(spies.nextLoop).toHaveBeenCalledWith(ORG, REPO);
      expect(spies.resolve).toHaveBeenCalledWith("dry_run_new_repos", { loop: 3 });
    },
  );
});
