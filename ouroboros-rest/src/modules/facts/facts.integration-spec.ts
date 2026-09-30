import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import type { FactDetail, FactList, FactNeedsYou } from "./facts.resources";
import type { SweepReport } from "./facts.sweep";

/**
 * The fact lifecycle and the staleness sweep against a migrated database, through the whole
 * pipeline — BF.2 ([#411](https://github.com/NobuData/ouroboros/issues/411)).
 *
 * What the unit suites cannot hold alone, because it is about PostgreSQL's rules and the guards
 * together:
 *
 *   * every transition is written through V071's triggers — the audit row with its actor, the
 *     expiry snapshot, re-learn's lineage — and a manual expire of a confirmed fact lands as two
 *     audited edges the database accepts;
 *   * members and above decide, a viewer reads;
 *   * a merged PR changing the Zephyr platform pin flags the right fact stale, recording the
 *     anchor, and a non-matching path glob does not fire;
 *   * another workspace's fact is a `404` on every route.
 */

const FACTS = "/api/v1/facts";

/** The Zephyr 4.0 → 4.1 move, as `diffExcerptOf` samples west.yml. */
const ZEPHYR_BUMP = [
  "--- west.yml",
  "@@ -10,7 +10,7 @@ manifest:",
  "     - name: zephyr",
  "       remote: zephyrproject-rtos",
  "-      revision: v4.0.0",
  "+      revision: v4.1.0",
].join("\n");

