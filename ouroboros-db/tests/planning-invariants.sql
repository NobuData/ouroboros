-- planning-invariants.sql — the planning invariants (#276, AK.5), run on their own.
--
-- The assertions are lib/planning-invariants.sql, and constraints.sql includes the same file as
-- its AK.5 section: this is the second way in, for the database that file cannot be pointed at.
-- `ci/db` migrates a *seeded* database, and constraints.sql is not runnable against it — it
-- carries plan assertions chosen from an empty database's statistics. The planning invariants have
-- no such dependency: they read the rows that are there and the catalogue, and nothing else.
--
-- Against the seed, that is AK.5's first acceptance criterion — green against AK.4's (#275)
-- mockup-09 rows — and it is the database tests/verify-planning-invariants.sh plants a cycle, a
-- reversed range and the rest into, one at a time, to prove this goes red naming each.
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/planning-invariants.sql
--
-- It writes nothing, and is wrapped in a transaction it rolls back anyway, like its siblings.
-- Exits non-zero on the first violated assertion.

\set ON_ERROR_STOP on

-- A passing assertion returns void, so the only thing a result row could print is a screenful of
-- empty one-row tables. Errors are unaffected: they go to stderr and ON_ERROR_STOP still aborts.
\o /dev/null

begin;

-- must_hold, in pg_temp so it disappears with the session. Shared with constraints.sql and
-- seed.sql — see lib/assert.sql.
\ir lib/assert.sql

\ir lib/planning-invariants.sql

rollback;

\o
\echo 'planning-invariants.sql: all assertions passed'
