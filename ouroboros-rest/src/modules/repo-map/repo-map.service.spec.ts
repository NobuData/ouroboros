import { Logger } from "@nestjs/common";

import type { AuditRecord } from "../audit/audit.events";
import type { AuditService } from "../audit/audit.service";
import type { DatabaseService } from "../db/db.service";
import type { SkillVersion } from "../db/schema";
import { sourceMissing } from "../detection/detection.errors";
import type { DetectionResource } from "../detection/detection.resources";
import type { NewSkillInput, PublishSkillInput } from "../skills/skills.repository";
import { TicketSourceError } from "../ticket-sources/ticket-source.errors";
import type { RepoFile, RepoTree } from "../ticket-sources/ticket-source.probe";
import { REPO_MAP_ERRORS } from "./repo-map.errors";
import { REPO_MAP_FRONTMATTER } from "./repo-map.render";
import type { MappedRepo, RepoMapRepository, RepoMapSkill } from "./repo-map.repository";
import {
  REGENERATE_INTERVAL_SECONDS,
  RepoMapService,
  type RepoMapReader,
  type RepoMapSkillWriter,
} from "./repo-map.service";

/**
 * The repo-map generator (#415, K2) over an in-memory registry and a fixture repository. The
 * acceptance criteria this file holds:
 *
 *   * run twice with no repository change → **no new version**;
 *   * a structural change (new module, changed CODEOWNERS) → **exactly one** new version;
 *   * generated versions are `origin: generated` and carry their generation timestamp;
 *   * the manual regenerate round-trips and reports when nothing changed;
 *   * the walk is bounded (one tree request, at most one file) and a rate limit is respected.
 */

const WORKSPACE = "acme-robotics-id";
const REPO = "acme-robotics/helios-firmware";
const NIGHT = new Date("2026-09-30T05:12:00.000Z");
const NEXT_NIGHT = new Date("2026-10-01T05:40:00.000Z");

/** One stored skill, with its versions. */
interface StoredSkill {
  id: string;
  input: NewSkillInput;
  currentVersion: number | null;
  versions: SkillVersion[];
}

/** An in-memory registry the service writes through, and the repositories it maps. */
class World {
  readonly skills: StoredSkill[] = [];
  readonly repos: MappedRepo[] = [{ organizationId: WORKSPACE, repo: REPO }];
  readonly audit: AuditRecord[] = [];
  /** Slugs a person's own skills already took. */
  readonly taken = new Set<string>();

  /** The fixture repository. */
  files: Record<string, string> = {
    "app/src/main.c": "int main(void) {}",
    "drivers/can/can.c": "",
    "tests/hil/rig.py": "",
    ".github/CODEOWNERS": "* @acme/firmware\n/drivers/ @acme/platform\n",
  };
  /** The requests the host received. */
  readonly requests: string[] = [];
  /** When set, the host refuses every request with this class. */
  refuse: "rate_limit" | "upstream" | "no_source" | undefined;

  readonly store = {
    enabledRepos: () => Promise.resolve(this.repos),
    skillFor: (organizationId: string, repo: string): Promise<RepoMapSkill | undefined> => {
      const skill = this.skills.find(
        (candidate) =>
          organizationId === WORKSPACE &&
          candidate.input.repoRef === repo &&
          candidate.input.origin === "generated",
      );

      return Promise.resolve(
        skill === undefined
          ? undefined
          : {
              id: skill.id,
              slug: skill.input.slug,
              currentVersion: skill.currentVersion,
              body:
                skill.versions.find((version) => version.version === skill.currentVersion)?.body ??
                null,
            },
      );
    },
    takenSlugs: (_organizationId: string, slugs: readonly string[]) =>
      Promise.resolve(
        slugs.filter(
          (slug) => this.taken.has(slug) || this.skills.some((skill) => skill.input.slug === slug),
        ),
      ),
    mapSkills: () =>
      Promise.resolve(
        this.skills
          .filter((skill) => skill.input.origin === "generated")
          .map((skill) => ({
            repo: skill.input.repoRef ?? "",
            slug: skill.input.slug,
            currentVersion: skill.currentVersion,
          })),
      ),
    // The newest record of each repository — the audit trail's `distinct on`, in memory.
    lastGenerations: () =>
      Promise.resolve(
        [...new Set(this.audit.map((record) => record.subjectId))].flatMap((repo) => {
          const newest = this.audit
            .filter((record) => record.subjectId === repo)
            .sort((a, b) => b.at.getTime() - a.at.getTime())[0];

          return repo === null
            ? []
            : [{ repo, detail: newest.detail ?? {}, occurredAt: newest.at }];
        }),
      ),
  } as unknown as RepoMapRepository;

