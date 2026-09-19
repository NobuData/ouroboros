import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { createApplication } from "../../../application";
import { testConfiguration } from "../../config/configuration.fixture";
import type { ErrorEnvelope } from "../../errors/error.envelope";
import { FARM_ERRORS } from "../farm.errors";
import { RELEASE_VERSION_HEADER } from "./installer.controller";
import { INSTALL_SCRIPT_PATH } from "./installer.paths";

/**
 * The two installer routes, over a socket, in the application the process runs (#248): at the
 * origin root, answered without a session, with the headers `curl` and a person need — and a
 * refusal that is an envelope rather than a script, so `curl -f` pipes nothing into `sh`.
 *
 * No database is started: the routes read two settings and a directory, and nothing else.
 */

const ORIGIN = "https://farm.acme.dev";
const SUMS = `${"b".repeat(64)}  ouroboros-runner-linux-amd64\n`;
const BINARY = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0xff, 0x10]);

let root: string;
let app: INestApplication;

/** The adapter's server, typed so Supertest can be handed it without an `any`. */
const server = (): Server => app.getHttpServer() as Server;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "ouro-releases-"));
  for (const version of ["0.4.0", "0.5.0"]) {
    mkdirSync(join(root, version));
    writeFileSync(
      join(root, version, "install.sh"),
      `#!/bin/sh\nDEFAULT_SERVER=''\nDEFAULT_VERSION='${version}'\n`,
    );
    writeFileSync(join(root, version, "SHA256SUMS"), SUMS);
    writeFileSync(join(root, version, "ouroboros-runner-linux-amd64"), BINARY);
  }

  app = await createApplication(
    testConfiguration({ OURO_FARM_RELEASES_DIR: root, OURO_FARM_PUBLIC_URL: ORIGIN }),
    { logger: false },
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe("GET /install.sh", () => {
  it("answers at the origin root, without a session, with the newest release filled in", async () => {
    const response = await request(server()).get(INSTALL_SCRIPT_PATH).expect(200);

    expect(response.headers["content-type"]).toBe("text/x-shellscript; charset=utf-8");
    expect(response.headers[RELEASE_VERSION_HEADER.toLowerCase()]).toBe("0.5.0");
    expect(response.headers["cache-control"]).toBe("no-cache");
    expect(response.text).toBe(`#!/bin/sh\nDEFAULT_SERVER='${ORIGIN}'\nDEFAULT_VERSION='0.5.0'\n`);
  });

  it("serves the release ?version= pins", async () => {
    const response = await request(server())
      .get(`${INSTALL_SCRIPT_PATH}?version=0.4.0`)
      .expect(200);

    expect(response.headers[RELEASE_VERSION_HEADER.toLowerCase()]).toBe("0.4.0");
    expect(response.text).toContain("DEFAULT_VERSION='0.4.0'");
  });

  it("answers a release that is not here with an envelope, not a script", async () => {
    const response = await request(server())
      .get(`${INSTALL_SCRIPT_PATH}?version=0.9.9`)
      .expect(404);

    expect(response.headers["content-type"]).toMatch(/^application\/json/u);
    expect((response.body as ErrorEnvelope).code).toBe(FARM_ERRORS.releaseNotFound);
  });

  it("refuses a version given twice rather than guessing which was meant", async () => {
    const response = await request(server())
      .get(`${INSTALL_SCRIPT_PATH}?version=0.4.0&version=0.5.0`)
      .expect(404);

    expect((response.body as ErrorEnvelope).code).toBe(FARM_ERRORS.releaseNotFound);
  });

  it("is not also served under /api/v1", async () => {
    const response = await request(server()).get(`/api/v1${INSTALL_SCRIPT_PATH}`);

    expect(response.status).not.toBe(200);
  });
});

describe("GET /runner/:version/:file", () => {
  it("serves the checksums as text, unchanged, with their length and name", async () => {
    const response = await request(server()).get("/runner/0.5.0/SHA256SUMS").expect(200);

    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers["content-length"]).toBe(String(SUMS.length));
    expect(response.headers["content-disposition"]).toBe('attachment; filename="SHA256SUMS"');
    expect(response.headers[RELEASE_VERSION_HEADER.toLowerCase()]).toBe("0.5.0");
    expect(response.text).toBe(SUMS);
  });

  it("serves a binary as bytes, byte for byte", async () => {
    const response = await request(server())
      .get("/runner/0.5.0/ouroboros-runner-linux-amd64")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(Buffer.compare(response.body as Buffer, BINARY)).toBe(0);
  });

  it("serves the installer unchanged — the file SHA256SUMS names", async () => {
    const response = await request(server()).get("/runner/0.5.0/install.sh").expect(200);

    expect(response.text).toBe("#!/bin/sh\nDEFAULT_SERVER=''\nDEFAULT_VERSION='0.5.0'\n");
  });

  it.each([
    ["a file the release does not hold", "/runner/0.5.0/ouroboros-runner-darwin-arm64"],
    ["a name that is not a release file", "/runner/0.5.0/passwd"],
    ["an encoded traversal in the file", "/runner/0.5.0/..%2F0.4.0%2Finstall.sh"],
    ["an encoded traversal in the version", "/runner/..%2F..%2Fetc/passwd"],
    ["a version that is not here", "/runner/0.9.9/SHA256SUMS"],
  ])("answers %s with farm_release_not_found", async (_description, path) => {
    const response = await request(server()).get(path).expect(404);

    expect((response.body as ErrorEnvelope).code).toBe(FARM_ERRORS.releaseNotFound);
  });
});

describe("a deployment that serves no installer", () => {
  let bare: INestApplication;

  beforeAll(async () => {
    bare = await createApplication(testConfiguration(), { logger: false });
    await bare.init();
  });

  afterAll(async () => {
    await bare.close();
  });

  it("answers /install.sh with farm_installer_unavailable, naming what to set", async () => {
    const response = await request(bare.getHttpServer() as Server)
      .get(INSTALL_SCRIPT_PATH)
      .expect(404);
    const envelope = response.body as ErrorEnvelope;

    // The development defaults give no https origin, and that is the first thing it needs.
    expect(envelope.code).toBe(FARM_ERRORS.installerUnavailable);
    expect(envelope.message).toContain("OURO_FARM_PUBLIC_URL");
  });

  it("answers a release file with farm_installer_unavailable", async () => {
    const response = await request(bare.getHttpServer() as Server)
      .get("/runner/0.5.0/SHA256SUMS")
      .expect(404);

    expect((response.body as ErrorEnvelope).code).toBe(FARM_ERRORS.installerUnavailable);
  });
});
