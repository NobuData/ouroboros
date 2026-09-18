-- V041__farm_certificate_authority.sql — the farm CA, the certificates it issues, and the
-- one setting that lets a workspace do without them.
--
-- AH.2 (#250) under epic #240, decision **B3**. V040 (#249) gave the farm its enrollment
-- tokens and gave `runners` a `cert_serial` column with a constraint that says a certificate
-- serial is present exactly when a runner is on mTLS. This migration is what makes that serial
-- name something: a per-workspace certificate authority whose private key is an AD.1 (#222)
-- envelope, and a row per certificate it has ever issued — which is also the revocation list
-- the gateway (AH.3, #251) checks at every handshake.
--
-- Three things here are decisions rather than plumbing, and each has its section below: the
-- **CA key is a sealed column and only a sealed column**; a runner has **at most one live
-- certificate**, enforced by a partial unique index rather than by the service that renews;
-- and the **bearer fallback is a workspace setting with a visible consequence** rather than a
-- quiet capability.
--
-- ---------------------------------------------------------------------------
-- The CA key is sealed, and the CHECK is what makes that true of every writer.
-- ---------------------------------------------------------------------------
--
-- `farm_authorities.key_sealed` carries an `ouro.v1.<version>.<nonce>.<ciphertext>` envelope
-- and `farm_authorities_key_sealed` refuses any other shape — V015's, V027's and V040's
-- posture, for their reason. The rule being kept is not *the CA service remembers to seal*;
-- it is *a row holding an unsealed CA key cannot exist*, which is a rule about a migration
-- run by hand at 3am as much as about application code.
--
-- The issue's acceptance criterion — *the CA private key never leaves the vault service* — is
-- held in three places and this is the first. The second is `ouroboros-rest`'s
-- `ouroboros/no-ca-key-escape` lint rule, which fails the build on a CA key reaching a log, a
-- response or a field. The third is the grep test beside it, which reads the running service's
-- own source. A schema alone cannot say *and it is never returned*; what it can say is that
-- there is nothing here to return.
--
-- One authority per workspace, so `organization_id` is the primary key. A second CA would mean
-- two chains a gateway would have to try, and rotation — which is the only reason anybody
-- wants a second — is a *replacement*, written as a new row after the old one's certificates
-- are revoked. That is a lifecycle this migration does not build and deliberately does not
-- block: nothing here is `unique (organization_id, created_at)` or otherwise shaped for one
-- CA forever.
--
-- ---------------------------------------------------------------------------
-- A runner has at most one live certificate, and the index says so.
-- ---------------------------------------------------------------------------
--
-- Renewal issues a certificate and retires the one it replaces. If those two writes can come
-- apart, a runner ends up with two valid identities — and revoking "the" certificate of a
-- runner then leaves one working, which is the exact failure the revocation list exists to
-- prevent. `runner_certificates_live_idx` is a partial unique index over `runner_id` where the
-- row is neither revoked nor superseded, so the second live row is a write PostgreSQL refuses
-- rather than a state a service has to avoid reaching.
--
-- Rows are never deleted. A revoked certificate that disappeared would be a certificate the
-- handshake check cannot find — and *not found* has to mean *not ours*, which is a refusal, so
-- a deleted revocation would be safe by luck rather than by design. Keeping the row also keeps
-- the history: *this runner has been re-certified nine times this month* is a question with an
-- answer.
--
-- `runners.cert_serial` stays as V040 declared it and is **not** a foreign key onto this
-- table, which is worth stating because every other reference in the farm schema is. The two
-- tables reference each other — a certificate names its runner, and a runner names its live
-- certificate — and a cycle of non-deferrable foreign keys is a pair of rows neither of which
-- can be inserted first. The column is a denormalized pointer written in the same transaction
-- as the certificate row; `runner_certificates_live_idx` is what keeps it unambiguous, and
-- `tests/constraints.sql` is where the pairing is asserted.
--
-- ---------------------------------------------------------------------------
-- The bearer fallback is a setting, and a runner using it says so.
-- ---------------------------------------------------------------------------
--
-- Decision B3 keeps a bearer-token path for proxies that strip client certificates. V040
-- already recorded the consequence — `runners.security_mode` is `mtls` or `bearer_fallback`,
-- and AI.2 (#257) renders the weaker one as visibly degraded. What was missing is the two
-- halves either side of it: the workspace setting that has to be on before the weaker path can
-- be taken at all, and somewhere to put the secret it hands out.
--
-- `workspace_settings.runner_bearer_fallback` is the switch, defaulting to **false** — so a
-- deployment that never thinks about this question never has the weaker path. And
-- `runners.bearer_sealed` is the secret, with a constraint written as the exact mirror of
-- V040's `runners_cert_serial_with_mtls`: present precisely when `security_mode` is
-- `bearer_fallback`. The pair means neither mode can exist without its own evidence and
-- neither can carry the other's.

-- ---------------------------------------------------------------------------
-- farm_authorities — one workspace's certificate authority.
-- ---------------------------------------------------------------------------
create table ouroboros.farm_authorities (
  organization_id text        primary key
                              references ouroboros.organization ("id") on delete cascade,

  -- The CA's own certificate, PEM. Public: it is what every runner in the workspace pins and
  -- what the gateway verifies against, and it is the one thing about the CA an API returns.
  certificate_pem text        not null,

  -- The CA's private key, as an AD.1 envelope. There is no unsealed form of this column and
  -- no API that returns it — see this file's header.
  key_sealed      text        not null,

  -- Lowercase hex, as `crypto.X509Certificate` prints it lowercased and as this schema stores
  -- every serial. Not a lookup key — a workspace has one CA — but the answer to *which CA
  -- signed this?* when a certificate is read out of a proxy log.
  serial          text        not null,

  -- sha256 over the DER, lowercase hex: the CA pin an agent is handed at enrollment and checks
  -- on every connection. A pin is a fingerprint rather than a certificate so that comparing it
  -- is a string comparison an agent cannot get subtly wrong.
  fingerprint     text        not null,

  not_before      timestamptz not null,
  not_after       timestamptz not null,

  created_at      timestamptz not null default now(),

  -- **Envelope-only**, as V015, V027 and V040 are. The rule is about every writer.
  constraint farm_authorities_key_sealed
    check (key_sealed ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),

  -- A certificate column holds a certificate. Not a parse — PostgreSQL has no X.509 type — but
  -- enough that a private key pasted into the wrong column is a write that fails rather than a
  -- CA that stops working at the next handshake.
  constraint farm_authorities_certificate_pem
    check (certificate_pem like '-----BEGIN CERTIFICATE-----%'),

  constraint farm_authorities_serial_hex
    check (serial ~ '^[0-9a-f]{2,64}$'),

  constraint farm_authorities_fingerprint_sha256
    check (fingerprint ~ '^[0-9a-f]{64}$'),

  -- A validity window is a positive interval, for V040's reason about token TTLs: a CA that
  -- expired before it was created is one nothing can use and nothing will notice.
  constraint farm_authorities_window
    check (not_after > not_before)
);

comment on table ouroboros.farm_authorities is
  'One workspace''s build-farm certificate authority (#250, decision B3). The private key is an AD.1 (#222) envelope and farm_authorities_key_sealed refuses any other shape, so no writer can leave a plaintext key here; no API returns it, and ouroboros-rest''s no-ca-key-escape lint rule and its grep test are the other two halves of that claim. The certificate and the fingerprint are public — they are what a runner pins.';
comment on column ouroboros.farm_authorities.key_sealed is
  'The CA''s private key, sealed by AD.1''s vault (#222) as an ouro.v1.<version>.<nonce>.<ciphertext> envelope bound to this row. Unwrapped in-process for the duration of one signature and zeroized; never logged, never returned, and never written anywhere else.';
comment on column ouroboros.farm_authorities.fingerprint is
  'sha256 over the CA certificate''s DER, lowercase hex — the pin an agent is handed once at enrollment and checks on every connection thereafter. A fingerprint rather than the certificate itself because comparing it is a string comparison an agent implementation cannot get subtly wrong.';
comment on constraint farm_authorities_key_sealed on ouroboros.farm_authorities is
  'The CA key is one of the vault''s envelopes, always (#250) — V015''s, V027''s and V040''s posture for their reason: this is a rule about every writer, including a migration run by hand, rather than about the one service that is supposed to seal.';

-- ---------------------------------------------------------------------------
-- runner_certificates — every certificate the CA has issued, and the revocation list.
-- ---------------------------------------------------------------------------
create table ouroboros.runner_certificates (
  id                uuid        primary key default gen_random_uuid(),

  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  runner_id         uuid        not null,

  -- Lowercase hex, unique within the workspace. This is what a handshake presents and what a
  -- revocation names, so it is the column the gateway's check is indexed for.
  serial            text        not null,

  -- sha256 over the DER. A second identity for the same certificate, which is not redundancy:
  -- a serial is chosen by this service and a fingerprint is derived from the bytes, so an
  -- operator comparing what a runner actually presents against what was issued has something
  -- to compare that no writer here could have got wrong.
  fingerprint       text        not null,

  -- `enrollment` for the first certificate a runner ever gets, `renewal` for every one after.
  -- The distinction is the audit trail's — a renewal that arrives without a prior enrollment
  -- is a state worth being able to ask about.
  issued_for        text        not null,

  not_before        timestamptz not null,
  not_after         timestamptz not null,
  issued_at         timestamptz not null default now(),

  -- The immediate kill, as on enrollment_tokens and for the same reason: "this leaked" and
  -- "this was replaced" are different events, and only the first is an incident.
  revoked           boolean     not null default false,
  revoked_at        timestamptz,
  revoked_by        text        references ouroboros."user" ("id") on delete set null,

  -- One short machine-readable word — `operator`, `renewed`, `runner_removed`. Free text
  -- rather than a CHECK for V022's reason: adding a reason should be a release, not a
  -- migration.
  revocation_reason text,

  -- When a renewal replaced this certificate. Distinct from `revoked`: a superseded
  -- certificate is not an incident and is still cryptographically valid until it expires — it
  -- simply is not the one this runner should be presenting. The gateway refuses both, and the
  -- audit trail needs to tell them apart.
  superseded_at     timestamptz,

  constraint runner_certificates_runner_fk
    foreign key (runner_id, organization_id)
    references ouroboros.runners (id, organization_id) on delete no action,

  -- Unique per workspace rather than globally: a serial is 128 random bits, so a collision is
  -- not the thing being prevented — naming one workspace's certificate from another's lookup
  -- is. The gateway always knows which workspace a connection claims before it resolves a
  -- serial, and this index is what makes that pair the lookup.
  constraint runner_certificates_serial_key unique (organization_id, serial),

  constraint runner_certificates_serial_hex
    check (serial ~ '^[0-9a-f]{2,64}$'),

  constraint runner_certificates_fingerprint_sha256
    check (fingerprint ~ '^[0-9a-f]{64}$'),

  constraint runner_certificates_issued_for
    check (issued_for in ('enrollment', 'renewal')),

  constraint runner_certificates_window
    check (not_after > not_before),

  -- Both directions, as V040 writes every paired-nullable rule: a revoked certificate has a
  -- time, and a certificate with a time is revoked.
  constraint runner_certificates_revoked_at
    check (revoked = (revoked_at is not null)),

  -- A reason without a revocation is a reason for nothing.
  constraint runner_certificates_reason_with_revocation
    check (revocation_reason is null or revoked),

  constraint runner_certificates_superseded_after_issue
    check (superseded_at is null or superseded_at >= issued_at)
);

comment on table ouroboros.runner_certificates is
  'Every client certificate the farm CA has issued, and therefore the revocation list AH.3 (#251) checks at each handshake (#250, decision B3). Rows are never deleted: a revocation that vanished would be a serial the check cannot find, and "not found" has to mean "refuse" — so a deleted row would be safe by luck rather than by design.';
comment on column ouroboros.runner_certificates.serial is
  'The certificate''s serial, lowercase hex and unique within the workspace. What a TLS handshake presents and what a revocation names — the lookup the gateway''s refusal is built on.';
comment on column ouroboros.runner_certificates.superseded_at is
  'When a renewal replaced this certificate, or null. Deliberately not the same as revoked: a superseded certificate is not an incident and stays cryptographically valid until it expires, it is simply no longer the one this runner should present. The gateway refuses both; the audit trail has to tell them apart.';
comment on column ouroboros.runner_certificates.issued_for is
  'enrollment | renewal — which exchange produced this certificate. A renewal with no prior enrollment for the same runner is a question worth being able to ask.';

-- **At most one live certificate per runner**, which is what makes "revoke this runner" an
-- unambiguous instruction. See this file's header.
create unique index runner_certificates_live_idx
  on ouroboros.runner_certificates (runner_id)
  where not revoked and superseded_at is null;

comment on index ouroboros.runner_certificates_live_idx is
  'One live certificate per runner (#250). Renewal issues and supersedes in one transaction; without this, the two writes coming apart would leave a runner with two valid identities and revoking "the" certificate would leave one of them working.';

-- The gateway's own read, on the hot path of every handshake: is this workspace's serial still
-- good? Covered by runner_certificates_serial_key; named here so the query it serves is
-- recorded next to the table rather than only in EXPLAIN assertions.
create index runner_certificates_revoked_idx
  on ouroboros.runner_certificates (organization_id, serial)
  where revoked;

-- The fleet's read: this runner's certificate history, newest first.
create index runner_certificates_runner_idx
  on ouroboros.runner_certificates (runner_id, issued_at desc);

-- ---------------------------------------------------------------------------
-- The bearer fallback: the switch, and the secret.
-- ---------------------------------------------------------------------------
alter table ouroboros.runners
  add column bearer_sealed text;

comment on column ouroboros.runners.bearer_sealed is
  'The long-lived secret a bearer_fallback runner authenticates with, as an AD.1 envelope (#250, decision B3). Present exactly when security_mode is bearer_fallback — runners_bearer_with_fallback — which is the exact mirror of V040''s runners_cert_serial_with_mtls: neither mode can exist without its own evidence, and neither can carry the other''s.';

alter table ouroboros.runners
  add constraint runners_bearer_sealed
    check (bearer_sealed is null or bearer_sealed ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

alter table ouroboros.runners
  add constraint runners_bearer_with_fallback
    check ((security_mode = 'bearer_fallback') = (bearer_sealed is not null));

comment on constraint runners_bearer_with_fallback on ouroboros.runners is
  'The fallback claim carries its evidence (#250), as V040''s runners_cert_serial_with_mtls does for mTLS. A bearer_fallback runner with no secret could not authenticate at all; an mtls runner holding one would be a second way in that the certificate check never sees.';

alter table ouroboros.workspace_settings
  add column runner_bearer_fallback boolean not null default false;

comment on column ouroboros.workspace_settings.runner_bearer_fallback is
  'Whether this workspace permits a runner to enrol without a client certificate (#250, decision B3). Default false, so a deployment that never considers the question never has the weaker path. The fallback exists for corporate proxies that terminate client certificates; a runner that takes it is recorded as bearer_fallback and rendered as visibly degraded by AI.2 (#257), because a security downgrade nobody can see is the worst of both designs.';

-- The effective view gains the column, with its default resolved in the database exactly as
-- V011 argues auto_merge_on_checks should be — so a workspace that has never written a
-- settings row reads `false` from here rather than from an application constant.
create or replace view ouroboros.workspace_settings_effective
  with (security_invoker = true) as
select o."id"                                     as organization_id,
       coalesce(s.auto_merge_on_checks, false)    as auto_merge_on_checks,
       (s.organization_id is not null)            as is_explicit,
       s.updated_at,
       s.updated_by,

       -- Appended rather than slotted in beside auto_merge_on_checks, and that is PostgreSQL's
       -- rule rather than a preference: `create or replace view` may add columns at the end and
       -- may not reorder the ones already there. A drop-and-recreate would be free today and
       -- would be a broken dependency the first time anything else selects from this view.
       coalesce(s.runner_bearer_fallback, false)  as runner_bearer_fallback
  from ouroboros.organization o
  left join ouroboros.workspace_settings s
    on s.organization_id = o."id";

comment on view ouroboros.workspace_settings_effective is
  'Every organization''s settings with the defaults resolved (#67, extended by #250) — one row per workspace whether or not it has a workspace_settings row. The read side of the lazy-creation decision in V011''s header: it is what makes a newly created workspace read auto_merge_on_checks = false and runner_bearer_fallback = false from the database rather than from an application default. Read here, write the table.';
comment on column ouroboros.workspace_settings_effective.runner_bearer_fallback is
  'Whether the workspace permits certificate-less runner enrollment (#250), false for a workspace that has never set it. Bound to the column default by assertion in tests/constraints.sql, as auto_merge_on_checks is — a view cannot spell "whatever that column defaults to".';
