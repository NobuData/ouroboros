import { Logger } from "@nestjs/common";

import { FIXTURE_REPO_ID, FIXTURE_WORKSPACE } from "./backlog-sync.fixture";
import { LoggingEstimationIntake, type EstimableIssue } from "./estimation.intake";

/**
 * The placeholder, and what it is careful *not* to claim.
 *
 * L.3 ([#107](https://github.com/NobuData/ouroboros/issues/107)) owns the queue that actually
 * estimates. Until it lands, this is what is bound — and the property worth a suite is that it
 * is honest about being a placeholder: the rows are `unsized`, nothing is claiming them, and a
 * boot without an estimator says so once rather than pretending to enqueue.
 */

/**
 * One issue on its way to the pipeline.
 *
 * @param reason - Why it is being estimated.
 * @param number - Which issue.
 * @returns The handoff.
 */
function estimable(reason: EstimableIssue["reason"], number = 485): EstimableIssue {
  return {
    organizationId: FIXTURE_WORKSPACE,
    issueId: `d1000000-0000-0000-0000-00000000${String(number)}`,
    githubRepoId: FIXTURE_REPO_ID,
    number,
    reason,
  };
}

describe("the logging estimation intake", () => {
  let logged: jest.SpyInstance;
  let warned: jest.SpyInstance;

  beforeEach(() => {
    logged = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    warned = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  it("says once that nothing is estimating, so a deployment is not misread", async () => {
    const intake = new LoggingEstimationIntake();

    await intake.accept([estimable("imported")]);
    await intake.accept([estimable("imported", 486)]);

    expect(warned).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining("No estimation pipeline"));
  });

  it("counts what it was handed, by reason", async () => {
    await new LoggingEstimationIntake().accept([
      estimable("imported", 485),
      estimable("imported", 486),
      estimable("reopened", 490),
    ]);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("3 issue(s)"));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("2 imported"));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("1 reopened"));
  });

  it("is silent about an empty batch, which is most polls", async () => {
    await new LoggingEstimationIntake().accept([]);

    expect(logged).not.toHaveBeenCalled();
    expect(warned).not.toHaveBeenCalled();
  });

  it("resolves rather than throwing, so a handoff never costs a committed poll", async () => {
    await expect(
      new LoggingEstimationIntake().accept([estimable("imported")]),
    ).resolves.toBeUndefined();
  });
});
