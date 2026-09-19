/**
 * One job's log chunks, put back into `seq` order before anything is stored.
 *
 * AH.5 ([#253](https://github.com/NobuData/ouroboros/issues/253)). V040's cap trigger assigns a
 * chunk's `byte_start` from the job's running total **at the moment it is inserted**, so the
 * stored stream is in insertion order, and offsets a reader has already been given must never
 * move. Chunks can arrive out of order across a reconnect — the old socket's last frames overtaken
 * by the new one's first — so ingest inserts only in `seq` order, and this is the buffer that
 * holds a chunk that arrived ahead of a gap until the gap fills.
 *
 * ```
 * seq 41 ──▶ ready: 41
 * seq 43 ──▶ held (gap at 42)
 * seq 42 ──▶ ready: 42, 43
 * seq 45 ──▶ held … 10 s, or 64 held, or the job finished ──▶ ready: 45 (missingBefore: 1)
 * ```
 *
 * A gap is not waited for for ever. `log.chunk` is not re-sent, so a frame in flight when a socket
 * died is gone; after {@link ReassemblyLimits.gapWaitMs}, or once more than
 * {@link ReassemblyLimits.pendingMax} chunks are held, or when the job finishes, the gap is given
 * up and its size — in chunks, because its bytes are unknown — travels with the next chunk as
 * `missingBefore`, which is what the console's elision marker says. Pure: no clock of its own, no
 * I/O.
 */

/** A chunk as it arrived. */
export interface ArrivedChunk {
  /** The protocol's `seq`: 0-based and contiguous per job. */
  readonly seq: number;
  /** The decoded bytes. */
  readonly bytes: Buffer;
  /** The protocol's `dropped_bytes`: what the agent elided immediately before this chunk. */
  readonly droppedBytes: number;
}

/** A chunk ready to store, in order. */
export interface ReadyChunk extends ArrivedChunk {
  /** Chunks immediately before this one that were given up as lost. */
  readonly missingBefore: number;
}

/** How long, and how much, a gap is waited for. */
export interface ReassemblyLimits {
  readonly pendingMax: number;
  readonly gapWaitMs: number;
}

/** What {@link Reassembly.accept} did with a chunk. */
export interface Accepted {
  /** Chunks now ready, in `seq` order — possibly none, possibly several. */
  readonly ready: ReadyChunk[];
  /** True for a chunk already stored or already held: a re-send, which changes nothing. */
  readonly duplicate: boolean;
}

export class Reassembly {
  private next: number;
  private readonly pending = new Map<number, ArrivedChunk>();
  /** When the current gap was first seen, in epoch milliseconds. */
  private gapSince: number | undefined;

  /**
   * @param nextSeq - The first `seq` not yet stored — one past the job's last stored chunk.
   * @param limits - How long, and how much, a gap is waited for.
   */
  constructor(
    nextSeq: number,
    private readonly limits: ReassemblyLimits,
  ) {
    this.next = nextSeq;
  }

  /** The next `seq` expected — everything below it has been released. */
  get nextSeq(): number {
    return this.next;
  }

  /** How many chunks are held ahead of a gap. */
  get held(): number {
    return this.pending.size;
  }

  /**
   * Take a chunk.
   *
   * @param chunk - It.
   * @param now - Epoch milliseconds, for the gap's clock.
   * @returns The chunks now ready, and whether this one was a duplicate.
   */
  accept(chunk: ArrivedChunk, now: number): Accepted {
    if (chunk.seq < this.next || this.pending.has(chunk.seq)) {
      return { ready: [], duplicate: true };
    }

    this.pending.set(chunk.seq, chunk);
    return { ready: this.release(now, false), duplicate: false };
  }

  /**
   * Give up every gap now and release everything held — the job finished, or its state is being
   * forgotten.
   *
   * @returns The chunks released, in order.
   */
  flush(): ReadyChunk[] {
    return this.release(0, true);
  }

  /**
   * Release anything held behind a gap that has been waited for long enough.
   *
   * @param now - Epoch milliseconds.
   * @returns The chunks released, in order — none while the gap is still young.
   */
  expire(now: number): ReadyChunk[] {
    return this.release(now, false);
  }

  /**
   * Release what can be released.
   *
   * @param now - Epoch milliseconds.
   * @param force - Give up every gap regardless of its age.
   * @returns The chunks released, in order.
   */
  private release(now: number, force: boolean): ReadyChunk[] {
    const ready: ReadyChunk[] = [];
    let missing = 0;

    for (;;) {
      let chunk = this.pending.get(this.next);
      while (chunk) {
        this.pending.delete(this.next);
        ready.push({ ...chunk, missingBefore: missing });
        missing = 0;
        this.next += 1;
        chunk = this.pending.get(this.next);
      }

      if (this.pending.size === 0) {
        this.gapSince = undefined;
        return ready;
      }

      this.gapSince ??= now;
      const givenUp =
        force ||
        this.pending.size > this.limits.pendingMax ||
        now - this.gapSince >= this.limits.gapWaitMs;
      if (!givenUp) return ready;

      const lowest = Math.min(...this.pending.keys());
      missing += lowest - this.next;
      this.next = lowest;
      this.gapSince = undefined;
    }
  }
}
