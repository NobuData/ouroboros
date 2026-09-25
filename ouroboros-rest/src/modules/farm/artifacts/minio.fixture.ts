/**
 * A throwaway MinIO for the integration suites (#330) — the S3-compatible store the artifact
 * driver swap is proven against.
 *
 * **The image is `pgsty/minio`**, the community-maintained build of MinIO's AGPL server: MinIO Inc.
 * stopped publishing `minio/minio` to public registries, and a suite that cannot pull its image is
 * a suite that silently stops running. Pinned to a release, like `POSTGRES_IMAGE`, so a new MinIO
 * cannot change what a green run means. `docker-compose.yml`'s optional `minio` profile runs the
 * same image.
 */

import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

import { EMPTY_PAYLOAD_SHA256, signRequest } from "./sigv4";

/** The pinned MinIO image. */
export const MINIO_IMAGE = "pgsty/minio:RELEASE.2026-08-04T00-00-00Z";

/** The port MinIO's S3 API listens on inside the container. */
const MINIO_PORT = 9000;

/** A running MinIO, with one bucket made. */
export interface StartedMinio {
  /** `http://<host>:<mapped port>`. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  /** Stop and remove the container. */
  stop(): Promise<void>;
}

/**
 * Start MinIO and make a bucket in it.
 *
 * @param bucket - The bucket to make.
 * @returns It, ready.
 */
export async function startMinio(bucket = "ouroboros-artifacts"): Promise<StartedMinio> {
  const accessKeyId = "ouroboros";
  const secretAccessKey = "ouroboros-integration-secret";
  const region = "us-east-1";

  const container = await startWithRetry(() =>
    new GenericContainer(MINIO_IMAGE)
      .withEnvironment({ MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey })
      .withCommand(["server", "/data"])
      .withExposedPorts(MINIO_PORT)
      .withWaitStrategy(Wait.forHttp("/minio/health/ready", MINIO_PORT))
      .start(),
  );

  const endpoint = `http://${container.getHost()}:${String(container.getMappedPort(MINIO_PORT))}`;
  await createBucket(endpoint, bucket, { accessKeyId, secretAccessKey, region });

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    stop: async () => {
      await container.stop();
    },
  };
}

/** How many times a container start that lost a port race is tried. */
const START_ATTEMPTS = 3;

/**
 * Start a container, again if Docker lost a race for its host port.
 *
 * Rootless Docker allocates a published port through its own port manager, and when several
 * suites start containers at once two can be handed the same free port — the second start fails
 * `bind: address already in use` though nothing is wrong with it. That one failure is retried; any
 * other is not.
 *
 * @param start - Starts the container.
 * @returns The started container.
 * @throws The last failure, after {@link START_ATTEMPTS}, or at once for any other failure.
 */
async function startWithRetry(
  start: () => Promise<StartedTestContainer>,
): Promise<StartedTestContainer> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await start();
    } catch (error) {
      if (attempt >= START_ATTEMPTS || !String(error).includes("address already in use"))
        throw error;
    }
  }
}

/**
 * S3's CreateBucket — a signed `PUT /<bucket>` with no body. The driver itself never makes a
 * bucket: a deployment provisions its own, and a store that created buckets on demand would turn a
 * typo in `OURO_ARTIFACT_S3_BUCKET` into a new, empty bucket.
 *
 * @param endpoint - The origin.
 * @param bucket - The bucket.
 * @param credentials - Who signs.
 * @returns When it exists.
 * @throws {Error} If MinIO refuses.
 */
async function createBucket(
  endpoint: string,
  bucket: string,
  credentials: { accessKeyId: string; secretAccessKey: string; region: string },
): Promise<void> {
  const url = new URL(`/${bucket}`, endpoint);
  const headers = signRequest(
    { method: "PUT", host: url.host, path: url.pathname, payloadHash: EMPTY_PAYLOAD_SHA256 },
    credentials,
    new Date(),
  );
  const { host: _host, ...sent } = headers;

  const response = await fetch(url, { method: "PUT", headers: sent });
  if (!response.ok) {
    throw new Error(`MinIO refused to create ${bucket}: HTTP ${String(response.status)}`);
  }
}
