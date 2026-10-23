# Live slice against a real provider — {{date}}

Written by `scripts/live-slice-acceptance.sh` (DI.6, [#1321](https://github.com/NobuData/ouroboros/issues/1321)).
It ran the same path as the e2e leg `tests/e2e/specs/live-loop.spec.ts` with a real model:
queue one mirrored issue, confirm it for a live run, and wait for the run's draft pull request.

**Outcome:** {{outcome}}

| | |
| --- | --- |
| Issue | {{issue}} |
| Run | `{{run_id}}` ({{run_status}}) |
| Queued → finished | {{started}} → {{finished}} ({{duration}}) |
| Run wall clock | {{wall_clock}} |
| Model alias (run) | `{{model_alias}}` |
| Route | `{{route}}` |
| Models that answered | {{models}} |
| Model turns | {{turns}} ({{turns_by_stage}}) |
| Tokens | {{tokens}} ({{tokens_in}} in, {{tokens_out}} out) |
| Cost | {{cost}} ({{unpriced}} unpriced events) |
| Build | {{build}} |
| Pull request | {{pr_url}} (draft: {{pr_draft}}, branch `{{pr_branch}}`) |

## Notes

<!-- Who ran it, against which deployment and commit, and anything the numbers do not say. -->
