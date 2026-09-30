import { join } from "node:path";

import { GoldenFile } from "../../testing/golden.fixture";
import { ApiHarness, type Person } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { KNOWLEDGE_IMPORTED_EVENT } from "../audit/audit.events";
import { SCHEMA_NAME } from "../db/schema";
import { DetectionService } from "../detection/detection.service";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { RULE_IMPORT_ERRORS } from "./rule-import.errors";
import { CLAUDE_MD, CURSORRULES, IMPORT_REPO } from "./rule-import.fixture";
import type { RuleImportPreview, RuleImportResult } from "./rule-import.resources";
import { FixtureReader } from "./rule-import.store.fixture";

/**
 * The rule-file import against a migrated database, through the whole pipeline — BF.7's
 * **Import** row ([#416](https://github.com/NobuData/ouroboros/issues/416)) over BF.4
 * ([#413](https://github.com/NobuData/ouroboros/issues/413)).
 *
 * The repository is the one seam replaced: `DetectionService` is swapped for the unit suite's
 * `FixtureReader` over the checked-in `CLAUDE.md` and `.cursorrules`, so everything from the
 * route to V069's and V071's triggers is the real thing. What it certifies:
 *
 *   * **golden output** — what an apply of the fixtures leaves in the database, held to
 *     `rule-import.golden.json`, so a parse change is a reviewed diff and never a silent one;
 *   * **preview equals apply** — the apply answers exactly the preview, and writes exactly what
 *     it answered;
 *   * **idempotent re-import** — a second apply of the same files writes nothing;
 *   * **everything gated** — every skill a `draft`, `imported`, with no published version; every
 *     fact `proposed`, proposer `import`, confirmed by nobody;
 *   * **empty-repo honesty** — a repository with no rules file is a `200` saying so, not an error
 *     and not invented content.
 *
 * ```bash
 * yarn test:integration src/modules/knowledge-import
 * ```
 */

const PREVIEW = "/api/v1/knowledge/import/preview";
const APPLY = "/api/v1/knowledge/import/apply";

/** The committed golden, beside this suite. */
const GOLDEN_PATH = join(__dirname, "rule-import.golden.json");

/** The command that rewrites {@link GOLDEN_PATH}. */
const REGENERATE =
  "OURO_UPDATE_GOLDENS=1 yarn test:integration src/modules/knowledge-import/rule-import.integration-spec.ts";

/** One imported skill as the database holds it, with its only version. */
interface StoredSkill {
  slug: string;
  name: string;
  description: string;
  scope: string;
  repo_ref: string | null;
  origin: string;
  draft: boolean;
  enabled: boolean;
  current_version: number | null;
  versions: { version: number | null; published: boolean; frontmatter: unknown; body: string }[];
}

/** One imported fact as the database holds it. */
interface StoredFact {
  text: string;
  status: string;
  proposer: string;
  repo_ref: string | null;
  provenance: unknown;
  confirmed_by: string | null;
}

