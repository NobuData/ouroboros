import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreatePoolDto, EnrollCommandQuery, UpdatePoolDto } from "./fleet.dto";

/**
 * What the pool writes accept, and what they refuse.
 *
 * Every bound here restates one of V040's CHECKs. The schema is the guarantee — it cannot be
 * bypassed — and these are what turn a violation into a `422` naming the field rather than a
 * `500` naming a constraint an operator has no way to look up. So the cases are written
 * against the constraint they mirror, and a case that passed here and was refused by
 * PostgreSQL would be this file having drifted.
 */

/** The field names a body fails on, or an empty list. */
function errorsOn(dto: object): string[] {
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).map(
    (error) => error.property,
  );
}

/** A create body with the two required fields filled in. */
function create(body: Record<string, unknown> = {}): CreatePoolDto {
  return plainToInstance(CreatePoolDto, { name: "pool-c", executor: "shell", ...body });
}

/** An update body. */
function update(body: Record<string, unknown> = {}): UpdatePoolDto {
  return plainToInstance(UpdatePoolDto, body);
}

describe("creating a pool", () => {
  it("accepts the minimum a pool needs to exist", () => {
    expect(errorsOn(create())).toEqual([]);
  });

  it("accepts a fully specified container pool", () => {
    expect(
      errorsOn(
        create({
          executor: "container",
          image: "ghcr.io/acme-robotics/zephyr-sdk:0.17",
          description: "firmware builds",
          envAllowlist: ["CCACHE_DIR", "WEST_TOPDIR"],
          maxConcurrency: 2,
          enabled: true,
          tags: ["firmware", "zephyr"],
          defaultCommand: ["west", "build", "-b", "helios_mainboard", "app"],
          autoscalePref: { enabled: false, queue_threshold: 5 },
        }),
      ),
    ).toEqual([]);
  });

  it("requires a name and an executor", () => {
    expect(errorsOn(plainToInstance(CreatePoolDto, {})).sort()).toEqual(["executor", "name"]);
  });

  it("refuses a name that is not a slug — it travels on a command line as --pool", () => {
    // V040's `runner_pools_name_shape`. A name with a space or a slash is a `--pool` argument
    // that means something else to a shell, and a URL segment that is not one.
    for (const name of ["Pool A", "pool_a", "-pool", "pool-", "pool/a", ""]) {
      expect(errorsOn(create({ name }))).toContain("name");
    }
  });

  it("refuses an executor V040 does not have", () => {
    expect(errorsOn(create({ executor: "vm" }))).toContain("executor");
  });

  it("refuses a field nothing declares, rather than storing it silently", () => {
    expect(errorsOn(create({ autoscale: true }))).toContain("autoscale");
  });

  it("refuses a concurrency outside the column's range", () => {
    // `runner_pools_max_concurrency_in_range` — 1 to 64.
    expect(errorsOn(create({ maxConcurrency: 0 }))).toContain("maxConcurrency");
    expect(errorsOn(create({ maxConcurrency: 65 }))).toContain("maxConcurrency");
    expect(errorsOn(create({ maxConcurrency: 1 }))).toEqual([]);
    expect(errorsOn(create({ maxConcurrency: 64 }))).toEqual([]);
  });
});

describe("the environment allow-list", () => {
  it("is a set, so a duplicate is refused rather than rendered twice", () => {
    // `farm_text_set_valid`'s distinctness. A duplicate is a writer that appended without
    // reading.
    expect(errorsOn(create({ envAllowlist: ["CCACHE_DIR", "CCACHE_DIR"] }))).toContain(
      "envAllowlist",
    );
  });

  it("refuses an empty name and a non-string", () => {
    expect(errorsOn(create({ envAllowlist: [""] }))).toContain("envAllowlist");
    expect(errorsOn(create({ envAllowlist: [3] }))).toContain("envAllowlist");
  });

  it("refuses more names than the column holds", () => {
    const many = Array.from({ length: 65 }, (_unused, index) => `VAR_${String(index)}`);

    expect(errorsOn(create({ envAllowlist: many }))).toContain("envAllowlist");
    expect(errorsOn(create({ envAllowlist: many.slice(0, 64) }))).toEqual([]);
  });

  it("accepts an empty list — a pool that carries nothing through", () => {
    expect(errorsOn(create({ envAllowlist: [] }))).toEqual([]);
  });
});

