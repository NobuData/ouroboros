import { MODEL_ALIAS_PARAM_KEYS, MODEL_ALIAS_RESTRICTION_KEYS } from "../db/schema";
import { NO_PARAM_CHIPS, PARAM_CHIP_ORDER, paramChips, paramChipsCell } from "./params.chips";
import { REGISTRY_ROWS } from "./registry.rows.fixture";

/**
 * CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)) fifth acceptance criterion.
 *
 * > *"All eight mockup rows' chips reproduce exactly from the seeded structure, and regenerate
 * > identically on a second call."*
 *
 * The chips in `registry.rows.fixture.ts` were read off `docs/mockups/21-model-registry.html`,
 * so what this suite compares is the derivation against *the mockup*, not against its own
 * output recorded back at itself. The determinism half is a second call, compared to the first —
 * which is what makes *a chip is a pure function of the structure* a test result rather than a
 * claim, and what would catch a locale, a clock or a map iteration creeping in.
 */

describe("mockup 21's eight rows", () => {
  it.each(REGISTRY_ROWS.map((row) => [row.alias, row] as const))(
    "draws %s's params cell exactly as the mockup does",
    (_alias, row) => {
      expect(paramChips(row.params, row.restrictions)).toEqual(row.chips);
    },
  );

  it("regenerates every row identically on a second call", () => {
    for (const row of REGISTRY_ROWS) {
      expect(paramChips(row.params, row.restrictions)).toEqual(
        paramChips(row.params, row.restrictions),
      );
    }
  });

  it("draws the em dash for the two rows that have nothing to show", () => {
    // `coder-fallback` is a fixed-catalog model with nothing to tune and `gpt5-experiments` has
    // no provider yet. Both are honest states rather than a failure to render.
    const dashed = REGISTRY_ROWS.filter((row) => row.chips.length === 0).map((row) => row.alias);

    expect(dashed).toEqual(["coder-fallback", "gpt5-experiments"]);

    for (const alias of dashed) {
      const row = REGISTRY_ROWS.find((candidate) => candidate.alias === alias)!;

      expect(paramChipsCell(row.params, row.restrictions)).toBe(NO_PARAM_CHIPS);
    }
  });

  it("stores no chip anywhere — the cell is derived on every read", () => {
    // The second half of the ticket's problem statement, as a property of the fixture: a row
    // carries `params` and `restrictions` and nothing that looks like a display string, so
    // there is nothing beside the structure for an edit to leave behind.
    for (const row of REGISTRY_ROWS) {
      for (const value of [...Object.values(row.params), ...Object.values(row.restrictions)]) {
        expect(row.chips).not.toContain(value);
      }
    }
  });
});

