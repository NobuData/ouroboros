import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_PORT } from "./modules/config/configuration";
import { HEALTH_LIVE_PATH, HEALTH_READY_PATH } from "./modules/health/health.paths";

/**
 * The production image ([#36](https://github.com/NobuData/ouroboros/issues/36)), asserted
 * from the files that define it.
 *
 * A `docker build` is not something `ci/rest` can run — it needs a daemon, a network and
 * minutes this job does not have — so what is checked here is every property of the image
 * that is decided *in the repository*: the stages, the base image, the production-only
 * dependency tree, the non-root user, the files the service resolves relative to itself,
 * the healthcheck, and the build context. Each of these is a way the image can be broken
 * by an edit that no other test in this module would notice, and several of them are ways
 * it can be broken from *another* module's pull request.
 *
 * The properties that genuinely need a daemon — that the image builds, that the container
 * boots against the compose network and reports healthy, and that it is inside the 300 MB
 * budget — are verified when the image is built, and by the compose stack once
 * [#55](https://github.com/NobuData/ouroboros/issues/55) adds this service to it.
 *
 * Two assertions read their expected value out of the application rather than restating
 * it: the healthcheck's path comes from `modules/health/health.paths.ts` and the port from
 * `modules/config/configuration.ts`. A probe that moved or a port that changed then fails
 * *here*, which is the only place the two could otherwise drift apart unnoticed — a
 * container reporting unhealthy while the service is fine.
 */

/** This module's directory, and the repository root the image is built from. */
const MODULE_DIR = join(__dirname, "..");
const REPO_ROOT = join(MODULE_DIR, "..");

/** This module's directory name — the path every COPY in the image is written against. */
const MODULE_NAME = "ouroboros-rest";

const DOCKERFILE = readFileSync(join(MODULE_DIR, "Dockerfile"), "utf8");
const DOCKERIGNORE = readFileSync(join(MODULE_DIR, "Dockerfile.dockerignore"), "utf8");

/** The base image every stage is built on. Alpine, and pinned to a major version. */
const BASE_IMAGE = "node:24-alpine";

/** The `deps`/`build`/`runtime` split docs/CONVENTIONS.md § 5 requires of every module. */
const STAGE_NAMES = ["deps", "build", "runtime"];

/**
 * Where the `deps` stage sets the production-only dependency tree aside.
 *
 * A stage has one `node_modules`, and this image needs two trees out of one lockfile — the
 * full one to compile against and the production one to ship. This is the path the first
 * is copied to before the second replaces it.
 */
const PRODUCTION_TREE = "/production";

/**
 * The Dockerfile's instructions, with its commentary removed.
 *
 * Everything below is asserted against this rather than against the raw file, and the
 * distinction is not cosmetic: this Dockerfile explains at length *why* it does what it
 * does, so its prose quotes the very instructions under test. Matching the raw text would
 * let a comment satisfy an assertion about an instruction that had been deleted — which is
 * exactly what a deliberate breakage of the `focus --production` line proved before this
 * existed.
 */
const INSTRUCTIONS = DOCKERFILE.split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

/**
 * The Dockerfile's instructions, split at their `FROM` lines into one entry per stage.
 *
 * @returns Stage name to the instructions that follow it, in file order.
 */
function stages(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  let current: string | undefined;

  for (const line of INSTRUCTIONS.split("\n")) {
    const from = /^FROM\s+\S+\s+AS\s+(\S+)\s*$/.exec(line);
    if (from) {
      current = from[1];
      found.set(current, "");
      continue;
    }
    if (current) found.set(current, `${found.get(current)}${line}\n`);
  }

  return found;
}

const STAGES = stages();

/**
 * The instructions of one stage, as a string.
 *
 * @param name - Stage to read. Must be one of {@link STAGE_NAMES}.
 * @returns Everything between that stage's `FROM` and the next one.
 * @throws {Error} If the stage is absent — which the first test in this file reports as a
 *   missing stage rather than as a cascade of unrelated failures.
 */
function stage(name: string): string {
  const instructions = STAGES.get(name);
  if (instructions === undefined) throw new Error(`The Dockerfile declares no ${name} stage`);

  return instructions;
}

/**
 * Quote a literal for use inside a regular expression.
 *
 * @param literal - Text to match exactly — a path, here, so it carries dots and slashes.
 * @returns The same text with every regex metacharacter escaped.
 */
function quote(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read a package manifest.
 *
 * @param directory - Directory holding the `package.json`.
 * @returns The parsed manifest, narrowed to the two fields this suite reads.
 */
function manifest(directory: string): { workspaces?: string[]; scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
    workspaces?: string[];
    scripts?: Record<string, string>;
  };
}

