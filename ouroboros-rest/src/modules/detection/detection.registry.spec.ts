/** The rule-pack registry's boot checks ([#384](https://github.com/NobuData/ouroboros/issues/384)). */

import type { RulePack } from "./detection.pack";
import { RulePackRegistry, rulePackViolations } from "./detection.registry";
import { CORE_PACKS } from "./packs/core.packs";

/**
 * A pack that concludes nothing.
 *
 * @param overrides - What to change.
 * @returns The pack.
 */
function pack(overrides: Partial<RulePack>): RulePack {
  return {
    key: "custom",
    version: "1.0.0",
    rows: ["custom:thing"],
    probes: () => [],
    conclude: () => ({ rows: [] }),
    ...overrides,
  };
}

describe("RulePackRegistry", () => {
  it("registers the core packs, in card order, with their versions", () => {
    const registry = new RulePackRegistry(CORE_PACKS);

    expect(registry.all().map((registered) => registered.key)).toEqual([
      "language",
      "build",
      "devcontainer",
      "tests",
      "protected_paths",
      "conventions",
    ]);
    expect(Object.values(registry.versions()).every((version) => version === "1.0.0")).toBe(true);
  });

  it("accepts a pack emitting custom rows beside the core", () => {
    expect(() => new RulePackRegistry([...CORE_PACKS, pack({})])).not.toThrow();
  });

  it("stops the process at boot, naming every violation at once", () => {
    expect(() => new RulePackRegistry([pack({ key: "Bad Key", version: "1" })])).toThrow(
      'The rule packs cannot be registered: pack key "Bad Key" is not lower-case letters, digits, _ and -; ' +
        'pack "Bad Key" version "1" is not major.minor.patch',
    );
  });
});

describe("rulePackViolations", () => {
  it("refuses two packs with one key", () => {
    expect(rulePackViolations([pack({}), pack({ rows: ["custom:other"] })])).toEqual([
      'two packs are registered as "custom"',
    ]);
  });

  it("refuses two packs claiming one row", () => {
    expect(rulePackViolations([...CORE_PACKS, pack({ rows: ["tests"] })])).toEqual([
      'row "tests" is declared by both "tests" and "custom"',
    ]);
  });

  it("refuses a row key V067 would not store, and a pack with no rows", () => {
    expect(
      rulePackViolations([pack({ rows: ["custom:Upper"] }), pack({ key: "empty", rows: [] })]),
    ).toEqual([
      'pack "custom" declares row "custom:Upper", which is neither core nor custom:<name>',
      'pack "empty" declares no rows',
    ]);
  });
});