describe("paramChips", () => {
  it("answers nothing at all for an alias nobody has tuned", () => {
    // Seven of the eight rows have an empty one of the two documents and a newly created alias
    // has both — so this is the ordinary case rather than an edge one.
    expect(paramChips({}, {})).toEqual([]);
  });

  it("draws params before restrictions", () => {
    // A setting on the model and a policy about the alias are different kinds of claim, and
    // grouping them keeps the cell readable at a glance.
    expect(paramChips({ thinking: "max" }, { batch_ok: true })).toEqual([
      "max thinking",
      "batch ok",
    ]);
  });

  it("draws params in the order the inspector stacks its fields", () => {
    // Mockup 21's own order rather than V019's declaration order: `coder-max` reads
    // *max thinking* then *400k budget*, and `sizer` reads *temp 0* then *8k out* — the
    // temperature comes before the output ceiling because that is where the inspector's field
    // is. A cell and a form that disagreed about order would be two readings of one row.
    expect(
      paramChips(
        {
          temperature: 0.2,
          context_clamp: 32_768,
          max_output: 8192,
          token_budget: 400_000,
          thinking: "max",
        },
        {},
      ),
    ).toEqual(["max thinking", "400k budget", "temp 0.2", "8k out", "ctx 32k"]);
  });

  it("draws every key the column can hold, and each exactly once", () => {
    // The order list is written out by hand, so completeness is what a type cannot check here:
    // a sixth key added to V019 and forgotten in `PARAM_CHIP_ORDER` would be a param that
    // renders nowhere, which is precisely what decision R3 closed the vocabulary to prevent.
    expect([...PARAM_CHIP_ORDER].sort()).toEqual([...MODEL_ALIAS_PARAM_KEYS].sort());
  });

  it("draws restrictions in V019's order too", () => {
    expect(paramChips({}, { batch_ok: true, review_vote_only: true })).toEqual([
      "review vote only",
      "batch ok",
    ]);
  });

  it("draws one chip per key when a row sets every one of them", () => {
    // Decision R3's dividend, exercised rather than inspected: the vocabulary is closed
    // precisely so this function is total over it, and a key with no chip would be a param that
    // renders nowhere.
    const everything = {
      thinking: "max",
      token_budget: 1000,
      max_output: 1000,
      context_clamp: 1000,
      temperature: 1,
    };

    expect(paramChips(everything, { review_vote_only: true, batch_ok: true })).toHaveLength(
      MODEL_ALIAS_PARAM_KEYS.length + MODEL_ALIAS_RESTRICTION_KEYS.length,
    );
  });

  describe("thinking", () => {
    it.each([
      ["max", "max thinking"],
      ["std", "std thinking"],
    ])("draws %s as %s", (level, chip) => {
      expect(paramChips({ thinking: level }, {})).toEqual([chip]);
    });

    it("draws off as an instruction rather than as an absence", () => {
      // An alias that says nothing about thinking and one that says `off` are two different
      // requests — the first takes the provider's default and the second turns it off — so the
      // second gets a chip.
      expect(paramChips({ thinking: "off" }, {})).toEqual(["thinking off"]);
      expect(paramChips({}, {})).toEqual([]);
    });

    it("draws nothing for a level V019 would refuse", () => {
      expect(paramChips({ thinking: "ultra" }, {})).toEqual([]);
      expect(paramChips({ thinking: 3 }, {})).toEqual([]);
    });
  });

  describe("a token count", () => {
    it.each([
      [400_000, "400k budget"],
      [1_000_000, "1M budget"],
      [10_000_000, "10M budget"],
      [32_768, "32k budget"],
      [8192, "8k budget"],
      [1024, "1k budget"],
      [512, "512 budget"],
      [12_345, "12.3k budget"],
    ])("prints %d in the unit that states it exactly — %s", (value, chip) => {
      expect(paramChips({ token_budget: value }, {})).toEqual([chip]);
    });

    it("uses one rule across all three token params", () => {
      expect(paramChips({ max_output: 8192, context_clamp: 32_768 }, {})).toEqual([
        "8k out",
        "ctx 32k",
      ]);
    });

    it("draws nothing for a count V019 would refuse", () => {
      // Zero and negatives are outside the column's domain, so a document carrying one has been
      // written past the constraint; drawing `0k out` would put a number on the page that no
      // request will ever carry.
      for (const value of [0, -1, 1.5, "8192", null]) {
        expect(paramChips({ max_output: value }, {})).toEqual([]);
      }
    });
  });

  describe("temperature", () => {
    it.each([
      [0, "temp 0"],
      [0.2, "temp 0.2"],
      [1, "temp 1"],
      [2, "temp 2"],
    ])("prints %p as %s", (value, chip) => {
      expect(paramChips({ temperature: value }, {})).toEqual([chip]);
    });

    it("draws a zero rather than treating it as unset", () => {
      // Mockup 21's `sizer` row is `temp 0`, and zero is the most deliberate temperature there
      // is — a falsy check here would silently drop the one setting somebody most meant.
      expect(paramChips({ temperature: 0 }, {})).toEqual(["temp 0"]);
    });

    it("draws nothing for a value that is not a finite number", () => {
      for (const value of ["0.2", NaN, Infinity, null]) {
        expect(paramChips({ temperature: value }, {})).toEqual([]);
      }
    });
  });

  describe("a restriction", () => {
    it("is drawn only when it is really true", () => {
      // Absence and `false` both mean unrestricted, which V019's own comment says — and the
      // strings `"true"` and `1` are what a form submits when nothing coerced them, which read
      // as true to anything that only asks whether the key is present.
      for (const value of [false, "true", 1, null, undefined]) {
        expect(paramChips({}, { batch_ok: value })).toEqual([]);
      }

      expect(paramChips({}, { batch_ok: true })).toEqual(["batch ok"]);
    });

    it("prints mockup 21's own wording", () => {
      expect(paramChips({}, { review_vote_only: true })).toEqual(["review vote only"]);
    });
  });

  it("ignores a key nothing derives rather than printing it raw", () => {
    // V019 refuses such a key at the column, so a document holding one has been written past
    // the constraint. Printing it would put a provider's vocabulary on this product's page.
    expect(paramChips({ speculative_decoding: true }, { unknown_flag: true })).toEqual([]);
  });

  it("renders a row whose documents are odd rather than failing on it", () => {
    // A registry table that failed to render because one row was strange is worse than a row
    // with a chip missing — so the derivation reads defensively and answers what it can.
    expect(paramChips({ thinking: {}, temperature: [] }, { batch_ok: {} })).toEqual([]);
  });
});

describe("paramChipsCell", () => {
  it("joins the chips the way the mockups separate them", () => {
    expect(paramChipsCell({ thinking: "max", token_budget: 400_000 }, {})).toBe(
      "max thinking · 400k budget",
    );
  });

  it("answers the em dash when there are no chips", () => {
    expect(paramChipsCell({}, {})).toBe(NO_PARAM_CHIPS);
  });

  it("means the same as an empty chip list, and is the only place the dash appears", () => {
    // The two answers are deliberately different shapes: a client drawing tags wants the list
    // and a client drawing text wants the cell, and neither has to recognise a sentinel string
    // to know there is nothing there.
    expect(paramChips({}, {})).toEqual([]);
    expect(paramChipsCell({}, {})).toBe("—");
  });
});
