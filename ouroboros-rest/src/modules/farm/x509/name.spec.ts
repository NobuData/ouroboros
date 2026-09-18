import { X509Certificate } from "node:crypto";

import { authoritySubject, encodeName, runnerSubject, AUTHORITY_UNIT, RUNNER_UNIT } from "./name";
import { children, read } from "./reader";
import { TAG } from "./der";
import { authority, certificate, FIXTURE_ORGANIZATION, FIXTURE_RUNNER } from "../farm.fixture";

/**
 * The subject, and the one property that makes the gateway's read of it safe: **every value
 * in it was chosen by this service**.
 */

describe("the subject of a runner's certificate", () => {
  it("is the issue's own sentence — CN the runner id, O the workspace", () => {
    expect(runnerSubject(FIXTURE_RUNNER, FIXTURE_ORGANIZATION)).toEqual({
      commonName: FIXTURE_RUNNER,
      organization: FIXTURE_ORGANIZATION,
      unit: RUNNER_UNIT,
    });
  });

  it("carries the runner's id rather than its name", () => {
    // A name is unique per workspace and renameable; a certificate outlives a rename.
    expect(runnerSubject(FIXTURE_RUNNER, FIXTURE_ORGANIZATION).commonName).not.toBe("forge-01");
  });

  it("carries the workspace's id rather than its display name", () => {
    // A display name inside an immutable certificate goes stale the day somebody renames a
    // workspace, and every runner then presents a name that is wrong.
    expect(authoritySubject(FIXTURE_ORGANIZATION).organization).toBe(FIXTURE_ORGANIZATION);
  });

  it("is distinguishable by eye from the authority's own", () => {
    expect(authoritySubject(FIXTURE_ORGANIZATION).unit).toBe(AUTHORITY_UNIT);
    expect(runnerSubject(FIXTURE_RUNNER, FIXTURE_ORGANIZATION).unit).not.toBe(AUTHORITY_UNIT);
  });
});

describe("the encoding", () => {
  it("is a sequence of single-valued relative distinguished names", () => {
    // Which is what lets `der.ts`'s `set()` avoid implementing DER's set ordering: a set of one
    // is already sorted.
    const encoded = encodeName(runnerSubject(FIXTURE_RUNNER, FIXTURE_ORGANIZATION));
    const rdns = children(encoded, read(encoded, 0));

    expect(encoded[0]).toBe(TAG.SEQUENCE);
    expect(rdns).toHaveLength(3);

    for (const rdn of rdns) {
      expect(rdn.tag).toBe(TAG.SET);
      expect(children(encoded, rdn)).toHaveLength(1);
    }
  });

  it("produces what a real parser reads back", () => {
    const issuer = authority();
    const parsed = new X509Certificate(certificate(issuer).pem);

    expect(parsed.subject).toContain(`CN=${FIXTURE_RUNNER}`);
    expect(parsed.subject).toContain(`O=${FIXTURE_ORGANIZATION}`);
    expect(parsed.subject).toContain(`OU=${RUNNER_UNIT}`);
  });

  it("makes an issuer byte-identical to its issuer's subject", () => {
    // RFC 5280's actual requirement, and a property of composing both through one function
    // rather than of any particular attribute order.
    const issuer = authority();
    const parsed = new X509Certificate(certificate(issuer).pem);
    const ca = new X509Certificate(issuer.pem);

    expect(parsed.issuer).toBe(ca.subject);
    expect(parsed.checkIssued(ca)).toBe(true);
  });

  it("survives a workspace id that would need escaping in a name", () => {
    // Not a case BetterAuth produces, and encoded as UTF-8 rather than refused, so that a
    // future id format is an encoding question rather than an outage.
    const encoded = encodeName({ commonName: "a,b", organization: "c+d", unit: "e" });

    expect(encoded.length).toBeGreaterThan(0);
  });
});
