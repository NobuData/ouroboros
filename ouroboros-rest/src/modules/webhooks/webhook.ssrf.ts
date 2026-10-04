/**
 * The URL policy every webhook target is held to — at save **and** at delivery (BR.3,
 * [#487](https://github.com/NobuData/ouroboros/issues/487)).
 *
 * ```
 * save      https · no user-info · no internal IP literal · every resolved address external
 * delivery  the same, and the connection is made to the address this policy approved
 * ```
 *
 * A URL the server fetches on a user's behalf is a textbook SSRF primitive: on a self-hosted
 * install the internal ranges are where the cloud metadata endpoint (`169.254.169.254`) and the
 * admin services live. So:
 *
 * - **https only.** Also a CHECK in V094, so the database refuses what this file would.
 * - **Internal ranges are denied by default** — loopback, link-local (metadata included), RFC1918,
 *   carrier-grade NAT, unique-local IPv6, and the unspecified, multicast and reserved blocks. An
 *   IPv4 address embedded in IPv6 (`::ffff:10.0.0.1`, NAT64) is judged as the IPv4 it carries.
 * - **Checked at delivery as well as at save**, because DNS answers change: a hostname that
 *   resolved outward when the endpoint was saved may resolve inward tomorrow (DNS rebinding). The
 *   transport resolves through {@link guardedAddresses} and connects to an address it approved, so
 *   there is no gap between the check and the connection for a second answer to slip through.
 * - **An operator override**, `OURO_WEBHOOK_INTERNAL_ALLOWLIST` — hostnames, addresses or CIDR
 *   blocks of genuine internal collectors. A policy with no escape hatch gets disabled wholesale.
 *   The override never relaxes https.
 */

import { BlockList, isIP } from "node:net";

/** One resolved address. */
export interface ResolvedAddress {
  readonly address: string;
  /** 4 or 6. */
  readonly family: number;
}

/** Resolves a hostname to every address it currently has. */
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** Why a target was refused — the code a refusal and the delivery log carry. */
export type SsrfRefusal =
  "not_https" | "credentials_in_url" | "malformed_url" | "internal_address" | "unresolvable";

/** A refused target. */
export class SsrfBlockedError extends Error {
  /**
   * @param reason - The refusal code.
   * @param detail - What was refused, for the delivery log — a host or an address, never a path
   *   or query (either can carry a collector token).
   */
  constructor(
    readonly reason: SsrfRefusal,
    readonly detail: string,
  ) {
    super(`webhook target refused (${reason}): ${detail}`);
    this.name = "SsrfBlockedError";
  }
}

/** The ranges no webhook may reach unless the operator allows it. */
const DENIED = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network", unspecified
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — the cloud metadata endpoint lives here
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
] as const) {
  DENIED.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique-local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  DENIED.addSubnet(network, prefix, "ipv6");
}

/**
 * The IPv4 address an IPv6 address carries, when it is a mapped or NAT64 form.
 *
 * @param address - An IPv6 address.
 * @returns The embedded IPv4, or `undefined`.
 */
function embeddedIpv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);

  if (dotted !== null) {
    return dotted[1];
  }

  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);

  if (hex === null) {
    return undefined;
  }

  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * Whether an address is in a denied range.
 *
 * @param address - An IPv4 or IPv6 literal.
 * @returns `true` for an internal address.
 */
export function isInternalAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    return DENIED.check(address, "ipv4");
  }

  if (version === 6) {
    const v4 = embeddedIpv4(address);

    return v4 !== undefined ? DENIED.check(v4, "ipv4") : DENIED.check(address, "ipv6");
  }

  // Not an address at all: refuse rather than guess.
  return true;
}

/** The operator's override, parsed. */
export class InternalAllowlist {
  /** Hostnames, lower-cased. */
  private readonly hosts = new Set<string>();

  /** Addresses and CIDR blocks. */
  private readonly blocks = new BlockList();

