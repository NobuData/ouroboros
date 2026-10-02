import { readTail, TAIL_LINE_CHARS, type ChunkPager, type LogChunk } from "./log.tail";

/**
 * A pager over chunks held in memory, newest first, `size` at a time — and a record of every
 * page asked for, so a case can assert how little was read.
 */
function pagerOver(chunks: readonly string[] | readonly Buffer[], size = 2) {
  const stored: LogChunk[] = chunks.map((content, seq) => ({
    seq,
    content: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"),
  }));
  const asked: (number | null)[] = [];

  const page: ChunkPager = (beforeSeq) => {
    asked.push(beforeSeq);
    const older = stored.filter((chunk) => beforeSeq === null || chunk.seq < beforeSeq);
    return Promise.resolve(older.reverse().slice(0, size));
  };

  return { page, asked };
}

describe("a log tail", () => {
  it("is the last lines, oldest first, with the trailing newline not counted as a line", async () => {
    const { page } = pagerOver(["one\ntwo\n", "three\nfour\n"]);

    expect((await readTail(page, 3)).lines).toEqual(["two", "three", "four"]);
  });

  it("is the whole log when the log is shorter than the tail", async () => {
    const { page } = pagerOver(["only\n", "two lines\n"]);

    expect((await readTail(page, 10)).lines).toEqual(["only", "two lines"]);
  });

  it("joins a line that straddles two chunks", async () => {
    const { page } = pagerOver(["first\nhalf a ", "line\nlast\n"]);

    expect((await readTail(page, 2)).lines).toEqual(["half a line", "last"]);
  });

  it("decodes a character split across two chunks whole", async () => {
    const bytes = Buffer.from("ok\n✓ passed\n", "utf8");
    // Split inside the three bytes of ✓.
    const { page } = pagerOver([bytes.subarray(0, 4), bytes.subarray(4)]);

    expect((await readTail(page, 5)).lines).toEqual(["ok", "✓ passed"]);
  });

  it("keeps a last line that has no newline", async () => {
    const { page } = pagerOver(["a\nb\nunfinished"]);

    expect((await readTail(page, 2)).lines).toEqual(["b", "unfinished"]);
  });

  it("stops reading once the tail is whole, however long the log", async () => {
    // A thousand chunks of a hundred lines; a three-line tail needs the newest chunk only.
    const chunks = Array.from(
      { length: 1000 },
      (_, n) =>
        Array.from({ length: 100 }, (__, line) => `chunk ${String(n)} line ${String(line)}`).join(
          "\n",
        ) + "\n",
    );
    const { page, asked } = pagerOver(chunks, 1);

    const tail = await readTail(page, 3);

    expect(tail.lines).toEqual(["chunk 999 line 97", "chunk 999 line 98", "chunk 999 line 99"]);
    expect(asked).toEqual([null]);
    expect(tail.bytesRead).toBe(Buffer.byteLength(chunks[999]));
  });

  it("drops the fragment it began reading in the middle of", async () => {
    const { page } = pagerOver(["xx\nbeginning of a", " long line\nend\n"], 1);

    // The newest chunk alone holds two newlines — enough for a one-line tail — so the fragment
    // before its first newline is not a line.
    expect((await readTail(page, 1)).lines).toEqual(["end"]);
  });

  it("cuts a line longer than a tail keeps", async () => {
    const { page } = pagerOver(["x".repeat(TAIL_LINE_CHARS * 4) + "\n"]);

    expect((await readTail(page, 1)).lines[0]).toHaveLength(TAIL_LINE_CHARS);
  });

  it("drops a carriage return a Windows runner left", async () => {
    const { page } = pagerOver(["a\r\nb\r\n"]);

    expect((await readTail(page, 2)).lines).toEqual(["a", "b"]);
  });

  it("reads nothing for an empty log, or for a tail of no lines", async () => {
    const empty = pagerOver([]);
    expect(await readTail(empty.page, 5)).toEqual({ lines: [], bytesRead: 0 });

    const some = pagerOver(["a\n"]);
    expect(await readTail(some.page, 0)).toEqual({ lines: [], bytesRead: 0 });
    expect(some.asked).toEqual([]);
  });
});
