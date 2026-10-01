import { repositoryUrl, revertedTitle } from "./revert.detection";

/**
 * Revert detection (BI.2, #433) — the change failure rate proxy. Both patterns match; every
 * near-miss does not. The oracle twin (`rollup.oracle.fixture.ts`) states the same rules as SQL
 * regular expressions, and the parity suite holds the two together.
 */

describe("revert detection", () => {
  it.each([
    ['Revert "Fix CAN-bus flake"', "Fix CAN-bus flake"],
    ['Revert "Fix CAN-bus flake" (#514)', "Fix CAN-bus flake"],
    ['Revert "Fix CAN-bus flake (#510)"', "Fix CAN-bus flake"],
    ['Revert "Add "quoted" sampler"', 'Add "quoted" sampler'],
    ["revert: Add telemetry", "Add telemetry"],
    ["Revert: Add telemetry", "Add telemetry"],
    ["REVERT:   Add telemetry  ", "Add telemetry"],
    ["revert: Add telemetry\n\nThe sampler regressed.", "Add telemetry"],
    ['  Revert "Bump deps"  \r\nThis reverts commit d4d4d4d.', "Bump deps"],
  ])("reads %j as reverting %j", (text, title) => {
    expect(revertedTitle(text)).toBe(title);
  });

  it.each([
    "Reverted docs typo",
    "Revert docs typo",
    "Reverting the sampler",
    "revert:",
    "revert:   ",
    'Revert ""',
    'Don\'t revert "Fix CAN-bus flake"',
    'fix: Revert "Fix CAN-bus flake"',
    "chore(revert): Add telemetry",
    'Fix CAN-bus flake\n\nRevert "Add telemetry"',
  ])("does not read %j as a revert", (text) => {
    expect(revertedTitle(text)).toBeNull();
  });

  it("names a PR's repository by its URL, on GitHub and GitLab", () => {
    expect(repositoryUrl("https://github.com/acme/helios/pull/514")).toBe(
      "https://github.com/acme/helios",
    );
    expect(repositoryUrl("https://github.com/acme/helios/pull/514/files")).toBe(
      "https://github.com/acme/helios",
    );
    expect(repositoryUrl("https://gitlab.com/acme/fw/helios/-/merge_requests/9")).toBe(
      "https://gitlab.com/acme/fw/helios",
    );
    expect(repositoryUrl("https://example.com/elsewhere")).toBe("https://example.com/elsewhere");
  });
});
