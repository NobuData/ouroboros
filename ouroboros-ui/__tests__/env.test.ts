import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REST_URL_VAR,
  type Environment,
  readRestUrl,
  resetRestUrlCache,
  restUrl,
} from "@/app/env";

/** An environment with nothing in it. */
const empty = (): Environment => ({});

/** An environment carrying just the one variable under test. */
const withRestUrl = (value: string): Environment => ({ [REST_URL_VAR]: value });

afterEach(() => {
  vi.unstubAllEnvs();
  resetRestUrlCache();
});

describe("readRestUrl", () => {
  it("returns the configured URL", () => {
    expect(readRestUrl(withRestUrl("http://localhost:4000"))).toBe("http://localhost:4000");
  });

  it("accepts https", () => {
    expect(readRestUrl(withRestUrl("https://rest.example.com"))).toBe(
      "https://rest.example.com",
    );
  });

  it("keeps a path prefix, which a reverse proxy may add", () => {
    expect(readRestUrl(withRestUrl("https://example.com/rest"))).toBe(
      "https://example.com/rest",
    );
  });

  it("strips trailing slashes so callers can join paths by concatenation", () => {
    expect(readRestUrl(withRestUrl("http://localhost:4000/"))).toBe("http://localhost:4000");
    expect(readRestUrl(withRestUrl("http://localhost:4000///"))).toBe(
      "http://localhost:4000",
    );
  });

  it("ignores surrounding whitespace, which a .env file makes easy to leave in", () => {
    expect(readRestUrl(withRestUrl("  http://localhost:4000  "))).toBe(
      "http://localhost:4000",
    );
  });

  it("names the variable when it is missing", () => {
    expect(() => readRestUrl(empty())).toThrow(REST_URL_VAR);
  });

  it("treats a blank value as missing rather than as a valid empty URL", () => {
    expect(() => readRestUrl(withRestUrl("   "))).toThrow(/is not set/);
  });

  it("rejects a host with no scheme, quoting what it got", () => {
    expect(() => readRestUrl(withRestUrl("rest.example.com/api"))).toThrow(
      /not a valid URL: rest\.example\.com\/api/,
    );
  });

  it("rejects host:port, which parses as a scheme rather than as a host", () => {
    // The trap this covers: `localhost:4000` looks like a host and a port, but URL
    // reads `localhost:` as the scheme, so it parses cleanly and only the protocol
    // check catches it.
    expect(() => readRestUrl(withRestUrl("localhost:4000/api"))).toThrow(
      /must be an http or https URL/,
    );
  });

  it("rejects a scheme the UI cannot fetch over", () => {
    expect(() => readRestUrl(withRestUrl("ftp://localhost:4000"))).toThrow(
      /must be an http or https URL/,
    );
  });

  it("rejects file:, which would otherwise parse cleanly", () => {
    expect(() => readRestUrl(withRestUrl("file:///etc/passwd"))).toThrow(
      /must be an http or https URL/,
    );
  });

  it("reads process.env when no environment is passed", () => {
    vi.stubEnv(REST_URL_VAR, "http://localhost:4000");
    expect(readRestUrl()).toBe("http://localhost:4000");
  });
});

describe("restUrl", () => {
  it("returns the validated URL from the environment", () => {
    vi.stubEnv(REST_URL_VAR, "http://localhost:4000/");
    expect(restUrl()).toBe("http://localhost:4000");
  });

  it("caches the first successful read", () => {
    vi.stubEnv(REST_URL_VAR, "http://localhost:4000");
    expect(restUrl()).toBe("http://localhost:4000");

    // The environment of a running process does not change under it; the cache is what
    // says so. A second read must not pick this up.
    vi.stubEnv(REST_URL_VAR, "http://elsewhere:9999");
    expect(restUrl()).toBe("http://localhost:4000");
  });

  it("re-reads after the cache is reset", () => {
    vi.stubEnv(REST_URL_VAR, "http://localhost:4000");
    expect(restUrl()).toBe("http://localhost:4000");

    resetRestUrlCache();
    vi.stubEnv(REST_URL_VAR, "http://elsewhere:9999");
    expect(restUrl()).toBe("http://elsewhere:9999");
  });

  it("throws every time while the value is unusable, rather than caching the failure", () => {
    vi.stubEnv(REST_URL_VAR, "");
    expect(() => restUrl()).toThrow(REST_URL_VAR);
    expect(() => restUrl()).toThrow(REST_URL_VAR);

    vi.stubEnv(REST_URL_VAR, "http://localhost:4000");
    expect(restUrl()).toBe("http://localhost:4000");
  });
});
