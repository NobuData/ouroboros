import { SOURCE_CHECKOUT_CAPABILITY, supportsSourceCheckout } from "./capabilities";

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
