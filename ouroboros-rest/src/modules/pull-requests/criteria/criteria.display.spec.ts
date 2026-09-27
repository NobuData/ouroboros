import {
  MAX_DISPLAY_TEXT,
  analysisNoteLine,
  artifactLine,
  hunkLine,
  measurementLine,
  testCaseLine,
} from "./criteria.display";

/**
 * The composed evidence lines (#359, decision V6) — mockup 12's matrix, line for line where the
 * mockup prints one, and the edge of every rule.
 */
describe("the composed evidence lines", () => {
  it("renders the mockup's four evidence lines from their rows", () => {
    expect(
      testCaseLine(
        { name: "test_frame_order_under_load", status: "passed" },
        "10⁶ frames, 0 reordered",
      ),
    ).toBe("test_frame_order_under_load (10⁶ frames, 0 reordered)");
    expect(
      measurementLine(
        {
          metric: "overshoot_pct",
          value: "1.7",
          unit: "%",
          limit_value: "2",
          limit_kind: "max",
          context: "was 2.4% in build 3",
        },
        null,
      ),
    ).toBe("HIL overshoot 1.7% vs 2.0% limit (was 2.4% in build 3)");
    expect(
      hunkLine({ path: "drivers/can/telemetry_buf.c", lineStart: 41, lineEnd: 66 }, null),
    ).toBe("hunk telemetry_buf.c:41–66");
    expect(analysisNoteLine("static K_MSGQ_DEFINE · stack analysis clean")).toBe(
      "static K_MSGQ_DEFINE · stack analysis clean",
    );
  });

  it("says a case did not pass rather than letting its name read as a pass", () => {
    expect(testCaseLine({ name: "boot_ok", status: "flaky" }, null)).toBe("boot_ok · flaky");
    expect(testCaseLine({ name: "boot_ok", status: "failed" }, " ")).toBe("boot_ok · failed");
  });

  it("prints units as the gates card does, and names a floor as a minimum", () => {
    expect(
      measurementLine(
        {
          metric: "recovered_boots",
          value: "3",
          unit: "count",
          limit_value: "3",
          limit_kind: "min",
          context: null,
        },
        "slot-B fallback",
      ),
    ).toBe("HIL recovered boots 3 vs 3 minimum (slot-B fallback)");
    expect(
      measurementLine(
        {
          metric: "reboot_ms",
          value: "412",
          unit: "ms",
          limit_value: "500.5",
          limit_kind: "max",
          context: null,
        },
        null,
      ),
    ).toBe("HIL reboot ms 412.0 ms vs 500.5 ms limit");
  });

  it("prints a one-line hunk as one line, and a path with no directory as itself", () => {
    expect(hunkLine({ path: "main.c", lineStart: 7, lineEnd: 7 }, null)).toBe("hunk main.c:7");
  });

  it("names an artifact and carries its qualifier", () => {
    expect(artifactLine("rig-trace.pcap", "frames 1–10⁶")).toBe(
      "artifact rig-trace.pcap (frames 1–10⁶)",
    );
  });

  it("cuts an over-long line to V057's 512 with an ellipsis rather than refusing it", () => {
    const line = testCaseLine({ name: "t".repeat(600), status: "passed" }, null);

    expect(line).toHaveLength(MAX_DISPLAY_TEXT);
    expect(line.endsWith("…")).toBe(true);
  });
});
