import { describe, expect, it } from "vitest";

import {
  ENGINE_NOT_ASKED_NOTE,
  PUBLISH_UNPARSED_MESSAGE,
  VALIDATED_MESSAGE,
  VALIDATE_CONFLICT_MESSAGE,
  VALIDATE_ENGINE_UNAVAILABLE_MESSAGE,
  VALIDATE_UNPARSED_MESSAGE,
  VALIDATE_UNSAVED_MESSAGE,
  latestVersion,
  unpublishable,
  unvalidatable,
  validateRefusal,
  validationNotice,
} from "@/app/workflows/code/code-flows";
import { PUBLISH_CONFLICT_MESSAGE, UNSAVED_MESSAGE } from "@/app/workflows/publish";

import { codeValidation } from "../../helpers/workflow-code";

/**
 * The code view's Validate and Publish decisions (V.6, #174): what each answer says, that **Validate never
 * reports publishing**, that a check that could not run is never called green, and that neither flow acts on
 * a draft older than the text on the screen. The flows drawn and driven are `code-flows-flow.test.tsx`'s.
 */

const ENGINE_FINDING = {
  source: "engine" as const,
  code: "loop.unbounded",
  message: "The engine will not run this stage.",
  node: "issue-queued",
};

describe("what a validation says", () => {
  it("is green in words when the gate found nothing", () => {
    expect(validationNotice(codeValidation())).toEqual({ tone: "ok", text: VALIDATED_MESSAGE });
  });

  it("counts the findings, says where they are drawn, and that nothing was published", () => {
    expect(validationNotice(codeValidation({ findings: [ENGINE_FINDING] }))).toEqual({
      tone: "err",
      text: "Validation found 1 finding — marked in the file and counted in Loop Checks. Nothing was published.",
    });
    expect(validationNotice(codeValidation({ findings: [ENGINE_FINDING, ENGINE_FINDING] })).text).toMatch(
      /^Validation found 2 findings —/,
    );
  });

  it("says the engine was not asked when an earlier stage refused first", () => {
    const notice = validationNotice(codeValidation({ findings: [ENGINE_FINDING], engineConsulted: false }));

    expect(notice.text).toContain(ENGINE_NOT_ASKED_NOTE);
  });

  it("never reports a publish, whatever the verdict", () => {
    for (const validation of [codeValidation(), codeValidation({ findings: [ENGINE_FINDING] })]) {
      expect(validationNotice(validation).text).toContain("Nothing was published.");
    }
  });
});

describe("a refused validation", () => {
  it("says the engine could not check it, rather than green", () => {
    expect(validateRefusal({ code: "engine_unavailable", message: "The engine is down.", details: {} })).toBe(
      VALIDATE_ENGINE_UNAVAILABLE_MESSAGE,
    );
  });

  it("says the service's own sentence for anything else", () => {
    expect(validateRefusal({ code: "workflow_not_found", message: "No such workflow.", details: {} })).toBe(
      "No such workflow.",
    );
  });
});

describe("a flow stopped by the save loop", () => {
  it.each([
    ["invalid", VALIDATE_UNPARSED_MESSAGE, PUBLISH_UNPARSED_MESSAGE],
    ["conflict", VALIDATE_CONFLICT_MESSAGE, PUBLISH_CONFLICT_MESSAGE],
    ["failed", VALIDATE_UNSAVED_MESSAGE, UNSAVED_MESSAGE],
  ] as const)("stops both flows when the save is %s", (state, validate, publish) => {
    expect(unvalidatable(state)).toBe(validate);
    expect(unpublishable(state)).toBe(publish);
  });

  it.each(["idle", "saved", "pending", "saving"] as const)("lets both flows go on when the save is %s", (state) => {
    expect(unvalidatable(state)).toBeNull();
    expect(unpublishable(state)).toBeNull();
  });
});

describe("the version in force", () => {
  it("is the read's until a publish from this page moves it", () => {
    expect(latestVersion(14, null)).toBe(14);
    expect(latestVersion(null, null)).toBeNull();
    expect(latestVersion(null, 1)).toBe(1);
    expect(latestVersion(14, 15)).toBe(15);
  });

  it("never goes back when a refreshed read catches up, or has moved further", () => {
    expect(latestVersion(15, 15)).toBe(15);
    expect(latestVersion(16, 15)).toBe(16);
  });
});
