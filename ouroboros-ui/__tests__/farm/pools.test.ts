import { describe, expect, it } from "vitest";

import type { RunnerPool } from "@/app/api/farm";
import {
  AUTOSCALE_AFFIX,
  CONCURRENCY_ERROR,
  DELETE,
  DELETE_FAILED,
  DELETE_FORBIDDEN,
  DESCRIPTION_MAX,
  DESCRIPTION_TOO_LONG,
  ENV_ALLOWLIST_MAX,
  ENV_NAME_MAX,
  ENV_TOO_MANY,
  EXECUTOR_CHOICES,
  FIELDS_REFUSED,
  IMAGE_MAX,
  IMAGE_MISMATCH,
  IMAGE_REQUIRED,
  IMAGE_SHAPE_ERROR,
  NAME_REQUIRED,
  NAME_SHAPE_ERROR,
  NAME_TAKEN,
  NO_POOL_EDITS,
  POOL_GONE,
  WRITE_FAILED,
  WRITE_FORBIDDEN,
  autoscaleLabel,
  autoscaleView,
  deleteGuard,
  deleteRefusal,
  draftOf,
  enableLabel,
  hasChanges,
  imageLabel,
  mergedPools,
  nextAutoscalePref,
  poolChanges,
  poolCreate,
  poolMeta,
  runnerCount,
  validatePoolDraft,
  withRemovedPool,
  withWrittenPool,
  writeRefusal,
} from "@/app/farm/pools";

import { runnerPool, seededFarm } from "../helpers/farm";

/**
 * Every judgement the pools card and its sheet make (#259), as values: the meta line composed from
 * truth, the auto-scale sub-toggle drawn only where a threshold is stored and never without its
 * affix, the form's bounds restating the service's, a save that names only what differs, the
 * guarded delete, the refusals' sentences, and a write standing in for the page until a read
 * made after it lands.
 */

/** The seeded pools: `pool-a`, the container world, and `pool-b`, the shell one. */
const [POOL_A, POOL_B] = seededFarm().pools as [RunnerPool, RunnerPool];

describe("the meta line", () => {
  it("reads the seeded rows exactly as mockup 08 draws them", () => {
    expect(poolMeta(POOL_A)).toBe("firmware builds · zephyr-sdk 0.17 image · 3 runners");
    expect(poolMeta(POOL_B)).toBe("HIL & macOS jobs · 2 runners");
  });

  it("is composed from the live count, not a stored string", () => {
    expect(poolMeta({ ...POOL_A, runners: 4 })).toBe("firmware builds · zephyr-sdk 0.17 image · 4 runners");
    expect(poolMeta({ ...POOL_A, runners: 1 })).toMatch(/· 1 runner$/);
    expect(poolMeta({ ...POOL_A, runners: 0 })).toMatch(/· no runners$/);
  });

  it("follows the executor and the image when the sheet changes them", () => {
    expect(poolMeta({ ...POOL_A, image: "ghcr.io/acme-robotics/zephyr-sdk:0.18" })).toContain("zephyr-sdk 0.18 image");
    expect(poolMeta({ ...POOL_A, executor: "shell", image: null })).toBe("firmware builds · 3 runners");
  });

  it("leaves out a part with nothing to say rather than drawing it empty", () => {
    expect(poolMeta({ ...POOL_B, description: null })).toBe("2 runners");
    expect(poolMeta({ ...POOL_B, description: "   " })).toBe("2 runners");
  });

  it("never draws an image on a shell pool, whatever the row carries", () => {
    expect(poolMeta({ ...POOL_B, image: "stray:1" })).toBe("HIL & macOS jobs · 2 runners");
  });
});

describe("imageLabel", () => {
  it.each([
    ["ghcr.io/acme-robotics/zephyr-sdk:0.17", "zephyr-sdk 0.17 image"],
    ["zephyr-sdk:0.17", "zephyr-sdk 0.17 image"],
    ["zephyr-sdk", "zephyr-sdk image"],
    // A registry's port is not a tag: the tag is looked for in the last segment only.
    ["localhost:5000/sdk", "sdk image"],
    ["localhost:5000/sdk:2", "sdk 2 image"],
    // What AJ.5 (#267) pins: the digest is dropped whole.
    ["ghcr.io/acme/sdk@sha256:0123abcd", "sdk image"],
    ["ghcr.io/acme/sdk:0.17@sha256:0123abcd", "sdk 0.17 image"],
    ["  img:1  ", "img 1 image"],
  ])("says %s as %s", (image, label) => {
    expect(imageLabel(image)).toBe(label);
  });

  it("falls back to the reference itself when no name can be read out of it", () => {
    expect(imageLabel(":0.17")).toBe(":0.17 image");
  });
});

