import type { BacklogListRow } from "./listing.repository";
import { backlogRow } from "./listing.resources";

/**
 * The mapping, which is the contract — and the one property it exists to state: **an issue has
 * a latest estimate or it has none**.
 *
 * `issue_estimates` makes `effort`, `confidence`, `suggested_workflow` and `routed_model` all
 * `not null` (V026), so the lateral either matched a row and produced four values or matched
 * nothing and produced four nulls. Publishing them as one nullable object is what lets N.3
 * ([#117](https://github.com/NobuData/ouroboros/issues/117)) branch once on an unsized row
 * instead of four times — and what stops this file from inventing a `confidence: 0` no
 * estimator produced.
 */

/**
 * One joined row, as the statement returns it.
 *
 * @param overrides - What differs from mockup 03's `#485`.
 * @returns The row.
 */
function row(overrides: Partial<BacklogListRow> = {}): BacklogListRow {
  return {
    id: "5eed0018-0000-4000-8000-000000000485",
    number: 485,
    title: "Watchdog reset on I²C bus lockup",
    labels: ["bug", "i2c", "watchdog", "priority-high"],
    state: "open",
    sizingStatus: "sized",
    githubRepoId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
    repository: "acme-robotics/helios-firmware",
    effort: "m",
    confidence: 92,
    suggestedWorkflow: "standard-fix",
    routedModel: "claude-fable-5",
    ...overrides,
  };
}

describe("a backlog row", () => {
  it("is the mockup's cells and no more", () => {
    // The table's six columns: the checkbox's id, the issue, effort with its confidence, the
    // workflow, the model and the status pill.
    expect(backlogRow(row())).toEqual({
      id: "5eed0018-0000-4000-8000-000000000485",
      number: 485,
      title: "Watchdog reset on I²C bus lockup",
      labels: ["bug", "i2c", "watchdog", "priority-high"],
      state: "open",
      sizingStatus: "sized",
      githubRepoId: "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
      repository: "acme-robotics/helios-firmware",
      estimate: {
        effort: "m",
        confidence: 92,
        suggestedWorkflow: "standard-fix",
        routedModel: "claude-fable-5",
      },
    });
  });

  it("carries no body, author or URL — those are the side panel's", () => {
    const published = Object.keys(backlogRow(row()));

    expect(published).not.toContain("body");
    expect(published).not.toContain("authorLogin");
    expect(published).not.toContain("ghUrl");
  });

  it("publishes an issue with no estimate as one null rather than four", () => {
    // The seeded `#483`: `estimating`, and no `issue_estimates` row at all, because that is what
    // `estimating` means. N.2 renders a mid-flight row from what exists.
    const mapped = backlogRow(
      row({
        number: 483,
        sizingStatus: "estimating",
        effort: null,
        confidence: null,
        suggestedWorkflow: null,
        routedModel: null,
      }),
    );

    expect(mapped.estimate).toBeNull();
    expect(mapped.sizingStatus).toBe("estimating");
  });

  it("keeps the status and the estimate as separate answers", () => {
    // The seeded `#490`: sized by the pipeline and then held for a human. The pill and the
    // estimate say different things, and a row that derived one from the other would lose that.
    const mapped = backlogRow(
      row({ number: 490, sizingStatus: "needs_human", effort: "xl", confidence: 61 }),
    );

    expect(mapped.sizingStatus).toBe("needs_human");
    expect(mapped.estimate).toEqual({
      effort: "xl",
      confidence: 61,
      suggestedWorkflow: "standard-fix",
      routedModel: "claude-fable-5",
    });
  });

  it("carries a closed issue's state, because a listing may be asked for one", () => {
    expect(backlogRow(row({ state: "closed" })).state).toBe("closed");
  });

  it("keeps the labels in the order they are stored", () => {
    // The tags under the title are GitHub's set as GitHub ordered it; re-sorting them here would
    // be this service editing a mirrored value, which decision K3 forbids.
    expect(backlogRow(row({ labels: ["watchdog", "bug"] })).labels).toEqual(["watchdog", "bug"]);
  });
});
