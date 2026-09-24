import { PULL_REQUEST_STATES, type PullRequestState } from "../db/schema";
import type { HostPrState } from "../ticket-sources/ticket-source.pr";
import { mirroredPath, mirroredState } from "./pr-sync.state";

/**
 * The sync's state rule against V052's graph (AX.1, [#357](https://github.com/NobuData/ouroboros/issues/357)).
 *
 * `pull_requests_state_transition` refuses any edge not listed below, for every role — so a rule
 * that answered one would be a sync the database rejects. Written out here from V052's header
 * rather than imported, because the point is to compare two independent statements of it.
 */

/** V052's edges, as `from→to`. */
const EDGES = new Set([
  "open→verifying",
  "open→closed",
  "open→merged",
  "verifying→blocked",
  "verifying→armed",
  "verifying→closed",
  "verifying→merged",
  "blocked→verifying",
  "blocked→closed",
  "blocked→merged",
  "armed→verifying",
  "armed→merged",
  "armed→closed",
  "closed→open",
]);

const HOST_STATES: readonly HostPrState[] = ["open", "closed", "merged"];

describe("mirroredState", () => {
  it.each(
    PULL_REQUEST_STATES.flatMap((current) => HOST_STATES.map((host) => [current, host] as const)),
  )(
    "moves %s along V052's graph when the host reports %s",
    (current: PullRequestState, host: HostPrState) => {
      const path = mirroredPath(current, host);
      const steps = [current, ...path];

      for (let index = 1; index < steps.length; index += 1) {
        expect([...EDGES]).toContain(`${steps[index - 1]}→${steps[index]}`);
      }

      expect(steps.at(-1)).toBe(mirroredState(current, host));
    },
  );

  it("walks a PR reopened and merged between two syncs through the reopen", () => {
    expect(mirroredState("closed", "merged")).toBe("merged");
    expect(mirroredPath("closed", "merged")).toEqual(["open", "merged"]);
    expect(mirroredPath("verifying", "open")).toEqual([]);
  });

  it("mirrors a new PR in as the host reports it — never armed", () => {
    expect(HOST_STATES.map((host) => mirroredState(null, host))).toEqual([
      "open",
      "closed",
      "merged",
    ]);
  });

  it("keeps the verification plane's refinements of an open PR", () => {
    for (const refined of ["verifying", "blocked", "armed"] as const) {
      expect(mirroredState(refined, "open")).toBe(refined);
    }
  });

  it("accepts the host's merge and close from any open state, reopens a closed one, and never leaves merged", () => {
    expect(mirroredState("armed", "merged")).toBe("merged");
    expect(mirroredState("blocked", "closed")).toBe("closed");
    expect(mirroredState("closed", "open")).toBe("open");

    for (const host of HOST_STATES) {
      expect(mirroredState("merged", host)).toBe("merged");
    }
  });
});
