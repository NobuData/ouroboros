import { describe, expect, it } from "vitest";

import type { RunnerPool } from "@/app/api/farm";
import { UNCLOSED_QUOTE } from "@/app/farm/command-line";
import {
  COMMAND_REQUIRED,
  COMMIT_INVALID,
  FIELDS_REFUSED,
  POOL_GONE,
  POOL_REQUIRED,
  REF_INVALID,
  REPOSITORY_INVALID,
  REPOSITORY_NOT_MIRRORED,
  SUBMIT_FAILED,
  SUBMIT_FORBIDDEN,
  SUBMIT_POOL_DISABLED,
  type SubmitDraft,
  draftFor,
  queuedToast,
  submissionOf,
  submitRefusal,
  submitToPoolLabel,
  validateDraft,
  withPool,
} from "@/app/farm/submit";

import { seededFarm } from "../helpers/farm";

/**
 * Every decision the submit-build dialog makes (#260): what it opens on, what it refuses before
 * a round trip, what it sends, and what a refusal from the service turns into.
 */

/** The seeded pools: `pool-a` with a default command, `pool-b` with none. */
const POOLS: readonly RunnerPool[] = seededFarm().pools;

/** `pool-a`'s default command, as the service stores it. */
const POOL_A_DEFAULT = "west build -b helios_mainboard app";

/** A full 40-character commit. */
const COMMIT = "9e7bd4034c1f1b2a6d8e0f5c7a9b3d1e2f4a6c80";

/**
 * A draft that validates, with some fields replaced.
 *
 * @param over Fields to replace.
 * @returns The draft.
 */
function draft(over: Partial<SubmitDraft> = {}): SubmitDraft {
  return {
    pool: "pool-a",
    repository: "acme-robotics/helios-firmware",
    ref: "refs/heads/main",
    commit: COMMIT,
    command: POOL_A_DEFAULT,
    ...over,
  };
}

/**
 * The seeded pools with one of them switched off.
 *
 * @param name The pool to disable.
 * @returns The pools.
 */
function withDisabled(name: string): readonly RunnerPool[] {
  return POOLS.map((pool) => (pool.name === name ? { ...pool, enabled: false } : pool));
}

describe("what the dialog opens on", () => {
  it("prefills the pool's default command — the issue's one design obligation for the form", () => {
    expect(draftFor(POOLS, "pool-a")).toEqual({
      pool: "pool-a",
      repository: "",
      ref: "",
      commit: "",
      command: POOL_A_DEFAULT,
    });
  });

  it("opens on the pool whose row asked", () => {
    expect(draftFor(POOLS, "pool-b")).toMatchObject({ pool: "pool-b", command: "" });
  });

  it("opens on the first enabled pool from the head, which names none", () => {
    expect(draftFor(POOLS, null).pool).toBe("pool-a");
    expect(draftFor(withDisabled("pool-a"), null).pool).toBe("pool-b");
  });

  it("falls back to the first pool rather than to nothing when every pool is off", () => {
    const off = POOLS.map((pool) => ({ ...pool, enabled: false }));

    expect(draftFor(off, null).pool).toBe("pool-a");
  });

  it("ignores a requested pool the workspace no longer has", () => {
    expect(draftFor(POOLS, "pool-z").pool).toBe("pool-a");
  });

  it("names a pool row's control for its pool", () => {
    expect(submitToPoolLabel("pool-a")).toBe("Submit build to pool-a");
  });
});

describe("changing the pool", () => {
  it("swaps in the new pool's default while the command is still the old pool's", () => {
    expect(withPool(draftFor(POOLS, "pool-a"), POOLS, "pool-b")).toMatchObject({
      pool: "pool-b",
      command: "",
    });
    expect(withPool(draftFor(POOLS, "pool-b"), POOLS, "pool-a").command).toBe(POOL_A_DEFAULT);
  });

  it("never overwrites a command the reader typed", () => {
    const typed = draft({ command: "make hil-sweep" });

    expect(withPool(typed, POOLS, "pool-b").command).toBe("make hil-sweep");
  });

  it("keeps everything else the reader has filled in", () => {
    expect(withPool(draft(), POOLS, "pool-b")).toMatchObject({
      repository: "acme-robotics/helios-firmware",
      ref: "refs/heads/main",
      commit: COMMIT,
    });
  });
});

