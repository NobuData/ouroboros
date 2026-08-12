import { describe, expect, it } from "vitest";

import { cx } from "@/app/ui";

/**
 * The one function every primitive composes its class list with.
 *
 * It is three lines, and it is tested because all eight primitives depend on the same two
 * behaviours: a condition that produced nothing contributes nothing, and a class list with
 * no parts is `""` rather than `undefined` — which React renders as no attribute at all
 * instead of as `class="undefined"`.
 */

describe("cx", () => {
  it("joins the names it was given, in order", () => {
    expect(cx("ou-btn", "ou-btn--primary")).toBe("ou-btn ou-btn--primary");
  });

  it("drops what a condition did not produce", () => {
    expect(cx("ou-btn", false, null, undefined, "ou-btn--block")).toBe(
      "ou-btn ou-btn--block",
    );
  });

  it("drops an empty string, which is what a default modifier looks like", () => {
    // Every tone map in these primitives spells the default as `""`, so this is the case
    // that keeps `class="ou-btn "` off every unmodified button in the product.
    expect(cx("ou-btn", "", "ou-btn--sm")).toBe("ou-btn ou-btn--sm");
  });

  it("is an empty string when there is nothing to join", () => {
    expect(cx(false, undefined)).toBe("");
  });
});
