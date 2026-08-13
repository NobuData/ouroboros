-- V007__user_preferences.sql — per-user product preferences, starting with the font scale.
--
-- The design system's § 4 (docs/DESIGN_SYSTEM_APP_SHELL.md) gives readers a five-step
-- font-size preference, and the preference belongs to the *person*, not the browser:
-- signing in on a second machine must bring the setting along, which means the server owns
-- the truth and the browser's localStorage is only a mirror for the no-flash boot. This
-- table is that truth.
--
-- One row per person, keyed by the BetterAuth user id — not a column on ouroboros."user",
-- deliberately. That table is the library's shape, rendered by scripts/betterauth-schema.mjs
-- and held to the snapshot by ci/db; a product column added there would either drift the
-- snapshot or have to become BetterAuth `additionalFields`, which moves schema ownership
-- out of these migrations and into application configuration. D3 (docs/ARCHITECTURE.md)
-- says Flyway owns every table, so the preference gets its own, referencing theirs.
--
-- Absence is an answer: a person with no row is at the default, and the API synthesizes
-- `font_scale = '100'` rather than writing a row nobody asked for. So the table only ever
-- holds *choices*, which is also why `on delete cascade` is safe — a deleted person's
-- choices mean nothing to anyone else.
--
-- Filed as issue #649 (CQ.2).

create table ouroboros.user_preferences (
  -- The person, and the key: one row of preferences each. BetterAuth ids are text (V004),
  -- and the reference makes sign-out-forever also preference-out-forever.
  user_id     text        not null primary key
                          references ouroboros."user" ("id") on delete cascade,

  -- The five steps of § 4, as percentages of the browser's base size. Text with a named
  -- CHECK rather than a numeric or an enum — the house idiom (V003's login format): the
  -- value is a *label* the UI stamps onto <html>, arithmetic is never done on it, numeric
  -- 87.5 would round-trip through JSON as a float, and widening the set is an ordinary
  -- migration instead of an enum surgery.
  font_scale  text        not null default '100',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint user_preferences_font_scale
    check (font_scale in ('87.5', '100', '112.5', '125', '150'))
);

comment on table ouroboros.user_preferences is
  'Per-user product preferences (#649). One row per person, absent while every setting is at its default; the REST preferences module is the only writer.';
comment on column ouroboros.user_preferences.font_scale is
  'Root font-size step, % of the browser base: 87.5 | 100 | 112.5 | 125 | 150 (DESIGN_SYSTEM_APP_SHELL.md § 4). Text because it is a label, not a number anything computes with.';

create trigger user_preferences_touch_updated_at
  before update on ouroboros.user_preferences
  for each row execute function ouroboros.touch_updated_at();
