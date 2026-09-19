import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Readable } from "node:stream";

import type { AppConfigService } from "../../config/config.service";
import type { DomainError, ErrorEnvelope } from "../../errors/error.envelope";
import { FARM_ERRORS } from "../farm.errors";
import { InstallerService } from "./installer.service";

/**
 * The installer service against a real releases directory (#248): which release it picks, the
 * origin it fills in, and every way it declines — with a message a person reading `curl`'s
 * output can act on, and never the directory's path.
 */

/** An installer as a release carries it: DEFAULT_VERSION filled in, DEFAULT_SERVER empty. */
function installer(version: string): string {
  return `#!/bin/sh\nDEFAULT_SERVER=''\nDEFAULT_VERSION='${version}'\n`;
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ouro-releases-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Put a release into the directory.
 *
 * @param version - Its directory's name.
 * @param files - Its files; an installer and a checksum file by default.
 */
function release(version: string, files: Record<string, string> = {}): void {
  mkdirSync(join(root, version));
  const contents = {
    "install.sh": installer(version),
    SHA256SUMS: `${"a".repeat(64)}  ouroboros-runner-linux-amd64\n`,
    "ouroboros-runner-linux-amd64": `binary ${version}`,
    ...files,
  };
  for (const [name, body] of Object.entries(contents)) {
    writeFileSync(join(root, version, name), body);
  }
}

/**
 * A service reading the given settings.
 *
 * `null` is how a test says a setting is *unset*: an explicit `undefined` would take the
 * default, which is the opposite of what such a test means.
 *
 * @param settings - What the three settings it reads should say.
 * @returns The service.
 */
function service(
  settings: {
    farmPublicUrl?: string | null;
    restUrl?: string;
    farmReleasesDir?: string | null;
  } = {},
): InstallerService {
  const config = {
    farmPublicUrl:
      settings.farmPublicUrl === null
        ? undefined
        : (settings.farmPublicUrl ?? "https://ouroboros.acme.dev"),
    restUrl: settings.restUrl ?? "http://localhost:4000",
    farmReleasesDir:
      settings.farmReleasesDir === null ? undefined : (settings.farmReleasesDir ?? root),
  };

  return new InstallerService(config as unknown as AppConfigService);
}

/**
 * What a call refused with.
 *
 * @param call - The call, expected to reject.
 * @returns The status and the envelope.
 */
async function refusal(
  call: Promise<unknown>,
): Promise<{ status: number; envelope: ErrorEnvelope }> {
  try {
    await call;
  } catch (error) {
    const domain = error as DomainError;
    return { status: domain.getStatus(), envelope: domain.envelope() };
  }

  throw new Error("expected the call to be refused");
}

/**
 * Read a stream to a string.
 *
 * @param stream - The stream.
 * @returns Its contents.
 */
async function text(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks).toString("utf8");
}

describe("the installer", () => {
  it("is the newest stable release, filled in with OURO_FARM_PUBLIC_URL", async () => {
    release("0.4.0");
    release("0.5.0");
    release("0.6.0-rc.1");

    const script = await service().script();

    expect(script.version).toBe("0.5.0");
    expect(script.body).toBe(
      "#!/bin/sh\nDEFAULT_SERVER='https://ouroboros.acme.dev'\nDEFAULT_VERSION='0.5.0'\n",
    );
  });

  it("is the release asked for, pre-releases included", async () => {
    release("0.5.0");
    release("0.6.0-rc.1");

    expect((await service().script("0.6.0-rc.1")).version).toBe("0.6.0-rc.1");
    expect((await service().script("0.5.0")).body).toContain("DEFAULT_VERSION='0.5.0'");
  });

  it("falls back to OURO_REST_URL when that is https", async () => {
    release("0.5.0");

    const script = await service({
      farmPublicUrl: null,
      restUrl: "https://api.acme.dev",
    }).script();

    expect(script.body).toContain("DEFAULT_SERVER='https://api.acme.dev'");
  });

  it("reads the directory again for every request, so a release copied in is served at once", async () => {
    release("0.5.0");
    const installerService = service();
    expect((await installerService.script()).version).toBe("0.5.0");

    release("0.5.1");

    expect((await installerService.script()).version).toBe("0.5.1");
  });

  it("resolves a relative directory against the working directory", async () => {
    release("0.5.0");

    const script = await service({ farmReleasesDir: relative(process.cwd(), root) }).script();

    expect(script.version).toBe("0.5.0");
  });
});

