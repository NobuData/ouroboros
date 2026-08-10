-- V000__bootstrap.sql — the schema every later migration builds inside.
--
-- The compose stack passes -createSchemas=true, so Flyway makes the schema before the
-- first migration runs; this restates that intent in SQL so the schema still exists
-- when these migrations are applied by something that does not (a managed database, a
-- restore, CI), and so the very first `docker compose up` leaves a history row a
-- developer can point at.
--
-- Numbered V000 deliberately: the tenancy tables start at V001 (tenants), V002 (users
-- and membership) and V003 (GitHub enablement) per ouroboros-db/README.md, and this
-- infrastructure step must not take a version one of them is named for.
--
-- Filed as issue #10.

-- Guarded with a catalogue lookup rather than `create schema if not exists`, which
-- raises a NOTICE that Flyway reports as a WARNING every time the schema is already
-- there — which, with -createSchemas=true, is every single run.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'ouroboros') then
    execute 'create schema ouroboros';
  end if;
end
$$;

comment on schema ouroboros is
  'Ouroboros tenancy schema — owned by Flyway; no application module alters it.';
