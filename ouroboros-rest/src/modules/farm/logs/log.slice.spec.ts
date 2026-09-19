import { characterBoundary, cutPage, type StoredChunk } from "./log.slice";

/**
 * Cutting pages (#253): successive pages concatenate to exactly the stored bytes, end on a
 * character boundary, and carry each elision marker once.
 */

/**
 * Split some bytes into stored chunks of the given sizes, as the cap trigger would place them.
 *
 * @param bytes - The whole stream.
 * @param sizes - Each chunk's size; the last one takes the rest.
 * @param elisions - Marker data by chunk index.
 * @returns The chunks.
 */
function store(
  bytes: Buffer,
  sizes: number[],
  elisions: Record<number, { elidedBytes?: number; missingChunks?: number }> = {},
): StoredChunk[] {
  const chunks: StoredChunk[] = [];
  let at = 0;
  sizes.forEach((size, index) => {
    const end = index === sizes.length - 1 ? bytes.length : at + size;
    chunks.push({
      byteStart: at,
      content: bytes.subarray(at, end),
      elidedBytes: elisions[index]?.elidedBytes ?? 0,
      missingChunks: elisions[index]?.missingChunks ?? 0,
    });
    at = end;
  });
  return chunks;
}

/**
 * Read a whole stream a page at a time, as a poller does.
 *
 * @param chunks - The stored chunks.
 * @param maxBytes - The page size.
 * @param live - Whether the job is still running.
 * @returns The concatenated text, every marker seen, and how many pages it took.
 */
function readAll(chunks: StoredChunk[], maxBytes: number, live: boolean) {
  const end = chunks.reduce((sum, c) => sum + c.content.length, 0);
  let offset = 0;
  let text = "";
  const markers: number[] = [];
  let pages = 0;

  while (pages < 10_000) {
    const page = cutPage({ chunks, offset, maxBytes, end, live });
    text += page.text;
    markers.push(...page.elisions.map((e) => e.offset));
    pages += 1;
    if (page.nextOffset === offset) break;
    offset = page.nextOffset;
  }

  return { text, markers, offset, pages };
}