describe("the rule-file import, against a migrated database", () => {
  const reader = new FixtureReader();
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start({}, [{ provide: DetectionService, useValue: reader }]);
  });

  afterAll(async () => {
    await api.close();
  });

  beforeEach(() => {
    reader.files = { "CLAUDE.md": CLAUDE_MD, ".cursorrules": CURSORRULES };
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

  /** A request as somebody, in the bench's workspace. */
  function as(person: Person, place: Bench) {
    return (path: string, body: Record<string, unknown>) =>
      api.as(person)("post", path).set(TENANT_HEADER, place.slug).send(body);
  }

  /**
   * Preview as the owner.
   *
   * @param place - Where.
   * @returns The preview.
   */
  async function preview(place: Bench): Promise<RuleImportPreview> {
    return bodyOf<RuleImportPreview>(
      await as(place.owner, place)(PREVIEW, { repo: IMPORT_REPO }).expect(200),
    );
  }

  /**
   * Apply a fingerprint as the owner.
   *
   * @param place - Where.
   * @param fingerprint - The preview's.
   * @returns The result.
   */
  async function apply(place: Bench, fingerprint: string): Promise<RuleImportResult> {
    return bodyOf<RuleImportResult>(
      await as(place.owner, place)(APPLY, { repo: IMPORT_REPO, fingerprint }).expect(200),
    );
  }

  /**
   * The workspace's skills, each with its versions, in slug order.
   *
   * @param place - Where.
   * @returns The rows.
   */
  async function storedSkills(place: Bench): Promise<StoredSkill[]> {
    const { rows } = await api.sql.query<StoredSkill>(
      `select s.slug, s.name, s.description, s.scope, s.repo_ref, s.origin, s.draft, s.enabled,
              s.current_version,
              (select jsonb_agg(jsonb_build_object(
                        'version', v.version, 'published', v.published_at is not null,
                        'frontmatter', v.frontmatter, 'body', v.body)
                        order by v.created_at, v.id)
                 from ${SCHEMA_NAME}.skill_versions v where v.skill_id = s.id) as versions
         from ${SCHEMA_NAME}.skills s
        where s.organization_id = $1
        order by s.slug`,
      [place.id],
    );

    return rows;
  }

  /**
   * The workspace's facts, by text — one apply writes them in one transaction, so they share a
   * `created_at` and the order they were written in is not the database's to give back.
   *
   * @param place - Where.
   * @returns The rows.
   */
  async function storedFacts(place: Bench): Promise<StoredFact[]> {
    const { rows } = await api.sql.query<StoredFact>(
      `select text, status, proposer, repo_ref, provenance, confirmed_by
         from ${SCHEMA_NAME}.facts
        where organization_id = $1
        order by text`,
      [place.id],
    );

    return rows;
  }

  it("leaves exactly the golden output in the database — every skill a draft, every fact proposed", async () => {
    const place = await bench();
    const golden = new GoldenFile(
      GOLDEN_PATH,
      `The fixtures' preview and what their apply stores. Regenerate with: ${REGENERATE}`,
      REGENERATE,
    );

    const previewed = await preview(place);
    await apply(place, previewed.fingerprint);

    const skills = await storedSkills(place);
    const facts = await storedFacts(place);

    golden.hold("preview", previewed);
    golden.hold("skills", skills);
    golden.hold("facts", facts);
    golden.save();

    // Gated, whatever the golden says: nothing an apply writes can change how a run behaves.
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill).toMatchObject({ origin: "imported", draft: true, current_version: null });
      expect(skill.versions.every((version) => !version.published)).toBe(true);
    }
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact).toMatchObject({ status: "proposed", proposer: "import", confirmed_by: null });
    }
  });

  it("applies exactly the preview, writes exactly what it answered, and audits the actor", async () => {
    const place = await bench();

    const previewed = await preview(place);
    // A preview writes nothing.
    expect(await storedSkills(place)).toEqual([]);
    expect(await storedFacts(place)).toEqual([]);

    const result = await apply(place, previewed.fingerprint);
    const { created, ...answered } = result;

    expect(answered).toEqual(previewed);
    expect(created.skills).toHaveLength(previewed.totals.skillDrafts);
    expect(created.facts).toHaveLength(previewed.totals.factCandidates);
    expect((await storedSkills(place)).map((skill) => skill.slug).sort()).toEqual(
      created.skills.map((skill) => skill.slug).sort(),
    );
    expect((await storedFacts(place)).map((fact) => fact.text).sort()).toEqual(
      created.facts.map((fact) => fact.text).sort(),
    );

    const { rows: audit } = await api.sql.query<{
      actor_id: string;
      detail: { fingerprint: string };
    }>(
      `select actor_id, detail from ${SCHEMA_NAME}.audit_events
        where organization_id = $1 and action = $2`,
      [place.id, KNOWLEDGE_IMPORTED_EVENT],
    );
    expect(audit).toEqual([
      expect.objectContaining({
        actor_id: place.owner.id,
        detail: expect.objectContaining({ fingerprint: previewed.fingerprint }) as unknown,
      }),
    ]);
  });

  it("writes nothing on a re-import of unchanged files, and refuses a stale fingerprint", async () => {
    const place = await bench();
    const first = await preview(place);
    await apply(place, first.fingerprint);
    const skills = await storedSkills(place);
    const facts = await storedFacts(place);

    const again = await preview(place);
    expect(again.totals).toMatchObject({ skillDrafts: 0, skillUpdates: 0, factCandidates: 0 });
    // Everything the first apply wrote is now what the second dedupes against.
    expect(again.totals.dedupedFacts).toBe(first.totals.factCandidates + first.totals.dedupedFacts);

    const reapplied = await apply(place, again.fingerprint);
    expect(reapplied.created).toEqual({ skills: [], facts: [] });
    expect(await storedSkills(place)).toEqual(skills);
    expect(await storedFacts(place)).toEqual(facts);

    // The first preview no longer describes the workspace: applying it is refused, not replayed.
    const stale = bodyOf<ErrorEnvelope>(
      await as(place.owner, place)(APPLY, {
        repo: IMPORT_REPO,
        fingerprint: first.fingerprint,
      }).expect(409),
    );
    expect(stale.code).toBe(RULE_IMPORT_ERRORS.previewStale);
    expect(await storedFacts(place)).toEqual(facts);
  });

  it("answers a repository with no rules file honestly: found nothing, planned nothing, wrote nothing", async () => {
    const place = await bench();
    reader.files = {};

    const empty = await preview(place);
    expect(empty.totals).toEqual({
      filesFound: 0,
      skillDrafts: 0,
      skillUpdates: 0,
      factCandidates: 0,
      dedupedSkills: 0,
      dedupedFacts: 0,
    });
    expect(empty.files.length).toBeGreaterThan(0);
    for (const file of empty.files) {
      expect(file).toMatchObject({
        found: false,
        sizeBytes: 0,
        skills: { planned: 0, samples: [] },
        facts: { planned: 0, samples: [] },
      });
    }

    const result = await apply(place, empty.fingerprint);
    expect(result.created).toEqual({ skills: [], facts: [] });
    expect(await storedSkills(place)).toEqual([]);
    expect(await storedFacts(place)).toEqual([]);
  });

  it("keeps the import an administrator's, like creating a skill", async () => {
    const place = await bench();
    const { fingerprint } = await preview(place);

    await as(place.member, place)(PREVIEW, { repo: IMPORT_REPO }).expect(403);
    await as(place.member, place)(APPLY, { repo: IMPORT_REPO, fingerprint }).expect(403);
    expect(await storedFacts(place)).toEqual([]);
  });
});
