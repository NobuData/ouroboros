import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME, type FactStatus } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { FACT_TRANSITIONS } from "./facts.lifecycle";
import type { FactDetail } from "./facts.resources";
import type { SweepReport } from "./facts.sweep";

/**
 * The fact lifecycle's certification — BF.7 ([#416](https://github.com/NobuData/ouroboros/issues/416)).
 *
 * `facts.integration-spec.ts` (BF.2, #411) walks the happy path once. This suite enumerates, so a
 * refactor that loosens a rule turns a case red rather than passing the spot checks people think
 * of:
 *
 *   * **Every status × every card action** through the API: the legal ones move the fact and
 *     append an audit row naming the person; every other one is `409 fact_transition_refused` and
 *     leaves the fact and its audit exactly as they were.
 *   * **Every `from → to` pair beneath the service**: V071's trigger admits exactly
 *     `FACT_TRANSITIONS` and refuses the rest, whoever writes.
 *   * **The staleness sweep against each anchor kind** — a matching `path_glob`, `dependency` and
 *     `platform_version` each fire on one merged PR, their non-matching twins do not, and an
 *     anchor-less fact is never flagged, only counted.
 *   * **The expiry snapshot is frozen** and the audit append-only, and **re-learn lineage** chains
 *     through generations without ever being rewritten.
 */

const FACTS = "/api/v1/facts";

/** Every status, in K3's order. */
const STATUSES: readonly FactStatus[] = ["proposed", "confirmed", "stale", "rejected", "expired"];

/** A card action: its route, its body, and what it answers when it succeeds. */
interface Action {
  readonly name: "confirm" | "reject" | "reconfirm" | "expire" | "relearn";
  readonly body: Record<string, unknown>;
  readonly ok: number;
}

const ACTIONS: readonly Action[] = [
  { name: "confirm", body: {}, ok: 200 },
  { name: "reject", body: {}, ok: 200 },
  { name: "reconfirm", body: {}, ok: 200 },
  { name: "expire", body: { reason: "Zephyr 4.1 migration" }, ok: 200 },
  { name: "relearn", body: {}, ok: 201 },
];

/**
 * The actions each status admits, and where each leaves the fact acted on. Written out rather than
 * derived from `FACT_TRANSITIONS`, so a change to the machine has to change this table too.
 */
const LEGAL: Readonly<Record<FactStatus, Partial<Record<Action["name"], FactStatus>>>> = {
  proposed: { confirm: "confirmed", reject: "rejected" },
  confirmed: { expire: "expired" },
  stale: { reconfirm: "confirmed", expire: "expired" },
  rejected: {},
  // Re-learn proposes a new fact; the expired one stays expired.
  expired: { relearn: "expired" },
};

/** The Zephyr 4.0 → 4.1 move, with MCUboot added to the manifest. */
const WEST_BUMP = [
  "--- west.yml",
  "@@ -10,7 +10,9 @@ manifest:",
  "     - name: zephyr",
  "       remote: zephyrproject-rtos",
  "-      revision: v4.0.0",
  "+      revision: v4.1.0",
  "+    - name: mcuboot",
  "+      revision: v2.1.0",
].join("\n");

const REPO = "acme-robotics/helios-firmware";

