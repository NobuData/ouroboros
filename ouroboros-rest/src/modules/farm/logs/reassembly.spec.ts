import { Reassembly, type ArrivedChunk } from "./reassembly";

/**
 * The reorder buffer (#253): chunks leave in `seq` order whatever order they arrive in, and a gap
 * is waited for — bounded in time and in size — before it is given up as missing chunks.
 */

const LIMITS = { pendingMax: 3, gapWaitMs: 10_000 };

/** A chunk whose bytes are its own seq, so the output order is visible. */
function chunk(seq: number, droppedBytes = 0): ArrivedChunk {
  return { seq, bytes: Buffer.from(`<${String(seq)}>`), droppedBytes };
}

/** The seqs of released chunks, with their missing counts. */
function released(ready: { seq: number; missingBefore: number }[]): string[] {
  return ready.map((c) =>
    c.missingBefore > 0 ? `${String(c.seq)}(-${String(c.missingBefore)})` : String(c.seq),
  );
}

describe("a job's reassembly", () => {
  it("releases chunks that arrive in order as they arrive", () => {
    const buffer = new Reassembly(0, LIMITS);

    expect(released(buffer.accept(chunk(0), 0).ready)).toEqual(["0"]);
    expect(released(buffer.accept(chunk(1), 0).ready)).toEqual(["1"]);
    expect(buffer.nextSeq).toBe(2);
  });

  it("holds a chunk that arrived ahead of a gap, and releases both in order when it fills", () => {
    const buffer = new Reassembly(41, LIMITS);

    expect(released(buffer.accept(chunk(41), 0).ready)).toEqual(["41"]);
    expect(released(buffer.accept(chunk(43), 0).ready)).toEqual([]);
    expect(buffer.held).toBe(1);
    expect(released(buffer.accept(chunk(42), 0).ready)).toEqual(["42", "43"]);
    expect(buffer.held).toBe(0);
  });

  it("reassembles a deliberately shuffled stream into order", () => {
    const buffer = new Reassembly(0, { pendingMax: 64, gapWaitMs: 10_000 });
    const order = [3, 0, 5, 1, 4, 2, 7, 6];
    const out: number[] = [];

    for (const seq of order) out.push(...buffer.accept(chunk(seq), 0).ready.map((c) => c.seq));

    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("starts where the job's stored log ends", () => {
    const buffer = new Reassembly(7, LIMITS);

    expect(buffer.accept(chunk(6), 0).duplicate).toBe(true);
    expect(released(buffer.accept(chunk(7), 0).ready)).toEqual(["7"]);
  });

  it("treats a re-sent chunk — stored or held — as a duplicate that changes nothing", () => {
    const buffer = new Reassembly(0, LIMITS);
    buffer.accept(chunk(0), 0);
    buffer.accept(chunk(2), 0);

    expect(buffer.accept(chunk(0), 0)).toEqual({ ready: [], duplicate: true });
    expect(buffer.accept(chunk(2), 0)).toEqual({ ready: [], duplicate: true });
    expect(buffer.held).toBe(1);
  });

  it("gives up a gap after it has been waited for long enough, counting what was lost", () => {
    const buffer = new Reassembly(0, LIMITS);
    buffer.accept(chunk(0), 0);
    buffer.accept(chunk(3), 1_000);

    expect(buffer.expire(10_999)).toEqual([]);
    expect(released(buffer.expire(11_000))).toEqual(["3(-2)"]);
    expect(buffer.nextSeq).toBe(4);
  });

  it("gives up a gap at once when more chunks are held than the bound", () => {
    const buffer = new Reassembly(0, LIMITS);

    buffer.accept(chunk(2), 0);
    buffer.accept(chunk(3), 0);
    buffer.accept(chunk(4), 0);
    const { ready } = buffer.accept(chunk(5), 0);

    expect(released(ready)).toEqual(["2(-2)", "3", "4", "5"]);
  });

  it("gives up every gap when the job finishes, with each gap's own count", () => {
    const buffer = new Reassembly(0, { pendingMax: 64, gapWaitMs: 10_000 });
    buffer.accept(chunk(2), 0);
    buffer.accept(chunk(5), 0);

    expect(released(buffer.flush())).toEqual(["2(-2)", "5(-2)"]);
    expect(buffer.held).toBe(0);
    expect(buffer.flush()).toEqual([]);
  });

  it("carries a chunk's own dropped bytes through untouched", () => {
    const buffer = new Reassembly(0, LIMITS);

    expect(buffer.accept(chunk(0, 512), 0).ready[0]).toMatchObject({
      droppedBytes: 512,
      missingBefore: 0,
    });
  });

  it("restarts the gap's clock when a new gap opens after one was filled", () => {
    const buffer = new Reassembly(0, LIMITS);
    buffer.accept(chunk(1), 0);
    buffer.accept(chunk(0), 9_000);
    buffer.accept(chunk(3), 9_500);

    expect(buffer.expire(15_000)).toEqual([]);
    expect(released(buffer.expire(19_500))).toEqual(["3(-1)"]);
  });
});
