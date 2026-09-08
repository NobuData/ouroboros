-- V027__github_credentials.sql — `github_credentials`, the per-workspace GitHub token the
-- backlog sync authenticates with.
--
-- K.3 (#101). Scaffolding (#22, `V003`) records *which* GitHub organisations and
-- repositories a workspace has enabled; `V014` (#99) records what is in them. Neither
-- records how this product is allowed to ask. Every call K.4's sync (#102) makes is an
-- authenticated one — GitHub's unauthenticated limit is 60 requests an hour against a
-- poller that pages a backlog — so the token is the thing standing between an enabled
-- repository and a mirror that can be filled.
--
-- One row per workspace, keyed by the workspace, holding one secret. Per decision **K1**
-- the MVP's credential is a **personal access token an administrator pastes in**; the
-- GitHub App installation flow is O.1 (#122), and when it lands it brings its own columns
-- rather than redefining this one — an installation token is minted per hour from an
-- installation id, which is a different kind of row and not a different value in this one.
--
-- ---------------------------------------------------------------------------
-- Decision — the column is sealed by the vault, and the database is what says so.
-- ---------------------------------------------------------------------------
--
-- `token_encrypted` holds one of AD.1's (#222) envelopes —
-- `ouro.v1.<key version>.<base64url nonce>.<base64url ciphertext‖tag>` — and
-- `github_credentials_token_sealed` refuses anything else. That is `V015`'s posture on
-- `provider_connections.credentials_encrypted`, adopted here for the reason its header
-- gives: *"the service is one writer, and this is every writer"*. A `ghp_…` pasted into
-- this column by a seed, a fixture, a support script or a hand-written `update` is refused
-- by the server rather than stored, and the vault's **adoption** path — seal a value that
-- was never sealed — therefore has nothing to do here, because a row holding a plaintext
-- token cannot exist.
--
-- Text rather than `bytea`, for `V015`'s reason: the envelope *is* text, its middle field
-- is the key version, and that field is what makes rotation additive — a token sealed
-- under version 3 stays readable after version 4 becomes active because the value itself
-- says which key opens it. A `bytea` column would mean decoding that framing on write and
-- re-encoding it on read, and a second place the version could be lost.
--
-- The `recordId` the envelope is bound to is **`organization_id`**, this row's primary key.
-- The vault's additional authenticated data is `(organization id, record id)`, so here both
-- halves are the same value — which is not a weakness but the shape of the fact: there is
-- one GitHub token per workspace, so "which record" and "which workspace" are the same
-- question. What the binding still buys is the property it exists for: a ciphertext lifted
-- out of one workspace's row and pasted into another's fails authentication rather than
-- decrypting.
--
-- ---------------------------------------------------------------------------
-- Decision — no mask column, and no suffix column.
-- ---------------------------------------------------------------------------
--
-- The settings surface renders `ghp_••••abcd`, and the obvious schema for that is a
-- `token_suffix text` written beside the ciphertext. It is not here. A mask is derived from
-- the token, and a derived value in a second column is a second source of truth that can
-- disagree with the first — a rotation that updated one and not the other would leave the
-- surface showing the previous token's last four characters over the current token's
-- ciphertext, which is worse than showing nothing, because it reads as confirmation.
--
-- So the mask is computed from the plaintext each time it is shown, and the cost of that is
-- one vault round trip on a settings read. That is a page an administrator opens
-- occasionally, and paying an AES operation for it is a better trade than a column that can
-- lie. `ouroboros-rest/src/modules/github/github.token.ts` is where the derivation lives.
--
-- ---------------------------------------------------------------------------
-- Decision — no `rotated_at`, and no `last_used_at`.
-- ---------------------------------------------------------------------------
--
-- Both were considered and both belong somewhere else.
--
-- **Rotation** is a write of a new token over an old one, so `updated_at > created_at` is
-- already the answer to *"has this been rotated"*. What an operator actually needs to know
-- is *who* rotated it and *when*, and that is `audit_events` (V022, #225) — which records
-- the actor, the address and the outcome that a timestamp on this row cannot. Decision
-- **AD.4**'s rule is that credential operations are audited from day one, and a column here
-- would be a worse copy of the trail that rule already requires.
--
-- **Last used** would be written by every poll of every enabled repository — a row update
-- per sync tick, on a table with one row per workspace, to record something
-- `github_repos.issues_synced_at` (V014) already records per repository and more precisely.
--
-- ---------------------------------------------------------------------------
-- Decision — the row is deleted rather than nulled when a token is cleared.
-- ---------------------------------------------------------------------------
--
-- `token_encrypted` is `not null`, so "this workspace has no GitHub token" is the absence
-- of a row and not a row full of nulls. There is exactly one state to read, and the
-- honest-pause state the intake page renders (N.6, #120) — *"no token configured"* — is a
-- missing row rather than a row that has to be inspected to find out whether it means
-- anything. It is also what makes the cascade complete: deleting a workspace takes its
-- token row with it *and* its DEK (`tenant_keys` cascades too, V013), so the ciphertext in
-- every backup taken while the workspace existed becomes unopenable.
--
-- Filed as issue #101 (K.3). Read by K.4's sync (#102) through
-- `ouroboros-rest/src/modules/github/`; written by that module's settings endpoint. The
-- sealed column is registered with the vault's re-encryption sweep, so a rotation of a
-- workspace's DEK finds it. Asserted in tests/constraints.sql.

create table ouroboros.github_credentials (
  -- The workspace, and the whole identity of the row: one GitHub token per workspace
  -- (decision K1). Not a surrogate key with a unique on top, because there is nothing else
  -- a row could be — and because this value is half the envelope's additional authenticated
  -- data and must therefore never change. A workspace id does not.
  --
  -- `on delete cascade`, which is the second half of the crypto-shredding guarantee: the
  -- row goes with the workspace and so does the key that sealed it.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The token, sealed. See this file's header: envelope-only by CHECK, bound to
  -- `organization_id`, and never read back out of this database by anything but the vault.
  token_encrypted text        not null,

  created_at      timestamptz not null default now(),

  -- Moved by the V001 trigger below rather than by the writer, as everywhere else in this
  -- schema. It is also the rotation record: a row whose `updated_at` is past its
  -- `created_at` has had its token replaced at least once.
  updated_at      timestamptz not null default now(),

  primary key (organization_id),

  -- **Envelope-only.** V015's guarantee, and the argument in this file's header: the
  -- service is one writer and this is every writer. A `ghp_…` cannot be stored here by any
  -- route, including the ones written after this migration by somebody who has not read it.
  constraint github_credentials_token_sealed
    check (token_encrypted ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);

comment on table ouroboros.github_credentials is
  'The per-workspace GitHub token the backlog sync authenticates with (#101, decision K1). One row per workspace; no row means no token, which is the honest "sync paused" state the intake page renders rather than a state to be inferred from nulls. The token is sealed by the vault (AD.1, #222) and github_credentials_token_sealed refuses any value that is not one of its envelopes, so a plaintext token cannot be stored here by any writer. Superseded for v2 auth by the GitHub App installation flow (O.1, #122), which brings its own columns rather than redefining this one.';
comment on column ouroboros.github_credentials.organization_id is
  'The workspace. Primary key — one token each — and the recordId the envelope''s additional authenticated data is bound to, which is why it is a value that never changes. Cascades from organization, together with tenant_keys (V013): deleting a workspace destroys both this ciphertext and the key that could open it.';
comment on column ouroboros.github_credentials.token_encrypted is
  'The GitHub personal access token, sealed as an AD.1 envelope (#222). Never returned by any API and never logged; the settings surface renders a mask derived from the plaintext at read time, which is why there is no suffix column here to fall out of step with it.';
comment on column ouroboros.github_credentials.updated_at is
  'When the token was last written. Past created_at means it has been rotated; who rotated it and from where is audit_events (V022), not this column.';
comment on constraint github_credentials_token_sealed on ouroboros.github_credentials is
  'The token is one of the vault''s envelopes, always (#101) — V015''s posture on provider_connections.credentials_encrypted, for its reason: this is a rule about every writer rather than about the one service that is supposed to encrypt. It also means the vault''s adoption path has nothing to do on this table, because a row holding an unsealed token cannot exist.';

create trigger github_credentials_touch_updated_at
  before update on ouroboros.github_credentials
  for each row execute function ouroboros.touch_updated_at();

comment on trigger github_credentials_touch_updated_at on ouroboros.github_credentials is
  'Moves updated_at on every write (#101), the V001 trigger every table in this schema uses. It is what makes "has this token been rotated" answerable without a column of its own.';