describe("runnerCount", () => {
  it("counts in words a person would use", () => {
    expect([0, 1, 2, 12].map(runnerCount)).toEqual(["no runners", "1 runner", "2 runners", "12 runners"]);
  });
});

describe("the enable switch", () => {
  it("is named for what pressing it would do", () => {
    expect(enableLabel(POOL_A)).toBe("Disable pool-a");
    expect(enableLabel({ ...POOL_A, enabled: false })).toBe("Enable pool-a");
  });
});

describe("the auto-scale sub-toggle", () => {
  it("is drawn for the pool that stores a threshold, with the sentence composed from it", () => {
    expect(autoscaleView(POOL_A)).toEqual({ on: false, sentence: "Auto-scale to cloud when queue > 5" });
    expect(autoscaleView({ autoscalePref: { enabled: true, queue_threshold: 12 } })).toEqual({
      on: true,
      sentence: "Auto-scale to cloud when queue > 12",
    });
  });

  it("is not drawn where no threshold is stored — no default is invented", () => {
    expect(autoscaleView(POOL_B)).toBeNull();
    expect(autoscaleView({ autoscalePref: { enabled: true } })).toBeNull();
    expect(autoscaleView({ autoscalePref: { queue_threshold: Number.NaN } })).toBeNull();
  });

  it("reads anything but a stored `true` as off", () => {
    expect(autoscaleView({ autoscalePref: { queue_threshold: 5 } })?.on).toBe(false);
  });

  it("carries decision B9's affix verbatim", () => {
    expect(AUTOSCALE_AFFIX).toBe("arrives with cloud runners (v2)");
  });

  it("is named for what pressing it would do", () => {
    expect(autoscaleLabel("pool-a", false)).toBe("Turn on auto-scale to cloud for pool-a");
    expect(autoscaleLabel("pool-a", true)).toBe("Turn off auto-scale to cloud for pool-a");
  });

  it("stores the switch and hands every other key back untouched", () => {
    const pool = { autoscalePref: { enabled: false, queue_threshold: 5, max_runners: 3 } };

    expect(nextAutoscalePref(pool, true)).toEqual({ enabled: true, queue_threshold: 5, max_runners: 3 });
    expect(nextAutoscalePref(pool, false)).toEqual({ enabled: false, queue_threshold: 5, max_runners: 3 });
    // The pool it was given is not written to.
    expect(pool.autoscalePref.enabled).toBe(false);
  });
});

describe("a write standing in for the page", () => {
  const PAGE_AT = 1_000;
  const pools = [POOL_A, POOL_B];

  it("answers the page's own list, identity and all, when nothing is outstanding", () => {
    expect(mergedPools(pools, NO_POOL_EDITS, PAGE_AT)).toBe(pools);
  });

  it("draws a changed pool as the service answered it, until a page read after the write lands", () => {
    const disabled = { ...POOL_A, enabled: false };
    const edits = withWrittenPool(NO_POOL_EDITS, disabled, PAGE_AT + 500);

    expect(mergedPools(pools, edits, PAGE_AT)).toEqual([disabled, POOL_B]);
    // A page confirmed at the write's own instant was still read before it was answered.
    expect(mergedPools(pools, edits, PAGE_AT + 500)).toEqual([disabled, POOL_B]);
    expect(mergedPools(pools, edits, PAGE_AT + 501)).toBe(pools);
  });

  it("adds a created pool where the next read will put it — by name", () => {
    const created = runnerPool({ id: "new", name: "pool-0", runners: 0 });
    const edits = withWrittenPool(NO_POOL_EDITS, created, PAGE_AT + 1);

    expect(mergedPools(pools, edits, PAGE_AT).map((pool) => pool.name)).toEqual(["pool-0", "pool-a", "pool-b"]);
  });

  it("takes a deleted pool out — even one it had just written", () => {
    const renamed = { ...POOL_B, name: "pool-z" };
    const edits = withRemovedPool(withWrittenPool(NO_POOL_EDITS, renamed, PAGE_AT + 1), POOL_B.id, PAGE_AT + 2);

    expect(mergedPools(pools, edits, PAGE_AT)).toEqual([POOL_A]);
    expect(mergedPools(pools, edits, PAGE_AT + 3)).toBe(pools);
  });

  it("lets an old write lapse on its own while a newer one still stands", () => {
    const first = withWrittenPool(NO_POOL_EDITS, { ...POOL_A, enabled: false }, PAGE_AT + 1);
    const both = withWrittenPool(first, { ...POOL_B, enabled: false }, PAGE_AT + 100);

    // The page has caught up with the first write and not the second.
    expect(mergedPools(pools, both, PAGE_AT + 50)).toEqual([POOL_A, { ...POOL_B, enabled: false }]);
  });

  it("never writes to what it was given", () => {
    const edits = withWrittenPool(NO_POOL_EDITS, POOL_A, 1);

    expect(NO_POOL_EDITS).toEqual({ written: {}, removed: {} });
    expect(withRemovedPool(edits, POOL_A.id, 2)).not.toBe(edits);
    expect(edits.removed).toEqual({});
  });
});

