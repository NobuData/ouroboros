/**
 * Upload bodies for the artifact upload's suites (#330) — the multipart an agent sends, built by
 * hand so a case can corrupt exactly one thing: a byte, a checksum, a size, a part's name or order.
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FILE_FIELD, MANIFEST_FIELD } from "./upload.receiver";

/** AT.1's fixtures directory — real reports, so a parse in these suites reads what an emitter wrote. */
export const RESULT_FIXTURES = join(__dirname, "..", "..", "test-results", "fixtures");

/**
 * One of AT.1's fixture reports.
 *
 * @param name - Its file name under `test-results/fixtures`.
 * @returns Its bytes.
 */
export function resultFixture(name: string): Buffer {
  return readFileSync(join(RESULT_FIXTURES, name));
}

/** A file the fixture agent collected. */
export interface FixtureFile {
  /** Its manifest name. */
  readonly name: string;
  readonly bytes: Buffer;
  /** Set when the agent cut it to the per-file cap. */
  readonly truncated?: { readonly original_bytes: number; readonly note: string };
}

/** A file the fixture agent left behind. */
export interface FixtureSkip {
  readonly name: string;
  readonly size_bytes: number;
  readonly reason: string;
  readonly detail: string;
}

/**
 * `sha256:<hex>` of some bytes.
 *
 * @param bytes - The bytes.
 * @returns The checksum as a manifest declares it.
 */
export function checksumOf(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * The manifest an honest agent writes for these files.
 *
 * @param files - What it sends.
 * @param skipped - What it left behind.
 * @returns The manifest document.
 */
export function manifestOf(files: readonly FixtureFile[], skipped: readonly FixtureSkip[] = []) {
  return {
    schema_version: 1,
    files: files.map((file) => ({
      name: file.name,
      size_bytes: file.bytes.length,
      checksum: checksumOf(file.bytes),
      ...(file.truncated ? { truncated: file.truncated } : {}),
    })),
    skipped,
  };
}

/** One multipart part. */
export type Part =
  | { readonly field: string; readonly value: string }
  | { readonly field: string; readonly filename: string; readonly bytes: Buffer };

/** A multipart body and the header that frames it. */
export interface MultipartBody {
  readonly contentType: string;
  readonly body: Buffer;
}

/**
 * Frame parts as `multipart/form-data`.
 *
 * @param parts - The parts, in order.
 * @returns The body and its `Content-Type`.
 */
export function multipart(parts: readonly Part[]): MultipartBody {
  const boundary = `ouro-${randomBytes(12).toString("hex")}`;
  const chunks: Buffer[] = [];

  for (const part of parts) {
    const disposition =
      "filename" in part
        ? `form-data; name="${part.field}"; filename="${part.filename}"`
        : `form-data; name="${part.field}"`;
    const type = "filename" in part ? "application/octet-stream" : "application/json";
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      "filename" in part ? part.bytes : Buffer.from(part.value),
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) };
}

/**
 * The body an honest agent sends: the manifest, then every file it lists.
 *
 * @param files - What it sends.
 * @param skipped - What it left behind.
 * @param manifest - A manifest to send instead of the honest one — for a case that lies.
 * @returns The body.
 */
export function uploadBody(
  files: readonly FixtureFile[],
  skipped: readonly FixtureSkip[] = [],
  manifest: unknown = manifestOf(files, skipped),
): MultipartBody {
  return multipart([
    { field: MANIFEST_FIELD, value: JSON.stringify(manifest) },
    ...files.map((file) => ({ field: FILE_FIELD, filename: file.name, bytes: file.bytes })),
  ]);
}

/** Mockup 11's artifacts card, as an agent would collect it for Build 3. */
export function mockupFiles(): FixtureFile[] {
  return [
    { name: "junit-build3.xml", bytes: resultFixture("twister-reruns.xml") },
    { name: "coverage/lcov.info", bytes: resultFixture("lcov.info") },
    {
      name: "rig-capture-estop.csv",
      bytes: Buffer.from("t_ms,torque_nm,velocity\n0,2.0,0\n10,2.1,0.4\n"),
    },
    {
      name: "serial-console.log",
      bytes: Buffer.from("*** Booting Zephyr OS ***\nestop released\n"),
    },
  ];
}
