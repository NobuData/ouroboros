/**
 * The upload manifest — the agent's account of everything it collected (#330).
 *
 * The first part of every upload. It lists each file it sends, with its size and the checksum the
 * agent computed locally, and each file it did **not** send, with the reason — a file cut to the
 * per-file cap is sent and marked truncated, a file past the per-job cap is listed as skipped. So
 * nothing a glob matched disappears without the page being able to say so.
 *
 * ```json
 * {
 *   "schema_version": 1,
 *   "files": [
 *     { "name": "junit-build3.xml", "size_bytes": 20480, "checksum": "sha256:…" },
 *     { "name": "captures/rig-capture-estop.csv", "size_bytes": 67108864, "checksum": "sha256:…",
 *       "truncated": { "original_bytes": 98566144, "note": "cut at 64 MiB of 94 MiB (per-file cap)" } }
 *   ],
 *   "skipped": [
 *     { "name": "logs/serial-console.log", "size_bytes": 1048576, "reason": "job_cap",
 *       "detail": "the job's 256 MiB upload cap was reached" }
 *   ]
 * }
 * ```
 *
 * What the service stores is the **receipt** built from it (`build_job_artifact_uploads.manifest`):
 * one entry per file, `stored`, `truncated` or `skipped`, with the server's own skips — the
 * workspace quota — beside the agent's.
 */

import { z } from "zod";

import { manifestInvalid } from "./upload.errors";
import { isArtifactName, MANIFEST_MAX_SKIPPED, UPLOAD_MAX_FILES } from "./upload.policy";

/** The manifest versions this build reads. */
export const MANIFEST_SCHEMA_VERSION = 1;

/** Why the agent did not send a file. */
export const AGENT_SKIP_REASONS = [
  "job_cap",
  "max_files",
  "unreadable",
  "not_regular_file",
  "outside_workspace",
] as const;

/** Why the service did not keep a file the agent sent. */
export const SERVICE_SKIP_REASONS = ["quota"] as const;

/** Every reason a receipt can give for a skipped file. */
export type SkipReason =
  (typeof AGENT_SKIP_REASONS)[number] | (typeof SERVICE_SKIP_REASONS)[number];

const name = z.string().refine(isArtifactName, "is not a relative artifact path");
const bytes = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const note = z.string().trim().min(1).max(500);

const manifestSchema = z
  .object({
    schema_version: z.literal(MANIFEST_SCHEMA_VERSION),
    files: z
      .array(
        z
          .object({
            name,
            size_bytes: bytes,
            checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/, "is not sha256:<64 hex>"),
            truncated: z.object({ original_bytes: bytes, note }).strict().optional(),
          })
          .strict()
          .refine(
            (file) =>
              file.truncated === undefined || file.truncated.original_bytes > file.size_bytes,
            "a truncated file was longer than what was sent",
          ),
      )
      .max(UPLOAD_MAX_FILES),
    skipped: z
      .array(
        z
          .object({
            name,
            size_bytes: bytes,
            reason: z.enum(AGENT_SKIP_REASONS),
            detail: note,
          })
          .strict(),
      )
      .max(MANIFEST_MAX_SKIPPED)
      .default([]),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const file of manifest.files) {
      if (seen.has(file.name)) {
        context.addIssue({ code: "custom", message: `${file.name} is listed twice` });
      }
      seen.add(file.name);
    }
  });

/** A validated manifest. */
export type UploadManifest = z.infer<typeof manifestSchema>;

/** One file the manifest says is sent. */
export type ManifestFile = UploadManifest["files"][number];

/**
 * Read the manifest part.
 *
 * @param text - The part's value.
 * @returns The manifest.
 * @throws {InvalidRequestError} `farm_artifact_manifest_invalid`, naming the first problem.
 */
export function parseManifest(text: string): UploadManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw manifestInvalid("the manifest part is not JSON.");
  }

  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length === 0 ? "the manifest" : issue.path.join(".");
    throw manifestInvalid(`${where}: ${issue.message}.`);
  }

  return result.data;
}

/** One line of a receipt — `build_job_artifact_uploads.manifest`. */
export interface ReceiptEntry {
  readonly name: string;
  readonly status: "stored" | "truncated" | "skipped";
  /** Bytes stored, or for a skipped file the size the agent reported. */
  readonly size_bytes: number;
  /** Present on a stored or truncated file. */
  readonly kind?: string;
  readonly checksum?: string;
  /** The `test_artifacts` row. */
  readonly artifact_id?: string;
  /** Why a file was skipped. */
  readonly reason?: SkipReason;
  /** The agent's sentence — how a file was truncated, or why it was skipped. */
  readonly note?: string;
}

/** A job warning — `build_job_artifact_uploads.warnings`, and what the page says. */
export interface UploadWarning {
  readonly code: "artifact_quota_exceeded" | "artifact_truncated" | "artifact_skipped";
  readonly file: string;
  readonly message: string;
}
