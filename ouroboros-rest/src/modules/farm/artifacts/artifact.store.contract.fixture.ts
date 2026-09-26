/**
 * The one suite every {@link ArtifactStore} driver passes, unchanged (#330).
 *
 * The acceptance criterion is that swapping the local volume for MinIO is **configuration only** —
 * so the suite is written once, against the interface, and each driver is handed to it by whatever
 * built it: `artifact.store.spec.ts` runs it against the local volume and an in-process S3 stand-in,
 * and `artifact.store.integration-spec.ts` against the store `OURO_ARTIFACT_*` configures — the
 * local volume, then a real MinIO — through the same factory the application uses.
 */

import { Readable } from "node:stream";

import {
  ArtifactNotFoundError,
  ArtifactStoreError,
  type ArtifactKey,
  type ArtifactStore,
} from "./artifact.store";

/** A body as a stream. */
function streamOf(bytes: Buffer): Readable {
  return Readable.from([bytes]);
}

/** A body of `size` bytes delivered in `pieces` chunks — how a multipart part arrives. */
function chunked(size: number, pieces: number): { bytes: Buffer; stream: Readable } {
  const bytes = Buffer.alloc(size, 0);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + 7) % 256;

  const step = Math.ceil(size / pieces);
  const parts: Buffer[] = [];
  for (let offset = 0; offset < size; offset += step)
    parts.push(bytes.subarray(offset, offset + step));

  return { bytes, stream: Readable.from(parts) };
}

/**
 * Declare the contract's cases.
 *
 * @param describeName - What the suite is called — the driver under test.
 * @param open - Builds the store; called once, before the cases.
 * @param prefix - A key prefix unique to this run, so a shared bucket is never polluted.
 */
export function describeArtifactStoreContract(
  describeName: string,
  open: () => Promise<ArtifactStore> | ArtifactStore,
  prefix: string,
): void {
  describe(describeName, () => {
    let store: ArtifactStore;
    const written: ArtifactKey[] = [];

    /** A key under this run's prefix, remembered for cleanup. */
    function key(name: string): ArtifactKey {
      const value = `${prefix}/${name}`;
      written.push(value);
      return value;
    }

    beforeAll(async () => {
      store = await open();
    });

    afterAll(async () => {
      for (const each of written) await store.delete(each);
    });

    it("names its driver as a storage_ref records it", () => {
      expect(store.driver).toMatch(/^[a-z][a-z0-9_]*$/);
    });

    it("reads back exactly the bytes it was given", async () => {
      const where = key("job/upload/junit-build3.xml");
      const bytes = Buffer.from('<testsuites><testsuite name="unit"/></testsuites>\n');

      await store.put(where, streamOf(bytes), bytes.length);

      expect(await store.get(where)).toEqual(bytes);
    });

    it("streams a multi-megabyte body in pieces", async () => {
      const where = key("job/upload/rig-capture-estop.csv");
      const { bytes, stream } = chunked(2_202_009, 37);

      await store.put(where, stream, bytes.length);

      expect((await store.get(where)).equals(bytes)).toBe(true);
    });

    it("stores an empty file", async () => {
      const where = key("job/upload/empty.log");

      await store.put(where, streamOf(Buffer.alloc(0)), 0);

      expect(await store.get(where)).toHaveLength(0);
    });

    it("keeps nested paths, spaces and non-ASCII names", async () => {
      const where = key("job/upload/build/zephyr/serial console · ü.log");
      const bytes = Buffer.from("boot ok\n");

      await store.put(where, streamOf(bytes), bytes.length);

      expect(await store.get(where)).toEqual(bytes);
    });

    it("replaces an object written again under the same key", async () => {
      const where = key("job/upload/coverage.info");

      await store.put(where, streamOf(Buffer.from("first")), 5);
      await store.put(where, streamOf(Buffer.from("second")), 6);

      expect((await store.get(where)).toString()).toBe("second");
    });

    it("refuses a body shorter than its declared size, and leaves nothing under the key", async () => {
      const where = key("job/upload/short.bin");

      await expect(store.put(where, streamOf(Buffer.from("abc")), 10)).rejects.toBeInstanceOf(
        ArtifactStoreError,
      );
      await expect(store.get(where)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    });

    it("refuses a body longer than its declared size, and leaves nothing under the key", async () => {
      const where = key("job/upload/long.bin");

      await expect(store.put(where, streamOf(Buffer.from("abcdef")), 3)).rejects.toBeInstanceOf(
        ArtifactStoreError,
      );
      await expect(store.get(where)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    });

    it("answers a missing object with ArtifactNotFoundError", async () => {
      await expect(store.get(key("job/upload/never-written.xml"))).rejects.toBeInstanceOf(
        ArtifactNotFoundError,
      );
    });

    it("deletes an object, and deleting it again is not an error", async () => {
      const where = key("job/upload/serial-console.log");
      await store.put(where, streamOf(Buffer.from("x")), 1);

      await store.delete(where);
      await store.delete(where);

      await expect(store.get(where)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    });

    it.each([
      ["a climb out of the root", "../outside.txt"],
      ["a dot segment", "job/./x.txt"],
      ["an empty segment", "job//x.txt"],
      ["a backslash", "job\\x.txt"],
      ["a control character", "job/x\u0000.txt"],
    ])("refuses %s as a key", async (_what, bad) => {
      await expect(
        store.put(`${prefix}/${bad}`, streamOf(Buffer.from("x")), 1),
      ).rejects.toBeInstanceOf(ArtifactStoreError);
      await expect(store.get(`${prefix}/${bad}`)).rejects.toBeInstanceOf(ArtifactStoreError);
    });
  });
}
