/**
 * The OpenAPI document and what the workspace card's routes send
 * ([#483](https://github.com/NobuData/ouroboros/issues/483)). Real service answers — every role,
 * both region sources, both SSO states — are held to `WorkspaceSettings`, which is
 * `additionalProperties: false` throughout. The training-data variants the SaaS tier will use are
 * held to the schema too: representable on the wire, never produced here.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { OWNER, VIEWER, WORKSPACE, world } from "./workspace.fixture";

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

describe("the workspace card on the wire", () => {
  const card = validatorFor("WorkspaceSettings");

  it.each([
    ["an owner, configured region, SSO enforced", OWNER, "eu-central-1", true],
    ["a viewer, default region, no SSO", VIEWER, undefined, false],
  ] as const)("matches WorkspaceSettings for %s", async (_label, caller, region, ssoEnforced) => {
    const { service, seedDomain } = world({ region, ssoEnforced });
    seedDomain(WORKSPACE, "acme.ouroboros.dev", true);

    expect(card(wire(await service.read(WORKSPACE, caller)))).toBeUndefined();
  });

  it("matches WorkspaceSettings for a workspace with no domain", async () => {
    const { service } = world();

    expect(card(wire(await service.read(WORKSPACE, OWNER)))).toBeUndefined();
  });

  it("matches WorkspaceSettings after a save", async () => {
    const { service } = world();

    expect(
      card(wire(await service.update(WORKSPACE, OWNER, { name: "Acme", domain: "acme.io" }))),
    ).toBeUndefined();
  });
});

describe("the training-data vocabulary", () => {
  const training = validatorFor("WorkspaceTrainingData");

  it.each([
    ["the self-hosted truth", { enabled: false, changeable: false, reason: "deployment" }],
    ["the plan lock (BT.4)", { enabled: false, changeable: false, reason: "plan" }],
    ["a SaaS choice (BT.4)", { enabled: true, changeable: true, reason: null }],
  ])("represents %s", (_label, value) => {
    expect(training(value)).toBeUndefined();
  });

  it.each([
    [
      "a deployment reason that claims training is on",
      { enabled: true, changeable: false, reason: "deployment" },
    ],
    ["a changeable control with a reason", { enabled: false, changeable: true, reason: "plan" }],
    ["a locked control with no reason", { enabled: false, changeable: false, reason: null }],
  ])("refuses %s", (_label, value) => {
    expect(training(value)).toBeDefined();
  });
});
