import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ENV_FILES, environmentWithDotenv } from "./dotenv";

/**
 * The `.env` layering that stands in front of validation.
 *
 * Every test here writes its own files into a temporary directory and passes them in.
 * None of them read the checkout's real `.env` — a suite whose result depends on what a
 * developer happens to have in theirs is a suite that fails on one machine and passes on
 * another, and the developer's file holds real generated secrets besides.
 */
describe("environmentWithDotenv", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ouroboros-dotenv-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  /**
   * Write an `.env` file into this test's temporary directory.
   *
   * @param name - File name.
   * @param contents - What to write.
   * @returns The absolute path, ready to pass to {@link environmentWithDotenv}.
   */
  function envFile(name: string, contents: string): string {
    const path = join(directory, name);
    writeFileSync(path, contents, "utf8");

    return path;
  }

  it("reads a variable from a file", () => {
    const file = envFile(".env", "OURO_SESSION_SECRET=from-the-file\n");

    expect(environmentWithDotenv({}, [file]).OURO_SESSION_SECRET).toBe("from-the-file");
  });

  it("lets the process environment win over a file", () => {
    // What keeps a container configured by exactly what it was started with.
    const file = envFile(".env", "OURO_SESSION_SECRET=from-the-file\n");

    const env = environmentWithDotenv({ OURO_SESSION_SECRET: "from-the-process" }, [file]);

    expect(env.OURO_SESSION_SECRET).toBe("from-the-process");
  });

  it("lets a later file win over an earlier one", () => {
    // docs/CONVENTIONS.md § 4: the more specific file wins, and the module's is last.
    const root = envFile("root.env", "OURO_SESSION_SECRET=from-the-root\nPORT=9001\n");
    const module = envFile("module.env", "OURO_SESSION_SECRET=from-the-module\n");

    const env = environmentWithDotenv({}, [root, module]);

    expect(env.OURO_SESSION_SECRET).toBe("from-the-module");
    expect(env.PORT).toBe("9001");
  });

  it("treats a missing file as no variables rather than an error", () => {
    // The normal case in a container, which ships with neither file.
    const missing = join(directory, "does-not-exist.env");

    expect(() => environmentWithDotenv({ PORT: "4000" }, [missing])).not.toThrow();
    expect(environmentWithDotenv({ PORT: "4000" }, [missing]).PORT).toBe("4000");
  });

  it("throws when a file exists but cannot be read", () => {
    // Starting on defaults after failing to read the file meant to configure the service
    // is a silence that costs an afternoon.
    expect(() => environmentWithDotenv({}, [directory])).toThrow();
  });

  it("does not mutate the environment it is given", () => {
    // A layered copy that wrote through to `process.env` would change what every other
    // part of the process sees, from a function whose name says it only reads.
    const file = envFile(".env", "OURO_SESSION_SECRET=from-the-file\n");
    const original: NodeJS.ProcessEnv = { PORT: "4000" };

    environmentWithDotenv(original, [file]);

    expect(original).toEqual({ PORT: "4000" });
  });

  describe("ENV_FILES", () => {
    it("is the repo-root file then this module's, lowest precedence first", () => {
      // Deliberately the same two files, in the same order, as ouroboros-engine's
      // settings._ENV_FILES: one .env configures both services.
      const moduleRoot = resolve(__dirname, "..", "..", "..");

      expect([...ENV_FILES]).toEqual([
        resolve(moduleRoot, "..", ".env"),
        resolve(moduleRoot, ".env"),
      ]);
    });

    it("resolves absolute paths, so the working directory cannot change them", () => {
      expect(ENV_FILES.every((path) => resolve(path) === path)).toBe(true);
    });
  });
});
