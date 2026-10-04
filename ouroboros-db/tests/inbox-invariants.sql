-- inbox-invariants.sql — the Needs-You inbox probes (#460, BM.4), run on their own.
--
-- The assertions are lib/inbox-invariants.sql. This file owns the session around them: the
-- helpers and a transaction it rolls back. `ci/db` runs it against the *seeded* database, where
-- R__dev_seed_workspace_triage_inbox.sql's cards, answers, blocks and PR #504 are the rows the probes
-- read. That database is also where tests/verify-inbox-invariants.sh plants a violation of each invariant, one at a
-- time, to prove this goes red naming it.
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/inbox-invariants.sql
--
-- Its only writes are probes that must be refused, and it is wrapped in a transaction it rolls back anyway, like its siblings.
-- Exits non-zero on the first violated assertion.

\set ON_ERROR_STOP on

-- A passing assertion returns void, so the only thing a result row could print is a screenful of
-- empty one-row tables. Errors are unaffected: they go to stderr and ON_ERROR_STOP still aborts.
\o /dev/null

begin;

-- must_hold, in pg_temp so it disappears with the session. Shared with constraints.sql and
-- seed.sql — see lib/assert.sql.
\ir lib/assert.sql

\ir lib/inbox-invariants.sql

rollback;

\o
\echo 'inbox-invariants.sql: all assertions passed'
