import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppConfigService } from "../../config/config.service";
import { testConfiguration } from "../../config/configuration.fixture";
import type { ArtifactStore } from "./artifact.store";
import { describeArtifactStoreContract } from "./artifact.store.contract.fixture";
import { createArtifactStore } from "./artifact.store.factory";
import { startMinio, type StartedMinio } from "./minio.fixture";

/**
 * **The local → MinIO driver swap passes the same suite unchanged, via configuration only**
 * ([#330](https://github.com/NobuData/ouroboros/issues/330)'s acceptance criterion, option 3-A).
 *
 * One contract (`artifact.store.contract.fixture.ts`), declared twice. Each store is built the way
 * the application builds its own — environment variables through `loadConfiguration`, then
 * `AppConfigService.artifacts`, then `createArtifactStore` — so the only difference between the two
 * runs is the `OURO_ARTIFACT_*` set, and the second run talks to a real MinIO over the network.
 *
 * ```bash
 * yarn test:integration src/modules/farm/artifacts/artifact.store.integration-spec.ts
 * ```
 */

/**
 * The store a deployment with this environment would write through.
 *
 * @param environment - The `OURO_ARTIFACT_*` variables.
 * @returns The configured store.
 */
function configuredStore(environment: NodeJS.ProcessEnv): ArtifactStore {
  const configuration = testConfiguration(environment);
  const config = new AppConfigService({
    getOrThrow: (key: string) => configuration[key as keyof typeof configuration],
    get: (key: string) => configuration[key as keyof typeof configuration],
  } as never);

  return createArtifactStore(config.artifacts);
}

let volume: string;
let minio: StartedMinio;

beforeAll(async () => {
  volume = await mkdtemp(join(tmpdir(), "ouro-artifact-volume-"));
  minio = await startMinio();
}, 180_000);

afterAll(async () => {
  await rm(volume, { recursive: true, force: true });
  // Undefined when the start failed — the failure the suite already reports.
  await (minio as StartedMinio | undefined)?.stop();
});

describeArtifactStoreContract(
  "the artifact store configured as OURO_ARTIFACT_STORE=local",
  () => configuredStore({ OURO_ARTIFACT_STORE: "local", OURO_ARTIFACT_DIR: volume }),
  "org-contract/local",
);

describeArtifactStoreContract(
  "the same artifact store configured as OURO_ARTIFACT_STORE=s3, against MinIO",
  () =>
    configuredStore({
      OURO_ARTIFACT_STORE: "s3",
      OURO_ARTIFACT_S3_ENDPOINT: minio.endpoint,
      OURO_ARTIFACT_S3_BUCKET: minio.bucket,
      OURO_ARTIFACT_S3_REGION: minio.region,
      OURO_ARTIFACT_S3_ACCESS_KEY_ID: minio.accessKeyId,
      OURO_ARTIFACT_S3_SECRET_ACCESS_KEY: minio.secretAccessKey,
    }),
  "org-contract/s3",
);
