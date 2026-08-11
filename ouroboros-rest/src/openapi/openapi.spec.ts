import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { validate as validateSpecification } from "@readme/openapi-parser";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import request from "supertest";
import { parse } from "yaml";

import {
  API_BASE_PATH,
  DOCS_PATH,
  OPENAPI_JSON_PATH,
  OPENAPI_YAML_PATH,
  YAML_MEDIA_TYPE,
  createApplication,
} from "../application";
import { DEFAULT_PORT } from "../modules/config/configuration";
import { testConfiguration } from "../modules/config/configuration.fixture";
import { PROBE_PATHS } from "../modules/health/health.paths";
import { SERVICE_NAME, serviceVersion } from "../version";
import { JSON_FILENAME, YAML_FILENAME, document, specificationYaml } from "./specification";

/**
 * The committed specification, and the code's agreement with it.
 *
 * `openapi.yaml` is authoritative and the application serves it verbatim, which buys a
 * contract no decorator can edit — and costs the one thing a generated document gave
 * away for free: the guarantee that it describes the routes that actually exist. This
 * suite is that guarantee. It fails when a path, a method, a response field or the
 * version drifts from what the document claims, so the disagreement is a red pipeline
 * rather than `ouroboros-ui` generating a client against a contract this service does
 * not honour.
 */

/** The module root, where both specification files are committed. */
const MODULE_ROOT = join(__dirname, "..", "..");

/** How an operation is named in every assertion below. */
type OperationKey = `${string} ${string}`;

/**
 * Flatten a document's paths into one map.
 *
 * @param source - A parsed OpenAPI document.
 * @returns Every operation, keyed `"<METHOD> <path>"`.
 */
function operations(source: OpenAPIObject): Map<OperationKey, Record<string, unknown>> {
  const flattened = new Map<OperationKey, Record<string, unknown>>();
  for (const [path, item] of Object.entries(source.paths)) {
    for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
      flattened.set(`${method.toUpperCase()} ${path}`, operation as Record<string, unknown>);
    }
  }
  return flattened;
}

/**
 * Ask `@nestjs/swagger` what the application's routes actually are.
 *
 * The application no longer generates its document, so this generates one purely to read
 * the route set out of it — the framework's own answer to "what does this serve",
 * derived from the code rather than from the committed file, which is exactly the other
 * side of every comparison below. It carries the global prefix and the URI version, so
 * the paths it reports are the ones a client calls.
 *
 * Swagger UI and the two document routes are absent from it by construction: they are
 * registered on the HTTP adapter rather than declared by a controller, which is the same
 * reason they are not in `openapi.yaml`.
 *
 * @param app - The application under test.
 * @returns Every operation the code serves, keyed like {@link operations}.
 */
function served(app: INestApplication): Map<OperationKey, Record<string, unknown>> {
  return operations(SwaggerModule.createDocument(app, new DocumentBuilder().build()));
}

/** The authoritative file, parsed. */
function yamlDocument(): OpenAPIObject {
  return parse(readFileSync(join(MODULE_ROOT, YAML_FILENAME), "utf8")) as OpenAPIObject;
}

/** The rendered file, exactly as committed. */
function jsonText(): string {
  return readFileSync(join(MODULE_ROOT, JSON_FILENAME), "utf8");
}

/**
 * A validator for one schema in the document.
 *
 * The document is added under an identifier and the schema referenced by pointer into
 * it, so a `$ref` between schemas resolves the same way it does for a client's tooling.
 *
 * @param source - The document holding the schema.
 * @param ref - A local reference, e.g. `#/components/schemas/Heartbeat`.
 * @returns A function that reports whether a value matches, and why it did not.
 */
function validatorFor(source: OpenAPIObject, ref: string) {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: source.components });

  const validate = ajv.compile({ $ref: `${id}${ref}` });
  return (value: unknown): string | undefined =>
    validate(value) ? undefined : ajv.errorsText(validate.errors);
}

/** One JSON response body, as the document describes it. */
interface DocumentedBody {
  schema: { $ref: string };
  example?: unknown;
}

/**
 * The JSON response bodies an operation documents, keyed by status code.
 *
 * Keyed by status rather than reaching for `200`, because an operation is allowed more than
 * one honest answer: `/health/ready` answers `503` when a dependency is missing, which is
 * the case in a suite that starts no database — so the assertions below check that whatever
 * the service *did* answer is an answer the document describes, and validate the body
 * against the schema documented for that status.
 *
 * @param operation - One operation from {@link operations}.
 * @returns Its JSON media-type objects, by status code. Statuses documented without a JSON
 *   body are absent.
 */
