-- settings-invariants.sql — the Settings probes (#484, BQ.5), run on their own.
--
-- The assertions are lib/settings-invariants.sql. This file owns the session around them: the
-- helpers and a transaction it rolls back. `ci/db` runs it against the *seeded* database, where
-- R__dev_seed_workspace_settings.sql's policy, keys, webhooks and routes are the rows the probes
-- read. That database is also where tests/verify-settings-invariants.sh plants a violation of each invariant, one at a
-- time, to prove this goes red naming it.
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/settings-invariants.sql
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

\ir lib/settings-invariants.sql

rollback;

\o
\echo 'settings-invariants.sql: all assertions passed'
