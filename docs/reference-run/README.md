# Reference runs

Each directory here is the evidence bundle of one **real** run of the live loop, named by the
day it ran (DL.3, [#1327](https://github.com/NobuData/ouroboros/issues/1327)). Start with its
`SUMMARY.md`: what was measured, what the run does **not** show, how many attempts came before it,
and the recording's link and SHA-256.

`scripts/reference-bundle.sh` writes the bundles from `scripts/reference-run.sh` exports. Do not
edit one by hand: every figure on a summary is computed from a file next to it, and `manifest.json`
holds each file's SHA-256. The recording is a release asset, not a file in git. How to record and
publish a run: [`docs/DEMONSTRATION_LIVE_LOOP.md` § Publish the evidence](../DEMONSTRATION_LIVE_LOOP.md#publish-the-evidence).

The marketing page's hero shows the newest bundle's figures (DL.4,
[#1328](https://github.com/NobuData/ouroboros/issues/1328)). After committing a bundle, run
`yarn gen:reference` in `ouroboros-web/` and commit `ouroboros-web/data/reference-run.json` with
it. The web CI job fails until you do.

No bundle has been published yet.
