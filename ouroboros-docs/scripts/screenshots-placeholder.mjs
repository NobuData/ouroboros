/**
 * `yarn screenshots` — placeholder until the capture harness lands with CZ.1 (#1170).
 *
 * Exits non-zero on purpose: a verb that silently succeeded would let a contributor
 * believe the screenshots were refreshed when nothing was captured.
 */
console.error(
  "yarn screenshots: the capture harness arrives with CZ.1 " +
    "(https://github.com/NobuData/ouroboros/issues/1170); nothing was captured.",
);
process.exit(1);
