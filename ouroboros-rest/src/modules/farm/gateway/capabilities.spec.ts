import { SOURCE_CHECKOUT_CAPABILITY, capabilitiesOf, supportsSourceCheckout } from "./capabilities";

describe("supportsSourceCheckout (DG.2, #1300)", () => {
  it("is the `git` key AG.7 (#991) will report", () => {
    expect(SOURCE_CHECKOUT_CAPABILITY).toBe("git");
  });

  it("is true only for a runner that said `git: true`", () => {
    expect(supportsSourceCheckout({ git: true, executors: ["shell"] })).toBe(true);
  });

  it.each([
    ["today's document", { docker: true, shell: true, executors: ["container", "shell"] }],
    ["git: false", { git: false }],
    ["git as a string", { git: "true" }],
    ["an enrolled, never-connected runner", {}],
    ["null", null],
    ["a non-object", "git"],
  ])("is false for %s", (_label, capabilities) => {
    expect(supportsSourceCheckout(capabilities)).toBe(false);
  });
});

describe("capabilitiesOf (AG.7, #991)", () => {
  const reported = { docker: true, shell: false, ccache: true, cpus: 8, memory_mb: 16384 };

  it("stores `git` as the agent reported it, and derives the executors", () => {
    expect(capabilitiesOf({ ...reported, git: true })).toEqual({
      docker: true,
      shell: false,
      ccache: true,
      cpu_count: 8,
      memory_mb: 16384,
      executors: ["container"],
      git: true,
    });
  });

  it("stores `git: false` for an agent whose hello did not say — one older than source checkout", () => {
    expect(capabilitiesOf(reported).git).toBe(false);
    expect(supportsSourceCheckout(capabilitiesOf(reported))).toBe(false);
    expect(supportsSourceCheckout(capabilitiesOf({ ...reported, git: true }))).toBe(true);
  });
});
