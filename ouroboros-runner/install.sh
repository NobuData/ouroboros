#!/bin/sh
#
# install.sh — install ouroboros-runner, enrol it, and keep it running (#248).
#
# The build farm's one-liner:
#
#   curl -fsSL 'https://<your deployment>/install.sh?version=<v>' | sh -s -- \
#     --tenant <workspace> --pool <pool> --token orb_enroll_…
#
# What it does, in this order — and nothing it downloaded runs before step 3:
#
#   1. works out which release this machine needs: linux/x86_64, linux/arm64 or
#      darwin/arm64, and refuses anything else by name;
#   2. downloads that binary and the release's SHA256SUMS into a private temporary
#      directory, over https only;
#   3. verifies the binary's SHA-256 against SHA256SUMS, and aborts — installing nothing
#      and stopping nothing — if it does not match;
#   4. asks the verified binary for its version, and refuses one that is not the release
#      it asked for;
#   5. installs it to /usr/local/bin and creates the agent's state directory;
#   6. enrols it with the flags given here (`ouroboros-runner enroll`), unless the state
#      directory already holds a runner — which makes a second run an upgrade;
#   7. installs a service that starts it at boot and restarts it on failure: a systemd
#      unit on Linux, a launchd daemon on macOS.
#
# `--uninstall` reverses 5–7. Run with --help for every option.
#
# Where it comes from. A deployment serves this file itself (ouroboros-rest's
# `GET /install.sh`), with DEFAULT_SERVER below filled in with its own address, and the
# release's binaries from `<server>/runner/<version>/`. Nothing here depends on a public
# domain: mockup 08's `get.ouroboros.dev` is design shorthand, and a self-hosted
# deployment behind a firewall installs from itself. The release this file came from
# fills in DEFAULT_VERSION, so the script and the binary it installs are one release.
#
# It needs root for steps 5–7, and uses sudo for them when it is not root. Steps 1–4 run
# as whoever ran it.
#
# Two variables exist for the test suite (ouroboros-runner/tests/install.test.sh) and
# nothing else: DESTDIR prefixes every path this script writes, and INSTALL_TTY names the
# terminal a confirmation is read from. A real install sets neither.
#
# POSIX sh, and checked by shellcheck in `make lint`: it runs on whatever /bin/sh a build
# machine has, which is dash, bash or zsh depending on who installed the machine.

set -eu

# ---------------------------------------------------------------------------
# Filled in by whoever publishes this file. Leave each exactly as written: a publisher
# replaces the whole line, and one that finds the line changed refuses to publish.
# ---------------------------------------------------------------------------

# The deployment to download from and enrol into — filled in by ouroboros-rest when it
# serves this script. Empty in the repository and in a release: pass --server.
DEFAULT_SERVER=''

# The release to install — filled in by `make release`, so a release's install.sh
# installs that release. Empty in the repository: pass --version.
DEFAULT_VERSION=''

# ---------------------------------------------------------------------------
# Where things go
# ---------------------------------------------------------------------------

PROGRAM=ouroboros-runner
BIN_DIR=/usr/local/bin
CONFIG_DIR=/etc/ouroboros-runner
DEFAULT_STATE_DIR=/var/lib/ouroboros-runner
SYSTEMD_UNIT=/etc/systemd/system/ouroboros-runner.service
LAUNCHD_LABEL=dev.ouroboros.runner
LAUNCHD_PLIST=/Library/LaunchDaemons/dev.ouroboros.runner.plist
MACOS_LOG_DIR=/Library/Logs/ouroboros-runner

DESTDIR=${DESTDIR:-}
INSTALL_TTY=${INSTALL_TTY:-/dev/tty}

# The options, before parsing.
server=''
version=''
download_url=''
tenant=''
pool=''
name=''
token=${OURO_RUNNER_TOKEN:-}
server_ca=''
service_user=''
state_dir=$DEFAULT_STATE_DIR
bearer_fallback=false
no_shell=false
uninstall=false
purge=false