describe("the fact lifecycle's certification (#416)", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({});
  });

  afterAll(async () => {
    await api.close();
  });

  afterEach(async () => {
    await api.truncate();
  });

  /** A workspace, its owner and a member. */
  interface Bench {
    owner: Person;
    member: Person;
    id: string;
    slug: string;
  }

  /** @returns A workspace with an owner and a member. */
  async function bench(): Promise<Bench> {
    const owner = await api.signIn({ email: "owner@ouroboros.invalid" });
    const member = await api.signIn({ email: "member@ouroboros.invalid" });
    const workspace = await api.workspace(owner);

    await api.join(workspace.id, member, "member");

    return { owner, member, id: workspace.id, slug: workspace.slug };
  }

  /** A request as somebody, in a bench's workspace. */
  function as(person: Person, place: Bench) {
    return (method: "get" | "post", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, place.slug);
  }

  /**
   * @param place - Where.
   * @param id - The fact.
   * @returns The fact as the card reads it.
   */
  async function read(place: Bench, id: string): Promise<FactDetail> {
    return bodyOf<FactDetail>(await as(place.member, place)("get", `${FACTS}/${id}`).expect(200));
  }

  /**
   * A fact in a given status, reached the way the product reaches it: the card's actions, and for
   * `stale` the sweep's actor-less edge written as the sweep writes it.
   *
   * @param place - Where.
   * @param status - Where it should be.
   * @param body - The proposal.
   * @returns The fact's id.
   */
  async function factIn(
    place: Bench,
    status: FactStatus,
    body: Record<string, unknown> = { text: `A ${status} fact`, repoRef: REPO },
  ): Promise<string> {
    const act = (id: string, action: string, payload: Record<string, unknown> = {}) =>
      as(place.member, place)("post", `${FACTS}/${id}/${action}`).send(payload).expect(200);
    const { id } = bodyOf<FactDetail>(
      await as(place.member, place)("post", FACTS).send(body).expect(201),
    );

    if (status === "rejected") await act(id, "reject");
    if (status === "confirmed" || status === "stale" || status === "expired") {
      await act(id, "confirm");
    }
    if (status === "stale") {
      await api.sql.query(
        `update ${SCHEMA_NAME}.facts set status = 'stale', status_changed_by = null,
                status_reason = 'an anchor fired' where id = $1`,
        [id],
      );
    }
    if (status === "expired") await act(id, "expire", { reason: "gone" });

    return id;
  }

  describe("the transition matrix", () => {
    it.each(STATUSES)(
      "admits exactly the designed actions on a %s fact, audited with the person",
      async (status) => {
        const place = await bench();

        for (const action of ACTIONS) {
          const id = await factIn(place, status);
          const before = await read(place, id);
          const response = await as(place.member, place)(
            "post",
            `${FACTS}/${id}/${action.name}`,
          ).send(action.body);
          const lands = LEGAL[status][action.name];
          const after = await read(place, id);

          if (lands === undefined) {
            expect([action.name, response.status]).toEqual([action.name, 409]);
            expect(bodyOf<ErrorEnvelope>(response)).toMatchObject({
              code: "fact_transition_refused",
              details: { factId: id, from: status },
            });
            expect(after).toEqual(before);
            continue;
          }

          expect([action.name, response.status]).toEqual([action.name, action.ok]);
          expect(after.status).toBe(lands);

          const added = after.history.slice(before.history.length);

          if (action.name === "relearn") {
            // Not a transition: the original is untouched, and a new proposal names it.
            expect(added).toEqual([]);
            const proposal = bodyOf<FactDetail>(response);
            expect(proposal).toMatchObject({ status: "proposed", relearnedFromFactId: id });
            expect(proposal.history.map((row) => [row.from, row.to, row.actor?.id])).toEqual([
              [null, "proposed", place.member.id],
            ]);
          } else {
            expect(added.length).toBeGreaterThan(0);
            expect(added.map((row) => row.actor?.id)).toEqual(added.map(() => place.member.id));
            expect(added[added.length - 1]?.to).toBe(lands);
          }
        }
      },
    );

    it("refuses beneath the service every edge V071 does not name, whoever writes", async () => {
      const place = await bench();
      const legal: string[] = [];

      for (const from of STATUSES) {
        for (const to of STATUSES) {
          if (from === to) continue;

          const id = await factIn(place, from);
          const write = api.sql.query(
            `update ${SCHEMA_NAME}.facts
                set status = $2, status_changed_by = $3, status_reason = 'matrix',
                    confirmed_at = case when $2 in ('confirmed', 'stale', 'expired')
                                        then coalesce(confirmed_at, now()) end,
                    expired_reason = case when $2 = 'expired' then 'matrix' end,
                    previous_use_count = case when $2 = 'expired' then 0 end
              where id = $1`,
            [id, to, place.member.id],
          );

          if (FACT_TRANSITIONS.get(from)?.includes(to) === true) {
            await write;
            legal.push(`${from}→${to}`);
          } else {
            await expect(write).rejects.toThrow(/cannot move from|expired fact is frozen/);
          }
        }
      }

      expect(legal).toEqual([
        "proposed→confirmed",
        "proposed→rejected",
        "confirmed→stale",
        "stale→confirmed",
        "stale→expired",
      ]);

      // Born proposed, and nothing else.
      await expect(
        api.sql.query(
          `insert into ${SCHEMA_NAME}.facts (organization_id, text, status, proposer, provenance)
           values ($1, 'born confirmed', 'confirmed', 'manual', '{"line": "x", "refs": []}')`,
          [place.id],
        ),
      ).rejects.toThrow(/created proposed/);
    });
  });

  describe("the staleness sweep", () => {
    it("fires each anchor kind on a matching change, never its twin, never an anchor-less fact", async () => {
      const place = await bench();
      const anchored = (kind: string, value: string) =>
        factIn(place, "confirmed", {
          text: `${kind} ${value}`,
          repoRef: REPO,
          anchors: [{ kind, value }],
        });

      const hits = {
        path: await anchored("path_glob", "tests/hil/**"),
        dependency: await anchored("dependency", "mcuboot"),
        platform: await anchored("platform_version", "zephyr-4.0"),
      };
      const misses = [
        await anchored("path_glob", "docs/**"),
        await anchored("dependency", "lvgl"),
        await anchored("platform_version", "zephyr-3.7"),
      ];
      const bare = await factIn(place, "confirmed", { text: "An anchor-less house rule" });

      await mergedPr(place, 531, ["west.yml", "tests/hil/rig.c", "src/can.c"], WEST_BUMP);

      const sweep = async () =>
        bodyOf<SweepReport>(await as(place.owner, place)("post", `${FACTS}/sweep`).expect(200));
      const report = await sweep();

      expect(report).toMatchObject({ changes: 1, anchors: 6, uncovered: 1 });
      expect(report.flagged.map((flag) => flag.factId).sort()).toEqual(Object.values(hits).sort());
      expect((await read(place, hits.path)).staleness?.reason).toMatch(
        /^path_glob anchor tests\/hil\/\*\* matched: .*\(PR #531\)$/,
      );
      expect((await read(place, hits.dependency)).staleness?.reason).toMatch(
        /^dependency anchor mcuboot matched: .*west\.yml \(PR #531\)$/,
      );
      expect((await read(place, hits.platform)).staleness).toMatchObject({
        actor: null,
        reason:
          'platform_version anchor zephyr-4.0 matched: removed "revision: v4.0.0" in west.yml (PR #531)',
      });
      for (const id of [...misses, bare]) {
        expect((await read(place, id)).status).toBe("confirmed");
      }
      expect((await read(place, bare)).sweep.covered).toBe(false);

      // The same change never flags twice — not on the next pass, not after a re-confirm.
      expect((await sweep()).flagged).toEqual([]);
      await as(place.member, place)("post", `${FACTS}/${hits.path}/reconfirm`).send({}).expect(200);
      expect((await sweep()).flagged).toEqual([]);
    });
  });

  describe("expiry and re-learn", () => {
    it("freezes the expiry snapshot and keeps the audit append-only", async () => {
      const place = await bench();
      const id = await factIn(place, "expired");
      const expired = await read(place, id);

      expect(expired.expiry).toMatchObject({ reason: "gone", previousUseCount: 0 });

      for (const change of [
        "previous_use_count = 31",
        "expired_reason = 'rewritten'",
        "text = 'rewritten'",
      ]) {
        await expect(
          api.sql.query(`update ${SCHEMA_NAME}.facts set ${change} where id = $1`, [id]),
        ).rejects.toThrow(/expired fact is frozen/);
      }
      await expect(
        api.sql.query(
          `update ${SCHEMA_NAME}.fact_transitions set reason = 'rewritten' where fact_id = $1`,
          [id],
        ),
      ).rejects.toThrow(/append-only/);

      // Anchors of a frozen fact do not change either.
      const frozen = bodyOf<ErrorEnvelope>(
        await as(place.member, place)("post", `${FACTS}/${id}/anchors`)
          .send({ kind: "dependency", value: "west" })
          .expect(409),
      );
      expect(frozen.code).toBe("fact_frozen");
      expect(await read(place, id)).toEqual(expired);
    });

    it("chains re-learn lineage through generations, fixed once proposed", async () => {
      const place = await bench();
      const first = await factIn(place, "expired");
      const relearn = async (id: string, text: string) =>
        bodyOf<FactDetail>(
          await as(place.member, place)("post", `${FACTS}/${id}/relearn`)
            .send({ text })
            .expect(201),
        );

      const second = await relearn(first, "Second generation");
      await as(place.member, place)("post", `${FACTS}/${second.id}/confirm`).send({}).expect(200);
      await as(place.member, place)("post", `${FACTS}/${second.id}/expire`)
        .send({ reason: "again" })
        .expect(200);
      const third = await relearn(second.id, "Third generation");
      const sibling = await relearn(first, "A second attempt at the first");

      expect(third).toMatchObject({ status: "proposed", relearnedFromFactId: second.id });
      expect(third.provenance.line).toBe("re-learned after expiry");
      expect([...(await read(place, first)).relearnedByFactIds].sort()).toEqual(
        [second.id, sibling.id].sort(),
      );
      expect(await read(place, second.id)).toMatchObject({
        status: "expired",
        relearnedFromFactId: first,
        relearnedByFactIds: [third.id],
        expiry: { reason: "again" },
      });

      await expect(
        api.sql.query(`update ${SCHEMA_NAME}.facts set relearned_from_fact_id = $2 where id = $1`, [
          third.id,
          first,
        ]),
      ).rejects.toThrow(/lineage is fixed/);
    });
  });

  /**
   * A merged PR of the bench's enabled helios-firmware repository, as the sync would mirror it.
   *
   * @param place - Where.
   * @param number - The PR's number.
   * @param paths - Its changed paths.
   * @param excerpt - Its diff sample.
   */
  async function mergedPr(
    place: Bench,
    number: number,
    paths: string[],
    excerpt: string | null,
  ): Promise<void> {
    const { rows: sources } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.ticket_sources (organization_id, kind, display_name, config)
       values ($1, 'github', 'GitHub · acme-robotics',
               '{"login": "acme-robotics", "repos": ["helios-firmware"]}')
       returning id`,
      [place.id],
    );
    const { rows: orgs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.github_orgs (organization_id, login, enabled)
       values ($1, 'acme-robotics', true) returning id`,
      [place.id],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.github_repos (org_id, name, enabled)
       values ($1, 'helios-firmware', true)`,
      [orgs[0].id],
    );
    const { rows: prs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
              (organization_id, source_id, external_number, external_url, title, head_branch,
               base_branch, state)
       values ($1, $2, $3::integer,
               'https://github.com/acme-robotics/helios-firmware/pull/' || $3::integer,
               'bump', 'loop/bump', 'main', 'open')
       returning id`,
      [place.id, sources[0].id, number],
    );
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.pr_revisions (pr_id, revision_seq, head_sha, pushed_at, files,
                                                diff_excerpt)
       values ($1, 1, 'abc1234', now(), $2::jsonb, $3)`,
      [
        prs[0].id,
        JSON.stringify(paths.map((path) => ({ path, additions: 1, deletions: 1 }))),
        excerpt,
      ],
    );
    await api.sql.query(
      `update ${SCHEMA_NAME}.pull_requests
          set state = 'merged', merged_at = clock_timestamp(), merged_by = 'ken'
        where id = $1`,
      [prs[0].id],
    );
  }
});
