import { UNKNOWN_PLATFORM, kindOf, normalizePlatform, rigPlatform } from "./platform";

/** Every stored platform satisfies V051's `test_suites_platform_shape`. */
const SHAPE = /^(rig:[A-Za-z0-9][A-Za-z0-9._-]*|[a-z0-9][a-z0-9_]*)$/;

describe("normalizePlatform", () => {
  it.each([
    ["native_sim", "native_sim"],
    ["qemu_cortex_m3", "qemu_cortex_m3"],
    ["  Native_Sim ", "native_sim"],
    ["nrf52840dk/nrf52840", "nrf52840dk_nrf52840"],
    ["-qemu-x86", "qemu_x86"],
    ["rig:helios-rig-02", "rig:helios-rig-02"],
    ["RIG:Helios Rig 02", "rig:Helios-Rig-02"],
    ["rig:.hidden", "rig:hidden"],
  ])("normalizes %j to %j", (raw, stored) => {
    expect(normalizePlatform(raw)).toBe(stored);
    expect(stored).toMatch(SHAPE);
  });

  it.each(["", "   ", "///", "rig:", "rig:---"])("has nothing usable in %j", (raw) => {
    expect(normalizePlatform(raw)).toBeNull();
  });

  it("records a missing platform under a tag that fits the shape", () => {
    expect(UNKNOWN_PLATFORM).toMatch(SHAPE);
  });
});

describe("rigPlatform and kindOf", () => {
  it("prefixes a rig and makes it physical", () => {
    expect(rigPlatform("helios-rig-02")).toBe("rig:helios-rig-02");
    expect(kindOf("rig:helios-rig-02")).toBe("physical");
    expect(kindOf("native_sim")).toBe("sim");
  });
});