describe("a page of a build log", () => {
  const ascii = Buffer.from("$ west build -b helios_mainboard app\n[6/7] Linking zephyr.elf …\n");

  it("returns everything after the offset, and where to ask next", () => {
    const chunks = store(ascii, [10, 20, 30]);

    const page = cutPage({ chunks, offset: 5, maxBytes: 1_000, end: ascii.length, live: true });

    expect(page.text).toBe(ascii.subarray(5).toString("utf8"));
    expect(page.nextOffset).toBe(ascii.length);
  });

  it("answers an empty page at the end, pointing at the same offset", () => {
    const chunks = store(ascii, [10]);

    const page = cutPage({
      chunks,
      offset: ascii.length,
      maxBytes: 1_000,
      end: ascii.length,
      live: true,
    });

    expect(page).toEqual({ text: "", nextOffset: ascii.length, elisions: [] });
  });

  it.each([1, 2, 3, 7, 16, 64, 4096])(
    "concatenates to exactly the stored log, paged %i bytes at a time — nothing skipped, nothing repeated",
    (maxBytes) => {
      const text = "héllo — wörld ✓ 𝄞 build ok\n".repeat(40);
      const bytes = Buffer.from(text, "utf8");
      const chunks = store(bytes, [3, 5, 7, 11, 13, 17, 19, 23, 29]);

      const read = readAll(chunks, maxBytes, false);

      expect(read.text).toBe(text);
      expect(read.offset).toBe(bytes.length);
    },
  );

  it("never splits a character between pages, even when a chunk boundary does", () => {
    // "é" is two bytes, and the chunk boundary falls between them.
    const bytes = Buffer.from("café au lait", "utf8");
    const split = bytes.indexOf(0xc3) + 1;
    const chunks = store(bytes, [split]);

    const live = cutPage({
      chunks: [chunks[0]],
      offset: 0,
      maxBytes: 1_000,
      end: split,
      live: true,
    });

    expect(live.text).toBe("caf");
    expect(live.nextOffset).toBe(split - 1);

    const next = cutPage({
      chunks,
      offset: live.nextOffset,
      maxBytes: 1_000,
      end: bytes.length,
      live: true,
    });
    expect(live.text + next.text).toBe("café au lait");
  });

  it("gives up a partial character only at the end of a finished log", () => {
    const bytes = Buffer.from([0x6f, 0x6b, 0xe2, 0x9c]); // "ok" and the first two bytes of "✓"
    const chunks = store(bytes, [4]);

    const running = cutPage({ chunks, offset: 0, maxBytes: 1_000, end: 4, live: true });
    const finished = cutPage({ chunks, offset: 0, maxBytes: 1_000, end: 4, live: false });

    expect(running).toMatchObject({ text: "ok", nextOffset: 2 });
    expect(finished).toMatchObject({ text: "ok�", nextOffset: 4 });
  });

  it("reads bytes that were never UTF-8 as replacement marks, each counted once", () => {
    const bytes = Buffer.from([0x61, 0x80, 0x62, 0xff, 0x63]);
    const chunks = store(bytes, [5]);

    const page = cutPage({ chunks, offset: 0, maxBytes: 1_000, end: 5, live: true });

    expect(page).toMatchObject({ text: "a�b�c", nextOffset: 5 });
  });

  it("places each elision marker once, with the page whose range holds it", () => {
    const chunks = store(ascii, [10, 20, 30], {
      1: { elidedBytes: 4096 },
      2: { missingChunks: 2 },
    });

    const first = cutPage({ chunks, offset: 0, maxBytes: 10, end: ascii.length, live: true });
    const second = cutPage({
      chunks,
      offset: first.nextOffset,
      maxBytes: 20,
      end: ascii.length,
      live: true,
    });
    const third = cutPage({
      chunks,
      offset: second.nextOffset,
      maxBytes: 1_000,
      end: ascii.length,
      live: true,
    });

    expect(first.elisions).toEqual([]);
    expect(second.elisions).toEqual([{ offset: 10, bytes: 4096, missingChunks: 0 }]);
    expect(third.elisions).toEqual([{ offset: 30, bytes: 0, missingChunks: 2 }]);
  });

  it("gives a paging reader every marker exactly once", () => {
    const chunks = store(ascii, [5, 5, 5, 5, 5, 5], {
      0: { elidedBytes: 1 },
      2: { elidedBytes: 2 },
      5: { missingChunks: 1 },
    });

    expect(readAll(chunks, 3, false).markers).toEqual([0, 10, 25]);
  });

  it("sends a character wider than the whole page whole, so a reader always moves forward", () => {
    const bytes = Buffer.from("𝄞x", "utf8");
    const chunks = store(bytes, [5]);

    const page = cutPage({ chunks, offset: 0, maxBytes: 2, end: bytes.length, live: true });

    expect(page).toMatchObject({ text: "𝄞", nextOffset: 4 });
  });

  it("waits for a character wider than the page that has not all arrived", () => {
    const bytes = Buffer.from("𝄞", "utf8").subarray(0, 3);
    const chunks = store(bytes, [3]);

    const page = cutPage({ chunks, offset: 0, maxBytes: 2, end: 3, live: true });

    expect(page).toMatchObject({ text: "", nextOffset: 0 });
  });

  it("stops at the stored end even when a chunk read reaches past it", () => {
    const chunks = store(ascii, [10]);

    const page = cutPage({ chunks, offset: 0, maxBytes: 1_000, end: 10, live: true });

    expect(page.nextOffset).toBe(10);
  });
});

describe("a character boundary", () => {
  it.each([
    ["plain ASCII", [0x61, 0x62], 2],
    ["a complete two-byte character", [0x61, 0xc3, 0xa9], 3],
    ["a two-byte character missing its continuation", [0x61, 0xc3], 1],
    ["a three-byte character missing one continuation", [0x61, 0xe2, 0x9c], 1],
    ["a four-byte character missing three", [0x61, 0xf0], 1],
    ["a complete four-byte character", [0xf0, 0x9d, 0x84, 0x9e], 4],
    ["a stray continuation byte, which can never complete", [0x61, 0x80], 2],
    ["a byte that begins no character", [0x61, 0xff], 2],
    ["an empty page", [], 0],
  ])("keeps %s intact", (_, bytes, expected) => {
    expect(characterBoundary(Buffer.from(bytes))).toBe(expected);
  });
});
