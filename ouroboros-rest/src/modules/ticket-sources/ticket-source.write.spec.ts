import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TICKET_SOURCE_KINDS } from "../db/schema";
import {
  EPIC_MAPPINGS,
  PUSH_DISABLED_REASONS,
  READ_ONLY_WRITE_CAPABILITIES,
  dependencyMarker,
  dependencyMarkersIn,
  hasDependencyMarker,
  pushAffordance,
  withDependencyMarker,
  writeCapabilityViolations,
} from "./ticket-source.write";

/**
 * The write declaration's rules (AL.2, [#278](https://github.com/NobuData/ouroboros/issues/278)).
 *
 * Four claims: a declaration is **total and coherent** or the registry refuses it; **capability
 * flags gate the UI affordance** — read-only renders disabled with a reason; the **fallback marker
 * round-trips** and is idempotent; and the write path **names no tracker**, so decision P5 holds in
 * the direction it was never tested before.
 */

/** The module's own source below its header, with this repository's issue links removed. */
const SOURCE = (() => {
  const text = readFileSync(join(__dirname, "ticket-source.write.ts"), "utf8");

  return text.slice(text.indexOf("*/") + 2).replaceAll(/https:\/\/github\.com\/NobuData\/\S*/g, "");
})();

describe("writeCapabilityViolations", () => {
  it("passes the read-only declaration and every coherent writable one", () => {
    expect(writeCapabilityViolations(READ_ONLY_WRITE_CAPABILITIES)).toEqual([]);

    for (const epicMapping of EPIC_MAPPINGS) {
      for (const flag of [true, false]) {
        expect(
          writeCapabilityViolations({
            createTicket: true,
            nativeDependencies: flag,
            epicMapping,
            milestones: !flag,
          }),
        ).toEqual([]);
      }
    }
  });

  it.each([null, "read-only", [], undefined])("refuses %p as no declaration at all", (write) => {
    expect(writeCapabilityViolations(write)).toEqual([
      "capabilities().write must be an object — READ_ONLY_WRITE_CAPABILITIES says no",
    ]);
  });

  it("refuses a flag left out, because false is an answer", () => {
    expect(
      writeCapabilityViolations({ createTicket: false, epicMapping: "none", milestones: false }),
    ).toEqual(["capabilities().write.nativeDependencies must be a boolean — false is an answer"]);
  });

  it("refuses a mapping outside the vocabulary", () => {
    expect(
      writeCapabilityViolations({ ...READ_ONLY_WRITE_CAPABILITIES, epicMapping: "sub_task" }),
    ).toEqual([
      "capabilities().write.epicMapping must be one of parent_issue, epic, project, none",
    ]);
  });

  it("refuses a read-only declaration that claims anything it could only do by writing", () => {
    expect(
      writeCapabilityViolations({
        createTicket: false,
        nativeDependencies: true,
        epicMapping: "parent_issue",
        milestones: true,
      }),
    ).toEqual([
      "capabilities().write.nativeDependencies is true but createTicket is false",
      "capabilities().write.milestones is true but createTicket is false",
      "capabilities().write.epicMapping is parent_issue but createTicket is false — a provider that cannot write maps epics to none",
    ]);
  });
});

describe("pushAffordance", () => {
  it("renders a read-only source push-disabled, with a reason fit for a tooltip", () => {
    const affordance = pushAffordance(READ_ONLY_WRITE_CAPABILITIES);

    expect(affordance).toStrictEqual({ enabled: false, reason: PUSH_DISABLED_REASONS.readOnly });
    expect(affordance.reason?.trim()).not.toBe("");
  });

  it("enables push for a source that can create tickets, whatever else it lacks", () => {
    // `epicMapping: none` and no milestones are supported configurations, not reasons to refuse.
    expect(
      pushAffordance({
        createTicket: true,
        nativeDependencies: false,
        epicMapping: "none",
        milestones: false,
      }),
    ).toStrictEqual({ enabled: true, reason: null });
  });
});

describe("the dependency fallback marker", () => {
  it("is an HTML comment naming the blocker", () => {
    expect(dependencyMarker("10001")).toBe("<!-- ouroboros:blocked-by 10001 -->");
  });

  it.each(["", "  ", "a--b", "a>b"])(
    "refuses %p, which could not survive inside a comment",
    (id) => {
      expect(() => dependencyMarker(id)).toThrow(RangeError);
    },
  );

  it("is appended below what a person wrote, once however often it is added", () => {
    const once = withDependencyMarker("Resume rather than brick.", "10001");
    const twice = withDependencyMarker(once, "10001");

    expect(once).toBe("Resume rather than brick.\n\n<!-- ouroboros:blocked-by 10001 -->");
    expect(twice).toBe(once);
  });

  it("is the whole body when there was none", () => {
    expect(withDependencyMarker(null, "7")).toBe("<!-- ouroboros:blocked-by 7 -->");
    expect(withDependencyMarker("", "7")).toBe("<!-- ouroboros:blocked-by 7 -->");
  });

  it("round-trips one line per blocker, in order", () => {
    const body = withDependencyMarker(withDependencyMarker("Body", "10001"), "10002");

    expect(dependencyMarkersIn(body)).toStrictEqual(["10001", "10002"]);
    expect(hasDependencyMarker(body, "10002")).toBe(true);
    expect(hasDependencyMarker(body, "10003")).toBe(false);
  });

  it("counts only whole lines, so a marker quoted mid-sentence is not a relation", () => {
    expect(
      dependencyMarkersIn("we write <!-- ouroboros:blocked-by 10001 --> for the fallback"),
    ).toStrictEqual([]);
    expect(dependencyMarkersIn(null)).toStrictEqual([]);
  });
});

describe("the write declaration's source", () => {
  it("names no tracker below its header", () => {
    // Decision P5 on the write path: the vocabulary is `parent_issue`, `epic` and `project` — the
    // shapes — never the product that has them.
    for (const kind of TICKET_SOURCE_KINDS) {
      if (kind !== "custom") {
        expect(SOURCE.toLowerCase()).not.toContain(kind);
      }
    }

    expect(SOURCE.toLowerCase()).not.toContain("octokit");
  });
});
