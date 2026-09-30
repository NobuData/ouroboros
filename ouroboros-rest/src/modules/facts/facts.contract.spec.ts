/**
 * The OpenAPI document and what the fact routes send
 * ([#411](https://github.com/NobuData/ouroboros/issues/411)). `openapi.spec.ts` sees these routes only
 * unauthenticated, so this is where real service answers — every status, a stale flag with its
 * reason, an expiry snapshot, a re-learn's lineage, the needs-you feed and a sweep report — are held
 * to the documented schemas, all of them closed.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { DatabaseService } from "../db/db.service";
import { FactsService } from "./facts.service";
import { FactStore } from "./facts.store.fixture";
import { FactSweepService } from "./facts.sweep";

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

const ORG = "acme-robotics";

describe("the fact routes and the document", () => {
  let store: FactStore;
  let facts: FactsService;
  let sweep: FactSweepService;

  beforeEach(() => {
    store = new FactStore();
    store.people.set("user-ken", "Ken");
    const repo = store.asRepository();
    const database = {
      transaction: jest.fn((work: (trx: unknown) => Promise<unknown>) => work({})),
    } as unknown as DatabaseService;
    facts = new FactsService(repo, database);
    sweep = new FactSweepService(repo);
  });

  it("sends what FactList, FactDetail and FactNeedsYou describe, at every status", async () => {
    const runId = "0a1b2c3d-0000-4000-8000-00000000abcd";
    store.citable.set(ORG, new Set([runId]));

    const proposal = await facts.proposeManual(
      ORG,
      {
        text: "Team prefers `k_msgq` over `k_fifo` in ISR paths",
        repoRef: "acme-robotics/helios-firmware",
        provenanceLine: "from PR #514 review cycle",
        refs: [{ kind: "run", id: runId }],
        anchors: [{ kind: "path_glob", value: "subsys/telemetry/**" }],
      },
      "user-ken",
    );
    const confirmed = store.seed(ORG, "confirmed");
    const stale = store.seed(ORG, "stale");
    const rejected = store.seed(ORG, "rejected");
    const expired = await facts.expire(
      ORG,
      store.seed(ORG, "confirmed").id,
      "user-ken",
      "moved on",
    );
    const relearned = await facts.relearn(ORG, expired.id, "user-ken");

    for (const id of [proposal.id, confirmed.id, stale.id, rejected.id, expired.id, relearned.id]) {
      expect(validatorFor("FactDetail")(wire(await facts.get(ORG, id)))).toBeUndefined();
    }
    expect(validatorFor("FactList")(wire(await facts.list(ORG)))).toBeUndefined();
    expect(validatorFor("FactNeedsYou")(wire(await facts.needsYou(ORG)))).toBeUndefined();
  });

  it("sends what FactSweepReport describes", async () => {
    const fact = await facts.proposeManual(
      ORG,
      { text: "HIL tests need a rig", anchors: [{ kind: "path_glob", value: "tests/hil/**" }] },
      "user-ken",
    );
    await facts.confirm(ORG, fact.id, "user-ken");
    store.changes.push({
      organizationId: ORG,
      enabled: true,
      prId: "5eed0046-0000-4000-8000-000000000001",
      number: 531,
      repoRef: null,
      mergedAt: store.tick(),
      paths: ["tests/hil/a.py"],
      diffExcerpt: null,
    });

    const report = await sweep.sweepWorkspace(ORG, store.tick());

    expect(report.flagged).toHaveLength(1);
    expect(validatorFor("FactSweepReport")(wire(report))).toBeUndefined();
  });

  it("refuses an undocumented field — the schemas are closed", async () => {
    const detail = wire(await facts.get(ORG, store.seed(ORG, "confirmed").id)) as object;
    const { history: _history, ...plain } = detail as { history: unknown };

    expect(validatorFor("FactDetail")(detail)).toBeUndefined();
    expect(validatorFor("FactDetail")({ ...detail, surprise: 1 })).toMatch(/unevaluated/);
    expect(validatorFor("Fact")(plain)).toBeUndefined();
    expect(validatorFor("Fact")(detail)).toMatch(/unevaluated/);
    expect(validatorFor("FactNeedsYou")({ count: 0, items: [], extra: true })).toMatch(
      /additional/,
    );
  });
});