  readonly writer: RepoMapSkillWriter = {
    create: (_organizationId: string, input: NewSkillInput) => {
      const id = `skill-${String(this.skills.length + 1)}`;

      this.skills.push({ id, input, currentVersion: null, versions: [] });
      this.draft(id, input.body);

      return Promise.resolve(id);
    },
    lock: () => Promise.resolve(undefined),
    draftOf: (skillId: string) =>
      Promise.resolve(this.find(skillId).versions.find((version) => version.version === null)),
    insertDraft: (skillId: string, _frontmatter: unknown, body: string) =>
      Promise.resolve(this.draft(skillId, body)),
    writeDraft: (draftId: string, _frontmatter: unknown, body: string) => {
      const draft = this.skills
        .flatMap((skill) => skill.versions)
        .find((version) => version.id === draftId);

      if (draft !== undefined) draft.body = body;

      return Promise.resolve(draft);
    },
    publish: (skillId: string, draftId: string, input: PublishSkillInput) => {
      const skill = this.find(skillId);
      const draft = skill.versions.find((version) => version.id === draftId);

      if (draft === undefined) throw new Error("no draft");

      const next = (skill.currentVersion ?? 0) + 1;

      Object.assign(draft, {
        version: next,
        published_at: input.publishedAt,
        published_by: input.publishedBy,
        change_note: input.changeNote,
      });
      skill.currentVersion = next;

      return Promise.resolve(draft);
    },
  };

  readonly reader: RepoMapReader = {
    readTree: async (
      _organizationId: string,
      _repo: string,
      pick: (tree: RepoTree) => readonly string[],
    ) => {
      if (this.refuse === "no_source") throw sourceMissing(REPO);

      const tree = this.request("tree", () => this.tree());
      const files = new Map<string, RepoFile | null>();

      for (const path of pick(tree)) {
        files.set(
          path,
          this.request(`file:${path}`, () =>
            this.files[path] === undefined
              ? null
              : { path, content: this.files[path], size: this.files[path].length },
          ),
        );
      }

      return Promise.resolve({ tree, files });
    },
    read: () =>
      Promise.resolve({
        repo: REPO,
        scan: null,
        rows: [
          {
            rowKey: "build",
            verdict: "ok",
            value: "west + twister",
            label: "detected",
            confidence: "high",
            determined: true,
            evidence: {},
          },
        ],
        protectedPaths: [],
        progress: null,
      } satisfies DetectionResource),
  };

  /** The service over this world. */
  service(): RepoMapService {
    const database = {
      transaction: <T>(work: (trx: unknown) => Promise<T>) => work({}),
    } as unknown as DatabaseService;
    const audit = {
      record: (event: AuditRecord) => {
        this.audit.push(event);
        return Promise.resolve("audit-id");
      },
    } as unknown as AuditService;

    return new RepoMapService(this.store, this.reader, this.writer, database, audit);
  }

  /** The published versions of the one map skill. */
  published(): SkillVersion[] {
    return (this.skills[0]?.versions ?? []).filter((version) => version.version !== null);
  }

  private find(skillId: string): StoredSkill {
    const skill = this.skills.find((candidate) => candidate.id === skillId);

    if (skill === undefined) throw new Error(`no skill ${skillId}`);

    return skill;
  }

  private draft(skillId: string, body: string): SkillVersion {
    const draft = {
      id: `${skillId}-v${String(this.find(skillId).versions.length + 1)}`,
      skill_id: skillId,
      version: null,
      body,
      frontmatter: REPO_MAP_FRONTMATTER,
      published_at: null,
      published_by: null,
      change_note: null,
      created_at: NIGHT,
      updated_at: NIGHT,
    } as SkillVersion;

    this.find(skillId).versions.push(draft);

    return draft;
  }

  private tree(): RepoTree {
    const directories = new Set<string>();

    for (const path of Object.keys(this.files)) {
      const segments = path.split("/");
      for (let depth = 1; depth < segments.length; depth += 1) {
        directories.add(segments.slice(0, depth).join("/"));
      }
    }

    return {
      entries: [
        ...[...directories].map((path) => ({ path, type: "dir" as const })),
        ...Object.keys(this.files).map((path) => ({ path, type: "file" as const })),
      ],
      truncated: false,
    };
  }