# Set by the steps below.
os=''
platform=''
work=''
agent_stopped=false

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

# say MESSAGE — one line of progress.
say() {
  printf '%s\n' "$*"
}

# die MESSAGE — stop with a message on stderr. Every refusal ends here, and exits 1.
die() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Install ouroboros-runner, enrol it into a build farm pool, and run it as a service.

  curl -fsSL 'https://<deployment>/install.sh?version=<v>' | sh -s -- \
    --tenant <workspace> --pool <pool> --token orb_enroll_…

Options:
  --server URL        the deployment, https:// only (filled in when the deployment
                      served this script)
  --version X.Y.Z     the release to install (filled in when a release served it)
  --download-url URL  where the release's files are; default <server>/runner/<version>
  --tenant NAME       the workspace, as the enroll command shows it
  --pool NAME         the pool this runner joins
  --token TOKEN       the enrollment token; or export OURO_RUNNER_TOKEN, which keeps it
                      off the process list. Not needed when already enrolled
  --name NAME         this runner's name; default the hostname
  --server-ca FILE    PEM roots for a deployment whose certificate the system does not
                      trust — used for the downloads, and installed for the agent
  --bearer-fallback   enrol and run in the degraded bearer mode (decision B3)
  --no-shell          run no job directly on this machine; container jobs only
  --user NAME         the account the service runs as; default whoever ran this
                      (SUDO_USER under sudo)
  --state-dir DIR     where the agent keeps its identity; default /var/lib/ouroboros-runner
  --uninstall         stop and remove the service, the binary and its configuration;
                      asks before removing the state directory
  --purge             with --uninstall: remove the state directory without asking
  -h, --help          this text
USAGE
}

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

# require_value OPTION [VALUE...] — refuse an option that takes a value and has none.
# A value that looks like another option is almost always a forgotten one, so that is
# refused too rather than swallowed.
require_value() {
  [ $# -ge 2 ] || die "$1 needs a value"
  case $2 in
    --*) die "$1 needs a value (got the option $2)" ;;
  esac
}

# parse_arguments ARG... — set the option variables above from the command line. Both
# `--flag value` and `--flag=value` are accepted, as the agent's own flags accept both.
parse_arguments() {
  while [ $# -gt 0 ]; do
    case $1 in
      --server=* | --version=* | --download-url=* | --tenant=* | --pool=* | --token=* | \
        --name=* | --server-ca=* | --user=* | --state-dir=*)
        option=${1%%=*}
        value=${1#*=}
        shift
        set -- "$option" "$value" "$@"
        ;;
    esac
    case $1 in
      --server) require_value "$@"; server=$2; shift 2 ;;
      --version) require_value "$@"; version=$2; shift 2 ;;
      --download-url) require_value "$@"; download_url=$2; shift 2 ;;
      --tenant) require_value "$@"; tenant=$2; shift 2 ;;
      --pool) require_value "$@"; pool=$2; shift 2 ;;
      --token) require_value "$@"; token=$2; shift 2 ;;
      --name) require_value "$@"; name=$2; shift 2 ;;
      --server-ca) require_value "$@"; server_ca=$2; shift 2 ;;
      --user) require_value "$@"; service_user=$2; shift 2 ;;
      --state-dir) require_value "$@"; state_dir=$2; shift 2 ;;
      --bearer-fallback) bearer_fallback=true; shift ;;
      --no-shell) no_shell=true; shift ;;
      --uninstall) uninstall=true; shift ;;
      --purge) purge=true; shift ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option: $1 (see --help)" ;;
    esac
  done
}

# matches TEXT REGEX — whether TEXT matches an extended regex, whole.
matches() {
  printf '%s\n' "$1" | grep -Eq -- "^($2)\$"
}

# SemVer 2.0.0, as the agent's VERSION file and the gateway's version floor use it.
SEMVER='[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?'

