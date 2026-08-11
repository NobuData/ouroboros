import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

/**
 * The production image (#47), asserted from the files that define it.
 *
 * A `docker build` is not something `ci/ui` can run — it needs a daemon, a network and
 * minutes this job does not have — so what is checked here is every property of the
 * image that is decided *in the repository*: the standalone output the runtime stage
 * depends on, the base image, the stages, the non-root user, the healthcheck, and the
 * build context. Each of these is a way the image can be broken by an edit that no other
 * test in this module would notice.
 *
 * The one property that genuinely needs a daemon — that the container starts, serves
 * `/` and reports healthy under 300 MB — is verified when the image is built, and by the
 * compose stack once #55 adds this service to it.
 */

const MODULE_DIR = join(import.meta.dirname, "..");
const REPO_ROOT = join(MODULE_DIR, "..");

const DOCKERFILE = readFileSync(join(MODULE_DIR, "Dockerfile"), "utf8");
const DOCKERIGNORE = readFileSync(join(MODULE_DIR, "Dockerfile.dockerignore"), "utf8");

/** The base image every stage is built on. Alpine, and pinned to a major version. */
const BASE_IMAGE = "node:24-alpine";

/**
 * The Dockerfile, split at its `FROM` lines into one entry per stage.
 *
 * @returns Stage name to the instructions that follow it, in file order.
 */
