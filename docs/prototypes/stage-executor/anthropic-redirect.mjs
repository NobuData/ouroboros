// A Node preload for the DH.2 (#1303) compatibility run: it points ouroboros-rest's calls to
// https://api.anthropic.com at the recorded Anthropic API (`stub_facade.py`) instead, so the
// real facade, the real adapter and a real harness meet a scripted model.
//
// Test-only, and only for a throwaway REST started by hand:
//
//   OURO_TEST_ANTHROPIC_REDIRECT=http://127.0.0.1:9410 \
//   NODE_OPTIONS="--import $PWD/anthropic-redirect.mjs" node dist/main
//
// Nothing in ouroboros-rest reads this variable; without the preload it does nothing.

const target = process.env.OURO_TEST_ANTHROPIC_REDIRECT;
const ANTHROPIC = "https://api.anthropic.com";
const real = globalThis.fetch;

if (target) {
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    return real(url.startsWith(ANTHROPIC) ? `${target}${url.slice(ANTHROPIC.length)}` : input, init);
  };
}