describe("pool tags", () => {
  it("accepts the lower-case slugs a marketplace snippet resolves against", () => {
    expect(errorsOn(create({ tags: ["hil", "macos", "gpu_a100"] }))).toEqual([]);
  });

  it("refuses anything a `runner_tags` requirement could not match without normalising", () => {
    // `farm_pool_tags_valid` — the tag a snippet writes and the tag a pool carries have to be
    // comparable as they stand.
    for (const tag of ["HIL", "has space", "-lead", ""]) {
      expect(errorsOn(create({ tags: [tag] }))).toContain("tags");
    }
  });

  it("is a set too", () => {
    expect(errorsOn(create({ tags: ["hil", "hil"] }))).toContain("tags");
  });
});

describe("the auto-scale preference", () => {
  it("accepts the three keys V040 permits, and an empty document", () => {
    expect(errorsOn(create({ autoscalePref: {} }))).toEqual([]);
    expect(
      errorsOn(create({ autoscalePref: { enabled: true, queue_threshold: 5, max_runners: 10 } })),
    ).toEqual([]);
  });

  it("refuses a key nothing will ever read", () => {
    // Closed *because* nothing reads it yet: the point of storing an inert preference is that
    // AJ.1 can activate it without first discovering what accumulated in the column.
    expect(errorsOn(create({ autoscalePref: { region: "eu-west-1" } }))).toContain("autoscalePref");
  });

  it("refuses a threshold below one, and a switch that is not a boolean", () => {
    expect(errorsOn(create({ autoscalePref: { queue_threshold: 0 } }))).toContain("autoscalePref");
    expect(errorsOn(create({ autoscalePref: { max_runners: 0 } }))).toContain("autoscalePref");
    expect(errorsOn(create({ autoscalePref: { enabled: "yes" } }))).toContain("autoscalePref");
  });

  it("refuses an array and a scalar, which are not documents", () => {
    expect(errorsOn(create({ autoscalePref: [] }))).toContain("autoscalePref");
    expect(errorsOn(create({ autoscalePref: 5 }))).toContain("autoscalePref");
  });
});

describe("the default command", () => {
  it("is argv, never a shell string", () => {
    // `dispatch/jobs.dto.ts`'s rule and the same validator, so a pool's default and a
    // submission's command are bounded identically.
    expect(errorsOn(create({ defaultCommand: ["make", "all"] }))).toEqual([]);
    expect(errorsOn(create({ defaultCommand: "make all" }))).toContain("defaultCommand");
  });

  it("accepts null — a pool where every submission names its own", () => {
    expect(errorsOn(create({ defaultCommand: null }))).toEqual([]);
  });

  it("refuses an empty argv and an empty program", () => {
    expect(errorsOn(create({ defaultCommand: [] }))).toContain("defaultCommand");
    expect(errorsOn(create({ defaultCommand: ["", "all"] }))).toContain("defaultCommand");
  });
});

describe("changing a pool", () => {
  it("accepts an empty body — a request that changes nothing", () => {
    expect(errorsOn(update())).toEqual([]);
  });

  it("accepts the card's switch on its own", () => {
    expect(errorsOn(update({ enabled: false }))).toEqual([]);
  });

  it("makes name and executor optional, and still bounds them", () => {
    expect(errorsOn(update({ name: "pool-d" }))).toEqual([]);
    expect(errorsOn(update({ name: "Pool D" }))).toContain("name");
    expect(errorsOn(update({ executor: "vm" }))).toContain("executor");
  });

  it("accepts null for the two fields where null means `there is none`", () => {
    expect(errorsOn(update({ image: null, description: null, defaultCommand: null }))).toEqual([]);
  });

  it("refuses an unknown field here too", () => {
    expect(errorsOn(update({ runners: 3 }))).toContain("runners");
  });
});

describe("the enroll-command query", () => {
  it("requires a pool, as a slug", () => {
    expect(errorsOn(plainToInstance(EnrollCommandQuery, { pool: "pool-a" }))).toEqual([]);
    expect(errorsOn(plainToInstance(EnrollCommandQuery, {}))).toContain("pool");
    expect(errorsOn(plainToInstance(EnrollCommandQuery, { pool: "Pool A" }))).toContain("pool");
  });
});
