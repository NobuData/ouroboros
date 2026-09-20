import { afterEach, describe, expect, it, vi } from "vitest";

import { copyWhenReady } from "@/app/farm/clipboard";

/**
 * Writing a value that is still being minted to the clipboard (#258): the write is asked for
 * inside the press and fulfilled when the text arrives, an engine with no `ClipboardItem` gets
 * `writeText` after the wait, and a text that never arrives writes nothing.
 */

/** What a `ClipboardItem` was built over, by type. */
type ItemData = Record<string, Promise<Blob>>;

/** A stand-in for the platform's `ClipboardItem`, which jsdom does not have. */
class FakeClipboardItem {
  constructor(readonly data: ItemData) {}
}

/**
 * A clipboard whose writes can be read back.
 *
 * @returns The stub, and what `write` was handed.
 */
function clipboard() {
  const written: FakeClipboardItem[][] = [];

  return {
    written,
    stub: {
      write: vi.fn((items: FakeClipboardItem[]) => {
        written.push(items);

        // As the platform does: the write settles when the item's data has.
        return Promise.all(items.flatMap((item) => Object.values(item.data))).then(() => {});
      }),
      writeText: vi.fn((text: string) => Promise.resolve(void text)),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("with a ClipboardItem", () => {
  it("asks for the write before the text exists, and fulfils it when it arrives", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const { stub, written } = clipboard();
    let arrive: (text: string) => void = () => {};
    const text = new Promise<string>((resolve) => (arrive = resolve));

    const copied = copyWhenReady(text, stub as unknown as Clipboard);

    // Asked for synchronously — inside what would be the press.
    expect(stub.write).toHaveBeenCalledTimes(1);

    arrive("the command");
    await copied;

    const blob = await written[0]?.[0]?.data["text/plain"];

    expect(blob?.type).toBe("text/plain");
    await expect(blob?.text()).resolves.toBe("the command");
    expect(stub.writeText).not.toHaveBeenCalled();
  });

  it("rejects when the text never arrives — nothing was written", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const { stub } = clipboard();

    await expect(
      copyWhenReady(Promise.reject(new Error("refused")), stub as unknown as Clipboard),
    ).rejects.toThrow("refused");
  });

  it("rejects when the browser refuses the write", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const stub = { write: vi.fn(() => Promise.reject(new DOMException("denied", "NotAllowedError"))) };

    await expect(copyWhenReady(Promise.resolve("x"), stub as unknown as Clipboard)).rejects.toThrow("denied");
  });
});

describe("without a ClipboardItem", () => {
  it("waits for the text and writes it as text", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const { stub } = clipboard();

    await copyWhenReady(Promise.resolve("the command"), stub as unknown as Clipboard);

    expect(stub.writeText).toHaveBeenCalledExactlyOnceWith("the command");
    expect(stub.write).not.toHaveBeenCalled();
  });

  it("writes nothing when the text never arrives", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    const { stub } = clipboard();

    await expect(
      copyWhenReady(Promise.reject(new Error("refused")), stub as unknown as Clipboard),
    ).rejects.toThrow("refused");
    expect(stub.writeText).not.toHaveBeenCalled();
  });
});

describe("with no clipboard at all", () => {
  it("rejects — an insecure origin has none — and leaves no rejection unobserved", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    await expect(copyWhenReady(Promise.reject(new Error("refused")), undefined)).rejects.toThrow(/no clipboard/);
    await new Promise((resolve) => setTimeout(resolve, 0));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("never puts the text in the error it throws", async () => {
    const failure: unknown = await copyWhenReady(Promise.resolve("orb_enroll_secret"), undefined).catch(
      (error: unknown) => error,
    );

    expect(String(failure)).not.toContain("orb_enroll_secret");
  });
});
