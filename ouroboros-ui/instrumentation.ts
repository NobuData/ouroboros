/**
 * What runs once, before this server answers anything.
 *
 * One job today: layering the repo's `.env` files under the process environment, so that
 * `ouroboros-ui` is configured from the repo-root `.env` the way `ouroboros-rest` and
 * `ouroboros-engine` already are (`docs/CONVENTIONS.md` § 4). `env-files.ts` is the rule;
 * this is only where it is called.
 *
 * ### Why here and not `next.config.ts`
 *
 * The config file looks like the earlier hook and is the wrong one. `next build` with
 * `output: "standalone"` **serialises** the resolved config into `.next/standalone/server.js`
 * — the file is not evaluated again when that server starts. So an environment assembled in
 * `next.config.ts` would be the *build machine's*, frozen into the image, which is the exact
 * failure `app/env.ts` is written to avoid: a build machine "has no reason to know the
 * address of a service it is not calling".
 *
 * `register` has the property that actually matters — Next.js calls it "once when a new
 * Next.js server instance is initiated, and [it] must complete before the server is ready to
 * handle requests" (`instrumentation.md` § Exports). It runs in development, under
 * `next start`, and in the standalone server, always in the environment of the *running*
 * process. Every reader of these variables — `app/env.ts` through `restUrl()`, and `proxy.ts`
 * on each request — asks after that point.
 */

/**
 * Prepare the process before it serves.
 *
 * @returns Nothing, once the environment is assembled.
 */
export async function register(): Promise<void> {
  // `register` is called for each runtime the application builds for, and the Edge one has
  // no filesystem — `node:fs` is not merely empty there, importing it fails the build. The
  // guard is what keeps `env-files.ts` out of that bundle entirely, which is why the import
  // is dynamic and inside the branch rather than at the top of the file.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { applyEnvFiles } = await import("./env-files");

  applyEnvFiles();
}