describe("the form a pool opens with", () => {
  it("holds the pool as typed strings, the allow-list one name per line", () => {
    expect(draftOf(POOL_A)).toEqual({
      name: "pool-a",
      description: "firmware builds",
      executor: "container",
      image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
      envAllowlist: "CCACHE_DIR\nWEST_TOPDIR\nZEPHYR_BASE",
      maxConcurrency: "2",
    });
    expect(draftOf(POOL_B)).toMatchObject({ description: "HIL & macOS jobs", executor: "shell", image: "" });
  });

  it("starts a new pool as a container pool running one build per runner", () => {
    expect(draftOf(null)).toEqual({
      name: "",
      description: "",
      executor: "container",
      image: "",
      envAllowlist: "",
      maxConcurrency: "1",
    });
  });

  it("offers the two executors, container first", () => {
    expect(EXECUTOR_CHOICES.map((choice) => choice.value)).toEqual(["container", "shell"]);
  });
});

describe("validatePoolDraft", () => {
  it("finds nothing wrong with either seeded pool", () => {
    expect(validatePoolDraft(draftOf(POOL_A))).toEqual({});
    expect(validatePoolDraft(draftOf(POOL_B))).toEqual({});
  });

  it("asks for a name, and for a slug that can travel on a command line", () => {
    expect(validatePoolDraft({ ...draftOf(POOL_A), name: "  " }).name).toBe(NAME_REQUIRED);

    for (const name of ["Pool-A", "pool a", "-pool", "pool-", "pool_a", "a".repeat(65)]) {
      expect(validatePoolDraft({ ...draftOf(POOL_A), name }).name, name).toBe(NAME_SHAPE_ERROR);
    }
    for (const name of ["a", "pool-c", "0", "a".repeat(64)]) {
      expect(validatePoolDraft({ ...draftOf(POOL_A), name }).name, name).toBeUndefined();
    }
  });

  it("bounds the description at the service's length", () => {
    expect(validatePoolDraft({ ...draftOf(POOL_A), description: "x".repeat(DESCRIPTION_MAX) }).description).toBeUndefined();
    expect(validatePoolDraft({ ...draftOf(POOL_A), description: "x".repeat(DESCRIPTION_MAX + 1) }).description).toBe(
      DESCRIPTION_TOO_LONG,
    );
  });

  it("requires an image of a container pool — and judges none on a shell pool", () => {
    expect(validatePoolDraft({ ...draftOf(POOL_A), image: " " }).image).toBe(IMAGE_REQUIRED);
    expect(validatePoolDraft({ ...draftOf(POOL_A), image: "two words" }).image).toBe(IMAGE_SHAPE_ERROR);
    expect(validatePoolDraft({ ...draftOf(POOL_A), image: "x".repeat(IMAGE_MAX + 1) }).image).toBe(IMAGE_SHAPE_ERROR);
    // The field is not on a shell pool's form, so what it still holds is nobody's error.
    expect(validatePoolDraft({ ...draftOf(POOL_B), image: "two words" }).image).toBeUndefined();
  });

  it("refuses a pasted NAME=value, a repeated name, a name too long and a list too long", () => {
    const draft = draftOf(POOL_A);

    expect(validatePoolDraft({ ...draft, envAllowlist: "CCACHE_DIR=/cache" }).envAllowlist).toBe(
      "CCACHE_DIR=/cache is not a variable name — names only, no values.",
    );
    expect(validatePoolDraft({ ...draft, envAllowlist: "TWO WORDS" }).envAllowlist).toContain("not a variable name");
    expect(validatePoolDraft({ ...draft, envAllowlist: "CI\nMAKEFLAGS\nCI" }).envAllowlist).toBe("CI is listed twice.");
    expect(validatePoolDraft({ ...draft, envAllowlist: "X".repeat(ENV_NAME_MAX + 1) }).envAllowlist).toContain(
      String(ENV_NAME_MAX),
    );

    const many = Array.from({ length: ENV_ALLOWLIST_MAX + 1 }, (_, index) => `V${index}`).join("\n");
    expect(validatePoolDraft({ ...draft, envAllowlist: many }).envAllowlist).toBe(ENV_TOO_MANY);
  });

  it("accepts an empty allow-list, and one pasted with commas", () => {
    expect(validatePoolDraft({ ...draftOf(POOL_A), envAllowlist: "" }).envAllowlist).toBeUndefined();
    expect(validatePoolDraft({ ...draftOf(POOL_A), envAllowlist: "CI, MAKEFLAGS" }).envAllowlist).toBeUndefined();
  });

  it("wants a whole number of builds per runner, within the service's range", () => {
    for (const typed of ["", "0", "65", "1.5", "1e1", "-1", "two", "0064"]) {
      expect(validatePoolDraft({ ...draftOf(POOL_A), maxConcurrency: typed }).maxConcurrency, typed).toBe(
        CONCURRENCY_ERROR,
      );
    }
    for (const typed of ["1", "64", " 8 "]) {
      expect(validatePoolDraft({ ...draftOf(POOL_A), maxConcurrency: typed }).maxConcurrency, typed).toBeUndefined();
    }
  });
});

