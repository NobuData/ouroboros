# Acceptance reports

Dated evidence that a release's acceptance path was run by a person, outside CI.

## Live slice against a real provider (DI.6, [#1321](https://github.com/NobuData/ouroboros/issues/1321))

`scripts/live-slice-acceptance.sh` runs the path the e2e leg `tests/e2e/specs/live-loop.spec.ts`
proves against a recorded fixture — one mirrored issue to a draft pull request — with a real
model, and writes `live-slice-<date>.md` here from
[`live-slice-report.template.md`](live-slice-report.template.md): the outcome, the duration, the
model turns, the tokens, the cost and the pull request's URL.

It spends money on your API key and pushes a branch and a draft pull request to the repository,
so it is never run in CI. Run it against the sample repository
[`NobuData/ouroboros-sample`](https://github.com/NobuData/ouroboros-sample) (DL.1, #1320), and
reset that repository afterwards with its `scripts/reset.sh`.

**Before you run it**

1. The deployment allows live execution: `OURO_LIVE_EXECUTION_ENABLED=true`.
2. A workspace mirrors the sample repository, with a GitHub token that can push to it, a published
   workflow on it, dry-run policy on, and a runner online in the workflow's pool.
3. That workspace is the active one in your browser. Copy the `better-auth.session_token` cookie
   from the UI's origin.

**Run it**

```sh
read -r OURO_ACCEPT_SESSION          # paste the cookie value; it stays out of your shell history
read -r OURO_ACCEPT_PROVIDER_KEY     # optional: your API key, stored through Rotate
export OURO_ACCEPT_SESSION OURO_ACCEPT_PROVIDER_KEY
export OURO_ACCEPT_URL=http://localhost:4000
export OURO_ACCEPT_ISSUE_ID=<the issue's id from the backlog> OURO_ACCEPT_ISSUE_NUMBER=1
export OURO_ACCEPT_CONNECTION=<the provider connection id>   # only with the key
scripts/live-slice-acceptance.sh
```

It exits `0` when the run opened its draft pull request, `1` when it stopped or ran out of time
(`--timeout`, 1800 s by default) — the report is written either way — and `2` when an input is
missing, a request is refused, or the deployment does not allow live runs. The session and the
key are never printed, logged or written to the report.

Read the report, add who ran it and against which deployment and commit under **Notes**, and commit
it.
