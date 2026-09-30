/**
 * The OpenAPI document and what the import routes send
 * ([#413](https://github.com/NobuData/ouroboros/issues/413)). `openapi.spec.ts` sees these routes
 * only unauthenticated, so real service answers — an empty preview, a full one, an apply — are held
 * to the documented schemas here, all of them closed.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { CLAUDE_MD, CURSORRULES, IMPORT_REPO } from "./rule-import.fixture";
import { RuleImportService } from "./rule-import.service";
import {
  FixtureReader,
  IMPORT_ACTOR,
  IMPORT_WORKSPACE,
  ImportWorld,
  RecordingAudit,
} from "./rule-import.store.fixture";

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Fact ids as the database mints them — the fixture's are not uuids. */
const UUID = "0a1b2c3d-0000-4000-8000-00000000abcd";

/**
 * A service over a fresh world.
 *
 * @param files - The repository's files.
 * @returns The service.
 */
function service(files: Record<string, string>): RuleImportService {
  const world = new ImportWorld();

  return new RuleImportService(
    world.store(),
    world.skills(),
    world.facts(),
    world.database(),
    new FixtureReader(files),
    new RecordingAudit(),
  );
}

describe("the import routes and the document", () => {
  it("sends what RuleImportPreview describes, empty or full", async () => {
    const empty = await service({}).preview(IMPORT_WORKSPACE, IMPORT_REPO);
    const full = await service({ "CLAUDE.md": CLAUDE_MD, ".cursorrules": CURSORRULES }).preview(
      IMPORT_WORKSPACE,
      IMPORT_REPO,
    );

    expect(validatorFor("RuleImportPreview")(wire(empty))).toBeUndefined();
    expect(validatorFor("RuleImportPreview")(wire(full))).toBeUndefined();
  });

  it("sends what RuleImportResult describes", async () => {
    const imports = service({ "CLAUDE.md": CLAUDE_MD, ".cursorrules": CURSORRULES });
    const preview = await imports.preview(IMPORT_WORKSPACE, IMPORT_REPO);
    const result = await imports.apply(
      IMPORT_WORKSPACE,
      IMPORT_REPO,
      preview.fingerprint,
      IMPORT_ACTOR,
    );
    const onWire = {
      ...result,
      created: { ...result.created, facts: result.created.facts.map((f) => ({ ...f, id: UUID })) },
    };

    expect(validatorFor("RuleImportResult")(wire(onWire))).toBeUndefined();
  });

  it("refuses an undocumented field — the schemas are closed", async () => {
    const preview = wire(await service({}).preview(IMPORT_WORKSPACE, IMPORT_REPO)) as object;

    expect(validatorFor("RuleImportPreview")({ ...preview, surprise: 1 })).toMatch(/unevaluated/);
    expect(validatorFor("RuleImportPreview")({ ...preview, created: {} })).toMatch(/unevaluated/);
  });
});
