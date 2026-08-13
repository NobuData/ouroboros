import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { DISCOVERY_FLOOR_MS } from "./discovery.timing";
import { NO_SSO_MESSAGE, type DiscoveryResource } from "./discovery.service";

/**
 * Domain discovery, against a real migrated PostgreSQL.
 *
 * The unit suites cover the pieces — the normalisation, the statement, the floor, the
 * uniform answer — and every one of them is asserted against a stand-in for the thing next
 * to it. This suite is here for the two claims that a stand-in cannot make, and they are the
 * two the issue's acceptance criteria are written as:
 *
 *   * **The statement runs.** `V006__tenancy_extensions.sql` dropped `tenant_domains.tenant_id`
 *     and `src/modules/db/schema.ts` still declares it
 *     ([#714](https://github.com/NobuData/ouroboros/issues/714) is what fixes that), so a
 *     lookup that named the wrong column would compile, typecheck, pass a recording-driver
 *     spec, and answer `500` in production. Only a server can say otherwise.
 *   * **A domain a workspace really holds is indistinguishable from one nothing holds** —
 *     with the row actually there, the index actually used, and the two responses compared
 *     as bytes rather than as objects a test constructed.
 *
 * Rows are seeded through the harness's own connection rather than over the API, and here
 * that is not merely convenient: the tenancy API cannot create them any more. It writes
 * `tenant_id`, which V006 dropped — #714 is the issue that rewrites it against
 * `organization_id`, and until then the two statements below are the only way this table
 * gets a row.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** Where the endpoint answers. */
const DISCOVER = "/api/v1/auth/discover";

/** A domain a workspace in this suite holds. */
const KNOWN = "acme.ouroboros.dev";

/** A domain nothing holds, and never will. `.invalid` is reserved by RFC 2606 for exactly this. */
const UNKNOWN = "nobody.invalid";

/**
 * How many times each timing case is measured.
 *
 * More than one, because a single pair of measurements on a shared CI runner says nothing:
 * one request landing next to a garbage collection would fail an honest implementation. The
 * median of a handful is what the comparison is made on.
 */
const SAMPLES = 5;

/** The middle of a set of measurements, which is what a stray outlier does not move. */
function median(values: number[]): number {
  return values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)];
}