describe("poolCreate", () => {
  it("sends the six fields the sheet edits, trimmed, and leaves the rest to the column defaults", () => {
    expect(
      poolCreate({
        name: " pool-c ",
        description: " nightly macOS builds ",
        executor: "container",
        image: " img:1 ",
        envAllowlist: "CI\n\n MAKEFLAGS ",
        maxConcurrency: " 4 ",
      }),
    ).toEqual({
      name: "pool-c",
      description: "nightly macOS builds",
      executor: "container",
      image: "img:1",
      envAllowlist: ["CI", "MAKEFLAGS"],
      maxConcurrency: 4,
    });
  });

  it("sends a shell pool no image, whatever the hidden field still holds, and no description as null", () => {
    expect(poolCreate({ ...draftOf(null), name: "pool-c", executor: "shell", image: "left:over" })).toMatchObject({
      executor: "shell",
      image: null,
      description: null,
    });
  });
});

describe("poolChanges", () => {
  it("names nothing when the form matches the pool", () => {
    expect(poolChanges(POOL_A, draftOf(POOL_A))).toEqual({});
    expect(hasChanges(poolChanges(POOL_A, draftOf(POOL_A)))).toBe(false);
    expect(poolChanges(POOL_B, draftOf(POOL_B))).toEqual({});
  });

  it("names only what differs, so the audit row lists the columns that moved", () => {
    expect(poolChanges(POOL_A, { ...draftOf(POOL_A), name: "pool-x" })).toEqual({ name: "pool-x" });
    expect(poolChanges(POOL_A, { ...draftOf(POOL_A), maxConcurrency: "4" })).toEqual({ maxConcurrency: 4 });
    expect(poolChanges(POOL_A, { ...draftOf(POOL_A), description: "" })).toEqual({ description: null });
    expect(hasChanges({ name: "pool-x" })).toBe(true);
  });

  it("turns a container pool into a shell one as the pair the service checks — executor and a null image", () => {
    expect(poolChanges(POOL_A, { ...draftOf(POOL_A), executor: "shell" })).toEqual({ executor: "shell", image: null });
  });

  it("turns a shell pool into a container one with the image typed for it", () => {
    expect(poolChanges(POOL_B, { ...draftOf(POOL_B), executor: "container", image: "img:1" })).toEqual({
      executor: "container",
      image: "img:1",
    });
  });

  it("sends the whole allow-list when any of it moved — an addition, a removal or a reorder", () => {
    const draft = draftOf(POOL_A);

    expect(poolChanges(POOL_A, { ...draft, envAllowlist: `${draft.envAllowlist}\nCI` })).toEqual({
      envAllowlist: ["CCACHE_DIR", "WEST_TOPDIR", "ZEPHYR_BASE", "CI"],
    });
    expect(poolChanges(POOL_A, { ...draft, envAllowlist: "CCACHE_DIR" })).toEqual({ envAllowlist: ["CCACHE_DIR"] });
    expect(poolChanges(POOL_A, { ...draft, envAllowlist: "" })).toEqual({ envAllowlist: [] });
    expect(poolChanges(POOL_A, { ...draft, envAllowlist: "WEST_TOPDIR\nCCACHE_DIR\nZEPHYR_BASE" })).toEqual({
      envAllowlist: ["WEST_TOPDIR", "CCACHE_DIR", "ZEPHYR_BASE"],
    });
  });

  it("never names what the sheet does not edit", () => {
    const change = poolChanges(POOL_A, {
      name: "pool-x",
      description: "other",
      executor: "shell",
      image: "",
      envAllowlist: "CI",
      maxConcurrency: "9",
    });

    expect(Object.keys(change).sort()).toEqual([
      "description",
      "envAllowlist",
      "executor",
      "image",
      "maxConcurrency",
      "name",
    ]);
  });
});