describe("the Dockerfile", () => {
  it.each(STAGE_NAMES)("has a %s stage", (name) => {
    expect([...STAGES.keys()]).toContain(name);
  });

  it("builds every stage on the same pinned base image", () => {
    const bases = [...INSTRUCTIONS.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);

    expect(bases).toHaveLength(STAGE_NAMES.length);
    expect(new Set(bases)).toEqual(new Set([BASE_IMAGE]));
  });

  it("pins a Node major the workspace root accepts", () => {
    // The roadmap text for #36 says node:22-alpine; it predates #13, which moved the repo
    // to Node 24, and this is what keeps the image and the manifest from disagreeing about
    // the runtime — an install under 22 would be refused by Yarn before it began.
    const root = manifest(REPO_ROOT) as { engines?: { node?: string } };
    const required = /^>=\s*(\d+)$/.exec(root.engines?.node ?? "");
    const image = /^node:(\d+)-alpine$/.exec(BASE_IMAGE);

    expect(required?.[1]).toBeDefined();
    expect(Number(image?.[1])).toBeGreaterThanOrEqual(Number(required?.[1]));
  });

  it("installs immutably, from the committed lockfile", () => {
    expect(stage("deps")).toMatch(/yarn install --immutable/);
  });

  it("copies a manifest for every workspace that has one", () => {
    // The drift guard that matters most here, and the one this module was itself caught
    // by in the UI image (#27). Yarn resolves the whole workspace set before installing
    // any of it, so a workspace whose manifest is missing from the context fails
    // `--immutable` — and the deps stage cannot give itself that reminder.
    const root = manifest(REPO_ROOT) as { workspaces: string[] };
    const withManifest = root.workspaces.filter((workspace) =>
      existsSync(join(REPO_ROOT, workspace, "package.json")),
    );
    const copied = [...stage("deps").matchAll(/^COPY\s+(\S+)\/package\.json/gm)].map(
      (match) => match[1],
    );

    expect(new Set(copied)).toEqual(new Set(withManifest));
  });

  it("builds a production-only tree for this workspace and sets it aside", () => {
    // `focus --production` is what keeps the compiler, Jest, the Nest CLI and every other
    // devDependency out of the shipped image. It runs *before* the full install rather
    // than pruning after it, so both trees come out of the same lockfile and the same
    // cache — and neither is a subset produced by deleting directories out of the other.
    const deps = stage("deps");

    expect(deps).toMatch(new RegExp(`yarn workspaces focus --production ${quote(MODULE_NAME)}\\b`));
    expect(deps).toMatch(new RegExp(`cp -R node_modules ${quote(PRODUCTION_TREE)}\\b`));

    // Both offsets are asserted present before they are compared: `indexOf` answers -1 for
    // a line that is not there, and -1 is less than everything — so the ordering check
    // alone would be satisfied by deleting the very instruction it is about.
    const focused = deps.indexOf("focus --production");
    const installed = deps.indexOf("yarn install --immutable");
    expect(focused).toBeGreaterThan(-1);
    expect(installed).toBeGreaterThan(focused);
  });

  it("prunes only what no running process reads, and only from the production tree", () => {
    // Declarations and source maps are read by a compiler and a debugger. Deleting them
    // from the *full* tree would fail the build stage's typecheck instead of shrinking the
    // image, so the path this find is given is load-bearing.
    const prune = /^\s*&&\s*find\s+(\S+)\s+-type f\s+\\?\(([^)]*)\)\s+-delete/m.exec(stage("deps"));

    expect(prune).not.toBeNull();
    expect(prune?.[1]).toBe(PRODUCTION_TREE);
    for (const kept of ["*.js", "*.json", "*.md", "LICENSE"]) {
      expect(prune?.[2]).not.toContain(`"${kept}"`);
    }
    for (const deleted of ["*.d.ts", "*.map"]) {
      expect(prune?.[2]).toContain(`"${deleted}"`);
    }
  });

  it("compiles through the workspace, so nest reads this module's own tsconfig", () => {
    expect(stage("build")).toMatch(
      new RegExp(`^RUN yarn workspace ${quote(MODULE_NAME)} run build$`, "m"),
    );
  });

  it("installs nothing in the runtime stage", () => {
    // The runtime carries the production tree the deps stage produced and no package
    // manager at all. An install here would put the toolchain and every dev dependency
    // back into the image.
    expect(stage("runtime")).not.toMatch(/yarn|npm|corepack/);
  });

  it("takes its dependencies from the production tree, never from the build stage", () => {
    // The one substitution that would silently double the image and ship a TypeScript
    // compiler to production: /app/node_modules in the build stage is the *full* tree.
    const runtime = stage("runtime");

    expect(runtime).toMatch(
      new RegExp(`^COPY --from=deps .*${quote(PRODUCTION_TREE)} \\./node_modules$`, "m"),
    );
    expect(runtime).not.toMatch(/^COPY --from=build .*node_modules/m);
  });

  it("runs as a created, non-root user", () => {
    const runtime = stage("runtime");

    expect(runtime).toMatch(/^RUN addgroup -S nestjs && adduser -S nestjs -G nestjs$/m);
    expect(runtime).toMatch(/^USER nestjs$/m);
  });

  it("drops root before the entry point, not after it", () => {
    // A USER below CMD is a USER that never takes effect for the process.
    const runtime = stage("runtime");

    expect(runtime.indexOf("\nUSER nestjs")).toBeLessThan(runtime.indexOf("\nCMD "));
  });

  it("owns the copied application as that user rather than as root", () => {
    const copies = [...stage("runtime").matchAll(/^COPY .*$/gm)].map((match) => match[0]);

    expect(copies).not.toHaveLength(0);
    for (const copy of copies) expect(copy).toContain("--chown=nestjs:nestjs");
  });

  it.each([
    ["dist", "the compiled service"],
    ["package.json", "the version every response carries — version.ts reads ../package.json"],
    ["openapi.json", "the document the process parses — specification.ts reads ../../"],
    ["openapi.yaml", "the authoritative document /api/openapi.yaml serves verbatim"],
  ])("copies %s beside the others — %s", (file) => {
    // Both version.ts and openapi/specification.ts resolve their siblings from __dirname
    // through the rootDir/outDir pinning, so all four have to land in one directory. Miss
    // one and the container fails at boot naming a path, which is cheap — but only if the
    // image was ever started, and this is what catches it before that.
    expect(stage("runtime")).toMatch(
      new RegExp(
        `^COPY --from=build .*/${quote(MODULE_NAME)}/${quote(file)} \\./${quote(MODULE_NAME)}/`,
        "m",
      ),
    );
  });

  it("starts the compiled entry point the manifest's own start script names", () => {
    // `yarn start` and the container must run the same file; the container's path is the
    // manifest's, one directory deeper, because node_modules is hoisted to /app.
    const start = manifest(MODULE_DIR).scripts?.start ?? "";

    expect(start).toContain("dist/main.js");
    expect(INSTRUCTIONS).toMatch(
      new RegExp(`^CMD \\["node", "${quote(MODULE_NAME)}/dist/main\\.js"\\]$`, "m"),
    );
  });

  it("declares itself production, which is what binds every interface", () => {
    // `listenHost` binds loopback outside production, and a process bound to loopback
    // inside a container is a process nothing can route to. It is also what strips
    // OURO_AUTH_DEV_USER before the schema sees it, so this one line is both the reason
    // the image answers at all and the reason it cannot be talked into trusting a
    // development bypass.
    expect(stage("runtime")).toMatch(/^(?:ENV\s+|\s+)NODE_ENV=production(?:\s|\\|$)/m);
  });

  it("names the port the configuration module defaults to, and exposes it", () => {
    const runtime = stage("runtime");

    expect(runtime).toMatch(new RegExp(`^\\s*PORT=${DEFAULT_PORT}$`, "m"));
    expect(runtime).toMatch(new RegExp(`^EXPOSE ${DEFAULT_PORT}$`, "m"));
  });

  it("declares a healthcheck on the liveness probe that follows the port it was given", () => {
    const healthcheck = /^HEALTHCHECK([^]*?)^\s*CMD (.+)$/m.exec(INSTRUCTIONS);

    expect(healthcheck).not.toBeNull();
    // Flags, so a container that is slow to boot is not killed and a wedged one is.
    expect(healthcheck?.[1]).toMatch(/--interval=\S+/);
    expect(healthcheck?.[1]).toMatch(/--timeout=\S+/);
    expect(healthcheck?.[1]).toMatch(/--start-period=\S+/);
    expect(healthcheck?.[1]).toMatch(/--retries=\d+/);
    // Shell form, which is what expands $PORT at run time; the exec form would look for a
    // container listening on the literal string.
    expect(healthcheck?.[2]).toContain(`"http://127.0.0.1:\${PORT}${HEALTH_LIVE_PATH}"`);
  });

  it("does not point the healthcheck at readiness", () => {
    // The distinction #29 exists for. A Docker healthcheck is read by restart policies and
    // by compose's `condition: service_healthy`, so pointing it at /health/ready would
    // restart a perfectly healthy container every time PostgreSQL was the thing that
    // needed attention.
    expect(INSTRUCTIONS).not.toContain(HEALTH_READY_PATH);
  });

  it("bakes in no value of any variable this service reads", () => {
    // Every OURO_* variable is an address that differs per environment or a secret. The
    // configuration module names each missing one at boot and exits 2; a default in a
    // layer would replace that line with a silent connection to the wrong host, or with a
    // published image carrying a credential.
    const settings = [...INSTRUCTIONS.matchAll(/^(?:ENV\s+|\s+)([A-Z][A-Z0-9_]*)=/gm)].map(
      (match) => match[1],
    );

    expect(settings).not.toHaveLength(0);
    for (const name of settings) expect(name).not.toMatch(/^OURO_/);
  });
});

