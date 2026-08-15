-- V013__tenant_keys.sql — the sealed data-encryption keys the vault encrypts credentials
-- with, one row per workspace per key version.
--
-- The database half of AD.1 (#222) and of roadmap decision **P2**
-- (docs/ROADMAP_MOCKUP_07_PROVIDERS_KEYS.md). Mockup 07's security strip promises that
-- *"keys are sealed per-tenant with envelope encryption (AES-256-GCM, KMS-backed)"*, and
-- this table is the half of that sentence which persists: the per-tenant **DEK**, never
-- stored in the clear, sealed by a **KEK** held behind `ouroboros-rest`'s `KeyWrapper`.
--
-- Nothing in this table is readable without the wrapper's key. `sealed_dek` is the DEK
-- after AES-256-GCM under the KEK, and a copy of this table — a `pg_dump`, a replica, a
-- stolen backup — is a table of ciphertext whose key was never in the database.
--
-- ---------------------------------------------------------------------------
-- **What envelope encryption buys, and therefore what this table's shape has to
-- support.** Three things, and each one is a column or a constraint below rather than a
-- promise in a document:
--
--   * **Upgrading custody is a re-wrap, not a migration.** The KEK seals *this table* and
--     nothing else. Moving from the environment master key to AWS KMS or Vault (AF.3,
--     [#236](https://github.com/NobuData/ouroboros/issues/236)) rewrites `sealed_dek` and
--     `wrapper` here and leaves every credential ciphertext elsewhere in the schema
--     byte-identical. Without the indirection, "add KMS support" would mean decrypting and
--     re-encrypting every secret in the system — an operation that has to hold every
--     plaintext in memory, and that fails halfway.
--
--   * **Deleting a workspace is crypto-shredding.** `on delete cascade` is not tidiness
--     here. Destroying the DEK makes that workspace's ciphertext unrecoverable *whatever
--     backups exist* — which is a stronger deletion guarantee than deleting the rows
--     themselves can give, because a backup holds those rows and does not hold this key.
--
--   * **Rotation is versioned, not destructive.** A rotation adds a version rather than
--     replacing one, so ciphertext sealed under the old DEK stays readable while the
--     re-encrypt sweep works through it. That is why the key here is `(organization_id,
--     version)` and not `organization_id`: an old version has to be able to coexist with
--     the new one, and each stored ciphertext names the version that sealed it.
--
-- ---------------------------------------------------------------------------
-- **Decision — a composite natural key, and no surrogate `id`.**
--
-- Every other table added since V008 opens with `id uuid primary key default
-- gen_random_uuid()`, so the departure is worth an argument rather than a shrug.
--
-- `(organization_id, version)` is the whole identity of a row: the vault asks for exactly
-- one thing — *this workspace's key at this version* — because that pair is what a stored
-- ciphertext carries in its envelope. A surrogate id would be a second identity that no
-- reader has and no writer needs, and it would have to be accompanied by a unique
-- constraint on the pair anyway to stop two rows claiming the same version. Nothing
-- references this table, so there is no foreign key that the composite would make wide.
--
-- The pair is also the index the only hot read uses. `select sealed_dek where
-- organization_id = $1 and version = $2` is a primary-key lookup, which is what one
-- decrypt costs.
--
-- ---------------------------------------------------------------------------
-- **Decision — at most one active version per workspace, enforced by a partial unique
-- index rather than by the application.**
--
-- "The version new writes are sealed under" has to be exactly one row, and the moment it
-- is two the vault is picking arbitrarily between two keys — which is not a visible
-- failure, it is a workspace whose ciphertext is split across two DEKs with nothing
-- recording which. Rotation is the operation that would do it: read the active version,
-- insert version + 1, retire the old one. Two rotations racing both read the same active
-- version, and without a rule in the database both succeed.
--
-- `tenant_keys_one_active_idx` is that rule. The second rotation fails on it, which is the
-- correct outcome — a rotation that lost a race did not happen, and the caller can see
-- that it did not.
--
-- A CHECK cannot express it: a CHECK sees one row. A trigger could, and would be a
-- serialization anomaly waiting to happen — it reads other rows in the same table, which
-- is exactly what a unique index does correctly and a `select` inside a trigger does not.
--
-- ---------------------------------------------------------------------------
-- **`status` and `rotated_at` are one fact, and the CHECK says so.** A retired version is
-- retired *at a time*, and an active version was never retired. Two nullable columns that
-- can disagree would make "is this key still in use" a question with two answers, so
-- `tenant_keys_retired_is_stamped` binds them: `status = 'retired'` if and only if
-- `rotated_at is not null`. `status` is text with a CHECK rather than an enum, per the
-- house rule — adding a state later is an ordinary migration.
--
-- ---------------------------------------------------------------------------
-- **Nothing writes this table from SQL.** `ouroboros-rest`'s `VaultService`
-- (`src/modules/vault/`) is the only writer, and the only reader, and there is no seed row:
-- a workspace's DEK is created the first time it stores a secret, because a key generated
-- for a workspace that never stores anything is key material with no purpose that a backup
-- would carry forever. `R__dev_seed.sql` therefore seeds no keys, and the development
-- database has an empty `tenant_keys` until something is encrypted.
--
-- House snake_case throughout — decision A4. `organization` is referenced by its quoted
-- camelCase `"id"` because that is BetterAuth's column.
--
-- Filed as issue #222 (AD.1).

-- ---------------------------------------------------------------------------
-- tenant_keys
-- ---------------------------------------------------------------------------
create table ouroboros.tenant_keys (
  -- The workspace this key belongs to, and the first half of the key.
  --
  -- **Cascade, and the cascade is a security feature rather than housekeeping.** Deleting
  -- a workspace destroys its DEK, and destroying the DEK is what makes that workspace's
  -- credential ciphertext unrecoverable — including the copies of it in every backup taken
  -- while it existed. This is the "delete a tenant = crypto-shred" half of decision P2, and
  -- it only holds because the key lives here and nowhere else: a cache that outlived this
  -- row, or a second copy kept somewhere convenient, would silently downgrade it to an
  -- ordinary delete.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- Which generation of this workspace's key this row holds. Starts at 1 and increases by
  -- one per rotation; the second half of the primary key.
  --
  -- Every ciphertext the vault produces carries this number in its envelope, which is what
  -- lets a rotation be additive: a value sealed under version 3 still names version 3 after
  -- version 4 becomes active, and decrypting it is a lookup rather than a guess. The
  -- re-encrypt sweep is what eventually empties an old version of readers; until it does,
  -- the old row stays and stays readable.
  --
  -- `>= 1` rather than `>= 0`, because zero is the value a caller supplies when it meant to
  -- supply nothing.
  version         integer     not null check (version >= 1),

  -- The DEK, sealed. **Never the key itself** — this column is AES-256-GCM ciphertext
  -- under the KEK, nonce and tag included, in whatever framing the wrapper named below
  -- produces.
  --
  -- `bytea` rather than text: it is bytes, and base64 in a text column would be a second
  -- encoding for a value nothing here reads as a string. The length is deliberately not
  -- constrained — the environment-master wrapper produces a fixed 60 bytes today, and a
  -- KMS wrapper's blob is a different, larger and version-dependent size, so a length CHECK
  -- would be a rule about the current wrapper masquerading as a rule about key material.
  sealed_dek      bytea       not null,

  -- Which `KeyWrapper` sealed it — `env-master` for the MVP's environment master key,
  -- and the KMS and Vault/OpenBao identifiers AF.3 (#236) adds.
  --
  -- This is what makes a re-wrap safe to run twice and possible to run at all: the service
  -- can tell a row it can already open from a row still sealed by the backend the operator
  -- is migrating away from, and can therefore convert a workspace at a time rather than
  -- requiring every row to move in one transaction. It is also the diagnostic an operator
  -- reads when the answer is "this database was sealed by a key you no longer have".
  --
  -- Plain text with no CHECK, deliberately: the set of wrappers is `ouroboros-rest`'s to
  -- extend, and a CHECK here would make adding an AF.3 backend a database migration.
  wrapper         text        not null,

  -- Whether this is the version new writes are sealed under. Exactly one row per workspace
  -- may be `active` — see `tenant_keys_one_active_idx` below, and the header for why that
  -- is an index rather than a trigger.
  --
  -- A retired version is still read: it is retired, not revoked, and the ciphertext it
  -- sealed stays readable until the sweep has re-encrypted it. What retirement means is
  -- only that nothing new will be sealed with it.
  status          text        not null default 'active'
                              check (status in ('active', 'retired')),

  -- When this version stopped being the one new writes use. Null exactly while the row is
  -- active — see `tenant_keys_retired_is_stamped`.
  --
  -- It is the audit trail of a rotation, and the input to any later question about how long
  -- a compromised key was in use.
  rotated_at      timestamptz,

  created_at      timestamptz not null default now(),

  -- Moved by the V001 trigger below rather than by the writer, as everywhere else in this
  -- schema: a re-wrap updates `sealed_dek` and `wrapper`, and the time it did so should be
  -- the server's account of it rather than the application's.
  updated_at      timestamptz not null default now(),

  primary key (organization_id, version),

  -- One fact, two columns — see the header. Written as an equivalence rather than as two
  -- implications so that neither direction can be relaxed without the other being noticed.
  constraint tenant_keys_retired_is_stamped
    check ((status = 'retired') = (rotated_at is not null))
);

comment on table ouroboros.tenant_keys is
  'Per-workspace data-encryption keys, sealed by the KeyWrapper''s KEK (#222, decision P2). Never holds key material in the clear: sealed_dek is AES-256-GCM ciphertext whose key was never in this database. One row per key version — rotation is additive, so ciphertext sealed under an older version stays readable while the sweep re-encrypts it. Written only by ouroboros-rest''s VaultService; cascading a workspace delete destroys its DEK, which is what makes that workspace''s credentials unrecoverable from any backup.';
comment on column ouroboros.tenant_keys.organization_id is
  'The workspace, and the first half of the key. ON DELETE CASCADE is the crypto-shredding guarantee, not housekeeping: destroying this row destroys the only key that can open that workspace''s ciphertext, in backups included.';
comment on column ouroboros.tenant_keys.version is
  'Which generation of the workspace''s key this is, from 1. Every ciphertext the vault produces names its version in the envelope, which is what makes a rotation additive rather than a migration.';
comment on column ouroboros.tenant_keys.sealed_dek is
  'The DEK after AES-256-GCM under the KEK — nonce and tag included, framed by the wrapper named beside it. Never the key itself. Deliberately unconstrained in length: an AF.3 KMS blob is a different size from the env-master framing, and a length CHECK would pin the current wrapper.';
comment on column ouroboros.tenant_keys.wrapper is
  'Which KeyWrapper sealed this row — env-master today, KMS or Vault/OpenBao after AF.3 (#236). What lets a re-wrap run a workspace at a time, and lets the service tell a row it can open from one sealed by a backend the operator is leaving. No CHECK: the set of wrappers belongs to ouroboros-rest.';
comment on column ouroboros.tenant_keys.status is
  'Whether new writes are sealed with this version. At most one active row per workspace (tenant_keys_one_active_idx). Retired is not revoked — a retired version is still read until the sweep has re-encrypted what it sealed.';
comment on column ouroboros.tenant_keys.rotated_at is
  'When this version stopped being the one new writes use; null exactly while it is active. The audit trail of a rotation, and the input to how long a compromised key was in use.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- The primary key covers the hot read — `(organization_id, version)` is exactly what a
-- decrypt looks up, because that pair is what the ciphertext's envelope carries.
--
-- The partial unique index below covers the other read, which is what an *encrypt* does:
-- find this workspace's active version. It is a unique index on `organization_id` alone
-- over the active rows, so the lookup is a single-row index scan and the uniqueness is the
-- rule the header argues for — one active key per workspace, enforced where two racing
-- rotations actually meet.
--
-- Nothing else is indexed. `wrapper` is read by the re-wrap job, which is an operator
-- action over the whole table and would sequentially scan it whatever indexes existed.
-- ---------------------------------------------------------------------------
create unique index tenant_keys_one_active_idx
  on ouroboros.tenant_keys (organization_id)
  where status = 'active';

comment on index ouroboros.tenant_keys_one_active_idx is
  'At most one active key version per workspace, and the index an encrypt finds it through (#222). A rule rather than an optimisation: two active rows would split a workspace''s ciphertext across two DEKs with nothing recording which, and this is where two concurrent rotations collide instead.';

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------
create trigger tenant_keys_touch_updated_at
  before update on ouroboros.tenant_keys
  for each row execute function ouroboros.touch_updated_at();
