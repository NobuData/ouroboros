/**
 * A build's log tail, read backwards — the only way the Build Analyzer reads a log (BV.1,
 * [#510](https://github.com/NobuData/ouroboros/issues/510)).
 *
 * **4.1 million log lines is not a query result.** The corpus counts every line the window's
 * builds stored (`build_jobs.log_lines`, V086) without reading one, and reads only the **tail** of
 * each sampled build: the last {@link TAIL_LINES} lines, which is where a build says how it ended
 * — the failing test, the timeout, the cache miss. The chunks are fetched newest first, a page at
 * a time, and the read stops as soon as the tail is whole, so a 60 MB log costs the last chunk or
 * two rather than 60 MB. Nothing here ever holds more than one tail and one page.
 */

/** The most lines one build's tail carries. */
export const TAIL_LINES = 200;

/**
 * The longest line a tail keeps, in characters. Longer lines are cut: a minified bundle or a hex
 * dump on one line would otherwise be the whole tail's memory, and a signature is in a line's
 * first few hundred characters or nowhere.
 */
export const TAIL_LINE_CHARS = 256;

/** One stored chunk of a build's log. */
export interface LogChunk {
  seq: number;
  content: Buffer;
}

/**
 * Where a build's chunks come from: the page just before `beforeSeq` (or the newest page when
 * null), newest first. An empty page means there is nothing older.
 */
export type ChunkPager = (beforeSeq: number | null) => Promise<LogChunk[]>;

/** A read tail. */
export interface LogTail {
  /** The last lines, oldest first, each at most {@link TAIL_LINE_CHARS} characters. */
  lines: string[];
  /** How many bytes were fetched to find them — what the memory bound is asserted against. */
  bytesRead: number;
}

/** The newline byte. */
const NEWLINE = 0x0a;

/**
 * Count the newlines in a buffer.
 *
 * @param buffer - The bytes.
 * @returns How many `\n` bytes it holds.
 */
function newlines(buffer: Buffer): number {
  let count = 0;
  let at = buffer.indexOf(NEWLINE);

  while (at !== -1) {
    count += 1;
    at = buffer.indexOf(NEWLINE, at + 1);
  }

  return count;
}

/**
 * Read the last `limit` lines of one build's log.
 *
 * Pages are fetched newest first until they hold more newlines than lines wanted — at that point
 * the oldest line needed is known to be whole — or the log runs out. The bytes are decoded once,
 * after the read, so a multi-byte character split across two chunks is decoded whole.
 *
 * @param page - The build's chunk pager.
 * @param limit - How many lines; {@link TAIL_LINES} unless the corpus has less room.
 * @returns The tail and what reading it cost.
 */
export async function readTail(page: ChunkPager, limit: number = TAIL_LINES): Promise<LogTail> {
  if (limit <= 0) {
    return { lines: [], bytesRead: 0 };
  }

  const pieces: Buffer[] = [];
  let seen = 0;
  let bytesRead = 0;
  let before: number | null = null;
  let exhausted = false;

  while (seen <= limit) {
    const chunks = await page(before);
    if (chunks.length === 0) {
      exhausted = true;
      break;
    }

    for (const chunk of chunks) {
      pieces.push(chunk.content);
      seen += newlines(chunk.content);
      bytesRead += chunk.content.length;
      before = chunk.seq;
    }
  }

  // Oldest first, decoded once.
  const text = Buffer.concat(pieces.reverse()).toString("utf8");
  const lines = text.split("\n");

  // A log that ends with a newline leaves an empty last element; it is not a line.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  // Stopped early: the first element began before the oldest chunk read, so it is a fragment.
  if (!exhausted && lines.length > 0) {
    lines.shift();
  }

  return {
    lines: lines.slice(-limit).map((line) => line.replace(/\r$/, "").slice(0, TAIL_LINE_CHARS)),
    bytesRead,
  };
}
