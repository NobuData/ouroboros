/**
 * Which {@link ArtifactStore} this process writes through — decided by configuration alone (#330).
 *
 * ```
 * OURO_ARTIFACT_STORE=local  ─▶ LocalArtifactStore(OURO_ARTIFACT_DIR)
 * OURO_ARTIFACT_STORE=s3     ─▶ S3ArtifactStore(OURO_ARTIFACT_S3_*)
 * ```
 */

import type { ArtifactSettings } from "../../config/config.service";
import type { ArtifactStore } from "./artifact.store";
import { LocalArtifactStore } from "./local.store";
import { S3ArtifactStore } from "./s3.store";

/** The injection token for the process's store. */
export const ARTIFACT_STORE = Symbol("ARTIFACT_STORE");

/**
 * Build the configured store.
 *
 * @param settings - `AppConfigService.artifacts`.
 * @returns The driver the settings name.
 * @throws {Error} If `s3` is chosen without its settings — which configuration already refuses at
 *   boot, so reaching this is a programming error.
 */
export function createArtifactStore(settings: ArtifactSettings): ArtifactStore {
  if (settings.store === "local") return new LocalArtifactStore(settings.dir);

  const { s3Endpoint, s3Bucket, s3AccessKeyId, s3SecretAccessKey } = settings;
  if (!s3Endpoint || !s3Bucket || !s3AccessKeyId || !s3SecretAccessKey) {
    throw new Error("OURO_ARTIFACT_STORE is s3, but the S3 settings are incomplete");
  }

  return new S3ArtifactStore({
    endpoint: s3Endpoint,
    bucket: s3Bucket,
    region: settings.s3Region,
    accessKeyId: s3AccessKeyId,
    secretAccessKey: s3SecretAccessKey,
  });
}
