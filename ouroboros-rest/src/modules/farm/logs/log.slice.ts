/**
 * One page of a build log: the stored chunks around an offset, as text a reader can append.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)). A reader asks for everything
 * after the offset it last reached and is given text plus the offset to ask from next. Two rules
 * make successive pages concatenate to exactly the stored bytes — nothing duplicated, nothing
 * skipped:
 *
 *   * **A page is a contiguous byte range**, `[offset, nextOffset)`, and the next page starts where
 *     this one ended.
 *   * **A page ends on a character boundary.** A build log is bytes, and a chunk can end in the
 *     middle of a UTF-8 character; decoding each page on its own would then turn one character
 *     into two replacement marks. So the last, incomplete character is held back for the next
 *     page — except at the very end of a log that will never grow again, where it is decoded as
 *     it is (a replacement mark) rather than withheld for ever.
 *
 * Bytes that are not UTF-8 at all — a compiler printing a lone `0x80` — decode to U+FFFD. That is
 * a property of the text shown, not of the offsets: every byte is still counted exactly once.
 *
 * **Elision markers are placed by position.** A chunk that had bytes elided, or chunks lost,
 * immediately before it contributes one marker at its `byte_start`, returned with the page whose
 * range contains that offset — so a reader paging through the whole log is given each marker
 * once. The tail (everything elided after the last stored byte) is the job's, not a page's; see
 * `logs.resources.ts`.
 */

/** A stored chunk, as a page is cut from it. */
export interface StoredChunk {
  /** Where its first byte sits in the job's stream. */
  readonly byteStart: number;
  readonly content: Buffer;
  /** Bytes elided immediately before it. */
  readonly elidedBytes: number;
  /** Chunks immediately before it that never arrived. */
  readonly missingChunks: number;
}

/** One elision marker. */
export interface Elision {
  /** The stream offset it sits at — before the byte there. */
  readonly offset: number;
  /** Bytes elided there. */
  readonly bytes: number;
  /** Chunks lost there, whose size is unknown. */
  readonly missingChunks: number;
}

/** A page. */
export interface LogPage {
  /** The page's bytes, decoded. */
  readonly text: string;
  /** Where the next page starts — `offset` plus the bytes this page covers. */
  readonly nextOffset: number;
  /** The markers inside `[offset, nextOffset)`. */
  readonly elisions: Elision[];
}

/** What a page is cut from. */
export interface PageRequest {
  /** The chunks that overlap the page, in `byte_start` order. */
  readonly chunks: readonly StoredChunk[];
  /** Where the page starts. */
  readonly offset: number;
  /** The most bytes it may cover. */
  readonly maxBytes: number;
  /** How many bytes the job has stored — the end of the stream as it stands. */
  readonly end: number;
  /** Whether the stream can still grow. A finished job's cannot. */
  readonly live: boolean;
}

/** A UTF-8 decoder that never throws: invalid bytes become U+FFFD. */
const UTF8 = new TextDecoder("utf-8", { fatal: false });

/**
 * Cut a page.
 *
 * @param request - The chunks, the offset and the bounds.
 * @returns The page.
 */
export function cutPage(request: PageRequest): LogPage {
  // Three bytes past the page, so a character that straddles its edge can still be completed.
  const reach = Math.min(request.end, request.offset + request.maxBytes + 3);
  const parts: Buffer[] = [];

  for (const chunk of request.chunks) {
    const start = Math.max(request.offset, chunk.byteStart);
    const stop = Math.min(reach, chunk.byteStart + chunk.content.length);
    if (stop > start) {
      parts.push(chunk.content.subarray(start - chunk.byteStart, stop - chunk.byteStart));
    }
  }

  const bytes = Buffer.concat(parts);
  const length = pageLength(bytes, request);
  const nextOffset = request.offset + length;

  const elisions = request.chunks
    .filter(
      (chunk) =>
        (chunk.elidedBytes > 0 || chunk.missingChunks > 0) &&
        chunk.byteStart >= request.offset &&
        chunk.byteStart < nextOffset,
    )
    .map((chunk) => ({
      offset: chunk.byteStart,
      bytes: chunk.elidedBytes,
      missingChunks: chunk.missingChunks,
    }));

  return { text: UTF8.decode(bytes.subarray(0, length)), nextOffset, elisions };
}

/**
 * How many of the bytes read a page covers: at most its size, ending on a character boundary —
 * except at the end of a finished log, which is sent as it is, and for one character wider than
 * the whole page, which is sent whole so a reader always moves forward.
 *
 * @param bytes - The bytes read from the page's offset, up to three past its size.
 * @param request - The page's bounds.
 * @returns How many to send.
 */
function pageLength(bytes: Buffer, request: PageRequest): number {
  const length = Math.min(bytes.length, request.maxBytes);
  const final = !request.live && request.offset + length >= request.end;
  if (final) return length;

  const boundary = characterBoundary(bytes.subarray(0, length));
  if (boundary > 0 || bytes.length === 0) return boundary;

  const width = leadWidth(bytes[0]);
  return bytes.length >= width ? width : 0;
}

/**
 * The longest prefix of some bytes that does not end inside a UTF-8 character.
 *
 * Only a genuinely incomplete sequence is held back — a lead byte whose continuation has not
 * arrived yet. Bytes that could never form a character are left in place, to decode as U+FFFD
 * now rather than to be withheld waiting for a continuation that will not come.
 *
 * @param bytes - The page's bytes.
 * @returns How many of them to send.
 */
export function characterBoundary(bytes: Buffer): number {
  // A character is at most four bytes, so an incomplete one starts in the last three.
  for (let back = 1; back <= Math.min(3, bytes.length); back += 1) {
    const byte = bytes[bytes.length - back];

    // A continuation byte: keep looking for the lead.
    if ((byte & 0xc0) === 0x80) continue;

    return leadWidth(byte) > back ? bytes.length - back : bytes.length;
  }

  return bytes.length;
}

/**
 * How many bytes the character a byte begins is — 1 for ASCII and for every byte that can begin
 * no character (a stray `0xC0`, `0xC1` or `0xF5`–`0xFF`), which then decodes on its own.
 *
 * @param byte - A byte that is not a continuation byte.
 * @returns 1 to 4.
 */
function leadWidth(byte: number): number {
  if (byte >= 0xf5 || byte < 0xc2) return 1;
  if (byte >= 0xf0) return 4;
  if (byte >= 0xe0) return 3;
  return 2;
}