describe("the fact lifecycle, against a migrated database", () => {
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

  /** A workspace, its owner, a member and a viewer. */
  interface Bench {
    owner: Person;
    member: Person;
    viewer: Person;
    id: string;
    slug: string;
  }

  /**
   * @param tag - Distinguishes two benches' people.
   * @returns A workspace with an owner, a member and a viewer.
   */
  async function bench(tag = "a"): Promise<Bench> {
    const owner = await api.signIn({ email: `owner-${tag}@ouroboros.invalid` });
    const member = await api.signIn({ email: `member-${tag}@ouroboros.invalid` });
    const viewer = await api.signIn({ email: `viewer-${tag}@ouroboros.invalid` });
    const workspace = await api.workspace(owner);

    await api.join(workspace.id, member, "member");
    await api.join(workspace.id, viewer, "viewer");

    return { owner, member, viewer, id: workspace.id, slug: workspace.slug };
  }

  /** A request as somebody, in a bench's workspace. */
  function as(person: Person, place: Bench) {
    return (method: "get" | "post" | "delete", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, place.slug);
  }

  /**
   * Propose and confirm a fact as the bench's member.
   *
   * @param place - Where.
   * @param body - The proposal.
   * @returns The confirmed fact.
   */
  async function confirmed(place: Bench, body: Record<string, unknown>): Promise<FactDetail> {
    const proposal = bodyOf<FactDetail>(
      await as(place.member, place)("post", FACTS).send(body).expect(201),
    );

    return bodyOf<FactDetail>(
      await as(place.member, place)("post", `${FACTS}/${proposal.id}/confirm`).send({}).expect(200),
    );
  }

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
      `select id from ${SCHEMA_NAME}.ticket_sources where organization_id = $1`,
      [place.id],
    );
    let sourceId = sources[0]?.id;

    if (sourceId === undefined) {
      const { rows } = await api.sql.query<{ id: string }>(
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
      sourceId = rows[0].id;
    }

    const { rows: prs } = await api.sql.query<{ id: string }>(
      `insert into ${SCHEMA_NAME}.pull_requests
              (organization_id, source_id, external_number, external_url, title, head_branch,
               base_branch, state)
       values ($1, $2, $3::integer,
               'https://github.com/acme-robotics/helios-firmware/pull/' || $3::integer,
               'bump', 'loop/bump', 'main', 'open')
       returning id`,
      [place.id, sourceId, number],
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

  it("walks propose → confirm → expire → re-learn through V071's triggers, audited", async () => {
    const place = await bench();

    const fact = await confirmed(place, {
      text: "Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`",
      repoRef: "acme-robotics/helios-firmware",
      anchors: [{ kind: "platform_version", value: "zephyr-4.0" }],
    });
    expect(fact.status).toBe("confirmed");
    expect(fact.confirmation?.actor?.id).toBe(place.member.id);
    expect(fact.history.map((row) => [row.from, row.to])).toEqual([
      [null, "proposed"],
      ["proposed", "confirmed"],
    ]);

    // A manual expire of a confirmed fact is two edges the database accepts.
    const expired = bodyOf<FactDetail>(
      await as(place.owner, place)("post", `${FACTS}/${fact.id}/expire`)
        .send({ reason: "Zephyr 4.1 migration" })
        .expect(200),
    );
    expect(expired).toMatchObject({
      status: "expired",
      expiry: { reason: "Zephyr 4.1 migration", previousUseCount: 0 },
    });
    expect(expired.history.slice(-2).map((row) => [row.from, row.to, row.actor?.id])).toEqual([
      ["confirmed", "stale", place.owner.id],
      ["stale", "expired", place.owner.id],
    ]);

    const relearned = bodyOf<FactDetail>(
      await as(place.member, place)("post", `${FACTS}/${fact.id}/relearn`)
        .send({ text: "Zephyr 4.1 drops `CONFIG_LEGACY_TIMER`" })
        .expect(201),
    );
    expect(relearned).toMatchObject({ status: "proposed", relearnedFromFactId: fact.id });

    const original = bodyOf<FactDetail>(
      await as(place.viewer, place)("get", `${FACTS}/${fact.id}`).expect(200),
    );
    expect(original).toMatchObject({
      status: "expired",
      relearnedByFactIds: [relearned.id],
      expiry: { previousUseCount: 0 },
    });
  });

  it("lets a viewer read but not decide, and a member not sweep", async () => {
    const place = await bench();
    const proposal = bodyOf<FactDetail>(
      await as(place.member, place)("post", FACTS)
        .send({ text: "PID gains live in config" })
        .expect(201),
    );

    await as(place.viewer, place)("get", FACTS).expect(200);
    await as(place.viewer, place)("get", `${FACTS}/needs-you`).expect(200);
    await as(place.viewer, place)("post", `${FACTS}/${proposal.id}/confirm`).send({}).expect(403);
    await as(place.viewer, place)("post", FACTS).send({ text: "x" }).expect(403);
    await as(place.member, place)("post", `${FACTS}/sweep`).expect(403);
  });

  it("refuses an impossible transition with its stated reason", async () => {
    const place = await bench();
    const proposal = bodyOf<FactDetail>(
      await as(place.member, place)("post", FACTS).send({ text: "a proposal" }).expect(201),
    );

    const refused = bodyOf<ErrorEnvelope>(
      await as(place.member, place)("post", `${FACTS}/${proposal.id}/expire`)
        .send({ reason: "why" })
        .expect(409),
    );
    expect(refused).toMatchObject({
      code: "fact_transition_refused",
      details: { from: "proposed", to: "expired" },
    });

    await as(place.member, place)("post", `${FACTS}/${proposal.id}/expire`).send({}).expect(422);
  });

  it("flags the right fact stale when the platform pin moves, recording the anchor", async () => {
    const place = await bench();
    const zephyr = await confirmed(place, {
      text: "Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`",
      repoRef: "acme-robotics/helios-firmware",
      anchors: [{ kind: "platform_version", value: "zephyr-4.0" }],
    });
    const hil = await confirmed(place, {
      text: "Tests under `tests/hil/` require rig reservation",
      repoRef: "acme-robotics/helios-firmware",
      anchors: [{ kind: "path_glob", value: "tests/hil/**" }],
    });
    await confirmed(place, { text: "An anchor-less house rule" });

    await mergedPr(place, 531, ["west.yml", "tests/unit/can.c"], ZEPHYR_BUMP);

    const report = bodyOf<SweepReport>(
      await as(place.owner, place)("post", `${FACTS}/sweep`).expect(200),
    );
    expect(report).toMatchObject({ changes: 1, anchors: 2, uncovered: 1 });
    expect(report.flagged.map((flag) => flag.factId)).toEqual([zephyr.id]);

    const flagged = bodyOf<FactDetail>(
      await as(place.member, place)("get", `${FACTS}/${zephyr.id}`).expect(200),
    );
    expect(flagged.status).toBe("stale");
    expect(flagged.staleness).toMatchObject({
      actor: null,
      reason:
        'platform_version anchor zephyr-4.0 matched: removed "revision: v4.0.0" in west.yml (PR #531)',
    });
    const untouched = bodyOf<FactDetail>(
      await as(place.member, place)("get", `${FACTS}/${hil.id}`).expect(200),
    );
    expect(untouched.status).toBe("confirmed");

    const feed = bodyOf<FactNeedsYou>(
      await as(place.member, place)("get", `${FACTS}/needs-you`).expect(200),
    );
    expect(feed.items).toEqual([
      expect.objectContaining({ kind: "fact_review", factId: zephyr.id, reason: "stale" }),
    ]);

    // A person looks, and it still holds.
    await as(place.member, place)("post", `${FACTS}/${zephyr.id}/reconfirm`).send({}).expect(200);
  });

  it("keeps every fact route inside its workspace", async () => {
    const mine = await bench("a");
    const theirs = await bench("b");
    const fact = bodyOf<FactDetail>(
      await as(mine.member, mine)("post", FACTS).send({ text: "mine" }).expect(201),
    );
    const anchored = bodyOf<FactDetail>(
      await as(mine.member, mine)("post", `${FACTS}/${fact.id}/anchors`)
        .send({ kind: "dependency", value: "west" })
        .expect(201),
    );
    const anchorId = anchored.anchors[0]?.id ?? "";
    const stranger = as(theirs.owner, theirs);

    await stranger("get", `${FACTS}/${fact.id}`).expect(404);
    for (const action of ["confirm", "reject", "reconfirm", "relearn"]) {
      await stranger("post", `${FACTS}/${fact.id}/${action}`).send({}).expect(404);
    }
    await stranger("post", `${FACTS}/${fact.id}/expire`).send({ reason: "x" }).expect(404);
    await stranger("post", `${FACTS}/${fact.id}/anchors`)
      .send({ kind: "dependency", value: "zephyr" })
      .expect(404);
    await stranger("delete", `${FACTS}/${fact.id}/anchors/${anchorId}`).expect(404);

    const list = bodyOf<FactList>(await stranger("get", FACTS).expect(200));
    expect(list.items).toEqual([]);
    const feed = bodyOf<FactNeedsYou>(await stranger("get", `${FACTS}/needs-you`).expect(200));
    expect(feed.count).toBe(0);
    const report = bodyOf<SweepReport>(await stranger("post", `${FACTS}/sweep`).expect(200));
    expect(report.anchors).toBe(0);
  });
});