describe("declining to serve the installer", () => {
  it("names OURO_FARM_PUBLIC_URL when no https origin is configured", async () => {
    release("0.5.0");

    const { status, envelope } = await refusal(
      service({ farmPublicUrl: null, restUrl: "http://localhost:4000" }).script(),
    );

    expect(status).toBe(404);
    expect(envelope.code).toBe(FARM_ERRORS.installerUnavailable);
    expect(envelope.message).toContain("OURO_FARM_PUBLIC_URL");
  });

  it("names OURO_FARM_RELEASES_DIR when it is unset", async () => {
    const { envelope } = await refusal(service({ farmReleasesDir: null }).script());

    expect(envelope.code).toBe(FARM_ERRORS.installerUnavailable);
    expect(envelope.message).toContain("OURO_FARM_RELEASES_DIR is not set");
  });

  it("names it, and not the path, when it is not a directory", async () => {
    const missing = join(root, "nowhere");

    const { envelope } = await refusal(service({ farmReleasesDir: missing }).script());

    expect(envelope.code).toBe(FARM_ERRORS.installerUnavailable);
    expect(envelope.message).toContain("OURO_FARM_RELEASES_DIR is not a directory");
    expect(JSON.stringify(envelope)).not.toContain(root);
  });

  it("says there is nothing to install when the directory holds no release", async () => {
    mkdirSync(join(root, "latest"));
    writeFileSync(join(root, "0.5.0"), "a file, not a release directory");

    const { envelope } = await refusal(service().script());

    expect(envelope.code).toBe(FARM_ERRORS.installerUnavailable);
    expect(envelope.message).toContain("no ouroboros-runner release to install");
  });

  it("answers farm_release_not_found for a version that is not here", async () => {
    release("0.5.0");

    const { status, envelope } = await refusal(service().script("0.9.9"));

    expect(status).toBe(404);
    expect(envelope.code).toBe(FARM_ERRORS.releaseNotFound);
    expect(envelope.details).toEqual({ version: "0.9.9" });
  });

  it("answers farm_release_not_found for a version that is not a version, and reads nothing", async () => {
    release("0.5.0");

    const { envelope } = await refusal(service().script("../0.5.0"));

    expect(envelope.code).toBe(FARM_ERRORS.releaseNotFound);
  });

  it("refuses a release whose installer has no DEFAULT_SERVER line to fill in", async () => {
    release("0.5.0", { "install.sh": "#!/bin/sh\necho hello\n" });

    const { envelope } = await refusal(service().script());

    expect(envelope.code).toBe(FARM_ERRORS.installerUnavailable);
    expect(envelope.message).toContain("no DEFAULT_SERVER line");
  });
});

describe("a release file", () => {
  it("is served exactly as the release holds it, with its size and media type", async () => {
    release("0.5.0");

    const file = await service().releaseFile("0.5.0", "SHA256SUMS");

    expect(file.name).toBe("SHA256SUMS");
    expect(file.mediaType).toMatch(/^text\/plain/u);
    expect(file.size).toBe(`${"a".repeat(64)}  ouroboros-runner-linux-amd64\n`.length);
    expect(await text(file.open())).toBe(`${"a".repeat(64)}  ouroboros-runner-linux-amd64\n`);
  });

  it("serves the installer unchanged, so it still matches SHA256SUMS", async () => {
    release("0.5.0");

    const file = await service().releaseFile("0.5.0", "install.sh");

    expect(await text(file.open())).toBe(installer("0.5.0"));
  });

  it("serves a binary as bytes", async () => {
    release("0.5.0");

    const file = await service().releaseFile("0.5.0", "ouroboros-runner-linux-amd64");

    expect(file.mediaType).toBe("application/octet-stream");
    expect(await text(file.open())).toBe("binary 0.5.0");
  });

  it.each([
    ["a file the release does not have", "0.5.0", "ouroboros-runner-darwin-arm64"],
    ["a name that is not a release file", "0.5.0", "notes.txt"],
    ["a traversal in the name", "0.5.0", "../0.4.0/install.sh"],
    ["a version that is not here", "0.9.9", "SHA256SUMS"],
    ["a version that is not a version", "..", "SHA256SUMS"],
  ])("answers farm_release_not_found for %s", async (_description, version, name) => {
    release("0.4.0");
    release("0.5.0");
    writeFileSync(join(root, "0.5.0", "notes.txt"), "not part of a release");

    const { status, envelope } = await refusal(service().releaseFile(version, name));

    expect(status).toBe(404);
    expect(envelope.code).toBe(FARM_ERRORS.releaseNotFound);
  });

  it("does not serve a directory that happens to have a release file's name", async () => {
    release("0.5.0");
    mkdirSync(join(root, "0.5.0", "ouroboros-runner-linux-arm64"));

    const { envelope } = await refusal(
      service().releaseFile("0.5.0", "ouroboros-runner-linux-arm64"),
    );

    expect(envelope.code).toBe(FARM_ERRORS.releaseNotFound);
  });

  it("answers farm_installer_unavailable when no releases directory is configured", async () => {
    const { envelope } = await refusal(
      service({ farmReleasesDir: null }).releaseFile("0.5.0", "SHA256SUMS"),
    );

    expect(envelope.code).toBe(FARM_ERRORS.installerUnavailable);
  });
});