describe("the build context", () => {
  it("is governed by a file named for the Dockerfile, not for the directory", () => {
    // The image builds from the repository root, so BuildKit reads
    // <dockerfile>.dockerignore. A plain ouroboros-rest/.dockerignore would be read by
    // nothing at all while looking exactly like the file that governs the build.
    expect(existsSync(join(MODULE_DIR, ".dockerignore"))).toBe(false);
    expect(DOCKERIGNORE).not.toHaveLength(0);
  });

  it("starts from an allow-list", () => {
    // With the whole repository as the context, a deny-list grows a hole every time a
    // directory is added at the root.
    const first = DOCKERIGNORE.split("\n").find(
      (line) => line.trim() !== "" && !line.startsWith("#"),
    );

    expect(first).toBe("*");
  });

  it.each(["package.json", "yarn.lock", ".yarnrc.yml", MODULE_NAME])(
    "admits %s, which the build reads",
    (path) => {
      expect(DOCKERIGNORE).toMatch(new RegExp(`^!${quote(path)}$`, "m"));
    },
  );

  it("admits a manifest for every sibling workspace the deps stage copies", () => {
    // Same drift as the COPY lines, one file over: an admitted path that is not copied is
    // harmless, but a copied path that is not admitted fails the build.
    const copied = [...stage("deps").matchAll(/^COPY\s+(ouroboros-\S+)\/package\.json/gm)]
      .map((match) => match[1])
      .filter((workspace) => workspace !== MODULE_NAME);

    expect(copied).not.toHaveLength(0);
    for (const workspace of copied) {
      expect(DOCKERIGNORE).toMatch(new RegExp(`^!${quote(`${workspace}/package.json`)}$`, "m"));
    }
  });

  it.each([
    [`${MODULE_NAME}/node_modules`, "resolved for the host platform, not the image"],
    [`${MODULE_NAME}/dist`, "the output of a previous build"],
    ["**/.env", "a real value, never a layer"],
    ["**/.env.*", "a real value, never a layer"],
    ["**/*.pem", "a credential"],
    ["**/*.key", "a credential"],
  ])("re-excludes %s — %s", (pattern) => {
    const lines = DOCKERIGNORE.split("\n");
    const excluded = lines.indexOf(pattern);
    const admitted = lines.indexOf(`!${MODULE_NAME}`);

    // Present, and *after* the line that admits the module — .dockerignore is
    // last-match-wins, so the same two lines in the other order exclude nothing.
    expect(excluded).toBeGreaterThan(-1);
    expect(excluded).toBeGreaterThan(admitted);
  });

  it("excludes no file the build stage needs", () => {
    // The module's own files are admitted wholesale and then subtracted from; this is what
    // catches a subtraction that goes too far. Every excluded path must be generated
    // output, prose or the container definition — never a source file, and never one of
    // the three files the runtime copies out of the build stage.
    const subtracted = DOCKERIGNORE.split("\n").filter((line) =>
      line.startsWith(`${MODULE_NAME}/`),
    );

    expect(subtracted).not.toHaveLength(0);
    for (const path of subtracted) {
      expect(path).not.toMatch(new RegExp(`^${quote(MODULE_NAME)}/src\\b`));
      expect(path).not.toMatch(new RegExp(`^${quote(MODULE_NAME)}/(package|openapi)\\.`));
      expect(path).not.toMatch(new RegExp(`^${quote(MODULE_NAME)}/tsconfig`));
    }
  });

  it("admits every top-level entry of this module that is not subtracted", () => {
    // The allow-list is `!ouroboros-rest`, so this holds by construction today. It is
    // asserted because the cheapest way to shrink a context is to admit paths one by one,
    // and that is the version of this file that silently drops a new directory.
    const subtracted = new Set(
      DOCKERIGNORE.split("\n")
        .filter((line) => line.startsWith(`${MODULE_NAME}/`))
        .map((line) => line.slice(`${MODULE_NAME}/`.length)),
    );
    const entries = readdirSync(MODULE_DIR).filter(
      (entry) => !subtracted.has(entry) && !entry.startsWith("."),
    );

    expect(entries).toContain("src");
    expect(entries).toContain("package.json");
    expect(entries).toContain("openapi.json");
    expect(DOCKERIGNORE).toMatch(new RegExp(`^!${quote(MODULE_NAME)}$`, "m"));
  });
});
