import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import type { ArtifactSettings } from "../../config/config.service";
import { ArtifactStoreError, artifactKey, isArtifactKey } from "./artifact.store";
import { describeArtifactStoreContract } from "./artifact.store.contract.fixture";
import { createArtifactStore } from "./artifact.store.factory";
import { LocalArtifactStore } from "./local.store";
import { startFakeS3, type FakeS3 } from "./s3.fake.fixture";
import { S3ArtifactStore } from "./s3.store";

/**
 * The artifact store drivers (#330, option 3-A): the one contract, passed by the local volume and
 * by the S3 driver against an in-process stand-in, plus what is particular to each. The same
 * contract against a real MinIO is `artifact.store.integration-spec.ts`.
 */

/** The settings the factory reads, at their defaults. */
const SETTINGS: ArtifactSettings = {
  store: "local",
  dir: ".artifacts",
  s3Region: "us-east-1",
  quotaBytes: 10_737_418_240,
  maxFileBytes: 67_108_864,
  maxJobBytes: 268_435_456,
  retentionDays: 30,
};

let root: string;
let fake: FakeS3;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ouro-artifacts-"));
  fake = await startFakeS3();
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await fake.close();
});

describeArtifactStoreContract(
  "the local-volume store keeps the artifact store contract",
  () => new LocalArtifactStore(root),
  "org/contract",
);

describeArtifactStoreContract(
  "the S3 store keeps the artifact store contract",
  () =>
    new S3ArtifactStore({
      endpoint: fake.endpoint,
      bucket: fake.bucket,
      ...fake.credentials,
    }),
  "org/contract",
);

describe("artifact keys", () => {
  it("are organization/job/upload/name, with the name's own directories kept", () => {
    expect(artifactKey("org-1", "job-1", "up-1", "build/zephyr/junit.xml")).toBe(
      "org-1/job-1/up-1/build/zephyr/junit.xml",
    );
  });

  it.each(["../../etc/passwd", "a/../b", "/abs", "a//b", "a\\b", ""])(
    "are never built from the name %j",
    (name) => {
      expect(() => artifactKey("org-1", "job-1", "up-1", name)).toThrow(ArtifactStoreError);
    },
  );

  it("are at most 1024 bytes", () => {
    expect(isArtifactKey(`a/${"b".repeat(200)}/${"c".repeat(200)}/${"d".repeat(200)}`)).toBe(true);
    expect(isArtifactKey(Array.from({ length: 6 }, () => "e".repeat(200)).join("/"))).toBe(false);
  });
});

describe("the local-volume store", () => {
  it("leaves no temporary file behind when a write fails", async () => {
    const store = new LocalArtifactStore(root);

    await expect(
      store.put("org/leftovers/a.bin", Readable.from([Buffer.from("abc")]), 9),
    ).rejects.toBeInstanceOf(ArtifactStoreError);

    expect(await readdir(join(root, "org", "leftovers"))).toEqual([]);
  });

  it("wraps a failing disk as an ArtifactStoreError", async () => {
    const store = new LocalArtifactStore(join(root, "missing\u0000dir"));

    await expect(
      store.put("org/x.bin", Readable.from([Buffer.from("x")]), 1),
    ).rejects.toBeInstanceOf(ArtifactStoreError);
  });
});

describe("the S3 store", () => {
  it("is refused by a service that does not trust its secret, and says so without the secret", async () => {
    const store = new S3ArtifactStore({
      endpoint: fake.endpoint,
      bucket: fake.bucket,
      ...fake.credentials,
      secretAccessKey: "not-the-secret",
    });

    const refusal = store.put("org/x.bin", Readable.from([Buffer.from("x")]), 1);

    await expect(refusal).rejects.toThrow(/HTTP 403 SignatureDoesNotMatch/);
    await expect(refusal).rejects.not.toThrow(/not-the-secret/);
  });

  it("reports whether its bucket is reachable", async () => {
    const good = new S3ArtifactStore({
      endpoint: fake.endpoint,
      bucket: fake.bucket,
      ...fake.credentials,
    });
    const wrong = new S3ArtifactStore({
      endpoint: fake.endpoint,
      bucket: "elsewhere",
      ...fake.credentials,
    });
    const down = new S3ArtifactStore({
      endpoint: "http://127.0.0.1:1",
      bucket: fake.bucket,
      ...fake.credentials,
    });

    expect(await good.reachable()).toBe(true);
    expect(await wrong.reachable()).toBe(false);
    expect(await down.reachable()).toBe(false);
  });

  it("wraps an unreachable service as an ArtifactStoreError", async () => {
    const store = new S3ArtifactStore({
      endpoint: "http://127.0.0.1:1",
      bucket: fake.bucket,
      ...fake.credentials,
    });

    await expect(store.get("org/x.bin")).rejects.toBeInstanceOf(ArtifactStoreError);
  });
});

describe("createArtifactStore", () => {
  it("builds the local volume by default", () => {
    const store = createArtifactStore(SETTINGS);

    expect(store).toBeInstanceOf(LocalArtifactStore);
    expect(store.driver).toBe("local");
  });

  it("builds the S3 driver when configuration says s3 — nothing else changes", () => {
    const store = createArtifactStore({
      ...SETTINGS,
      store: "s3",
      s3Endpoint: fake.endpoint,
      s3Bucket: fake.bucket,
      s3AccessKeyId: fake.credentials.accessKeyId,
      s3SecretAccessKey: fake.credentials.secretAccessKey,
    });

    expect(store).toBeInstanceOf(S3ArtifactStore);
    expect(store.driver).toBe("s3");
  });

  it("refuses s3 without its settings", () => {
    expect(() => createArtifactStore({ ...SETTINGS, store: "s3" })).toThrow(/incomplete/);
  });
});