describe("discovering a company domain", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(async () => {
    await api.close();
  });

  afterEach(async () => {
    await api.truncate();
  });

  /**
   * Give a workspace a domain, writing both rows directly.
   *
   * @param domain - The domain it claims.
   * @returns When the row is there.
   */
  async function claim(domain: string): Promise<void> {
    const organizationId = `org_${domain.replace(/\W/g, "_")}`;

    await api.sql.query(
      `insert into ouroboros.organization ("id", "name", "slug", "createdAt")
       values ($1, $2, $3, now())`,
      [organizationId, "Acme", organizationId],
    );
    await api.sql.query(
      `insert into ouroboros.tenant_domains (organization_id, domain, is_primary)
       values ($1, $2, true)`,
      [organizationId, domain],
    );
  }

  /**
   * Ask the endpoint about a domain.
   *
   * @param domain - What to send, exactly as a person would have typed it.
   * @returns The Supertest request, un-awaited, so a caller can assert on the status.
   */
  const ask = (domain: string) => api.anonymous("post", DISCOVER).send({ domain });

  describe("the statement V006 left behind", () => {
    it("runs against the migrated table, which is the whole of why this suite exists", async () => {
      // `schema.ts` still declares the column V006 dropped. A repository that named it would
      // fail *here* and nowhere else in the suite.
      await claim(KNOWN);

      await ask(KNOWN).expect(200);
    });

    it("finds the row through the domain, whatever case it arrives in", async () => {
      // End to end: the DTO folds `HTTPS://Acme.…/login` to the stored form, and the stored
      // form is what the unique index compares. A break anywhere along that path is a lookup
      // that silently misses — invisible in this release, and #722's first bug report.
      await claim(KNOWN);

      await ask("  HTTPS://Acme.Ouroboros.dev/login  ").expect(200);
    });
  });

  describe("what a stranger learns", () => {
    it("answers a domain a workspace holds", async () => {
      await claim(KNOWN);

      expect(bodyOf<DiscoveryResource>(await ask(KNOWN).expect(200))).toEqual({
        ssoAvailable: false,
        message: NO_SSO_MESSAGE,
      });
    });

    it("answers a domain nothing holds with the very same bytes", async () => {
      // The issue's first two acceptance criteria, together and as strictly as they can be
      // stated: not the same shape, the same response — compared as the text that went over
      // the socket, so a field order or a whitespace difference would fail too.
      await claim(KNOWN);

      const known = await ask(KNOWN).expect(200);
      const unknown = await ask(UNKNOWN).expect(200);

      expect(unknown.text).toBe(known.text);
    });

    it("says the same thing when there are no workspaces at all", async () => {
      // The empty installation, which is the one case where an implementation that leaked
      // could still look right: with nothing seeded, "unknown" is the only branch there is.
      expect(bodyOf<DiscoveryResource>(await ask(KNOWN).expect(200))).toEqual({
        ssoAvailable: false,
        message: NO_SSO_MESSAGE,
      });
    });

    it("names no organization, and sends no redirect", async () => {
      await claim(KNOWN);

      const response = await ask(KNOWN).expect(200);

      expect(response.text).not.toContain("org_");
      expect(response.text).not.toContain("Acme");
      expect(bodyOf<DiscoveryResource>(response).redirectUrl).toBeUndefined();
    });

    it("answers without a session, which is its whole point", async () => {
      // `api.anonymous` sends no cookie. A `401` here would mean the login page's first
      // request needs the thing it exists to obtain.
      await ask(UNKNOWN).expect(200);
    });

    it("refuses something that is not a domain, naming the field", async () => {
      const response = await ask("not a domain").expect(422);

      expect(bodyOf<{ code: string; details: Record<string, string[]> }>(response).code).toBe(
        "validation_failed",
      );
      expect(bodyOf<{ details: Record<string, string[]> }>(response).details.domain).toBeDefined();
    });
  });

  describe("what a stranger can time", () => {
    it("takes the floor for a domain a workspace holds", async () => {
      await claim(KNOWN);

      expect(await timed(KNOWN)).toBeGreaterThan(DISCOVERY_FLOOR_MS - 2);
    });

    it("cannot tell a known domain from an unknown one with a stopwatch", async () => {
      // The third acceptance criterion, measured rather than argued. A lookup that hits an
      // index entry and returns a row is slower than one that hits nothing, and without the
      // floor that difference is readable off a few hundred requests. With it, both land on
      // the floor and the difference between them is noise.
      //
      // The bound is a fifth of the floor: comfortably above the scheduling jitter of a
      // shared runner, and far below the several milliseconds a *removed* floor would let
      // through.
      await claim(KNOWN);

      const knownSamples: number[] = [];
      const unknownSamples: number[] = [];

      for (let sample = 0; sample < SAMPLES; sample += 1) {
        // Interleaved rather than one batch after the other, so a machine that grows busy
        // part-way through the run affects both sets equally.
        knownSamples.push(await timed(KNOWN));
        unknownSamples.push(await timed(UNKNOWN));
      }

      expect(Math.abs(median(knownSamples) - median(unknownSamples))).toBeLessThan(
        DISCOVERY_FLOOR_MS / 5,
      );
    });
  });

  /**
   * How long one request took, end to end.
   *
   * @param domain - What to ask about.
   * @returns The elapsed milliseconds, on the monotonic clock the floor itself uses.
   */
  async function timed(domain: string): Promise<number> {
    const started = performance.now();
    await ask(domain).expect(200);

    return performance.now() - started;
  }
});
