-- research-invariants.sql — mockup 22's research probes (#613, CK.6), run on their own.
--
-- The assertions are lib/research-invariants.sql. This file owns the session around them: the
-- helpers and a transaction it rolls back. `ci/db` runs it against the *seeded* database, where
-- R__dev_seed_research.sql's and R__dev_seed_workspace_research.sql's investigations, ledgers,
-- matrix, watch items and roadmap doc are the rows the probes read;
-- tests/verify-research-invariants.sh removes each discipline, one at a time, to prove this goes red
-- naming it.
--
--   PGPASSWORD=ouroboros psql -h localhost -p 5432 -U ouroboros -d ouroboros \
--     -v ON_ERROR_STOP=1 -f ouroboros-db/tests/research-invariants.sql
--
-- Exits non-zero on the first violated assertion.

\set ON_ERROR_STOP on

\o /dev/null

begin;

\ir lib/assert.sql

\ir lib/research-invariants.sql

rollback;

\o
\echo 'research-invariants.sql: all assertions passed'
