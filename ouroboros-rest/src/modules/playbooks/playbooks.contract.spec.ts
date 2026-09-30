/**
 * The OpenAPI document and what the playbook and repo-map routes send (#415). `openapi.spec.ts`
 * sees these routes only unauthenticated, so real service answers — a playbook, a draft, a
 * receipt, a picker list, counts — are held to the documented schemas here, all of them closed.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import type { RepoMapReport } from "../repo-map/repo-map.resources";
import {
  ISSUE_485,
  PlaybookWorld,
  SOURCE_RUN,
  STANDARD_FIX,
  WORKSPACE,
} from "./playbooks.store.fixture";

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

describe("the playbooks contract", () => {
  it("sends documented shapes from every read and write", async () => {
    const world = new PlaybookWorld();
    const service = world.service();
    world.injected.set(SOURCE_RUN, [world.hil.id, world.legacy.id]);

    const draft = await service.draftFromRun(WORKSPACE, SOURCE_RUN);
    const created = await service.createFromRun(WORKSPACE, {
      runId: SOURCE_RUN,
      name: "Flaky test hunt",
      issueFilter: { labels: ["flaky"] },
    });
    const plain = await service.create(WORKSPACE, {
      name: "CVE bump",
      description: "Bump the dependency",
      workflow: STANDARD_FIX,
      workflowVersion: 13,
    });
    const receipt = await service.launch(WORKSPACE, created.id, ISSUE_485);
    world.openRun(created.id);

    expect(validatorFor("PlaybookDraft")(wire(draft))).toBeUndefined();
    expect(validatorFor("Playbook")(wire(created))).toBeUndefined();
    expect(validatorFor("Playbook")(wire(plain))).toBeUndefined();
    expect(validatorFor("PlaybookList")(wire(await service.list(WORKSPACE)))).toBeUndefined();
    expect(validatorFor("PlaybookCounts")(wire(await service.counts(WORKSPACE)))).toBeUndefined();
    expect(
      validatorFor("PlaybookIssueList")(wire(await service.issues(WORKSPACE, plain.id))),
    ).toBeUndefined();
    expect(validatorFor("PlaybookLaunchReceipt")(wire(receipt))).toBeUndefined();
    expect(
      validatorFor("PlaybookContext")(wire(await service.context(WORKSPACE, plain.id))),
    ).toBeUndefined();
  });

  it.each<RepoMapReport>([
    {
      repo: "acme-robotics/helios-firmware",
      outcome: "published",
      skill: "repo-map",
      version: 61,
      generatedAt: "2026-09-30T05:12:00.000Z",
      trigger: "nightly",
      reason: null,
      modules: 12,
      truncated: false,
    },
    {
      repo: "acme-robotics/helios-firmware",
      outcome: "skipped",
      skill: null,
      version: null,
      generatedAt: "2026-09-30T05:12:00.000Z",
      trigger: "manual",
      reason: "rate_limit",
      modules: 0,
      truncated: false,
    },
  ])("documents the repo-map report — $outcome", (report) => {
    expect(validatorFor("RepoMapReport")(wire(report))).toBeUndefined();
  });
});
