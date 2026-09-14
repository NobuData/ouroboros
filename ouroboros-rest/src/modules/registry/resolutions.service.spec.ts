import type { ResolutionSnapshotsRepository } from "./resolutions.repository";
import type { ResolutionSnapshotRow } from "./resolutions.rows";
import { ResolutionSnapshotsService } from "./resolutions.service";

/**
 * The read's one decision: a stored row is an answer, and no stored row is an answer too
 * ([#589](https://github.com/NobuData/ouroboros/issues/589)). The mapping itself is
 * `resolutions.resources.spec.ts`'.
 */

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/** A minimal stored snapshot. */
const ROW: ResolutionSnapshotRow = {
  id: "5eed0017-0000-4000-8000-000000000001",
  run_id: "5eed0005-0000-4000-8000-000000000482",
  issue_number: 482,
  shape_version: 1,
  task_kind: "implement",
  route_tag: "implement-primary",
  outcome: "resolved",
  duration_ms: 42,
  chain: [
    {
      index: 1,
      alias: "coder-max",
      model_id: "claude-fable-5",
      provider: { kind: "anthropic", display_name: "Anthropic Claude", status: "active" },
      decision: "kept",
      code: "provider_healthy",
      explanation: "Primary · healthy",
    },
  ],
  rules: [],
  resolved_at: new Date("2026-09-13T10:08:00.000Z"),
};

/**
 * The service, over a repository that answers with a row or with nothing.
 *
 * @param row - The row, or `null` for *nothing stored* — not `undefined`, which a default
 *   parameter would replace.
 * @returns The service and the repository's spy.
 */
function serviceAnswering(row: ResolutionSnapshotRow | null) {
  const latestNaming = jest.fn().mockResolvedValue(row ?? undefined);
  const service = new ResolutionSnapshotsService({
    latestNaming,
  } as unknown as ResolutionSnapshotsRepository);

  return { service, latestNaming };
}

describe("the resolution snapshot service", () => {
  it("asks for the alias in the caller's workspace", async () => {
    const { service, latestNaming } = serviceAnswering(ROW);

    await service.latest(WORKSPACE, "coder-max");

    expect(latestNaming).toHaveBeenCalledWith(WORKSPACE, "coder-max");
  });

  it("answers the alias and its latest snapshot", async () => {
    const { service } = serviceAnswering(ROW);

    const answer = await service.latest(WORKSPACE, "coder-max");

    expect(answer.alias).toBe("coder-max");
    expect(answer.snapshot?.run.issueNumber).toBe(482);
    expect(answer.snapshot?.resolvedHopIndex).toBe(1);
  });

  it("answers null for an alias no run has resolved through, rather than refusing", async () => {
    // The card renders a Simulate preview labelled as one (decision R9) against this null — never
    // a fabricated run.
    const { service } = serviceAnswering(null);

    await expect(service.latest(WORKSPACE, "gpt5-experiments")).resolves.toEqual({
      alias: "gpt5-experiments",
      snapshot: null,
    });
  });
});
