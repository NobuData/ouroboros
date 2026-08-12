/**
 * A Jest transform for the one ES-module dependency the suites load for real.
 *
 * `@thallesp/nestjs-better-auth` is what [#701](https://github.com/NobuData/ouroboros/issues/701)
 * mounts BetterAuth with, and it is published as ES modules only. This service compiles to
 * CommonJS — `tsconfig.json` says why — so the running process reaches it through Node 24's
 * `require(esm)`, and Jest's CommonJS runtime, which has no such bridge, cannot load it at
 * all. That leaves two ways to test the mounting, and only one of them is a test: replace
 * the library, and assert about the replacement; or convert it, and assert about the
 * library. This is the conversion.
 *
 * It matters which one, because what that package contributes is *middleware ordering* —
 * a body parser re-added for every route but the auth ones, and a handler registered on
 * the adapter ahead of the router. A stand-in would be a second implementation of exactly
 * the thing under test, and `application.spec.ts`'s regression suite would pass against a
 * bootstrap that had stopped working.
 *
 * Only that one package is converted; see `transformIgnorePatterns` in `jest.config.mjs`.
 * `better-auth` itself is not — it is megabytes of ES modules with dependencies of its
 * own, and it is *replaced* instead, by `src/auth/better-auth.fixture.ts`, which the
 * `moduleNameMapper` beside that setting points at. So the seam runs between the two
 * libraries: the Nest integration is real, and BetterAuth's own routes are #702's and
 * #703's to prove.
 *
 * @see jest.config.mjs — where this is registered, and what it is registered for.
 */

const ts = require("typescript");

/**
 * `import.meta.url`, spelled the way a CommonJS module can say it.
 *
 * TypeScript emits `import.meta` untouched — it is a syntax error in CommonJS rather than
 * something it can lower — so the one occurrence is rewritten here. The library uses it
 * exactly once, to build a `createRequire` for its optional Express dependency, and this
 * expression is what that call needs: the absolute `file:` URL of the module doing the
 * requiring.
 */
const IMPORT_META_URL = "require('node:url').pathToFileURL(__filename).href";

/** What the converted module is compiled to. CommonJS, at the runtime Node 24 provides. */
const COMPILER_OPTIONS = {
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  target: ts.ScriptTarget.ES2023,
  esModuleInterop: true,
  allowJs: true,
};

module.exports = {
  /**
   * Convert one ES module to CommonJS.
   *
   * @param {string} source - The module's source, as Jest read it.
   * @param {string} filename - Its absolute path.
   * @returns {{code: string}} The converted module.
   */
  process(source, filename) {
    const { outputText } = ts.transpileModule(source, {
      // Renamed to `.js` for the compiler's benefit and nothing else. TypeScript reads a
      // `.mjs` extension as "this file is an ES module, emit one" and overrides the
      // `module` setting above — which would return the file unconverted, and the failure
      // would be the same "Cannot use import statement outside a module" this exists to
      // prevent.
      fileName: filename.replace(/\.mjs$/, ".js"),
      compilerOptions: COMPILER_OPTIONS,
    });

    return { code: outputText.replaceAll("import.meta.url", IMPORT_META_URL) };
  },
};