function jsonBodies(operation: Record<string, unknown>): Map<string, DocumentedBody> {
  const responses = operation.responses as Record<
    string,
    { content?: Record<string, DocumentedBody> }
  >;

  const bodies = new Map<string, DocumentedBody>();
  for (const [status, response] of Object.entries(responses)) {
    const body = response.content?.["application/json"];
    if (body !== undefined) {
      bodies.set(status, body);
    }
  }

  return bodies;
}

/**
 * Every status an operation documents, whether or not it carries a body.
 *
 * Wider than {@link jsonBodies}, and the difference is the point. Most of this API answers
 * in JSON, and for those two the sets are the same; sign-in
 * ([#33](https://github.com/NobuData/ouroboros/issues/33)) is where they come apart. Its
 * two halves answer `302` — a redirect a browser follows, whose payload is a `Location` and
 * a `Set-Cookie` — and signing out answers `204`, which has nothing to say. Both are
 * described here with headers and no `content`, because that is what they really are, and
 * a document that invented a body for them to keep a check simple would be describing
 * something the service does not send.
 *
 * @param operation - One operation from {@link operations}.
 * @returns Its documented status codes, as strings.
 */
function documentedStatuses(operation: Record<string, unknown>): string[] {
  return Object.keys(operation.responses as Record<string, unknown>);
}

/**
 * Every documented example in the document, as the pairs that address one.
 *
 * @returns One `[operation, status]` pair per documented JSON example.
 */
function documentedExamples(): [OperationKey, string][] {
  const pairs: [OperationKey, string][] = [];

  for (const [key, operation] of operations(document())) {
    for (const [status, body] of jsonBodies(operation)) {
      if (body.example !== undefined) {
        pairs.push([key, status]);
      }
    }
  }

  return pairs;
}

describe("the specification as a document", () => {
  it("is valid OpenAPI 3.1", async () => {
    // Written by hand and published to whatever catalogues the contract, so without this
    // the thing that catches a malformed document is a client reading it.
    const result = await validateSpecification(yamlDocument() as never);

    expect(result.valid ? true : JSON.stringify(result.errors)).toBe(true);
  });

  it("is one document in two files", () => {
    expect(JSON.parse(jsonText())).toEqual(yamlDocument());
  });

  it("is rendered exactly as `yarn openapi` writes it", () => {
    // Not merely equal as data: the JSON is committed and diffed, so its formatting is
    // part of what has to be reproducible, and a hand-edited copy has to fail. This runs
    // the verb the README documents rather than reimplementing it — `--check` writes
    // nothing and exits non-zero on drift, which is what makes execFileSync throw.
    const check = (): string =>
      execFileSync(process.execPath, [join(MODULE_ROOT, "scripts", "openapi.mjs"), "--check"], {
        encoding: "utf8",
      });

    expect(check).not.toThrow();
  });

  it("declares the version the manifest declares", () => {
    // package.json is the one place a module's version is written down
    // (docs/CONVENTIONS.md § 8), and the specification is a second thing that states it.
    // This is what makes a release bump both.
    expect(document().info.version).toBe(serviceVersion());
  });

  it("is named for the service it describes", () => {
    expect(document().info.title).toBe(SERVICE_NAME);
  });

  it("publishes the development origin the service actually binds", () => {
    const [server] = document().servers ?? [];

    expect(server.url).toBe(`http://localhost:${DEFAULT_PORT}`);
  });

  it("describes nothing outside the versioned base path but the probes", () => {
    // The probes are the one exemption, and it is an enumerated one: they answer at the
    // origin root because a `HEALTHCHECK` and an orchestrator's probe have no notion of an
    // API version (see `src/modules/health/health.paths.ts`). Anything else that escaped
    // `/api/v1` would be a route published outside the contract's versioning, which is what
    // this check exists to refuse.
    const exempt: readonly string[] = PROBE_PATHS;
    const paths = Object.keys(document().paths);

    expect(paths).not.toHaveLength(0);
    for (const path of paths.filter((candidate) => !exempt.includes(candidate))) {
      expect(path.startsWith(API_BASE_PATH)).toBe(true);
    }
  });

  it("describes every path that is exempt from the version", () => {
    // The other half of the exemption: a probe path that stopped being described here would
    // be a route the drift check no longer covers, which is how an exemption becomes a hole.
    const paths = Object.keys(document().paths);

    for (const path of PROBE_PATHS) {
      expect(paths).toContain(path);
    }
  });
});

