import { testCaseKey } from "./case-key";

/**
 * V051's recipe, letter for letter (#329). The vectors were computed independently of this code
 * (Python's hashlib over the U+001F-joined inputs); `test-results.integration-spec.ts` checks the
 * database's derivation agrees on every case it writes.
 */
describe("testCaseKey", () => {
  const repo = "11111111-1111-4111-8111-111111111111";

  it("is sha256 over repo, suite, classname and name joined by U+001F", () => {
    expect(
      testCaseKey(repo, "telemetry integration", "telemetry.can", "frame_order_under_isr_load"),
    ).toBe("7433d437efcb672ac25fe593e9fed0b4ff536c7054509ce1b2954eaf2ac0b30a");
  });

  it("hashes a null classname as empty", () => {
    expect(testCaseKey(repo, "PHYSICAL · HIL rig", null, "brownout_recovery")).toBe(
      "6667576ad5d62aa0bb1a1745a1726a0804ebca4a3bb408f4bc8fe510784bbcd4",
    );
    expect(testCaseKey(repo, "PHYSICAL · HIL rig", "", "brownout_recovery")).toBe(
      testCaseKey(repo, "PHYSICAL · HIL rig", null, "brownout_recovery"),
    );
  });

  it("cannot collide across a moved boundary", () => {
    expect(testCaseKey(repo, "a b", "c", "d")).not.toBe(testCaseKey(repo, "a", "b c", "d"));
  });

  it("is scoped per repository and is 64 lowercase hex digits", () => {
    const other = "22222222-2222-4222-8222-222222222222";

    expect(testCaseKey(repo, "s", "c", "n")).not.toBe(testCaseKey(other, "s", "c", "n"));
    expect(testCaseKey(repo, "s", "c", "n")).toMatch(/^[0-9a-f]{64}$/);
  });
});