# Characters a path or name may not carry. Each ends up in a systemd unit or a plist,
# where a space, a quote or markup would change what the file says rather than what it
# names — so rather than escape for two formats, the few values that reach them are
# refused if they carry any.
PLAIN='[^[:space:]"'\''<>&\\$`;]+'

# validate_install — refuse options an install cannot proceed with, before anything is
# downloaded.
validate_install() {
  [ -n "$server" ] || server=$DEFAULT_SERVER
  [ -n "$version" ] || version=$DEFAULT_VERSION

  [ -n "$server" ] || die "no --server given: name the deployment to install from and enrol into"
  # Trailing slashes are dropped, so <server>/runner/… has exactly one.
  while [ "${server%/}" != "$server" ]; do server=${server%/}; done
  matches "$server" "https://$PLAIN" ||
    die "--server must be an https:// address with no spaces or quotes (got $server) — the agent speaks to its control plane over TLS only"

  [ -n "$version" ] || die "no --version given: name the release to install, e.g. --version 0.5.0"
  matches "$version" "$SEMVER" || die "--version must be a semantic version such as 0.5.0 (got $version)"

  [ -n "$download_url" ] || download_url="$server/runner/$version"
  while [ "${download_url%/}" != "$download_url" ]; do download_url=${download_url%/}; done
  matches "$download_url" "https://$PLAIN" ||
    die "--download-url must be an https:// address (got $download_url) — a binary fetched in the clear is one anybody on the path could have replaced"

  validate_state_dir
  validate_user

  if [ -n "$server_ca" ] && { [ ! -f "$server_ca" ] || [ ! -r "$server_ca" ]; }; then
    die "--server-ca $server_ca is not a readable file"
  fi
}

# validate_state_dir — refuse a state directory the service files could not name. An
# install and an uninstall both need it.
validate_state_dir() {
  case $state_dir in
    /*) ;;
    *) die "--state-dir must be an absolute path (got $state_dir)" ;;
  esac
  matches "$state_dir" "$PLAIN" || die "--state-dir must not contain spaces, quotes or markup (got $state_dir)"
}

# validate_user — settle and check the account the service runs as.
validate_user() {
  if [ -z "$service_user" ]; then
    service_user=${SUDO_USER:-}
    [ -n "$service_user" ] || service_user=$(id -un)
  fi
  matches "$service_user" "$PLAIN" || die "--user must be a plain account name (got $service_user)"
  id -u "$service_user" >/dev/null 2>&1 || die "--user $service_user is not an account on this machine"
}

# ---------------------------------------------------------------------------
# The platform
# ---------------------------------------------------------------------------

# detect_platform — set os (linux or darwin) and platform (the release file's suffix).
detect_platform() {
  kernel=$(uname -s)
  machine=$(uname -m)

  # A shell under Rosetta on Apple silicon reports x86_64. The machine is arm64, and
  # the arm64 build is the one to install.
  if [ "$kernel" = Darwin ] && [ "$machine" = x86_64 ] &&
    [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    machine=arm64
  fi

  case $kernel/$machine in
    Linux/x86_64 | Linux/amd64) os=linux platform=linux-amd64 ;;
    Linux/aarch64 | Linux/arm64) os=linux platform=linux-arm64 ;;
    Darwin/arm64) os=darwin platform=darwin-arm64 ;;
    *) die "this machine is $kernel/$machine, and ouroboros-runner is released for linux/x86_64, linux/arm64 and darwin/arm64 only" ;;
  esac
}

# ---------------------------------------------------------------------------
# Privilege
# ---------------------------------------------------------------------------

# as_root COMMAND [ARG...] — run a command as root: directly when this is root, through
# sudo otherwise. Only the steps that write outside the temporary directory use it.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    die "installing needs root, and this is not root and has no sudo — re-run as root"
  fi
}

# ---------------------------------------------------------------------------
# Download and verify
# ---------------------------------------------------------------------------

# fetch URL DEST — download over https only, following redirects only to https.
fetch() {
  if [ -n "$server_ca" ]; then
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      --cacert "$server_ca" --output "$2" "$1" ||
      die "could not download $1"
  else
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      --output "$2" "$1" ||
      die "could not download $1"
  fi
}

# sha256_of FILE — print FILE's SHA-256 in lowercase hex, with whichever tool this
# machine has: sha256sum on Linux, shasum on macOS, openssl anywhere.
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 -r "$1" | cut -d ' ' -f 1
  else
    die "this machine has no sha256sum, shasum or openssl, and a binary that cannot be verified is not installed"
  fi
}

# download_and_verify — fetch this platform's binary and SHA256SUMS, and verify one
# against the other. Leaves the verified binary at $work/$PROGRAM. Nothing downloaded
# has been executed when this returns, and nothing on the machine has been changed.
download_and_verify() {
  asset="$PROGRAM-$platform"
  say "downloading $PROGRAM $version for ${platform%%-*}/${platform#*-} from $download_url"
  fetch "$download_url/SHA256SUMS" "$work/SHA256SUMS"
  fetch "$download_url/$asset" "$work/$asset"

  # sha256sum writes `<hash>  <name>`, or `<hash> *<name>` in binary mode.
  expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$work/SHA256SUMS")
  [ -n "$expected" ] ||
    die "SHA256SUMS from $download_url lists no checksum for $asset — refusing to install a binary that cannot be verified; nothing was installed"
  [ "$(printf '%s\n' "$expected" | wc -l | tr -d ' ')" = 1 ] ||
    die "SHA256SUMS from $download_url lists $asset more than once — refusing to guess which checksum is real; nothing was installed"
  expected=$(printf '%s' "$expected" | tr 'A-F' 'a-f')
  matches "$expected" '[0-9a-f]{64}' ||
    die "SHA256SUMS from $download_url lists a malformed checksum for $asset; nothing was installed"

  actual=$(sha256_of "$work/$asset")
  [ "$actual" = "$expected" ] ||
    die "checksum mismatch for $asset: expected $expected, got $actual — the download was altered or corrupted, so it was not run and nothing was installed"
  say "verified   sha256 $actual"

  mv "$work/$asset" "$work/$PROGRAM"
  chmod 0755 "$work/$PROGRAM"

  # Verified, so it may now be run: ask it what it is. A release whose SHA256SUMS lists a
  # different release's binary would pass the checksum and install the wrong build.
  reported=$("$work/$PROGRAM" version 2>/dev/null | sed -n '1p' || true)
  [ "$reported" = "$PROGRAM $version" ] ||
    die "the downloaded binary reports [$reported], not [$PROGRAM $version] — refusing to install a different release than the one asked for"
}

# ---------------------------------------------------------------------------
# The service files
# ---------------------------------------------------------------------------

# run_arguments — print the arguments of `ouroboros-runner run`, one per line. The same
# list goes into the systemd unit and the launchd plist.
run_arguments() {
  printf '%s\n' run --state-dir "$state_dir"
  [ -z "$server_ca" ] || printf '%s\n' --server-ca "$CONFIG_DIR/server-ca.pem"
  [ "$bearer_fallback" = false ] || printf '%s\n' --bearer-fallback
  [ "$no_shell" = false ] || printf '%s\n' --no-shell
}

# write_systemd_unit FILE — the Linux service.
#
# Restart=on-failure brings the agent back from a crash, an OOM kill or anything else
# that is not a clean stop; SIGTERM is a clean stop (the agent says `bye` and exits 0), so
# `systemctl stop` stays stopped. The start limit is the other half: an agent the control
# plane has refused for good — a revoked certificate, a version below the floor — exits 1
# on purpose and says why, and restarting it every ten seconds forever would bury that
# line. Five failed starts in five minutes and systemd stops trying; `systemctl status`
# shows the reason, and a reboot or a `systemctl restart` tries again.
#
# KillMode=mixed sends SIGTERM to the agent alone, so it can cancel its running jobs and
# report them cancelled before anything else in the cgroup is killed; whatever is left
# after TimeoutStopSec is killed outright. 30 s covers the agent's own 10 s job grace, its
# report and its close.
write_systemd_unit() {
  exec_start="$BIN_DIR/$PROGRAM $(run_arguments | tr '\n' ' ' | sed 's/ $//')"
  {
    printf '%s\n' \
      '# Installed by ouroboros-runner'"'"'s install.sh. Re-run it to change this file;' \
      '# install.sh --uninstall removes it.' \
      '[Unit]' \
      'Description=Ouroboros build farm agent (ouroboros-runner)' \
      'Wants=network-online.target' \
      'After=network-online.target' \
      'StartLimitIntervalSec=300' \
      'StartLimitBurst=5' \
      '' \
      '[Service]' \
      'Type=simple' \
      "User=$service_user" \
      "ExecStart=$exec_start" \
      'Restart=on-failure' \
      'RestartSec=10' \
      'KillMode=mixed' \
      'TimeoutStopSec=30' \
      '' \
      '[Install]' \
      'WantedBy=multi-user.target'
  } >"$1"
}

# home_of USER — the account's home directory, for the launchd daemon's HOME.
home_of() {
  home=$(dscl . -read "/Users/$1" NFSHomeDirectory 2>/dev/null | awk '{ print $2 }' || true)
  [ -n "$home" ] || home=$(awk -F: -v user="$1" '$1 == user { print $6 }' /etc/passwd 2>/dev/null || true)
  [ -n "$home" ] || die "could not find the home directory of $1"
  matches "$home" "$PLAIN" || die "the home directory of $1 ($home) contains spaces or quotes, which a launchd plist cannot carry here"
  printf '%s\n' "$home"
}

# write_launchd_plist FILE — the macOS service.
#
# A LaunchDaemon, not a LaunchAgent: it starts at boot with nobody logged in, which is
# what a build machine in a cupboard needs, and runs as --user. KeepAlive with
# SuccessfulExit false restarts it after any exit that is not a clean one, at most every
# ThrottleInterval seconds; a clean stop (`launchctl bootout`) stays stopped. launchd has
# no start limit, so unlike the systemd unit a runner the control plane has refused for
# good is restarted every ten seconds until somebody acts — the log says why each time.
#
# HOME and PATH are set because launchd starts a daemon with neither of the user's:
# Docker Desktop's socket is found under HOME, and a shell job's program on PATH, which
# includes Homebrew's.
write_launchd_plist() {
  home=$(home_of "$service_user")
  {
    printf '%s\n' \
      '<?xml version="1.0" encoding="UTF-8"?>' \
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
      '<!-- Installed by ouroboros-runner'"'"'s install.sh. Re-run it to change this file; install.sh --uninstall removes it. -->' \
      '<plist version="1.0">' \
      '<dict>' \
      '  <key>Label</key>' \
      "  <string>$LAUNCHD_LABEL</string>" \
      '  <key>ProgramArguments</key>' \
      '  <array>' \
      "    <string>$BIN_DIR/$PROGRAM</string>"
    run_arguments | sed 's|.*|    <string>&</string>|'
    printf '%s\n' \
      '  </array>' \
      '  <key>UserName</key>' \
      "  <string>$service_user</string>" \
      '  <key>EnvironmentVariables</key>' \
      '  <dict>' \
      '    <key>HOME</key>' \
      "    <string>$home</string>" \
      '    <key>PATH</key>' \
      '    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>' \
      '  </dict>' \
      '  <key>RunAtLoad</key>' \
      '  <true/>' \
      '  <key>KeepAlive</key>' \
      '  <dict>' \
      '    <key>SuccessfulExit</key>' \
      '    <false/>' \
      '  </dict>' \
      '  <key>ThrottleInterval</key>' \
      '  <integer>10</integer>' \
      '  <key>ExitTimeOut</key>' \
      '  <integer>30</integer>' \
      '  <key>StandardOutPath</key>' \
      "  <string>$MACOS_LOG_DIR/runner.log</string>" \
      '  <key>StandardErrorPath</key>' \
      "  <string>$MACOS_LOG_DIR/runner.log</string>" \
      '</dict>' \
      '</plist>'
  } >"$1"
}

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

# service_installed — whether this machine already has the service file.
service_installed() {
  case $os in
    linux) [ -f "$DESTDIR$SYSTEMD_UNIT" ] ;;
    darwin) [ -f "$DESTDIR$LAUNCHD_PLIST" ] ;;
  esac
}

# stop_service — stop a running agent, if there is one. The agent holds a lock on its
# state directory, so an enrollment into it — and a binary replaced under it — has to
# wait until it has let go. Remembered, so that a run which fails from here on starts it
# again rather than leaving the machine without one (see finish).
stop_service() {
  service_installed || return 0
  say "stopping the running agent"
  agent_stopped=true
  case $os in
    linux) as_root systemctl stop ouroboros-runner.service || true ;;
    darwin) as_root launchctl bootout "system/$LAUNCHD_LABEL" 2>/dev/null || true ;;
  esac
}

# start_service — start the service file that is installed, as it is.
start_service() {
  case $os in
    linux) as_root systemctl start ouroboros-runner.service ;;
    darwin) as_root launchctl bootstrap system "$DESTDIR$LAUNCHD_PLIST" ;;
  esac
}

# finish — the EXIT trap. Removes the temporary directory; and when an install is failing
# after it stopped a running agent, starts that agent again. An agent that silently stops
# existing is worse than a failed upgrade, because the Build Farm page would show it
# offline and nobody would know why — so the old service file is started, with whichever
# binary is in place, and the failure is still reported.
finish() {
  finish_status=$?
  if [ "$finish_status" -ne 0 ] && [ "$agent_stopped" = true ]; then
    printf 'install.sh: starting the agent that was running before this run failed\n' >&2
    start_service || printf 'install.sh: could not start it again — see the service manager\n' >&2
  fi
  [ -z "$work" ] || rm -rf "$work"
}

# already_enrolled — whether the state directory holds a runner. Asked as root, because
# the directory is 0700 and may belong to the service's account.
already_enrolled() {
  as_root test -f "$DESTDIR$state_dir/runner.json"
}

# enroll — spend the token for an identity, unless the state directory already holds
# one. The token reaches the agent through OURO_RUNNER_TOKEN, read from a private file by
# the shell that starts it, so it is on no command line this script runs.
enroll() {
  if already_enrolled; then
    say "already enrolled — keeping the identity in $state_dir (no token spent)"
    return 0
  fi

  set -- --server "$server" --state-dir "$DESTDIR$state_dir"
  [ -z "$server_ca" ] || set -- "$@" --server-ca "$DESTDIR$CONFIG_DIR/server-ca.pem"
  [ -z "$tenant" ] || set -- "$@" --tenant "$tenant"
  [ -z "$pool" ] || set -- "$@" --pool "$pool"
  [ -z "$name" ] || set -- "$@" --name "$name"
  [ "$bearer_fallback" = false ] || set -- "$@" --bearer-fallback

  (umask 077 && printf '%s' "$token" >"$work/token")
  # shellcheck disable=SC2016 # expanded by the inner shell, on purpose
  as_root sh -c 'OURO_RUNNER_TOKEN=$(cat "$1") && export OURO_RUNNER_TOKEN && shift && exec "$@"' \
    enroll "$work/token" "$DESTDIR$BIN_DIR/$PROGRAM" enroll "$@" ||
    die "enrollment failed — see the agent's message above; the binary is installed, and no service was set up"
  rm -f "$work/token"
}

# install_service — write the service file and start it.
install_service() {
  case $os in
    linux)
      write_systemd_unit "$work/unit"
      as_root mkdir -p "$DESTDIR$(dirname "$SYSTEMD_UNIT")"
      as_root install -m 0644 "$work/unit" "$DESTDIR$SYSTEMD_UNIT"
      as_root systemctl daemon-reload
      as_root systemctl enable ouroboros-runner.service
      as_root systemctl restart ouroboros-runner.service
      agent_stopped=false
      ;;
    darwin)
      write_launchd_plist "$work/plist"
      as_root mkdir -p "$DESTDIR$MACOS_LOG_DIR" "$DESTDIR$(dirname "$LAUNCHD_PLIST")"
      as_root chown "$service_user" "$DESTDIR$MACOS_LOG_DIR"
      as_root install -m 0644 "$work/plist" "$DESTDIR$LAUNCHD_PLIST"
      as_root chown root:wheel "$DESTDIR$LAUNCHD_PLIST"
      as_root launchctl enable "system/$LAUNCHD_LABEL"
      as_root launchctl bootstrap system "$DESTDIR$LAUNCHD_PLIST"
      agent_stopped=false
      ;;
  esac
}

install_runner() {
  validate_install
  # Asked before anything is downloaded, so a forgotten flag costs nothing. What enroll
  # itself insists on is asked here too, rather than discovered after the binary is in.
  if ! already_enrolled; then
    [ -n "$token" ] ||
      die "no --token given, and $state_dir holds no runner yet: mint an enrollment token on the Build Farm page"
    [ -n "$tenant" ] || die "no --tenant given: name the workspace this runner joins, as the enroll command shows it"
    [ -n "$pool" ] || die "no --pool given: name the pool this runner joins"
  fi

  work=$(mktemp -d)
  trap finish EXIT
  trap 'exit 1' HUP INT TERM

  # An upgrade keeps trusting what the first install was told to trust: the unit it is about
  # to rewrite would otherwise lose its --server-ca, and a private deployment's runner with it.
  if [ -z "$server_ca" ] && [ -f "$DESTDIR$CONFIG_DIR/server-ca.pem" ]; then
    server_ca="$DESTDIR$CONFIG_DIR/server-ca.pem"
    say "trusting  the server CA an earlier install left in $CONFIG_DIR"
  fi

  # Read now, as whoever ran this, and used from the private copy from here on — so the file
  # may be anywhere this user can read, including the copy an earlier run installed, which
  # the install below would otherwise be asked to copy onto itself.
  if [ -n "$server_ca" ]; then
    cp "$server_ca" "$work/server-ca.pem" || die "could not read --server-ca $server_ca"
    server_ca="$work/server-ca.pem"
  fi

  download_and_verify

  # Everything above changed nothing on this machine. Everything below does.
  stop_service
  as_root mkdir -p "$DESTDIR$BIN_DIR"
  as_root install -m 0755 "$work/$PROGRAM" "$DESTDIR$BIN_DIR/$PROGRAM"
  say "installed  $BIN_DIR/$PROGRAM"

  if [ -n "$server_ca" ]; then
    as_root mkdir -p "$DESTDIR$CONFIG_DIR"
    as_root install -m 0644 "$server_ca" "$DESTDIR$CONFIG_DIR/server-ca.pem"
  fi

  as_root mkdir -p "$DESTDIR$state_dir"
  as_root chmod 0700 "$DESTDIR$state_dir"
  enroll
  # The agent created its files as root; the service runs as $service_user.
  as_root chown -R "$service_user" "$DESTDIR$state_dir"

  install_service

  case $os in
    linux) service="systemd unit ouroboros-runner.service" logs="journalctl -u ouroboros-runner -f" ;;
    darwin) service="launchd daemon $LAUNCHD_LABEL" logs="tail -f $MACOS_LOG_DIR/runner.log" ;;
  esac
  say ""
  say "$PROGRAM $version is installed and running."
  say "  service  $service — starts at boot, restarts on failure"
  say "  runs as  $service_user, from $state_dir"
  say "  logs     $logs"
  remove_flags='--uninstall'
  [ "$state_dir" = "$DEFAULT_STATE_DIR" ] || remove_flags="$remove_flags --state-dir $state_dir"
  # A private deployment's CA is installed world-readable, so the removal can trust it too.
  curl_flags='-fsSL'
  [ -z "$server_ca" ] || curl_flags="$curl_flags --cacert $CONFIG_DIR/server-ca.pem"
  say "  remove   curl $curl_flags '$server/install.sh' | sh -s -- $remove_flags"
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

# confirm QUESTION — ask on the terminal, and succeed only on a yes. With no terminal —
# a pipe from curl in a script, a provisioning tool — there is nobody to ask, and the
# answer is no.
confirm() {
  # In a subshell: a failed redirection on a special builtin such as `:` ends a
  # non-interactive dash, and with it the uninstall, rather than failing the test.
  (: <"$INSTALL_TTY") 2>/dev/null || return 1
  printf '%s [y/N] ' "$1" >&2
  answer=''
  read -r answer <"$INSTALL_TTY" || true
  case $answer in
    y | Y | yes | YES | Yes) return 0 ;;
    *) return 1 ;;
  esac
}

uninstall_runner() {
  validate_state_dir

  case $os in
    linux)
      if [ -f "$DESTDIR$SYSTEMD_UNIT" ]; then
        as_root systemctl disable --now ouroboros-runner.service || true
        as_root rm -f "$DESTDIR$SYSTEMD_UNIT"
        as_root systemctl daemon-reload || true
        as_root systemctl reset-failed ouroboros-runner.service 2>/dev/null || true
        say "removed    $SYSTEMD_UNIT"
      fi
      ;;
    darwin)
      if [ -f "$DESTDIR$LAUNCHD_PLIST" ]; then
        as_root launchctl bootout "system/$LAUNCHD_LABEL" 2>/dev/null || true
        as_root rm -f "$DESTDIR$LAUNCHD_PLIST"
        say "removed    $LAUNCHD_PLIST"
      fi
      if [ -d "$DESTDIR$MACOS_LOG_DIR" ]; then
        as_root rm -rf "$DESTDIR$MACOS_LOG_DIR"
        say "removed    $MACOS_LOG_DIR"
      fi
      ;;
  esac

  if [ -e "$DESTDIR$BIN_DIR/$PROGRAM" ]; then
    as_root rm -f "$DESTDIR$BIN_DIR/$PROGRAM"
    say "removed    $BIN_DIR/$PROGRAM"
  fi
  if [ -d "$DESTDIR$CONFIG_DIR" ]; then
    as_root rm -rf "$DESTDIR$CONFIG_DIR"
    say "removed    $CONFIG_DIR"
  fi

  # The state directory is this runner's identity — its private key among it — and
  # removing it cannot be undone, so it goes only when somebody says so.
  if as_root test -d "$DESTDIR$state_dir"; then
    if [ "$purge" = true ] ||
      confirm "Remove $state_dir too? It holds this runner's identity, and cannot be recovered."; then
      as_root rm -rf "$DESTDIR$state_dir"
      say "removed    $state_dir"
    else
      say "kept       $state_dir — this runner's identity. Remove it with: sudo rm -rf $state_dir"
      say "           (or re-run with --uninstall --purge)"
    fi
  fi

  say ""
  say "$PROGRAM is uninstalled. Its certificate stays valid until it expires: remove the"
  say "runner on the Build Farm page to revoke it."
}

# ---------------------------------------------------------------------------

main() {
  parse_arguments "$@"
  [ -z "$DESTDIR" ] || say "staging under $DESTDIR (DESTDIR is set)"
  detect_platform
  if [ "$uninstall" = true ]; then
    uninstall_runner
  else
    [ "$purge" = false ] || die "--purge only means something with --uninstall"
    install_runner
  fi
}

main "$@"
