import { ALNUM, AWS_ACCESS_KEY_ID, GITHUB_PAT, filler } from "./guardrails.fixture";
import { addedLines, scanChangeSet, type ScannedFile } from "./guardrails.secrets";

/**
 * The scan: added lines only, numbered as `git diff` numbers them, and findings that are places
 * and rules — never values.
 */

describe("addedLines", () => {
  it("numbers added lines by the new file, skipping deleted ones", () => {
    expect(
      addedLines([
        {
          newStart: 10,
          lines: [
            { kind: "ctx", text: "a" }, // 10
            { kind: "del", text: "b" }, // not in the new file
            { kind: "add", text: "c" }, // 11
            { kind: "ctx", text: "d" }, // 12
            { kind: "add", text: "e" }, // 13
          ],
        },
        { newStart: 40, lines: [{ kind: "add", text: "f" }] },
      ]),
    ).toEqual([
      { line: 11, text: "c" },
      { line: 13, text: "e" },
      { line: 40, text: "f" },
    ]);
  });
});

describe("scanChangeSet", () => {
  it("finds a planted AWS key with its path, line and rule — and nothing of the key", () => {
    const scan = scanChangeSet([
      {
        path: "drivers/can/telemetry_buf.c",
        hunks: [
          {
            newStart: 212,
            lines: [
              { kind: "ctx", text: "/* telemetry */" },
              { kind: "ctx", text: "static int x;" },
              { kind: "add", text: `static const char *k = "${AWS_ACCESS_KEY_ID}";` },
            ],
          },
        ],
      },
    ]);

    expect(scan.findings).toEqual([
      { path: "drivers/can/telemetry_buf.c", line: 214, ruleId: "aws-access-key-id" },
    ]);
    expect(JSON.stringify(scan)).not.toContain(AWS_ACCESS_KEY_ID);
  });

  it("ignores a credential on a deleted or context line — the run did not introduce it", () => {
    const scan = scanChangeSet([
      {
        path: "a.c",
        hunks: [
          {
            newStart: 1,
            lines: [
              { kind: "del", text: GITHUB_PAT },
              { kind: "ctx", text: AWS_ACCESS_KEY_ID },
            ],
          },
        ],
      },
    ]);

    expect(scan.scanned).toBe(true);
    expect(scan.findings).toEqual([]);
  });

  it("reports that nothing was scanned when no file carried hunks", () => {
    expect(scanChangeSet([{ path: "a.c" }, { path: "b.c", hunks: [] }])).toEqual({
      scanned: false,
      linesScanned: 0,
      findings: [],
    });
  });

  it("orders findings by path, then line, and reports each rule once per line", () => {
    const line = (newStart: number, text: string): ScannedFile["hunks"] => [
      { newStart, lines: [{ kind: "add", text }] },
    ];
    const scan = scanChangeSet([
      { path: "b.c", hunks: line(5, `${GITHUB_PAT} ${GITHUB_PAT}`) },
      { path: "a.c", hunks: line(9, AWS_ACCESS_KEY_ID) },
      { path: "a.c", hunks: line(2, GITHUB_PAT) },
    ]);

    expect(scan.findings).toEqual([
      { path: "a.c", line: 2, ruleId: "github-pat" },
      { path: "a.c", line: 9, ruleId: "aws-access-key-id" },
      { path: "b.c", line: 5, ruleId: "github-pat" },
    ]);
  });

  it("judges a typical change-set within the 50 ms budget", () => {
    // The acceptance criterion, measured: forty files of fifty added lines of ordinary code —
    // two thousand lines, the size of a substantial pull request — with one credential in it.
    const files: ScannedFile[] = Array.from({ length: 40 }, (_unused, file) => ({
      path: `src/module${String(file)}/impl.ts`,
      hunks: [
        {
          newStart: 1,
          lines: [
            ...Array.from({ length: 50 }, (_line, index) => ({
              kind: "add" as const,
              text: `  const value${String(index)} = compute("${filler(ALNUM, 12, index)}", options.token ?? http.get(url));`,
            })),
            ...(file === 17
              ? [{ kind: "add" as const, text: `key = "${AWS_ACCESS_KEY_ID}"` }]
              : []),
          ],
        },
      ],
    }));

    scanChangeSet(files); // warm the regular expressions, as a long-running service has
    const started = performance.now();
    const scan = scanChangeSet(files);
    const elapsed = performance.now() - started;

    expect(scan.linesScanned).toBe(2001);
    expect(scan.findings.map((finding) => finding.ruleId)).toContain("aws-access-key-id");
    expect(elapsed).toBeLessThanOrEqual(50);
  });
});
