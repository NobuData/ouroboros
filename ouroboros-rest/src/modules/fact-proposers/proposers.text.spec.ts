import {
  MAX_CANDIDATE_LENGTH,
  codeSpansOf,
  extractLeadInstruction,
  splitCodeSpans,
} from "./proposers.text";

/**
 * BF.3's text rule (#412): the lead instruction of a note, reason or steer — with every
 * inline-code span carried byte for byte, because `K_NO_WAIT` and `k_msgq` are the technically
 * load-bearing part of a fact.
 */

/**
 * @param raw - A source's text.
 * @returns The extracted candidate, failing the test when there is none.
 */
function lead(raw: string): string {
  const extraction = extractLeadInstruction(raw);

  if (!extraction.ok) throw new Error(`expected a candidate, got ${extraction.refusal}`);
  return extraction.text;
}

describe("splitting inline-code spans", () => {
  it("splits prose from spans and loses nothing", () => {
    const text = "Prefer `k_msgq` over ``k_fifo`s`` here";
    const segments = splitCodeSpans(text);

    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(codeSpansOf(text)).toEqual(["`k_msgq`", "``k_fifo`s``"]);
  });

  it("reads an unclosed backtick as prose", () => {
    expect(codeSpansOf("a stray ` backtick")).toEqual([]);
  });
});

describe("lead-instruction extraction", () => {
  it("promotes the seeded note's first sentence — the mockup's awaiting-review fact", () => {
    expect(
      lead(
        "Team prefers `k_msgq` over `k_fifo` in ISR paths. Keep the `k_msgq`, but move PID " +
          "sampling out of the ISR.",
      ),
    ).toBe("Team prefers `k_msgq` over `k_fifo` in ISR paths");
  });

  it("keeps every inline-code span verbatim — case, spacing and dots inside it", () => {
    const text = lead("please  use   `K_NO_WAIT.  Then   yield`   in the   ISR. Anything else.");

    expect(text).toBe("Use `K_NO_WAIT.  Then   yield` in the ISR");
    expect(codeSpansOf(text)).toEqual(["`K_NO_WAIT.  Then   yield`"]);
  });

  it("never breaks a sentence inside a code span", () => {
    expect(lead("Call `settings.load()` before `main.run()` starts. Then more.")).toBe(
      "Call `settings.load()` before `main.run()` starts",
    );
  });

  it("strips conversational filler down to the imperative", () => {
    expect(lead("Note: please always run `west update` before the first build")).toBe(
      "Always run `west update` before the first build",
    );
    expect(lead("We should keep ISR handlers under 20 µs")).toBe("Keep ISR handlers under 20 µs");
    expect(lead("Remember to claim the rig with `rig claim`.")).toBe(
      "Claim the rig with `rig claim`",
    );
    expect(lead("- Going forward, pin zephyr to 4.1")).toBe("Pin zephyr to 4.1");
  });

  it("does not break on a common abbreviation's dot", () => {
    expect(lead("Prefer static pools, e.g. `K_MEM_SLAB_DEFINE`, in drivers. Not heap.")).toBe(
      "Prefer static pools, e.g. `K_MEM_SLAB_DEFINE`, in drivers",
    );
  });

  it("ends the lead at a semicolon or a line break", () => {
    expect(lead("Rig 2's chamber is out for calibration; cases are red until it returns")).toBe(
      "Rig 2's chamber is out for calibration",
    );
    expect(lead("Keep PID gains in config\nand not in headers")).toBe("Keep PID gains in config");
  });

  it("leaves a lead that starts with a code span uncapitalised", () => {
    expect(lead("`west update` must run before the first build.")).toBe(
      "`west update` must run before the first build",
    );
  });

  it("keeps a trailing code span's own punctuation", () => {
    expect(lead("Always end with `k_yield();`")).toBe("Always end with `k_yield();`");
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["Please.", "empty"],
    ["Fix", "too_short"],
    [`Keep ${"x".repeat(MAX_CANDIDATE_LENGTH)}`, "too_long"],
  ])("refuses %j as %s", (raw, refusal) => {
    expect(extractLeadInstruction(raw)).toEqual({ ok: false, refusal });
  });

  it("is deterministic — the same text, the same answer", () => {
    const note = "Note: keep `k_msgq`. And more.";

    expect(extractLeadInstruction(note)).toEqual(extractLeadInstruction(note));
  });
});
