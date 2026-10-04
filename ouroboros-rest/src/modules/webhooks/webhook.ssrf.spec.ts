import {
  InternalAllowlist,
  SsrfBlockedError,
  checkUrlShape,
  checkWebhookTarget,
  guardedAddresses,
  isInternalAddress,
  type HostResolver,
  type ResolvedAddress,
} from "./webhook.ssrf";

/**
 * The URL policy (#487 acceptance criterion 3): `http://`, loopback, link-local (the metadata
 * address included) and RFC1918 are refused at save and at delivery — including a name that
 * resolves outward at save and inward later (DNS rebinding) — while the operator's override lets a
 * configured internal collector through.
 */

const NONE = new InternalAllowlist([]);

/** A resolver answering from a table. */
function resolver(table: Record<string, string[]>): HostResolver {
  return (hostname) => {
    const addresses = table[hostname];

    if (addresses === undefined) return Promise.reject(new Error("ENOTFOUND"));

    return Promise.resolve(
      addresses.map((address): ResolvedAddress => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })),
    );
  };
}

/** The refusal a synchronous check threw. */
function reasonOf(check: () => unknown): string {
  try {
    check();
  } catch (error) {
    if (error instanceof SsrfBlockedError) return error.reason;
    throw error;
  }

  throw new Error("expected a refusal");
}

/** The refusal a promise rejected with. */
async function refusal(promise: Promise<unknown>): Promise<SsrfBlockedError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SsrfBlockedError) return error;
    throw error;
  }

  throw new Error("expected a refusal");
}

describe("which addresses are internal", () => {
  it.each([
    "127.0.0.1",
    "127.8.8.8",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
  ])("%s is internal", (address) => {
    expect(isInternalAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])(
    "%s is not",
    (address) => {
      expect(isInternalAddress(address)).toBe(false);
    },
  );

  it("treats something that is not an address as internal, rather than guessing", () => {
    expect(isInternalAddress("example.com")).toBe(true);
  });
});

describe("the URL's shape", () => {
  it("requires https", () => {
    expect(reasonOf(() => checkUrlShape("http://siem.acme.dev/hook", NONE))).toBe("not_https");
  });

  it("refuses credentials in the URL", () => {
    expect(reasonOf(() => checkUrlShape("https://user:pass@siem.acme.dev/hook", NONE))).toBe(
      "credentials_in_url",
    );
  });

  it.each([
    "https://127.0.0.1/hook",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.1.2.3/hook",
    "https://[::1]/hook",
    "https://2130706433/hook", // 127.0.0.1, spelled as one number
    "https://0x7f000001/hook",
  ])("refuses the internal literal %s", (url) => {
    expect(reasonOf(() => checkUrlShape(url, NONE))).toBe("internal_address");
  });

  it("refuses what is not a URL at all", () => {
    expect(reasonOf(() => checkUrlShape("siem.acme.dev", NONE))).toBe("malformed_url");
  });
});

describe("the target at save", () => {
  const dns = resolver({
    "siem.acme.dev": ["93.184.216.34"],
    "metadata.attacker.dev": ["169.254.169.254"],
    "split.attacker.dev": ["93.184.216.34", "10.0.0.7"],
    "collector.internal": ["10.20.0.5"],
  });

  it("allows a public host", async () => {
    await expect(
      checkWebhookTarget("https://siem.acme.dev/services/collector", dns, NONE),
    ).resolves.toBeInstanceOf(URL);
  });

  it("refuses a name that resolves to the metadata address", async () => {
    const refused = await refusal(checkWebhookTarget("https://metadata.attacker.dev/x", dns, NONE));

    expect(refused.reason).toBe("internal_address");
    expect(refused.detail).toBe("metadata.attacker.dev → 169.254.169.254");
  });

  it("refuses a name with one internal address among public ones", async () => {
    expect(
      (await refusal(checkWebhookTarget("https://split.attacker.dev/", dns, NONE))).reason,
    ).toBe("internal_address");
  });

  it("refuses a name that does not resolve", async () => {
    expect((await refusal(checkWebhookTarget("https://nowhere.acme.dev/", dns, NONE))).reason).toBe(
      "unresolvable",
    );
  });

  it("lets the operator allow an internal collector by name, by address or by block", async () => {
    await expect(
      checkWebhookTarget(
        "https://collector.internal/hook",
        dns,
        new InternalAllowlist(["collector.internal"]),
      ),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      checkWebhookTarget(
        "https://collector.internal/hook",
        dns,
        new InternalAllowlist(["10.20.0.0/16"]),
      ),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      checkWebhookTarget("https://10.20.0.5/hook", dns, new InternalAllowlist(["10.20.0.5"])),
    ).resolves.toBeInstanceOf(URL);
  });

  it("allows only what the override names — not the metadata address beside it", async () => {
    const allow = new InternalAllowlist(["10.20.0.0/16"]);

    expect(
      (await refusal(checkWebhookTarget("https://metadata.attacker.dev/", dns, allow))).reason,
    ).toBe("internal_address");
  });

  it("never relaxes https, even for an allowed host", () => {
    expect(
      reasonOf(() =>
        checkUrlShape(
          "http://collector.internal/hook",
          new InternalAllowlist(["collector.internal"]),
        ),
      ),
    ).toBe("not_https");
  });
});

describe("the target at delivery — DNS rebinding", () => {
  it("refuses a name that resolved outward at save and inward now", async () => {
    let answer = ["93.184.216.34"];
    const rebinding: HostResolver = () =>
      Promise.resolve(answer.map((address) => ({ address, family: 4 })));

    await expect(guardedAddresses("rebind.attacker.dev", rebinding, NONE)).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);

    answer = ["127.0.0.1"];

    expect((await refusal(guardedAddresses("rebind.attacker.dev", rebinding, NONE))).reason).toBe(
      "internal_address",
    );
  });
});

describe("the operator's override", () => {
  it("refuses an entry it cannot read, so a typo is not a silent nothing", () => {
    expect(() => new InternalAllowlist(["10.0.0.0/33"])).toThrow(/not a CIDR block/);
    expect(() => new InternalAllowlist(["collector internal"])).toThrow(/not a hostname/);
  });

  it("ignores empty entries and case", () => {
    const allow = new InternalAllowlist(["", " Collector.Internal "]);

    expect(allow.allows("collector.internal")).toBe(true);
    expect(allow.allows("other.internal", "10.0.0.1")).toBe(false);
  });
});