describe("what is refused before a round trip", () => {
  it("finds nothing wrong with a draft the service's shapes accept", () => {
    expect(validateDraft(draft(), POOLS)).toEqual({});
  });

  it("wants a pool the workspace has, and one that is switched on", () => {
    expect(validateDraft(draft({ pool: "" }), POOLS).pool).toBe(POOL_REQUIRED);
    expect(validateDraft(draft(), withDisabled("pool-a")).pool).toBe(SUBMIT_POOL_DISABLED);
  });

  it.each(["", "helios-firmware", "acme/", "/helios", "acme robotics/helios", "-acme/helios"])(
    "refuses %j as a repository",
    (repository) => {
      expect(validateDraft(draft({ repository }), POOLS).repository).toBe(REPOSITORY_INVALID);
    },
  );

  it.each(["", "refs/heads/my branch", "x".repeat(257)])("refuses %j as a ref", (ref) => {
    expect(validateDraft(draft({ ref }), POOLS).ref).toBe(REF_INVALID);
  });

  it.each(["", "9e7bd40", "main", `${COMMIT}0`, COMMIT.replace("9", "g")])(
    "refuses %j as a commit — the full forty, because an offer pins the exact one",
    (commit) => {
      expect(validateDraft(draft({ commit }), POOLS).commit).toBe(COMMIT_INVALID);
    },
  );

  it("takes a commit pasted in upper case or with a stray space", () => {
    expect(validateDraft(draft({ commit: ` ${COMMIT.toUpperCase()} ` }), POOLS)).toEqual({});
  });

  it("says why a command cannot be read, in the splitter's own words", () => {
    expect(validateDraft(draft({ command: "sh -c 'make all" }), POOLS).command).toBe(UNCLOSED_QUOTE);
  });

  it("wants a command on a pool that has no default to fall back to", () => {
    expect(validateDraft(draft({ pool: "pool-b", command: "" }), POOLS).command).toBe(
      COMMAND_REQUIRED,
    );
    // …and none on a pool that has one.
    expect(validateDraft(draft({ command: "" }), POOLS)).toEqual({});
  });
});

describe("what is sent", () => {
  it("leaves the command out when the reader kept the pool's default, so the service's applies", () => {
    expect(submissionOf(draft(), POOLS)).toEqual({
      pool: "pool-a",
      repository: "acme-robotics/helios-firmware",
      ref: "refs/heads/main",
      commit: COMMIT,
    });
  });

  it("leaves it out when the field was cleared, too", () => {
    expect(submissionOf(draft({ command: "  " }), POOLS)).not.toHaveProperty("command");
  });

  it("sends a command the reader typed as argv, never as a string", () => {
    expect(submissionOf(draft({ command: "sh -c 'west build -p always'" }), POOLS).command).toEqual([
      "sh",
      "-c",
      "west build -p always",
    ]);
  });

  it("sends a command on a pool with no default", () => {
    expect(submissionOf(draft({ pool: "pool-b", command: "make hil-sweep" }), POOLS).command).toEqual(
      ["make", "hil-sweep"],
    );
  });

  it("still reads a default retyped with extra spaces as the default", () => {
    // Same argv, same canonical rendering — it is the pool's command, however it was spaced.
    expect(submissionOf(draft({ command: "west  build -b helios_mainboard  app" }), POOLS)).not.toHaveProperty(
      "command",
    );
  });

  it("folds the commit to the lower case the service requires, and trims the rest", () => {
    expect(
      submissionOf(
        draft({ repository: " acme-robotics/helios-firmware ", ref: " main ", commit: COMMIT.toUpperCase() }),
        POOLS,
      ),
    ).toMatchObject({
      repository: "acme-robotics/helios-firmware",
      ref: "main",
      commit: COMMIT,
    });
  });

  it("sends no title and no label — the service composes both", () => {
    expect(Object.keys(submissionOf(draft({ command: "make" }), POOLS)).sort()).toEqual([
      "command",
      "commit",
      "pool",
      "ref",
      "repository",
    ]);
  });
});

describe("what a refusal turns into", () => {
  it.each([
    ["farm_pool_not_found", { pool: POOL_GONE }],
    ["farm_pool_disabled", { pool: SUBMIT_POOL_DISABLED }],
    ["farm_repository_not_found", { repository: REPOSITORY_NOT_MIRRORED }],
    ["farm_command_required", { command: COMMAND_REQUIRED }],
  ])("puts %s under the field it is about", (code, fields) => {
    expect(submitRefusal({ code, details: {} })).toEqual({ reason: FIELDS_REFUSED, fields });
  });

  it("reads a validation failure's fields, first sentence each", () => {
    expect(
      submitRefusal({
        code: "validation_failed",
        details: {
          commit: ["commit must be 40 lower-case hex characters", "and another"],
          ref: "ref must be a git ref with no whitespace",
        },
      }),
    ).toEqual({
      reason: FIELDS_REFUSED,
      fields: {
        commit: "commit must be 40 lower-case hex characters",
        ref: "ref must be a git ref with no whitespace",
      },
    });
  });

  it("says a failure plainly when the refusal is about nothing the form draws", () => {
    expect(submitRefusal({ code: "validation_failed", details: { title: ["too long"] } })).toEqual({
      reason: SUBMIT_FAILED,
      fields: {},
    });
  });

  it("tells a reader the service will not let submit that nothing was queued", () => {
    expect(submitRefusal({ code: "forbidden", details: {} })).toEqual({
      reason: SUBMIT_FORBIDDEN,
      fields: {},
    });
    expect(SUBMIT_FORBIDDEN).toContain("Nothing was queued");
  });

  it("says anything else failed, and that nothing was queued", () => {
    expect(submitRefusal({ code: "internal_error", details: {} }).reason).toBe(SUBMIT_FAILED);
    expect(SUBMIT_FAILED).toContain("Nothing was queued");
  });
});

describe("the toast", () => {
  it("says queued — not running — with the build's number and pool", () => {
    const toast = queuedToast({ id: "job", number: 483, pool: "pool-a" });

    expect(toast).toContain("Queued #483 in pool-a");
    expect(toast).not.toMatch(/running/u);
  });
});
