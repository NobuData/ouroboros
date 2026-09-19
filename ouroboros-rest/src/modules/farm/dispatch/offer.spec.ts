import { decode, encode, frame } from "../protocol/protocol";
import { uuidOf } from "../protocol/ulid";
import { COMMIT, JOB, RUNNER, buildJob } from "./dispatch.fixture";
import { CONTAINER_WORKDIR, JOB_TIMEOUT_S, SHELL_WORKDIR } from "./dispatch.policy";
import { cloneUrl, envOf, offerPayload, undispatchable, type OfferSource } from "./offer";

/**
 * A placed job as its `job.offer` (#252) — every field from the row or from policy, and every
 * payload one the protocol's own codec accepts.
 */

const EXPIRES = new Date("2026-09-19T12:00:05.000Z");

/**
 * An offer source around a job row.
 *
 * @param overrides - The job's fields.
 * @param attempt - Which attempt.
 * @returns The source.
 */
function source(overrides = {}, attempt = 1): OfferSource {
  return {
    job: buildJob({ status: "offered", runner_id: RUNNER, ...overrides }),
    poolName: "pool-a",
    repoOwner: "acme-robotics",
    repoName: "helios-firmware",
    attempt,
  };
}

/**
 * Whether the protocol codec accepts an offer.
 *
 * @param payload - The payload.
 * @returns The diagnostics, empty when it is legal.
 */
function judge(payload: ReturnType<typeof offerPayload>): readonly unknown[] {
  return decode(encode(frame("job.offer", payload))).diagnostics;
}

describe("a placed job as its job.offer", () => {
  it("offers a container job with its snapshot, its argv and the exact commit", () => {
    const payload = offerPayload(source(), EXPIRES);

    expect(payload).toEqual({
      job: expect.stringMatching(/^job_[0-9A-HJKMNP-TV-Z]{26}$/) as string,
      pool: "pool-a",
      executor: "container",
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      command: ["west", "build", "-b", "helios_mainboard", "app"],
      workdir: CONTAINER_WORKDIR,
      env: {},
      repository: {
        url: "https://github.com/acme-robotics/helios-firmware.git",
        ref: "refs/heads/main",
        commit: COMMIT,
      },
      timeout_s: JOB_TIMEOUT_S,
      expires_at: "2026-09-19T12:00:05.000Z",
    });
    expect(uuidOf("job", payload.job)).toBe(JOB);
    expect(judge(payload)).toEqual([]);
  });

  it("offers a shell job with no image — the protocol forbids one there — in its workspace root", () => {
    const payload = offerPayload(
      source({ executor: "shell", image: null, command: "make hil-sweep RIG=rig-02" }),
      EXPIRES,
    );

    expect(payload).not.toHaveProperty("image");
    expect(payload.workdir).toBe(SHELL_WORKDIR);
    expect(payload.command).toEqual(["make", "hil-sweep", "RIG=rig-02"]);
    expect(judge(payload)).toEqual([]);
  });

  it("says which attempt a retry is, and says nothing on a first attempt", () => {
    expect(offerPayload(source({}, 1), EXPIRES)).not.toHaveProperty("attempt");

    const retry = offerPayload(source({}, 2), EXPIRES);
    expect(retry.attempt).toBe(2);
    expect(judge(retry)).toEqual([]);
  });

  it("carries the job's string environment and nothing else", () => {
    expect(envOf({ CCACHE_DIR: "/cache", WEIRD: 3, NESTED: { a: 1 } })).toEqual({
      CCACHE_DIR: "/cache",
    });
    expect(envOf(null)).toEqual({});
    expect(envOf(["A=B"])).toEqual({});
    expect(
      Object.keys(
        envOf(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`V${String(i)}`, "x"]))),
      ),
    ).toHaveLength(128);
  });

  it("builds a clone URL from the mirror's owner and name", () => {
    expect(cloneUrl("acme-robotics", "helios-firmware")).toBe(
      "https://github.com/acme-robotics/helios-firmware.git",
    );
  });

  describe("a record it cannot offer", () => {
    it("names a job with no commit, or a command that is not a canonical argv", () => {
      expect(undispatchable(buildJob())).toBeUndefined();
      expect(undispatchable(buildJob({ commit_sha: null }))).toMatch(/names no commit/);
      expect(undispatchable(buildJob({ command: 'sh -c "make all"' }))).toMatch(/canonical/);
    });

    it("refuses to build an offer for one rather than guessing", () => {
      expect(() => offerPayload(source({ commit_sha: null }), EXPIRES)).toThrow(TypeError);
      expect(() => offerPayload(source({ command: "make  all" }), EXPIRES)).toThrow(TypeError);
    });
  });
});
