import {
  PRIMARY_REPO,
  workspaceWithRepo,
  type SeededWorkspace,
} from "../../testing/dashboard.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { KNOWLEDGE_REPO_MAP_GENERATED_EVENT } from "../audit/audit.events";
import { SCHEMA_NAME } from "../db/schema";
import { DetectionService } from "../detection/detection.service";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { RepoFile, RepoTree } from "../ticket-sources/ticket-source.probe";
import type { RepoMapReport, RepoMapStatusList } from "./repo-map.resources";
import { RepoMapService, type RepoMapReader } from "./repo-map.service";

/**
 * The repo-map generator against a migrated database — BF.7's certification of BF.6's generator
 * ([#416](https://github.com/NobuData/ouroboros/issues/416),
 * [#415](https://github.com/NobuData/ouroboros/issues/415), decision **K2**).
 *
 * **Diff-aware, so each version marks a real change**, held against V069's `skill_versions`
 * rather than the unit suite's in-memory registry:
 *
 *   * a generation over an unchanged repository writes no version — manual or nightly;
 *   * a changed repository writes exactly one, and the next unchanged pass writes none again;
 *   * every generation is audited with its outcome, the ones that found nothing included.
 *
 * **Pending is not failed** (BG.6, [#422](https://github.com/NobuData/ouroboros/issues/422)): the
 * status read tells a map nobody has generated from one whose generation was refused, out of that
 * same audit trail — which is why it is held here, against the real `audit_events`.
 *
 * The repository is read through `DetectionService`, which this suite replaces with an in-memory
 * host: the host's own request walk is `repo-map.service.spec.ts`'s subject, and what is asserted
 * here is what the registry holds afterwards.
 */

const REPO_MAP = "/api/v1/knowledge/repo-map";

/** An in-memory repository host, playing `DetectionService`'s two reads. */
class FakeHost implements RepoMapReader {
  /** The repository's files, by path. */
  files: Record<string, string> = {
    "app/src/main.c": "int main(void) {}",
    "drivers/can/can.c": "",
    "tests/hil/rig.py": "",
    ".github/CODEOWNERS": "* @acme/firmware\n/drivers/ @acme/platform\n",
  };

  /** When set, the host refuses every read with this — a generation is then skipped (#422). */
  refusal: TicketSourceError | undefined;

  /**
   * The tree and the files the generator picks from it.
   *
   * @param _organizationId - Unused: one repository.
   * @param _repo - Unused.
   * @param pick - The generator's choice of files.
   * @returns The listing.
   */
  readTree(
    _organizationId: string,
    _repo: string,
    pick: (tree: RepoTree) => readonly string[],
  ): ReturnType<RepoMapReader["readTree"]> {
    if (this.refusal !== undefined) return Promise.reject(this.refusal);

    const dirs = new Set<string>();

    for (const path of Object.keys(this.files)) {
      const parts = path.split("/");
      for (let depth = 1; depth < parts.length; depth += 1) {
        dirs.add(parts.slice(0, depth).join("/"));
      }
    }

    const tree: RepoTree = {
      entries: [
        ...[...dirs].sort().map((path) => ({ path, type: "dir" as const })),
        ...Object.keys(this.files)
          .sort()
          .map((path) => ({ path, type: "file" as const })),
      ],
      truncated: false,
    };
    const files = new Map<string, RepoFile | null>();

    for (const path of pick(tree)) {
      const content = this.files[path];
      files.set(path, content === undefined ? null : { path, content, size: content.length });
    }

    return Promise.resolve({ tree, files });
  }

  /**
   * No stored detections — the map is drawn from the tree and CODEOWNERS alone.
   *
   * @param _organizationId - Unused.
   * @param repo - The repository.
   * @returns An empty detection resource.
   */
  read(_organizationId: string, repo: string): ReturnType<RepoMapReader["read"]> {
    return Promise.resolve({ repo, scan: null, rows: [] } as unknown as Awaited<
      ReturnType<RepoMapReader["read"]>
    >);
  }
}

