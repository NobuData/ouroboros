import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { RECIPE, SAVE_BODY, currentRow } from "./env-recipes.fixture";
import { envRecipeResource } from "./env-recipes.resources";

/**
 * The OpenAPI document and what the env-recipe routes send and take (#420). `openapi.spec.ts` sees
 * these routes only unauthenticated, so real answers — the seed's recipe, a detected draft — and
 * the documented save body are held to the documented schemas here, all of them closed.
 */

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

describe("the env-recipe contract", () => {
  it("sends the documented recipe — edited by a person, and a detected draft", () => {
    const recipe = validatorFor("EnvRecipe");

    expect(recipe(wire(RECIPE))).toBeUndefined();
    expect(
      recipe(
        wire(
          envRecipeResource(
            currentRow({ source: "detected", updated_by: null, editor_name: null }),
          ),
        ),
      ),
    ).toBeUndefined();
  });

  it("documents the save body it validates", () => {
    expect(validatorFor("SaveEnvRecipeBody")(wire(SAVE_BODY))).toBeUndefined();
  });

  it("describes both routes under the knowledge tag", () => {
    const paths = document().paths as Record<string, Record<string, { tags?: string[] }>>;
    const route = paths["/api/v1/knowledge/env-recipe"];

    expect(route?.get?.tags).toEqual(["knowledge"]);
    expect(route?.put?.tags).toEqual(["knowledge"]);
  });
});
