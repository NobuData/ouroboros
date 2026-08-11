import {
  ALL_INTERFACES_HOST,
  ConfigurationError,
  DEFAULT_PORT,
  LOOPBACK_HOST,
  readListenHost,
  readPort,
} from "./env";

describe("readPort", () => {
  it("falls back to the documented development port when PORT is unset", () => {
    expect(readPort({})).toBe(DEFAULT_PORT);
    expect(DEFAULT_PORT).toBe(4000);
  });

  it("treats an empty PORT as unset, because that is what an unfilled env line leaves", () => {
    expect(readPort({ PORT: "" })).toBe(DEFAULT_PORT);
  });

  it("reads a port that is set", () => {
    expect(readPort({ PORT: "4000" })).toBe(4000);
    expect(readPort({ PORT: "1" })).toBe(1);
    expect(readPort({ PORT: "65535" })).toBe(65535);
  });

  // Every one of these is accepted by Number() or parseInt() and turned into something
  // plausible, which is exactly the failure mode this reader exists to prevent.
  it.each([
    ["a word", "http"],
    ["trailing text", "4000abc"],
    ["leading whitespace", " 4000"],
    ["a sign", "+4000"],
    ["hexadecimal", "0x1f40"],
    ["scientific notation", "4e3"],
    ["a fraction", "4000.5"],
  ])("rejects %s", (_description, value) => {
    expect(() => readPort({ PORT: value })).toThrow(ConfigurationError);
    expect(() => readPort({ PORT: value })).toThrow(/^PORT: /);
  });

  it.each([
    ["zero, which means any free port to the operating system", "0"],
    ["a port above the maximum", "65536"],
  ])("rejects %s", (_description, value) => {
    expect(() => readPort({ PORT: value })).toThrow(ConfigurationError);
    expect(() => readPort({ PORT: value })).toThrow(/^PORT: /);
  });

  it("names the variable and echoes what it was given", () => {
    expect(() => readPort({ PORT: "http" })).toThrow(
      'PORT: expected a whole number between 1 and 65535, got "http"',
    );
  });
});

describe("readListenHost", () => {
  it("binds every interface in production, where the platform does the routing", () => {
    expect(readListenHost({ NODE_ENV: "production" })).toBe(ALL_INTERFACES_HOST);
    expect(ALL_INTERFACES_HOST).toBe("0.0.0.0");
  });

  // Anything that is not exactly "production" is treated as development, so a typo
  // leaves a developer's machine closed rather than open.
  it.each([
    ["unset", undefined],
    ["development", "development"],
    ["test", "test"],
    ["empty", ""],
    ["misspelt", "Production"],
    ["padded", "production "],
  ])("binds loopback only when NODE_ENV is %s", (_description, value) => {
    expect(readListenHost({ NODE_ENV: value })).toBe(LOOPBACK_HOST);
    expect(LOOPBACK_HOST).toBe("127.0.0.1");
  });
});

describe("ConfigurationError", () => {
  it("is nameable in a log line and distinguishable from an ordinary failure", () => {
    const error = new ConfigurationError("PORT: nope");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConfigurationError");
    expect(error.message).toBe("PORT: nope");
  });
});
