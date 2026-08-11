# ouroboros-db — the migration image.
#
# The deployable form of this module: the migrations, the project configuration that
# decides how they are applied, and nothing else. It is a **task, not a service** — it
# starts, applies what is pending to a database that already exists somewhere, and
# exits. That is the same shape the compose stack's `flyway` service has, and it is what
# keeps Flyway the sole owner of DDL (../docs/CONVENTIONS.md § 10, invariant 2) in an
# environment where there is no checkout to mount:
#
#   docker run --rm \
#     -e OURO_DB_HOST=db.internal -e OURO_DB_USER=ouroboros -e OURO_DB_PASSWORD=… \
#     ghcr.example/ouroboros-db:latest
#
# See docker-entrypoint.sh for the parameters, and README.md § The image for the rest.
#
# **The build context is this directory**, unlike ouroboros-ui: nothing here installs
# through the workspace lockfile, so the image needs nothing from the repository root
# (../docs/CONVENTIONS.md § 5 says so of this module by name). Which is also why the
# ignore file beside this one is a plain `.dockerignore` rather than a
# `Dockerfile.dockerignore`:
#
#   docker build -t ouroboros-db ouroboros-db     # from the repo root
#
# Three of the § 5 rules are deliberately not followed here, because each one is about a
# property this image does not have:
#
# - **Not multi-stage.** The stages exist to keep a build toolchain out of the runtime.
#   There is no build: the artefact is the .sql files themselves, copied in as they are
#   committed. A second stage would copy them from the first and prove nothing.
# - **No lockfile install.** Nothing is installed. The one dependency is Flyway, and it
#   is pinned by the base image below.
# - **No HEALTHCHECK.** A healthcheck answers "is this still serving?" of a process that
#   stays up. This one is finished when it exits, and its exit status is the answer —
#   which is what makes it usable as a Kubernetes Job, a compose `restart: "no"` service
#   or a deploy step.
#
# The non-root rule *is* followed: see USER below.

# The image the whole repository already migrates with — ../docker-compose.yml pins it
# for the development stack and run.sh pins it for a hand-run migration, and
# ../scripts/verify-dev-env.sh fails if the three ever disagree. A published image that
# applied these migrations with a different Flyway than the one a pull request proved
# them against would make the gate mean less than it appears to.
FROM flyway/flyway:11-alpine

# Only what Flyway reads, laid out the way both other runners lay it out: /flyway/project
# is the -workingDirectory in the compose stack and in run.sh's container arm, so the
# relative `filesystem:migrations` inside flyway.toml resolves to the same place here.
#
# flyway.seed.toml is present but inert. It is the overlay that sets ${ouro_dev_seed}
# true, Flyway loads no overlay it is not handed, and nothing here hands it one — so the
# image seeds nothing unless a caller names it, which is the same guard the seed has
# everywhere else (README.md § The development seed).
#
# flyway.dev.toml is deliberately **absent**. It is the only file that re-enables
# `clean`, `clean` drops every object in the schema, and this is the image that will be
# pointed at production. Leaving it out means `clean` cannot be reached from here even
# by a caller who asks for it by name: flyway.toml disables it, and the file that would
# turn it back on is not in the layer to load.
COPY migrations/ /flyway/project/migrations/
COPY flyway.toml flyway.seed.toml /flyway/project/
COPY docker-entrypoint.sh /flyway/docker-entrypoint.sh

# The base image runs as root and this has nothing that needs it: everything above is
# world-readable, and applying a migration is a network call. `nobody` is already in the
# base image's /etc/passwd, so it costs no layer and adds no user this image has to own.
USER nobody

# The entrypoint translates OURO_DB_* into the connection Flyway is given, and points it
# at the project directory. Anything on the command line goes to Flyway untouched and
# wins over the environment, so `docker run … info`, `… validate` and a bare `-url=` all
# work as they would against the real binary.
ENTRYPOINT ["/flyway/docker-entrypoint.sh"]

# Flyway's own default is to print its usage, which is not what running this should mean.
CMD ["migrate"]