describe("the document and the running application", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** The adapter's server, typed so Supertest can be handed it without an `any`. */
  const server = (): Server => app.getHttpServer() as Server;

  it("describes every route the application serves", () => {
    const code = [...served(app).keys()];

    expect(code).not.toHaveLength(0);
    for (const operation of code) {
      expect([...operations(document()).keys()]).toContain(operation);
    }
  });

  it("promises no route the application does not serve", () => {
    // The worse half of the same drift: a specification that offers an operation the
    // service has never had is a client that compiles and then 404s.
    const code = [...served(app).keys()];

    for (const operation of operations(document()).keys()) {
      expect(code).toContain(operation);
    }
  });

  it.each([...operations(document()).keys()])(
    "answers %s with a status it documents",
    async (key) => {
      // Not `expect(200)`: this suite starts no database and no engine, so `/health/ready`
      // answers the 503 it documents for exactly that case — and would answer 200 on a machine
      // where `docker compose up` is running. Both are honest, and a check that insisted on one
      // of them would be a check that depended on what happened to be listening.
      const [method, path] = key.split(" ");
      const documented = documentedStatuses(operations(document()).get(key)!);

      const response = await request(server())[method.toLowerCase() as "get"](path);

      expect(documented).toContain(String(response.status));
    },
  );

  it.each([...operations(document()).keys()])(
    "sends %s a body the schema documented for its answer accepts",
    async (key) => {
      const [method, path] = key.split(" ");
      const operation = operations(document()).get(key)!;

      const response = await request(server())[method.toLowerCase() as "get"](path);

      const documented = jsonBodies(operation).get(String(response.status));

      if (documented === undefined) {
        // The document describes this status with headers and no `content` — a redirect or
        // a `204`. The assertion is then the mirror image: the service must send no body
        // either. A route that started answering with one would be a route whose contract
        // says the opposite, which is the same drift this suite exists to catch.
        expect(documentedStatuses(operation)).toContain(String(response.status));
        expect(response.body).toEqual({});
        return;
      }

      // The schemas are `additionalProperties: false`, so this is also what catches a
      // field the code returns and the document does not mention.
      const mismatch = validatorFor(document(), documented.schema.$ref);
      expect(mismatch(response.body)).toBeUndefined();
    },
  );

  it.each(documentedExamples())(
    "documents %s's %s with an example the service could actually send",
    (key, status) => {
      // An example that no longer validates is a lie a reader copies into their client.
      const body = jsonBodies(operations(document()).get(key)!).get(status)!;
      const mismatch = validatorFor(document(), body.schema.$ref);

      expect(mismatch(body.example)).toBeUndefined();
    },
  );
});

describe("publishing the specification", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApplication(testConfiguration(), { logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;

  it("serves the committed document, unchanged", async () => {
    const response = await request(server()).get(OPENAPI_JSON_PATH).expect(200);

    // The document a client generator reads over HTTP and the file committed in this
    // repository are the same document — that is the whole of what spec-first buys.
    expect(response.body).toEqual(JSON.parse(jsonText()));
  });

  it("serves the authoritative YAML, byte for byte", async () => {
    const response = await request(server())
      .get(OPENAPI_YAML_PATH)
      .expect(200)
      .expect("Content-Type", new RegExp(YAML_MEDIA_TYPE))
      // Superagent buffers text/* and JSON and nothing else, so a YAML body arrives
      // empty unless it is told to collect one.
      .buffer(true)
      .parse((message, callback) => {
        let text = "";
        message.setEncoding("utf8");
        message.on("data", (chunk: string) => (text += chunk));
        message.on("end", () => callback(null, text));
      });

    // The file a human edits, not a re-serialisation of what was parsed out of it.
    expect(response.body).toBe(specificationYaml());
    expect(parse(response.body as string)).toEqual(JSON.parse(jsonText()));
  });

  it("serves Swagger UI for a human", async () => {
    await request(server())
      .get(DOCS_PATH)
      .expect(200)
      .expect("Content-Type", /text\/html/);
  });

  it("publishes all three outside the versioned surface", () => {
    // A document that lived under /api/v1 would be a document describing the version it
    // is inside — and a route the drift check has to know to forgive.
    for (const path of [DOCS_PATH, OPENAPI_JSON_PATH, OPENAPI_YAML_PATH]) {
      expect(path.startsWith(API_BASE_PATH)).toBe(false);
    }
  });
});
