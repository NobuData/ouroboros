import { Logger } from "@nestjs/common";

import { DENIED_WORDS } from "../vault/no-secret-logging";
import { LEASE_GRANTED_EVENT, LeaseAudit, type LeaseGrantedEvent } from "./lease.audit";

/**
 * The trail, and the two claims made about it.
 *
 * *Every lease grant writes an audit event* is an acceptance criterion, and the honest
 * version of it today is an emission with every field AD.4's
 * ([#225](https://github.com/NobuData/ouroboros/issues/225)) row will carry, into the sink
 * that exists — see `lease.audit.ts` on why that is a seam rather than a stub. So this suite
 * asserts what will still be true when the sink changes: the event's **name**, which is
 * AD.4's own vocabulary and what somebody will grep for, and the **record's contents**,
 * which must name what was granted and carry nothing secret.
 *
 * The second claim is checked against the vault's own denied-word list rather than against a
 * list typed here, so a word added there — the place that decides what "secret material"
 * means in this codebase — tightens this test too.
 */

const EVENT: LeaseGrantedEvent = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  run: "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
  organizationId: "aBcD1234eFgH5678iJkL9012mNoP3456",
  provider: "ollama",
  baseUrl: "http://localhost:11434",
  grantedAt: new Date("2026-08-22T18:04:11.000Z"),
  expiresAt: new Date("2026-08-22T18:19:11.000Z"),
};

describe("the event's name", () => {
  it("is the one AD.4 named", () => {
    // Agreed before the trail exists, so that a consumer grepping for it later finds the
    // string that was written down in #225's scope rather than one this module invented.
    expect(LEASE_GRANTED_EVENT).toBe("credential.lease_granted");
  });
});

describe("what one grant records", () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    jest.spyOn(Logger.prototype, "log").mockImplementation((message: unknown) => {
      written.push(String(message));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("writes exactly one record", () => {
    new LeaseAudit().granted(EVENT);

    expect(written).toHaveLength(1);
  });

  it("names the event, the lease, the run, the workspace, the provider and the address", () => {
    // Everything AD.4's row will hold. A trail that recorded *a lease happened* without
    // saying which workspace it was for would be a trail nobody can answer a question with.
    new LeaseAudit().granted(EVENT);

    const [record] = written;

    expect(record).toContain(LEASE_GRANTED_EVENT);
    expect(record).toContain(EVENT.id);
    expect(record).toContain(EVENT.run);
    expect(record).toContain(EVENT.organizationId);
    expect(record).toContain(EVENT.provider);
    expect(record).toContain(EVENT.baseUrl);
    expect(record).toContain(EVENT.expiresAt.toISOString());
  });

  it("carries nothing that names secret material", () => {
    // The grep test the roadmap asks of every credential event, run against the vocabulary
    // `no-secret-logging.mjs` defines rather than a list typed here. The event's own name
    // contains `credential`, which is the one legitimate occurrence — it is the *family* the
    // trail files this under — so it is removed before the words are looked for.
    new LeaseAudit().granted(EVENT);

    const record = written[0].replace(LEASE_GRANTED_EVENT, "");

    for (const word of DENIED_WORDS) {
      expect(record.toLowerCase()).not.toContain(word);
    }
  });
});