function stages(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  let current: string | undefined;

  for (const line of DOCKERFILE.split("\n")) {
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

/** The `deps`/`build`/`runtime` split docs/CONVENTIONS.md § 5 requires of every module. */
const STAGE_NAMES = ["deps", "build", "runtime"];

/**
 * Quote a literal for use inside a regular expression.
 *
 * @param literal Text to match exactly — a path, here, so it carries dots and slashes.
 * @returns The same text with every regex metacharacter escaped.
 */
function quote(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("next.config.ts", () => {
  it("emits the standalone build the runtime stage copies", () => {
    // Without this the runtime stage copies a directory that was never written, and the
    // build fails on a path that does not exist rather than on the missing option.
    expect(nextConfig.output).toBe("standalone");
  });

  it("traces from the repository root, where this workspace's dependencies are hoisted", () => {
    // The default tracing root is the project directory. This module's dependencies live
    // one level above it — `nodeLinker: node-modules` hoists them to the workspace root —
    // so at the default the trace would reach outside its root and copy nothing, and the
    // image would build cleanly and then die on a missing module.
    expect(nextConfig.outputFileTracingRoot).toBe(REPO_ROOT);
  });
});

describe("the Dockerfile", () => {
  it.each(STAGE_NAMES)("has a %s stage", (name) => {
    expect([...STAGES.keys()]).toContain(name);
  });

  it("builds every stage on the same pinned base image", () => {
    const bases = [...DOCKERFILE.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1]);

    expect(bases).toHaveLength(STAGE_NAMES.length);
    expect(new Set(bases)).toEqual(new Set([BASE_IMAGE]));
  });

  it("pins a Node major the workspace root accepts", () => {
    // The roadmap text for #47 says node:22-alpine; it predates the move to Node 24, and
    // this is what keeps the image and the manifest from disagreeing about the runtime.
    const root = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    const required = /^>=\s*(\d+)$/.exec(root.engines?.node ?? "");
    const image = /^node:(\d+)-alpine$/.exec(BASE_IMAGE);

    expect(required?.[1]).toBeDefined();
    expect(Number(image?.[1])).toBeGreaterThanOrEqual(Number(required?.[1]));
  });

  it("installs immutably, from the committed lockfile", () => {
    expect(STAGES.get("deps")).toMatch(/yarn install --immutable/);
  });

  it("copies a manifest for every workspace that has one", () => {
    // The drift guard that matters most here. Yarn resolves the whole workspace set
    // before installing any of it, so a workspace whose manifest is missing from the
    // context fails `--immutable`. It is what caught #27: scaffolding ouroboros-rest
    // failed this until its COPY was added, which is the reminder the deps stage cannot
    // give itself, and it will catch the next module the same way.
    const root = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as { workspaces: string[] };
    const withManifest = root.workspaces.filter((workspace) =>
      existsSync(join(REPO_ROOT, workspace, "package.json")),
    );
    const copied = [...STAGES.get("deps")!.matchAll(/^COPY\s+(\S+)\/package\.json/gm)].map(
      (match) => match[1],
    );

    expect(new Set(copied)).toEqual(new Set(withManifest));
  });

  it("installs nothing in the runtime stage", () => {
    // The point of the standalone output: the runtime carries the traced node_modules
    // and no package manager at all. A `yarn install` here would put the toolchain and
    // every dev dependency back into the image.
    expect(STAGES.get("runtime")).not.toMatch(/yarn|npm|corepack/);
  });

  it("runs as a created, non-root user", () => {
    const runtime = STAGES.get("runtime")!;

    expect(runtime).toMatch(/^RUN addgroup -S nextjs && adduser -S nextjs -G nextjs$/m);
    expect(runtime).toMatch(/^USER nextjs$/m);
  });

  it("owns the copied application as that user rather than as root", () => {
    const copies = [...STAGES.get("runtime")!.matchAll(/^COPY .*$/gm)].map(
      (match) => match[0],
    );

    expect(copies).not.toHaveLength(0);
    for (const copy of copies) expect(copy).toContain("--chown=nextjs:nextjs");
  });

  it("copies the standalone tree, the static assets and public/", () => {
    // server.js serves .next/static and public/ only if they are placed beside it; the
    // standalone output omits both on the assumption that a CDN will serve them.
    const runtime = STAGES.get("runtime")!;

    expect(runtime).toMatch(/COPY --from=build .*\.next\/standalone \.\/$/m);
    expect(runtime).toMatch(
      /COPY --from=build .*\.next\/static \.\/ouroboros-ui\/\.next\/static$/m,
    );
    expect(runtime).toMatch(/COPY --from=build .*\/public \.\/ouroboros-ui\/public$/m);
  });

  it("starts the standalone server at the path the tracing root produces", () => {
    // Tracing from the repository root means the tree unpacks as ./node_modules and
    // ./ouroboros-ui/server.js — not the ./server.js a single-package project gets.
    expect(DOCKERFILE).toMatch(/^CMD \["node", "ouroboros-ui\/server\.js"\]$/m);
  });

  it("binds every interface, and the port the convention gives this module", () => {
    // The standalone server binds localhost unless HOSTNAME says otherwise, which inside
    // a container means nothing outside it can ever connect.
    const runtime = STAGES.get("runtime")!;

    expect(runtime).toMatch(/^\s*HOSTNAME=0\.0\.0\.0$/m);
    expect(runtime).toMatch(/^\s*PORT=3000 \\$/m);
    expect(runtime).toMatch(/^EXPOSE 3000$/m);
  });

  it("declares a healthcheck on / that follows the port it was given", () => {
    const healthcheck = /^HEALTHCHECK([^]*?)^\s*CMD (.+)$/m.exec(DOCKERFILE);

    expect(healthcheck).not.toBeNull();
    // Flags, so a container that is slow to boot is not killed and a wedged one is.
    expect(healthcheck![1]).toMatch(/--interval=\S+/);
    expect(healthcheck![1]).toMatch(/--timeout=\S+/);
    expect(healthcheck![1]).toMatch(/--start-period=\S+/);
    expect(healthcheck![1]).toMatch(/--retries=\d+/);
    // Shell form, which is what expands $PORT at run time; the exec form would look for
    // a container listening on the literal string.
    expect(healthcheck![2]).toContain('"http://127.0.0.1:${PORT}/"');
  });

  it("bakes in no value of the one variable this module reads", () => {
    // OURO_REST_URL differs per environment and the standalone server reads it from the
    // process at request time. A default in a layer would turn a missing value into a
    // silent call to the wrong host instead of the error app/env.ts raises by name.
    expect(DOCKERFILE).not.toMatch(/^ENV\s+OURO_REST_URL/m);
    expect(DOCKERFILE).not.toMatch(/^\s*OURO_REST_URL=/m);
  });
});

describe("the build context", () => {
  it("is governed by a file named for the Dockerfile, not for the directory", () => {
    // The image builds from the repository root, so BuildKit reads
    // <dockerfile>.dockerignore. A plain ouroboros-ui/.dockerignore would be read by
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

  it.each([
    "package.json",
    "yarn.lock",
    ".yarnrc.yml",
    "ouroboros-ui",
  ])("admits %s, which the build reads", (path) => {
    expect(DOCKERIGNORE).toMatch(new RegExp(`^!${quote(path)}$`, "m"));
  });

  it("admits a manifest for every sibling workspace the deps stage copies", () => {
    // Same drift as the COPY lines, one file over: an admitted path that is not copied is
    // harmless, but a copied path that is not admitted fails the build.
    const copied = [...STAGES.get("deps")!.matchAll(/^COPY\s+(ouroboros-\S+)\/package\.json/gm)]
      .map((match) => match[1])
      .filter((workspace) => workspace !== "ouroboros-ui");

    expect(copied).not.toHaveLength(0);
    for (const workspace of copied) {
      expect(DOCKERIGNORE).toMatch(new RegExp(`^!${quote(`${workspace}/package.json`)}$`, "m"));
    }
  });

  it.each([
    ["ouroboros-ui/node_modules", "resolved for the host platform, not the image"],
    ["ouroboros-ui/.next", "the output of a previous build"],
    ["**/.env", "a real value, never a layer"],
    ["**/.env.*", "a real value, never a layer"],
    ["**/*.pem", "a credential"],
    ["**/*.key", "a credential"],
  ])("re-excludes %s — %s", (pattern) => {
    const lines = DOCKERIGNORE.split("\n");
    const excluded = lines.indexOf(pattern);
    const admitted = lines.indexOf("!ouroboros-ui");

    // Present, and *after* the line that admits the module — .dockerignore is
    // last-match-wins, so the same two lines in the other order exclude nothing.
    expect(excluded).toBeGreaterThan(-1);
    expect(excluded).toBeGreaterThan(admitted);
  });

  it("excludes no file the build stage needs", () => {
    // The module's own files are admitted wholesale and then subtracted from; this is
    // what catches a subtraction that goes too far — every excluded path must be either
    // generated or documentation, never a source file under app/.
    const subtracted = DOCKERIGNORE.split("\n").filter((line) =>
      line.startsWith("ouroboros-ui/"),
    );

    expect(subtracted).not.toHaveLength(0);
    for (const path of subtracted) expect(path).not.toMatch(/^ouroboros-ui\/app\b/);
  });

  it("admits every top-level entry of this module that is not subtracted", () => {
    // The allow-list is `!ouroboros-ui`, so this holds by construction today. It is
    // asserted because the cheapest way to shrink a context is to admit paths one by one,
    // and that is the version of this file that silently drops a new directory.
    const subtracted = new Set(
      DOCKERIGNORE.split("\n")
        .filter((line) => line.startsWith("ouroboros-ui/"))
        .map((line) => line.slice("ouroboros-ui/".length)),
    );
    const entries = readdirSync(MODULE_DIR).filter(
      (entry) => !subtracted.has(entry) && !entry.startsWith("."),
    );

    expect(entries).toContain("app");
    expect(entries).toContain("package.json");
    expect(DOCKERIGNORE).toMatch(/^!ouroboros-ui$/m);
  });
});