describe("the repo-map generator, against a migrated database", () => {
  let api: ApiHarness;
  let host: FakeHost;
  let generator: RepoMapService;

  beforeAll(async () => {
    host = new FakeHost();
    api = await ApiHarness.start({}, [{ provide: DetectionService, useValue: host }]);
    generator = api.nest.get(RepoMapService);
  });

  afterAll(async () => {
    await api.close();
  });

  afterEach(async () => {
    host.files = new FakeHost().files;
    host.refusal = undefined;
    await api.truncate();
  });

  /** A workspace with one enabled repository, and its owner. */
  async function bench(): Promise<{ owner: Person; workspace: SeededWorkspace; repo: string }> {
    const owner = await api.signIn({ email: "owner@ouroboros.invalid" });
    const workspace = await workspaceWithRepo(api, owner);

    return { owner, workspace, repo: `${workspace.slug}/${PRIMARY_REPO}`.toLowerCase() };
  }

  /**
   * The published versions of the workspace's map skill.
   *
   * @param organizationId - The workspace.
   * @returns `[version, body]`, oldest first.
   */
  async function versions(organizationId: string): Promise<[number, string][]> {
    const { rows } = await api.sql.query<{ version: number; body: string }>(
      `select sv.version, sv.body
         from ${SCHEMA_NAME}.skill_versions sv
         join ${SCHEMA_NAME}.skills s on s.id = sv.skill_id
        where s.organization_id = $1 and s.origin = 'generated' and sv.version is not null
        order by sv.version`,
      [organizationId],
    );

    return rows.map((row) => [row.version, row.body]);
  }

  it("writes no version when nothing changed, and exactly one when something did", async () => {
    const { owner, workspace, repo } = await bench();

    const first = bodyOf<RepoMapReport>(
      await api
        .as(owner)("post", `${REPO_MAP}/regenerate`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ repo })
        .expect(200),
    );
    expect(first).toMatchObject({ outcome: "published", skill: "repo-map", version: 1 });
    expect(await versions(workspace.id)).toHaveLength(1);

    // The button is debounced; the generator behind it is what is under test.
    const refused = bodyOf<ErrorEnvelope>(
      await api
        .as(owner)("post", `${REPO_MAP}/regenerate`)
        .set(TENANT_HEADER, workspace.slug)
        .send({ repo })
        .expect(409),
    );
    expect(refused.code).toBe("repo_map_regenerate_too_soon");

    // No change: no version, manually or nightly.
    expect(await generator.generate(workspace.id, repo, "manual", owner.id)).toMatchObject({
      outcome: "unchanged",
      version: 1,
    });
    expect(await generator.generateAll()).toEqual([
      expect.objectContaining({ repo, outcome: "unchanged", version: 1 }),
    ]);
    expect(await versions(workspace.id)).toHaveLength(1);

    // A structural change — a new module — is exactly one version.
    host.files["drivers/imu/imu.c"] = "";
    expect(await generator.generateAll()).toEqual([
      expect.objectContaining({ repo, outcome: "published", version: 2 }),
    ]);
    const after = await versions(workspace.id);
    expect(after.map(([version]) => version)).toEqual([1, 2]);
    expect(after[1][1]).toContain("drivers/imu");
    expect(after[0][1]).not.toContain("drivers/imu");

    // And the night after, with nothing new, is none again.
    expect(await generator.generate(workspace.id, repo, "nightly", null)).toMatchObject({
      outcome: "unchanged",
      version: 2,
    });
    expect(await versions(workspace.id)).toHaveLength(2);

    // Every generation is on the record, the ones that found nothing included.
    const { rows: audited } = await api.sql.query<{ outcome: string }>(
      `select detail->>'outcome' as outcome from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = $2`,
      [workspace.id, KNOWLEDGE_REPO_MAP_GENERATED_EVENT],
    );
    expect(audited.map((row) => row.outcome).sort()).toEqual([
      "published",
      "published",
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
  });
  it("says where a map stands — pending, then failed, then generated — to every member (#422)", async () => {
    const { owner, workspace, repo } = await bench();
    const member = await api.signIn({ email: "member@ouroboros.invalid" });

    await api.join(workspace.id, member, "member");

    /** The status, as one person reads it. */
    const statusFor = async (person: Person): Promise<RepoMapStatusList> =>
      bodyOf<RepoMapStatusList>(
        await api.as(person)("get", REPO_MAP).set(TENANT_HEADER, workspace.slug).expect(200),
      );

    // Nothing attempted: pending, with nothing on the record — and a member may read it.
    expect((await statusFor(member)).items).toEqual([
      { repo, state: "pending", skill: null, version: null, lastReport: null },
    ]);

    // A generation the host refuses writes no skill — and is on the record, so the map is failed.
    host.refusal = new TicketSourceError("auth", "the stored credential could not be opened");
    await generator.generate(workspace.id, repo, "nightly", null);

    const [failed] = (await statusFor(member)).items;

    expect(failed).toMatchObject({
      repo,
      state: "failed",
      skill: null,
      version: null,
      lastReport: { outcome: "skipped", reason: "host_error", trigger: "nightly" },
    });
    expect(await versions(workspace.id)).toHaveLength(0);

    // The host answers: the first version is published, and the map is generated.
    host.refusal = undefined;
    await generator.generate(workspace.id, repo, "manual", owner.id);

    expect((await statusFor(owner)).items).toEqual([
      expect.objectContaining({ repo, state: "generated", skill: "repo-map", version: 1 }),
    ]);

    // A later refusal leaves the version in force: still generated, the newest report says why
    // the refresh did not happen.
    host.refusal = new TicketSourceError("rate_limit", "at the floor");
    await generator.generate(workspace.id, repo, "nightly", null);

    expect((await statusFor(owner)).items[0]).toMatchObject({
      state: "generated",
      version: 1,
      lastReport: { outcome: "skipped", reason: "rate_limit" },
    });
  });

  it("lists every enabled repository of the workspace, and none of another's (#422)", async () => {
    const { owner, workspace, repo } = await bench();
    const stranger = await api.signIn({ email: "stranger@ouroboros.invalid" });
    const elsewhere = await workspaceWithRepo(api, stranger);

    await generator.generate(
      elsewhere.id,
      `${elsewhere.slug}/${PRIMARY_REPO}`.toLowerCase(),
      "nightly",
      null,
    );

    const mine = bodyOf<RepoMapStatusList>(
      await api.as(owner)("get", REPO_MAP).set(TENANT_HEADER, workspace.slug).expect(200),
    );

    // The other workspace generated its map; this one's is untouched by that, and names only
    // this workspace's repository.
    expect(mine.items).toEqual([
      { repo, state: "pending", skill: null, version: null, lastReport: null },
    ]);
  });
});
