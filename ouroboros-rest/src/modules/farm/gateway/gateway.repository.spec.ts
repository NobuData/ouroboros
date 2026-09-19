import { allowlistOf } from "./gateway.repository";

/**
 * The one pure piece of the gateway's repository: turning a pool's `env_allowlist` jsonb into the
 * `ack.pool.env_allowlist` an agent holds its jobs to (#246). The statements themselves are the
 * integration suite's.
 */
describe("a pool's allow-list, as an ack states it", () => {
  it("is the column's names, in order", () => {
    expect(allowlistOf(["CI", "MAKEFLAGS"])).toEqual(["CI", "MAKEFLAGS"]);
    expect(allowlistOf([])).toEqual([]);
  });

  it("is empty for a column that is not a list, rather than an ack the agent would refuse", () => {
    expect(allowlistOf(null)).toEqual([]);
    expect(allowlistOf({ CI: true })).toEqual([]);
    expect(allowlistOf("CI")).toEqual([]);
  });

  it("keeps only non-empty strings, and no more than the contract's 64", () => {
    expect(allowlistOf(["CI", "", 7, null, "PATH"])).toEqual(["CI", "PATH"]);
    const many = Array.from({ length: 70 }, (_, n) => `VAR_${String(n)}`);
    expect(allowlistOf(many)).toHaveLength(64);
  });
});