  /**
   * @param entries - `collector.internal`, `10.20.0.5`, `10.20.0.0/16`, `fd00::/8`.
   * @throws {Error} When an entry is none of those — a typo here would silently allow nothing.
   */
  constructor(entries: readonly string[]) {
    for (const raw of entries) {
      const entry = raw.trim().toLowerCase();

      if (entry === "") continue;

      const [network, prefix] = entry.split("/");
      const version = isIP(network);

      if (version !== 0) {
        const type = version === 4 ? "ipv4" : "ipv6";
        const bits = prefix === undefined ? (version === 4 ? 32 : 128) : Number(prefix);

        if (!Number.isInteger(bits) || bits < 0 || bits > (version === 4 ? 32 : 128)) {
          throw new Error(`not a CIDR block: ${raw}`);
        }

        this.blocks.addSubnet(network, bits, type);
      } else if (
        prefix === undefined &&
        /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(entry)
      ) {
        this.hosts.add(entry);
      } else {
        throw new Error(`not a hostname, address or CIDR block: ${raw}`);
      }
    }
  }

  /**
   * Whether the operator allowed this host, or this address, to be internal.
   *
   * @param hostname - The URL's host.
   * @param address - A resolved address, when judging one.
   * @returns `true` when either is on the list.
   */
  allows(hostname: string, address?: string): boolean {
    if (this.hosts.has(hostname.toLowerCase())) {
      return true;
    }

    if (address === undefined) {
      return false;
    }

    const version = isIP(address);

    return version !== 0 && this.blocks.check(address, version === 4 ? "ipv4" : "ipv6");
  }
}

/**
 * A URL's host with IPv6 brackets removed.
 *
 * @param url - The parsed URL.
 * @returns `example.com`, `10.0.0.1`, `::1`.
 */
export function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, "$1");
}

/**
 * The shape half of the policy — what can be judged without DNS.
 *
 * @param raw - The URL as given.
 * @param allowlist - The operator override.
 * @returns The parsed URL.
 * @throws {SsrfBlockedError} When it is not https, carries credentials, or names an internal
 *   address literal the operator did not allow.
 */
export function checkUrlShape(raw: string, allowlist: InternalAllowlist): URL {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError("malformed_url", "not an absolute URL");
  }

  if (url.protocol !== "https:") {
    throw new SsrfBlockedError("not_https", url.protocol);
  }

  if (url.username !== "" || url.password !== "") {
    throw new SsrfBlockedError("credentials_in_url", url.hostname);
  }

  const host = hostOf(url);

  if (isIP(host) !== 0 && isInternalAddress(host) && !allowlist.allows(host, host)) {
    throw new SsrfBlockedError("internal_address", host);
  }

  return url;
}

/**
 * Resolve a host and judge every address it has.
 *
 * **Every** address, not the first: a name that resolves to one public and one internal address
 * would otherwise be a coin toss the attacker gets to retry.
 *
 * @param hostname - The URL's host (no brackets).
 * @param resolve - The resolver — the system's at delivery, a fixture's in tests.
 * @param allowlist - The operator override.
 * @returns The approved addresses, in the resolver's order.
 * @throws {SsrfBlockedError} `unresolvable` when the name has no address, `internal_address` when
 *   any address is internal and not allowed.
 */
export async function guardedAddresses(
  hostname: string,
  resolve: HostResolver,
  allowlist: InternalAllowlist,
): Promise<ResolvedAddress[]> {
  if (isIP(hostname) !== 0) {
    if (isInternalAddress(hostname) && !allowlist.allows(hostname, hostname)) {
      throw new SsrfBlockedError("internal_address", hostname);
    }

    return [{ address: hostname, family: isIP(hostname) }];
  }

  let addresses: ResolvedAddress[];

  try {
    addresses = await resolve(hostname);
  } catch {
    throw new SsrfBlockedError("unresolvable", hostname);
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError("unresolvable", hostname);
  }

  for (const { address } of addresses) {
    if (isInternalAddress(address) && !allowlist.allows(hostname, address)) {
      throw new SsrfBlockedError("internal_address", `${hostname} → ${address}`);
    }
  }

  return addresses;
}

/**
 * The whole policy, as the management API applies it at save.
 *
 * @param raw - The URL.
 * @param resolve - The resolver.
 * @param allowlist - The operator override.
 * @returns The parsed URL, once every resolved address is approved.
 * @throws {SsrfBlockedError} The first refusal.
 */
export async function checkWebhookTarget(
  raw: string,
  resolve: HostResolver,
  allowlist: InternalAllowlist,
): Promise<URL> {
  const url = checkUrlShape(raw, allowlist);

  await guardedAddresses(hostOf(url), resolve, allowlist);

  return url;
}
