/**
 * The API specification: a file the service reads, not a document it generates.
 *
 * `openapi.yaml` at the module root is authoritative. `@nestjs/swagger` can derive a
 * document from the decorators a controller happens to carry, but that document is a
 * description of the code rather than a contract anyone agreed to — it changes when a
 * DTO's property order does, it carries the titles the generator invents, and it cannot
 * say anything the decorators have no field for. This service's specification is written
 * by hand instead, and the application serves it verbatim (`src/application.ts`), so the
 * document `ouroboros-ui` generates its client from and the document the process answers
 * with are the same bytes.
 *
 * Two files, one document:
 *
 *   * `openapi.yaml` is what a human edits — comments, block text, no escaping.
 *   * `openapi.json` is rendered from it by `yarn openapi` (`scripts/openapi.mjs`). It is
 *     what this module loads at runtime and what a JSON-only tool wants, and it is
 *     committed rather than built on demand so a container ships the document it serves.
 *
 * **And a second pair beside it** since AD.3
 * ([#224](https://github.com/NobuData/ouroboros/issues/224)): `openapi.internal.yaml` and
 * its rendering describe the two paths `ouroboros-engine` calls. They are a separate
 * document rather than a separate section because they describe a separate boundary — no
 * browser reaches them, no session authenticates them, and folding them into the file above
 * would put engine-facing operations into the client `ouroboros-ui` generates. Neither
 * internal file is served; `internalDocument()` is read by the suite that holds it to the
 * router, and by nothing at runtime.
 *
 * Reading JSON rather than YAML at runtime is why nothing here imports a YAML parser:
 * the served application needs what Node already has and no more, and `yaml` stays a
 * devDependency used only by the renderer.
 *
 * Nothing keeps the two files in step by itself — `yarn test` does. It fails on a pair
 * that has drifted apart, on a version that disagrees with `package.json`, and on a path
 * or a response field the code serves that the document does not describe
 * (`openapi.spec.ts`).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { OpenAPIObject } from "@nestjs/swagger";

/** The authoritative document, and the rendering of it that is read at runtime. */
export const YAML_FILENAME = "openapi.yaml";
export const JSON_FILENAME = "openapi.json";

/**
 * The engine-facing contract, and its rendering
 * ([#224](https://github.com/NobuData/ouroboros/issues/224)).
 *
 * A second pair rather than a second section of the first, because the two describe
 * different boundaries with different callers, different authentication and different
 * readers — see `openapi.internal.yaml`'s own header. **Neither file is served**: the
 * application publishes the public document at `/api/openapi.{json,yaml}` and publishes this
 * one nowhere, so it is read here only by the suite that holds it to the routes.
 */
export const INTERNAL_YAML_FILENAME = "openapi.internal.yaml";
export const INTERNAL_JSON_FILENAME = "openapi.internal.json";

/**
 * Where the rendered document is, resolved from this file rather than from the working
 * directory.
 *
 * `tsconfig.json` pins `rootDir` to `src` and `outDir` to `dist`, so `src/openapi/../..`
 * and `dist/openapi/../..` are both the module directory — the same pinning `version.ts`
 * relies on to find `package.json`, and the reason both paths can be constants. A
 * container therefore has to copy this file beside `dist/`, exactly as it copies the
 * manifest.
 */
const MODULE_ROOT = join(__dirname, "..", "..");

/**
 * The specification could not be read or parsed.
 *
 * Thrown while the application is being built rather than on the first request for the
 * document, because that is when a packaging mistake is still cheap: an image built
 * without `openapi.json` is broken at boot, naming the path it looked in, instead of
 * answering `/api/docs` with a stack trace in production.
 */
export class SpecificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SpecificationError";
  }
}

/** Memoised reads of the committed files — none changes under a running process. */
let cachedDocument: OpenAPIObject | undefined;
let cachedYaml: string | undefined;
let cachedInternalDocument: OpenAPIObject | undefined;

/**
 * Read and parse the rendered specification.
 *
 * @param path - Document to read. Defaults to the committed `openapi.json`; the
 *   parameter exists so the failure branches can be exercised against a fixture.
 * @returns The parsed document.
 * @throws {SpecificationError} If the file cannot be read or is not a JSON object.
 *   Naming the path is the whole value of the message: every one of those failures means
 *   a build that packaged the code without its specification, and the fix is always in
 *   the build rather than in this file.
 */
export function readSpecification(path: string = join(MODULE_ROOT, JSON_FILENAME)): OpenAPIObject {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new SpecificationError(
      `${JSON_FILENAME} is missing — the API specification is a committed file, not ` +
        `something the service generates. Looked in: ${path}`,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SpecificationError(`${path} could not be read as JSON`, { cause: error });
  }

  // Narrowed rather than cast: the document is a file on disk, and a cast would turn a
  // packaging mistake into an empty Swagger UI instead of an error at boot.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SpecificationError(`${path} is not an OpenAPI document`);
  }

  return parsed as OpenAPIObject;
}

/**
 * The specification the service serves.
 *
 * @returns A fresh deep copy of the parsed document, read on first call and remembered
 *   afterwards — so an application that is handed one, or a test that reaches into one,
 *   cannot change what the next caller gets.
 * @throws {SpecificationError} If the document is missing or malformed. See
 *   {@link readSpecification}.
 */
export function document(): OpenAPIObject {
  cachedDocument ??= readSpecification();
  return structuredClone(cachedDocument);
}

/**
 * The engine-facing contract — `openapi.internal.yaml`, as rendered.
 *
 * Read through the same loader as the public document so that a packaging mistake produces
 * the same named failure, and cloned for the same reason: a suite that reaches into one
 * cannot change what the next caller gets.
 *
 * Nothing in the running application calls this. The document is a contract AF.1
 * ([#234](https://github.com/NobuData/ouroboros/issues/234)) reads, AF.2
 * ([#235](https://github.com/NobuData/ouroboros/issues/235)) implements and
 * `ouroboros-engine`'s client stub mirrors; what calls it here is `openapi.spec.ts`, which
 * holds it to the two routes the service actually serves.
 *
 * @returns A fresh deep copy of the parsed internal document.
 * @throws {SpecificationError} If it is missing or malformed. See {@link readSpecification}.
 */
export function internalDocument(): OpenAPIObject {
  cachedInternalDocument ??= readSpecification(join(MODULE_ROOT, INTERNAL_JSON_FILENAME));
  return structuredClone(cachedInternalDocument);
}

/**
 * The authoritative document, as it was written.
 *
 * Served rather than re-serialised from the parsed JSON on purpose: this is the file a
 * human edits, and handing out its bytes means the comments, the block text and the key
 * order a reader sees are the ones the author put there. A YAML dump of the parsed
 * document would agree with it as data and differ from it as a file, which is exactly
 * the kind of "nearly the same" a contract should not have.
 *
 * @param path - Document to read. Defaults to the committed `openapi.yaml`.
 * @returns Its contents, read on first call and remembered afterwards.
 * @throws {SpecificationError} If the file cannot be read. It is not parsed here — the
 *   rendered JSON beside it is what the service reads for meaning, and `yarn test`
 *   already refuses a pair that disagrees.
 */
export function specificationYaml(path: string = join(MODULE_ROOT, YAML_FILENAME)): string {
  if (cachedYaml === undefined) {
    try {
      cachedYaml = readFileSync(path, "utf8");
    } catch (error) {
      throw new SpecificationError(
        `${YAML_FILENAME} is missing — it is the authoritative specification, and a ` +
          `build that shipped without it cannot publish the contract. Looked in: ${path}`,
        { cause: error },
      );
    }
  }
  return cachedYaml;
}