  private request<T>(key: string, answer: () => T): T {
    this.requests.push(key);

    if (this.refuse === "rate_limit") throw new TicketSourceError("rate_limit", "at the floor");
    if (this.refuse === "upstream") throw new TicketSourceError("upstream", "GitHub answered 502");

    return answer();
  }
}

describe("the repo-map generator", () => {
  let world: World;
  let service: RepoMapService;

  beforeEach(() => {
    world = new World();
    service = world.service();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("publishes v1 on the first run as a generated, enabled repo skill stamped with the run's time", async () => {
    const report = await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);

    expect(report).toMatchObject({
      repo: REPO,
      outcome: "published",
      skill: "repo-map",
      version: 1,
      generatedAt: NIGHT.toISOString(),
      reason: null,
      modules: 6,
    });
    expect(world.skills[0].input).toMatchObject({
      slug: "repo-map",
      origin: "generated",
      scope: "repo",
      repoRef: REPO,
      draft: false,
      frontmatter: REPO_MAP_FRONTMATTER,
    });
    expect(world.published()[0]).toMatchObject({
      version: 1,
      published_at: NIGHT,
      published_by: null,
      change_note: "Nightly rebuild — 6 modules",
    });
    expect(world.published()[0].body).toContain("| `drivers/` | 1 | @acme/platform |");
  });

  it("is stable: a second run with no repository change publishes no new version", async () => {
    await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);
    const second = await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);

    expect(second).toMatchObject({ outcome: "unchanged", skill: "repo-map", version: 1 });
    expect(world.published()).toHaveLength(1);
  });

  it("records every run — including the one that found nothing", async () => {
    await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);
    await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);

    expect(world.audit.map((event) => [event.action, event.detail?.outcome])).toEqual([
      ["knowledge.repo_map_generated", "published"],
      ["knowledge.repo_map_generated", "unchanged"],
    ]);
    expect(world.audit[1]).toMatchObject({
      actorId: null,
      subjectType: "repository",
      subjectId: REPO,
      at: NEXT_NIGHT,
    });
  });

  it("publishes exactly one new version for a new module", async () => {
    await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);
    world.files["subsys/telemetry/frame.c"] = "";

    const changed = await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);
    const again = await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);

    expect(changed).toMatchObject({ outcome: "published", version: 2 });
    expect(again).toMatchObject({ outcome: "unchanged", version: 2 });
    expect(world.published()).toHaveLength(2);
    expect(world.published()[1].body).toContain("`subsys/telemetry/`");
  });

  it("publishes exactly one new version for a changed CODEOWNERS", async () => {
    await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);
    world.files[".github/CODEOWNERS"] += "/tests/hil/ @acme/hil\n";

    await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);
    await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);

    expect(world.published()).toHaveLength(2);
    expect(world.published()[1].body).toContain("| `tests/hil/` | 1 | @acme/hil |");
  });

  it("overwrites a person's unpublished draft of the map when the map changes", async () => {
    await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);
    world.skills[0].versions.push({
      ...world.published()[0],
      id: "hand-edit",
      version: null,
      body: "my edits",
    });
    world.files["lib/x.c"] = "";

    await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);

    expect(world.published()).toHaveLength(2);
    expect(world.published()[1].id).toBe("hand-edit");
    expect(world.published()[1].body).toContain("`lib/`");
  });

  it("takes repo-map-<name> when a hand-made skill already holds repo-map", async () => {
    world.taken.add("repo-map");

    const report = await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);

    expect(report.skill).toBe("repo-map-helios-firmware");
  });

  it("walks bounded: one tree request and one file — the CODEOWNERS the tree holds", async () => {
    await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);

    expect(world.requests).toEqual(["tree", "file:.github/CODEOWNERS"]);
  });

  it("reads no file when the tree holds no CODEOWNERS", async () => {
    delete world.files[".github/CODEOWNERS"];

    const report = await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);

    expect(world.requests).toEqual(["tree"]);
    expect(world.published()[0].body).toContain("_No CODEOWNERS file");
    expect(report.outcome).toBe("published");
  });

  it.each([
    ["rate_limit", "rate_limit"],
    ["upstream", "host_error"],
    ["no_source", "no_source"],
  ] as const)("skips on %s, writing nothing but the record", async (refuse, reason) => {
    await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);
    world.refuse = refuse;

    const report = await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);

    expect(report).toMatchObject({ outcome: "skipped", reason, skill: "repo-map", version: 1 });
    expect(world.published()).toHaveLength(1);
    expect(world.audit.at(-1)?.detail).toMatchObject({ outcome: "skipped", reason });
  });

  it("joins a generation already running for the repository", async () => {
    const [first, second] = await Promise.all([
      service.generate(WORKSPACE, REPO, "nightly", null, NIGHT),
      service.generate(WORKSPACE, REPO, "manual", "ken", NIGHT),
    ]);

    expect(second).toBe(first);
    expect(world.published()).toHaveLength(1);
  });

  describe("where a repository's map stands (#422)", () => {
    it("is pending before any generation has run — no skill, and nothing on the record", async () => {
      await expect(service.status(WORKSPACE)).resolves.toEqual({
        items: [{ repo: REPO, state: "pending", skill: null, version: null, lastReport: null }],
      });
      // Asking is a read: the host was never called.
      expect(world.requests).toEqual([]);
    });

    it("is failed once a first generation was refused, with the report that says why", async () => {
      world.refuse = "upstream";
      await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);

      const { items } = await service.status(WORKSPACE);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        repo: REPO,
        state: "failed",
        skill: null,
        version: null,
        lastReport: {
          outcome: "skipped",
          reason: "host_error",
          trigger: "nightly",
          generatedAt: NIGHT.toISOString(),
        },
      });
    });

    it("is generated once one published — and stays so when a later refresh is refused", async () => {
      await service.generate(WORKSPACE, REPO, "nightly", null, NIGHT);

      expect((await service.status(WORKSPACE)).items[0]).toMatchObject({
        state: "generated",
        skill: "repo-map",
        version: 1,
        lastReport: { outcome: "published" },
      });

      world.refuse = "rate_limit";
      await service.generate(WORKSPACE, REPO, "nightly", null, NEXT_NIGHT);

      // The version in force stays in force; the newest report is what says the refresh failed.
      expect((await service.status(WORKSPACE)).items[0]).toMatchObject({
        state: "generated",
        version: 1,
        lastReport: { outcome: "skipped", reason: "rate_limit" },
      });
    });
  });

  describe("the manual regenerate", () => {
    it("round-trips: publishes, then reports unchanged, attributed to the person", async () => {
      const first = await service.regenerate(WORKSPACE, REPO, "ken", NIGHT);
      const later = new Date(NIGHT.getTime() + (REGENERATE_INTERVAL_SECONDS + 1) * 1000);
      const second = await service.regenerate(
        WORKSPACE,
        "Acme-Robotics/Helios-Firmware",
        "ken",
        later,
      );

      expect(first).toMatchObject({ outcome: "published", version: 1, trigger: "manual" });
      expect(second).toMatchObject({ outcome: "unchanged", version: 1, trigger: "manual" });
      expect(world.published()[0]).toMatchObject({
        published_by: "ken",
        change_note: "Regenerated on request — 6 modules",
      });
      expect(world.audit.map((event) => event.actorId)).toEqual(["ken", "ken"]);
    });

    it("is refused inside the debounce window, naming the wait", async () => {
      await service.regenerate(WORKSPACE, REPO, "ken", NIGHT);

      await expect(
        service.regenerate(WORKSPACE, REPO, "ken", new Date(NIGHT.getTime() + 10_000)),
      ).rejects.toMatchObject({
        code: REPO_MAP_ERRORS.tooSoon,
        details: { retryAfterSeconds: REGENERATE_INTERVAL_SECONDS - 10 },
      });
    });
  });

  describe("the nightly pass", () => {
    it("generates every enabled repository", async () => {
      world.repos.push({ organizationId: WORKSPACE, repo: "acme-robotics/ground-station" });

      const reports = await service.generateAll(NIGHT);

      expect(reports.map((report) => [report.repo, report.outcome])).toEqual([
        [REPO, "published"],
        ["acme-robotics/ground-station", "published"],
      ]);
    });

    it("stops asking a workspace's host after a rate-limit refusal", async () => {
      world.repos.push({ organizationId: WORKSPACE, repo: "acme-robotics/ground-station" });
      world.refuse = "rate_limit";

      const reports = await service.generateAll(NIGHT);

      expect(reports.map((report) => report.reason)).toEqual(["rate_limit", "rate_limit"]);
      expect(world.requests).toEqual(["tree"]);
    });

    it("keeps going past a repository that fails outright", async () => {
      world.repos.unshift({ organizationId: "other", repo: "other/repo" });
      const read = world.reader.read.bind(world.reader);
      let calls = 0;
      (world.reader as { read: RepoMapReader["read"] }).read = (organizationId, repo) => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("database gone"))
          : read(organizationId, repo);
      };

      const reports = await service.generateAll(NIGHT);

      expect(reports.map((report) => report.repo)).toEqual([REPO]);
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });
});
