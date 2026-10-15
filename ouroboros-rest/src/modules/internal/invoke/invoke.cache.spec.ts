import { TtlCache } from "./invoke.cache";

describe("TtlCache", () => {
  it("shares one load between concurrent callers and reuses it within the TTL", async () => {
    let now = 0;
    const cache = new TtlCache<number>(1_000, 10, () => now);
    const load = jest.fn(() => Promise.resolve(7));

    await Promise.all([cache.get("k", load), cache.get("k", load)]);
    now = 999;
    await cache.get("k", load);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("loads again once the TTL has passed", async () => {
    let now = 0;
    const cache = new TtlCache<number>(1_000, 10, () => now);
    const load = jest.fn(() => Promise.resolve(now));

    await cache.get("k", load);
    now = 1_000;

    await expect(cache.get("k", load)).resolves.toBe(1_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never remembers a failure", async () => {
    const cache = new TtlCache<number>(1_000, 10);
    const load = jest.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(3);

    await expect(cache.get("k", load)).rejects.toThrow("down");
    await expect(cache.get("k", load)).resolves.toBe(3);
  });

  it("drops the oldest entry beyond its bound", async () => {
    const cache = new TtlCache<string>(60_000, 2);
    const load = jest.fn((key: string) => Promise.resolve(key));

    for (const key of ["a", "b", "c"]) {
      await cache.get(key, () => load(key));
    }
    await cache.get("a", () => load("a"));

    expect(load).toHaveBeenCalledTimes(4);
  });
});