describe("the guarded delete", () => {
  it("blocks a pool with runners, with the count on the control and the reason behind it", () => {
    const guard = deleteGuard(POOL_A);

    expect(guard.label).toBe("Delete — blocked: 3 runners");
    expect(guard.reason).toContain("pool-a has 3 runners");
    expect(guard.reason).toContain("disable the pool");
    expect(deleteGuard({ name: "pool-b", runners: 1 }).label).toBe("Delete — blocked: 1 runner");
    expect(deleteGuard({ name: "pool-b", runners: 1 }).reason).toContain("Remove it first");
  });

  it("permits an empty one", () => {
    expect(deleteGuard({ name: "pool-c", runners: 0 })).toEqual({ label: DELETE, reason: null });
  });
});

describe("writeRefusal", () => {
  it("puts a taken name and an image mismatch under the field each is about", () => {
    expect(writeRefusal({ code: "farm_pool_name_taken", details: {} })).toEqual({
      reason: FIELDS_REFUSED,
      fields: { name: NAME_TAKEN },
    });
    expect(writeRefusal({ code: "farm_pool_image_mismatch", details: { field: "image" } })).toEqual({
      reason: FIELDS_REFUSED,
      fields: { image: IMAGE_MISMATCH },
    });
  });

  it("reads a validation refusal's sentences onto the form's own fields", () => {
    expect(
      writeRefusal({
        code: "validation_failed",
        details: { name: ["name must be a lower-case slug"], maxConcurrency: "too many", tags: ["not drawn here"] },
      }),
    ).toEqual({
      reason: FIELDS_REFUSED,
      fields: { name: "name must be a lower-case slug", maxConcurrency: "too many" },
    });
  });

  it("says the save failed when a validation refusal is about nothing this form draws", () => {
    expect(writeRefusal({ code: "validation_failed", details: { tags: ["bad"] } })).toEqual({
      reason: WRITE_FAILED,
      fields: {},
    });
    expect(writeRefusal({ code: "validation_failed", details: { name: [] } }).reason).toBe(WRITE_FAILED);
  });

  it("has a sentence for a member, for a pool that is gone, and for anything else", () => {
    expect(writeRefusal({ code: "forbidden", details: {} }).reason).toBe(WRITE_FORBIDDEN);
    expect(writeRefusal({ code: "farm_pool_not_found", details: {} }).reason).toBe(POOL_GONE);
    expect(writeRefusal({ code: "internal_error", details: {} })).toEqual({ reason: WRITE_FAILED, fields: {} });
  });
});

describe("deleteRefusal", () => {
  it("composes the reason from the counts the service took — retired runners and builds", () => {
    expect(deleteRefusal({ code: "farm_pool_in_use", details: { pool: "pool-c", runners: 1, jobs: 12 } })).toBe(
      "Blocked: 1 runner (retired ones included) and 12 builds still name this pool. " +
        "Disable it instead — that stops new work and keeps the history.",
    );
    expect(deleteRefusal({ code: "farm_pool_in_use", details: { runners: 0, jobs: 1 } })).toContain(
      "1 build still names this pool",
    );
    expect(deleteRefusal({ code: "farm_pool_in_use", details: { runners: 2, jobs: 0 } })).toContain(
      "2 runners (retired ones included) still name",
    );
  });

  it("still says why when the counts are missing or unreadable", () => {
    expect(deleteRefusal({ code: "farm_pool_in_use", details: { runners: "many" } })).toContain(
      "runners or builds still name this pool",
    );
  });

  it("has a sentence for a member, for a pool that is gone, and for anything else", () => {
    expect(deleteRefusal({ code: "forbidden", details: {} })).toBe(DELETE_FORBIDDEN);
    expect(deleteRefusal({ code: "farm_pool_not_found", details: {} })).toBe(POOL_GONE);
    expect(deleteRefusal({ code: "internal_error", details: {} })).toBe(DELETE_FAILED);
  });
});
