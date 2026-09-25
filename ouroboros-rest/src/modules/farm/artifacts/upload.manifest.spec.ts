import { DomainError } from "../../errors/error.envelope";
import { ARTIFACT_ERRORS } from "./upload.errors";
import { parseManifest } from "./upload.manifest";
import { MANIFEST_MAX_SKIPPED, UPLOAD_MAX_FILES } from "./upload.policy";

/** The upload manifest (#330): the agent's account of every file, held to its shape. */

const SHA = `sha256:${"a".repeat(64)}`;

/** A manifest with one file, and whatever a case changes. */
function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    files: [{ name: "junit-build3.xml", size_bytes: 20480, checksum: SHA }],
    ...overrides,
  });
}

/**
 * The refusal a manifest earns.
 *
 * @param text - The manifest.
 * @returns The error's message.
 */
function refusal(text: string): string {
  try {
    parseManifest(text);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(ARTIFACT_ERRORS.manifestInvalid);
    expect((error as DomainError).getStatus()).toBe(422);
    return (error as DomainError).message;
  }
  throw new Error("the manifest was accepted");
}

describe("a manifest", () => {
  it("reads files, truncations and skips", () => {
    const parsed = parseManifest(
      JSON.stringify({
        schema_version: 1,
        files: [
          { name: "junit-build3.xml", size_bytes: 20480, checksum: SHA },
          {
            name: "captures/rig-capture-estop.csv",
            size_bytes: 1024,
            checksum: SHA,
            truncated: {
              original_bytes: 9_856_614,
              note: "cut at 1 KiB of 9.4 MiB (per-file cap)",
            },
          },
        ],
        skipped: [
          {
            name: "logs/serial-console.log",
            size_bytes: 2048,
            reason: "job_cap",
            detail: "the job cap was reached",
          },
        ],
      }),
    );

    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[1].truncated?.original_bytes).toBe(9_856_614);
    expect(parsed.skipped[0].reason).toBe("job_cap");
  });

  it("treats a missing skipped list as empty", () => {
    expect(parseManifest(manifest()).skipped).toEqual([]);
  });

  it.each([
    ["not JSON", "{", /not JSON/],
    ["an unknown version", manifest({ schema_version: 2 }), /schema_version/],
    ["an unknown key", manifest({ extra: true }), /manifest/],
    [
      "a name outside the workspace",
      manifest({ files: [{ name: "../x", size_bytes: 1, checksum: SHA }] }),
      /relative/,
    ],
    [
      "a checksum with no algorithm",
      manifest({ files: [{ name: "a", size_bytes: 1, checksum: "a".repeat(64) }] }),
      /sha256/,
    ],
    [
      "a negative size",
      manifest({ files: [{ name: "a", size_bytes: -1, checksum: SHA }] }),
      /size_bytes/,
    ],
    [
      "a truncation that was not shorter",
      manifest({
        files: [
          {
            name: "a",
            size_bytes: 10,
            checksum: SHA,
            truncated: { original_bytes: 10, note: "n" },
          },
        ],
      }),
      /truncated/,
    ],
    [
      "a truncation with no note",
      manifest({
        files: [
          { name: "a", size_bytes: 1, checksum: SHA, truncated: { original_bytes: 2, note: " " } },
        ],
      }),
      /note/,
    ],
    [
      "a file listed twice",
      manifest({
        files: [
          { name: "a", size_bytes: 1, checksum: SHA },
          { name: "a", size_bytes: 1, checksum: SHA },
        ],
      }),
      /listed twice/,
    ],
    [
      "an unknown skip reason",
      manifest({ skipped: [{ name: "a", size_bytes: 1, reason: "felt_like_it", detail: "d" }] }),
      /reason/,
    ],
    [
      "too many files",
      manifest({
        files: Array.from({ length: UPLOAD_MAX_FILES + 1 }, (_, index) => ({
          name: `f${String(index)}`,
          size_bytes: 1,
          checksum: SHA,
        })),
      }),
      /files/,
    ],
    [
      "too many skips",
      manifest({
        skipped: Array.from({ length: MANIFEST_MAX_SKIPPED + 1 }, (_, index) => ({
          name: `f${String(index)}`,
          size_bytes: 1,
          reason: "max_files",
          detail: "d",
        })),
      }),
      /skipped/,
    ],
  ])("refuses %s, and says where", (_what, text, message) => {
    expect(refusal(text)).toMatch(message);
  });
});
