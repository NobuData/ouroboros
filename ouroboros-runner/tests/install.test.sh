#!/usr/bin/env sh
#
# install.test.sh — tests for ouroboros-runner's install.sh (#248).
#
# The script is run for real, end to end, against a fixture release and a staged root: a
# fake deployment serves a release directory — a stub agent per platform and a
# SHA256SUMS over them — through a stub curl; DESTDIR points every file the script writes
# into a temporary tree; and the machine it thinks it is on is whatever a stub uname says.
# The service managers, chown and the account lookup are stubs that record how they were
# called. The stub agent records its argv and the token it was handed, and "enrols" by
# writing runner.json, as the real one does.
#
# So what is asserted is what the script does to a machine, not what its source says:
# which file it downloaded for which platform, that a tampered one was never executed and
# left nothing behind, what the service files say, that the token reached the agent and
# no command line, and what an uninstall leaves.
#
# What is deliberately not here: a real systemd, a real launchd, a real reboot. Those are
# exercised by hand on real machines (see the README's Install section); these are the
# decisions the script makes before handing over to them.
#
# Usage:
#   ouroboros-runner/tests/install.test.sh          # this file alone
#   make test                                       # from ouroboros-runner/, with the Go suite
#   scripts/run-tests.sh ouroboros-runner/tests     # the module's shell suites
#
# Exit status: 0 all assertions passed / 1 at least one failed.

# The stubs' bodies below are single-quoted on purpose: they are scripts, and their
# variables are theirs to expand when they run, not this file's when it writes them.
# shellcheck disable=SC2016

set -u

unset CDPATH
TEST_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
MODULE_DIR=$(dirname -- "$TEST_DIR")
REPO_ROOT=$(dirname -- "$MODULE_DIR")

# shellcheck source-path=SCRIPTDIR/../..
# shellcheck source=scripts/lib/checks.sh
. "$REPO_ROOT/scripts/lib/checks.sh"

SCRIPT="$MODULE_DIR/install.sh"
VERSION=0.5.0
SERVER=https://farm.test
TOKEN=orb_enroll_01KE7TESTTOKENSECRETVALUE

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

STUB_LOG="$work/stub.log"
TOKEN_SEEN="$work/token-seen"
WEB_ROOT="$work/web"
export STUB_LOG TOKEN_SEEN WEB_ROOT

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------

mkdir -p "$work/bin"

# stub NAME BODY — a command on PATH ahead of the real one, whose body is BODY.
stub() {
  {
    printf '#!/bin/sh\n'
    printf '%s\n' "$2"
  } >"$work/bin/$1"
  chmod +x "$work/bin/$1"
}

# curl: serves $WEB_ROOT/<host>/<path> for https://<host>/<path>, and fails as --fail
# does when there is no such file. Records the URL and whether --cacert was passed.
stub curl '
output="" url="" cacert=""
while [ $# -gt 0 ]; do
  case $1 in
    --output) output=$2; shift 2 ;;
    --cacert) cacert=$2; shift 2 ;;
    --proto | --proto-redir) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
printf "curl %s%s\n" "$url" "${cacert:+ cacert=$cacert}" >>"$STUB_LOG"
path=${url#https://}
path=${path%%\?*}
[ -f "$WEB_ROOT/$path" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
cp "$WEB_ROOT/$path" "$output"'

# uname: the machine the script is told it is on.
stub uname '
case $1 in
  -s) printf "%s\n" "$STUB_KERNEL" ;;
  -m) printf "%s\n" "$STUB_MACHINE" ;;
esac'

# sysctl: answers sysctl.proc_translated — 1 is a shell under Rosetta.
stub sysctl 'printf "%s\n" "${STUB_TRANSLATED:-0}"'

# id: this is root (so no sudo is reached), invoked by "builder"; builder and root exist.
stub id '
case "$*" in
  -u) echo 0 ;;
  -un) echo builder ;;
  "-u builder" | "-u root") echo 0 ;;
  *) exit 1 ;;
esac'

# dscl: macOS directory services, for the daemon'"'"'s HOME.
stub dscl 'printf "NFSHomeDirectory: /Users/%s\n" "${3#/Users/}"'

for manager in launchctl chown sudo; do
  stub "$manager" "printf '%s %s\n' $manager \"\$*\" >>\"\$STUB_LOG\""
done

# systemctl: records its calls, and fails the one named by $STUB_SYSTEMCTL_FAIL — how a
# test makes a run fail after it has stopped the agent.
stub systemctl '
printf "systemctl %s\n" "$*" >>"$STUB_LOG"
[ "$1" != "${STUB_SYSTEMCTL_FAIL:-}" ]'

# The agent. `version` answers $STUB_VERSION; `enroll` records the token it was handed
# (from the environment) and writes runner.json into its --state-dir, as the real one
# does. Every call's argv is recorded.
agent_stub() {
  cat <<'AGENT'
#!/bin/sh
printf 'ouroboros-runner %s\n' "$*" >>"$STUB_LOG"
case $1 in
  version) printf 'ouroboros-runner %s\nprotocol        1 (speaks 1–1)\n' "${STUB_VERSION:-0.5.0}" ;;
  enroll)
    printf '%s' "${OURO_RUNNER_TOKEN:-}" >"$TOKEN_SEEN"
    state=''
    while [ $# -gt 0 ]; do
      [ "$1" = --state-dir ] && state=$2
      shift
    done
    [ "${STUB_ENROLL_EXIT:-0}" -eq 0 ] || exit "$STUB_ENROLL_EXIT"
    printf '{}\n' >"$state/runner.json"
    printf 'enrolled test-runner as runner 7f7c9d0e in acme-robotics / pool-a\n'
    ;;
esac
AGENT
}

# sums [ARG...] — sha256sum, or shasum -a 256 where there is none (macOS). Both print
# `<hash>  <name>`, and both take -b.
sums() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@"
  else
    shasum -a 256 "$@"
  fi
}

# publish_release DIR — a release directory: one stub agent per platform, install.sh,
# and SHA256SUMS over them, laid out as `make release` lays it out.
publish_release() {
  mkdir -p "$1"
  for platform in linux-amd64 linux-arm64 darwin-arm64; do
    agent_stub >"$1/ouroboros-runner-$platform"
    # Each platform's binary differs, as real ones do, so a checksum for one never
    # verifies another.
    printf '# %s\n' "$platform" >>"$1/ouroboros-runner-$platform"
  done
  cp "$SCRIPT" "$1/install.sh"
  (cd "$1" && sums ouroboros-runner-* install.sh >SHA256SUMS)
}

RELEASE="$WEB_ROOT/farm.test/runner/$VERSION"

# reset — a fresh deployment, a fresh machine and an empty log.
reset() {
  rm -rf "$WEB_ROOT" "$work/root" "$TOKEN_SEEN"
  publish_release "$RELEASE"
  mkdir -p "$work/root"
  : >"$STUB_LOG"
  root="$work/root"
  STUB_KERNEL=Linux STUB_MACHINE=x86_64
}

# run_install [ARG...] — run install.sh on the staged machine, with no terminal to ask
# on. Leaves its combined output in $out, its exit status in $status and the stubs'
# record in $log.
run_install() {
  run_with sh "$SCRIPT" "$@"
}

# run_with SHELL SCRIPT [ARG...] — run_install with a chosen shell and script.
run_with() {
  : >"$STUB_LOG"
  out=$(DESTDIR="$root" INSTALL_TTY="${TTY_FILE:-$work/no-tty}" PATH="$work/bin:$PATH" \
    STUB_KERNEL="$STUB_KERNEL" STUB_MACHINE="$STUB_MACHINE" "$@" </dev/null 2>&1)
  status=$?
  log=$(cat "$STUB_LOG")
}

UNIT="$work/root/etc/systemd/system/ouroboros-runner.service"
PLIST="$work/root/Library/LaunchDaemons/dev.ouroboros.runner.plist"
INSTALLED="$work/root/usr/local/bin/ouroboros-runner"
STATE="$work/root/var/lib/ouroboros-runner"

# The one-liner, with the token and the pool.
ENROLL_FLAGS="--server $SERVER --version $VERSION --tenant acme-robotics --pool pool-a --token $TOKEN"

printf '\nouroboros-runner — install.sh\n\n'

# ---------------------------------------------------------------------------
# The published lines
# ---------------------------------------------------------------------------

# ouroboros-rest fills DEFAULT_SERVER in when it serves the script, and `make release`
# fills DEFAULT_VERSION. Both replace the whole line, so each must be there exactly once,
# exactly as written.
printf 'The lines a publisher fills in\n'
check_equals 1 "$(grep -c "^DEFAULT_SERVER=''\$" "$SCRIPT")" \
  "install.sh carries DEFAULT_SERVER='' exactly once, for ouroboros-rest to fill in"
check_equals 1 "$(grep -c "^DEFAULT_VERSION=''\$" "$SCRIPT")" \
  "install.sh carries DEFAULT_VERSION='' exactly once, for make release to fill in"
check_executable "$SCRIPT" 'install.sh is executable'

# ---------------------------------------------------------------------------
# Linux
# ---------------------------------------------------------------------------

printf '\nA fresh Linux machine\n'
reset
# shellcheck disable=SC2086 # the flags are words on purpose
run_install $ENROLL_FLAGS
check_equals 0 "$status" "the one-liner installs on linux/x86_64 (output: $out)"
check_matches "$log" "^curl $SERVER/runner/$VERSION/SHA256SUMS\$" \
  'it downloads the release checksums from the deployment itself'
check_matches "$log" "^curl $SERVER/runner/$VERSION/ouroboros-runner-linux-amd64\$" \
  'and the linux/x86_64 binary'
check_matches "$out" 'verified   sha256 [0-9a-f]{64}' 'and says it verified the checksum'
check_executable "$INSTALLED" 'the binary is installed to /usr/local/bin'
check_equals "$(sums <"$RELEASE/ouroboros-runner-linux-amd64")" "$(sums <"$INSTALLED")" \
  'and it is the verified binary, byte for byte'
check_equals "$STATE" "$(find "$STATE" -prune -perm 700)" 'the state directory is created 0700'
check_matches "$log" "^ouroboros-runner enroll --server $SERVER --state-dir $STATE --tenant acme-robotics --pool pool-a\$" \
  'it enrols with the flags passed through'
check_equals "$TOKEN" "$(cat "$TOKEN_SEEN" 2>/dev/null)" 'the agent received the token'
check_not_matches "$log" "$TOKEN" 'and the token is on no command line the script ran'
check_matches "$log" "^chown -R builder $STATE\$" 'the state directory is handed to the service account'
check_exists "$UNIT" 'a systemd unit is installed'
check_contains "$UNIT" '^ExecStart=/usr/local/bin/ouroboros-runner run --state-dir /var/lib/ouroboros-runner$' \
  'which runs the agent from its state directory'
check_contains "$UNIT" '^Restart=on-failure$' 'and restarts it on failure'
check_contains "$UNIT" '^RestartSec=10$' 'ten seconds apart'
check_contains "$UNIT" '^StartLimitBurst=5$' 'and gives up after five failed starts'
check_contains "$UNIT" '^StartLimitIntervalSec=300$' 'in five minutes'
check_contains "$UNIT" '^KillMode=mixed$' 'stops the agent before the rest of its cgroup'
check_contains "$UNIT" '^User=builder$' 'runs as the account that installed it'
check_contains "$UNIT" '^WantedBy=multi-user.target$' 'and starts at boot'
check_contains "$UNIT" '^After=network-online.target$' 'once the network is up'
check_matches "$log" '^systemctl daemon-reload$' 'systemd is told about the unit'
check_matches "$log" '^systemctl enable ouroboros-runner.service$' 'the unit is enabled'
check_matches "$log" '^systemctl restart ouroboros-runner.service$' 'and started'
check_not_matches "$log" '^systemctl stop' 'nothing was stopped: nothing was running'
check_matches "$out" 'is installed and running' 'and it says so'
check_matches "$out" 'journalctl -u ouroboros-runner' 'naming where the logs are'

printf '\nEvery shell a build machine may have\n'
for shell in sh dash bash busybox; do
  command -v "$shell" >/dev/null 2>&1 || continue
  reset
  if [ "$shell" = busybox ]; then
    # shellcheck disable=SC2086
    run_with busybox sh "$SCRIPT" $ENROLL_FLAGS
  else
    # shellcheck disable=SC2086
    run_with "$shell" "$SCRIPT" $ENROLL_FLAGS
  fi
  check_equals 0 "$status" "it installs under $shell (output: $out)"
done

printf '\nlinux/arm64\n'
reset
STUB_MACHINE=aarch64
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 0 "$status" "it installs on linux/arm64 (output: $out)"
check_matches "$log" "/ouroboros-runner-linux-arm64\$" 'with the arm64 binary'
check_not_matches "$log" 'linux-amd64' 'and not the x86_64 one'

printf '\nOptions the agent passes on\n'
reset
printf 'PEM\n' >"$work/ca.pem"
run_install --server="$SERVER" --version="$VERSION" --tenant=acme-robotics --pool=pool-a \
  --token="$TOKEN" --name=shed-pi-01 --server-ca="$work/ca.pem" --no-shell --bearer-fallback \
  --state-dir=/srv/runner
check_equals 0 "$status" "--flag=value is accepted too (output: $out)"
check_matches "$log" "^curl $SERVER/runner/$VERSION/SHA256SUMS cacert=.*/server-ca.pem\$" \
  '--server-ca is trusted for the downloads'
check_equals "$(cat "$work/ca.pem")" "$(cat "$root/etc/ouroboros-runner/server-ca.pem" 2>/dev/null)" \
  'and installed for the agent'
check_matches "$log" "^ouroboros-runner enroll --server $SERVER --state-dir $root/srv/runner --server-ca $root/etc/ouroboros-runner/server-ca.pem --tenant acme-robotics --pool pool-a --name shed-pi-01 --bearer-fallback\$" \
  'enroll gets the CA, the name and the bearer fallback'
check_contains "$UNIT" '^ExecStart=/usr/local/bin/ouroboros-runner run --state-dir /srv/runner --server-ca /etc/ouroboros-runner/server-ca.pem --bearer-fallback --no-shell$' \
  'and run gets the state directory, the CA, the fallback and --no-shell'
check_matches "$out" "sh -s -- --uninstall --state-dir /srv/runner" \
  'the printed uninstall command carries a state directory that is not the default'
check_matches "$out" "curl -fsSL --cacert /etc/ouroboros-runner/server-ca.pem '$SERVER/install.sh'" \
  'and trusts the private CA the install did'

printf '\nToken from the environment\n'
reset
out=$(DESTDIR="$root" INSTALL_TTY="$work/no-tty" PATH="$work/bin:$PATH" \
  STUB_KERNEL=Linux STUB_MACHINE=x86_64 OURO_RUNNER_TOKEN="$TOKEN" \
  sh "$SCRIPT" --server "$SERVER" --version "$VERSION" --tenant acme-robotics --pool pool-a </dev/null 2>&1)
status=$?
check_equals 0 "$status" "OURO_RUNNER_TOKEN stands in for --token (output: $out)"
check_equals "$TOKEN" "$(cat "$TOKEN_SEEN" 2>/dev/null)" 'and reaches the agent'

printf '\nA script served by a deployment, from a release\n'
# What ouroboros-rest and make release do to the two lines, done here the same way.
reset
sed -e "s|^DEFAULT_SERVER=''\$|DEFAULT_SERVER='$SERVER'|" \
  -e "s|^DEFAULT_VERSION=''\$|DEFAULT_VERSION='$VERSION'|" "$SCRIPT" >"$work/served.sh"
run_with sh "$work/served.sh" --tenant acme-robotics --pool pool-a --token "$TOKEN"
check_equals 0 "$status" "the served script needs only the mockup's three flags (output: $out)"
check_matches "$log" "^curl $SERVER/runner/$VERSION/ouroboros-runner-linux-amd64\$" \
  'and installs the release it names, from the deployment that served it'
check_matches "$log" "^ouroboros-runner enroll --server $SERVER " 'enrolling into that deployment'

printf '\nA mirror\n'
reset
mkdir -p "$WEB_ROOT/mirror.test/r"
cp -R "$RELEASE" "$WEB_ROOT/mirror.test/r/$VERSION"
rm -rf "$RELEASE"
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS --download-url "https://mirror.test/r/$VERSION/"
check_equals 0 "$status" "--download-url fetches the release from elsewhere (output: $out)"
check_matches "$log" "^curl https://mirror.test/r/$VERSION/ouroboros-runner-linux-amd64\$" \
  'with the trailing slash dropped'
check_matches "$log" "^ouroboros-runner enroll --server $SERVER " 'and still enrols into the deployment'

printf '\nChecksums written in binary mode\n'
reset
(cd "$RELEASE" && sums -b ouroboros-runner-* install.sh >SHA256SUMS)
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 0 "$status" "a SHA256SUMS in sha256sum -b's '*name' form verifies too (output: $out)"

# ---------------------------------------------------------------------------
# Refusing to install
# ---------------------------------------------------------------------------

# nothing_installed — assert the machine is untouched: no binary, no unit, no enroll, no
# service manager called, and the downloaded agent never run.
nothing_installed() {
  check_missing "$INSTALLED" "$1: no binary is installed"
  check_missing "$UNIT" "$1: no unit is installed"
  check_not_matches "$log" '^ouroboros-runner ' "$1: the downloaded binary was never run"
  check_not_matches "$log" '^systemctl ' "$1: no service was touched"
}

printf '\nA tampered binary\n'
reset
printf '# altered in transit\n' >>"$RELEASE/ouroboros-runner-linux-amd64"
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 1 "$status" 'a binary whose checksum does not match aborts the install'
check_matches "$out" 'checksum mismatch for ouroboros-runner-linux-amd64: expected [0-9a-f]{64}, got [0-9a-f]{64}' \
  'with a message naming the file and both checksums'
check_matches "$out" 'nothing was installed' 'and saying nothing was installed'
nothing_installed 'tampered'

printf '\nA tampered binary over an installed runner\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
printf '# altered in transit\n' >>"$RELEASE/ouroboros-runner-linux-amd64"
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 1 "$status" 'an upgrade to a tampered binary aborts'
check_not_matches "$log" '^systemctl stop' 'and leaves the running agent running'
check_equals "$(sed '$d' "$RELEASE/ouroboros-runner-linux-amd64" | sums)" "$(sums <"$INSTALLED")" \
  'and the installed binary as it was'

printf '\nA release that does not list the binary\n'
reset
grep -v 'linux-amd64' "$RELEASE/SHA256SUMS" >"$work/sums" && mv "$work/sums" "$RELEASE/SHA256SUMS"
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 1 "$status" 'a binary SHA256SUMS does not list is not installed'
check_matches "$out" 'lists no checksum for ouroboros-runner-linux-amd64' 'and the message says why'
nothing_installed 'unlisted'

printf '\nA release that lists it twice\n'
reset
twice=$(grep 'linux-amd64' "$RELEASE/SHA256SUMS")
printf '%s\n' "$twice" >>"$RELEASE/SHA256SUMS"
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 1 "$status" 'a binary listed twice is not installed'
check_matches "$out" 'more than once' 'and the message says why'

printf '\nA release with no SHA256SUMS\n'
reset
rm -f "$RELEASE/SHA256SUMS"
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 1 "$status" 'no SHA256SUMS, no install'
check_matches "$out" "could not download $SERVER/runner/$VERSION/SHA256SUMS" 'and the message names what is missing'
nothing_installed 'no checksums'

printf '\nA binary of another release\n'
reset
# shellcheck disable=SC2086
out=$(DESTDIR="$root" INSTALL_TTY="$work/no-tty" PATH="$work/bin:$PATH" \
  STUB_KERNEL=Linux STUB_MACHINE=x86_64 STUB_VERSION=0.4.0 \
  sh "$SCRIPT" $ENROLL_FLAGS </dev/null 2>&1)
status=$?
log=$(cat "$STUB_LOG")
check_equals 1 "$status" 'a verified binary that reports another version is not installed'
check_matches "$out" 'reports \[ouroboros-runner 0.4.0\], not \[ouroboros-runner 0.5.0\]' \
  'and the message names both'
check_missing "$INSTALLED" 'no binary is installed'
check_not_matches "$log" '^ouroboros-runner enroll' 'nothing is enrolled'

printf '\nEnrollment the control plane refuses\n'
reset
# shellcheck disable=SC2086
out=$(DESTDIR="$root" INSTALL_TTY="$work/no-tty" PATH="$work/bin:$PATH" \
  STUB_KERNEL=Linux STUB_MACHINE=x86_64 STUB_ENROLL_EXIT=1 \
  sh "$SCRIPT" $ENROLL_FLAGS </dev/null 2>&1)
status=$?
log=$(cat "$STUB_LOG")
check_equals 1 "$status" 'a failed enrollment fails the install'
check_matches "$out" 'enrollment failed' 'and says so'
check_missing "$UNIT" 'and sets no service up'

printf '\nMachines there is no release for\n'
for machine in Linux/armv7l Linux/i686 Darwin/x86_64 FreeBSD/amd64; do
  reset
  STUB_KERNEL=${machine%/*} STUB_MACHINE=${machine#*/}
  # shellcheck disable=SC2086
  run_install $ENROLL_FLAGS
  check_equals 1 "$status" "$machine is refused"
  check_matches "$out" "this machine is $machine, and ouroboros-runner is released for linux/x86_64, linux/arm64 and darwin/arm64 only" \
    "$machine: the message names the machine and the three that are supported"
  check_not_matches "$log" '^curl ' "$machine: nothing is downloaded"
done

printf '\nRefused options\n'
# refuse DESCRIPTION MESSAGE-REGEX ARG... — the options are refused, with the message,
# before anything is downloaded.
refuse() {
  refuse_description=$1 refuse_message=$2
  shift 2
  reset
  run_install "$@"
  check_equals 1 "$status" "$refuse_description is refused"
  check_matches "$out" "$refuse_message" "$refuse_description: the message says why"
  check_not_matches "$log" '^curl ' "$refuse_description: nothing is downloaded"
}
refuse 'no server' 'no --server given' --version "$VERSION" --token "$TOKEN"
refuse 'an http server' '--server must be an https:// address' \
  --server http://farm.test --version "$VERSION" --token "$TOKEN"
refuse 'a server with a quote in it' '--server must be an https:// address' \
  --server "https://farm.test'x" --version "$VERSION" --token "$TOKEN"
refuse 'no version' 'no --version given' --server "$SERVER" --token "$TOKEN"
refuse 'a version that is not SemVer' '--version must be a semantic version' \
  --server "$SERVER" --version latest --token "$TOKEN"
refuse 'an http mirror' '--download-url must be an https:// address' \
  --server "$SERVER" --version "$VERSION" --token "$TOKEN" --download-url http://mirror.test/r
refuse 'no token on a machine with no runner' 'no --token given' \
  --server "$SERVER" --version "$VERSION"
refuse 'no tenant on a machine with no runner' 'no --tenant given' \
  --server "$SERVER" --version "$VERSION" --pool pool-a --token "$TOKEN"
refuse 'no pool on a machine with no runner' 'no --pool given' \
  --server "$SERVER" --version "$VERSION" --tenant acme-robotics --token "$TOKEN"
refuse 'an option with its value missing' '--token needs a value' \
  --server "$SERVER" --version "$VERSION" --token
refuse 'an option whose value is another option' '--pool needs a value \(got the option --token\)' \
  --server "$SERVER" --version "$VERSION" --pool --token "$TOKEN"
refuse 'an unknown option' 'unknown option: --frobnicate' --frobnicate
refuse 'a relative state directory' '--state-dir must be an absolute path' \
  --server "$SERVER" --version "$VERSION" --token "$TOKEN" --state-dir var/lib/runner
refuse 'a state directory with a space' '--state-dir must not contain spaces' \
  --server "$SERVER" --version "$VERSION" --token "$TOKEN" --state-dir '/var/lib/my runner'
refuse 'an account that does not exist' '--user nobody-here is not an account' \
  --server "$SERVER" --version "$VERSION" --token "$TOKEN" --user nobody-here
refuse 'a server CA that is not there' '--server-ca .* is not a readable file' \
  --server "$SERVER" --version "$VERSION" --token "$TOKEN" --server-ca "$work/missing.pem"
refuse '--purge without --uninstall' '--purge only means something with --uninstall' \
  --server "$SERVER" --version "$VERSION" --token "$TOKEN" --purge

printf '\n--help\n'
reset
run_install --help
check_equals 0 "$status" '--help succeeds'
check_matches "$out" '--uninstall' 'and documents --uninstall'
check_not_matches "$log" '^curl ' 'and downloads nothing'

# ---------------------------------------------------------------------------
# Re-running: an upgrade
# ---------------------------------------------------------------------------

printf '\nRe-running on an enrolled machine\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
run_install --server "$SERVER" --version "$VERSION"
check_equals 0 "$status" "a second run needs no token (output: $out)"
check_matches "$out" 'already enrolled — keeping the identity' 'and says it kept the identity'
check_not_matches "$log" '^ouroboros-runner enroll' 'no token is spent'
check_matches "$log" '^systemctl stop ouroboros-runner.service$' \
  'the running agent is stopped before its binary is replaced'
check_matches "$log" '^systemctl restart ouroboros-runner.service$' 'and started again after'

printf '\nRe-running on a machine installed with a private CA\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS --server-ca "$work/ca.pem"
run_install --server "$SERVER" --version "$VERSION" \
  --server-ca "$root/etc/ouroboros-runner/server-ca.pem"
check_equals 0 "$status" "--server-ca naming the CA the first install placed works (output: $out)"
run_install --server "$SERVER" --version "$VERSION"
check_equals 0 "$status" "and so does leaving it out (output: $out)"
check_matches "$out" 'trusting  the server CA an earlier install left' 'which keeps trusting the installed one'
check_matches "$log" "^curl $SERVER/runner/$VERSION/SHA256SUMS cacert=" 'for the downloads'
check_contains "$UNIT" ' --server-ca /etc/ouroboros-runner/server-ca.pem' 'and in the rewritten unit'

printf '\nAn upgrade that fails after stopping the agent\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
: >"$STUB_LOG"
out=$(DESTDIR="$root" INSTALL_TTY="$work/no-tty" PATH="$work/bin:$PATH" \
  STUB_KERNEL=Linux STUB_MACHINE=x86_64 STUB_SYSTEMCTL_FAIL=daemon-reload \
  sh "$SCRIPT" --server "$SERVER" --version "$VERSION" </dev/null 2>&1)
status=$?
log=$(cat "$STUB_LOG")
check_equals 1 "$status" 'a failure after the agent was stopped fails the run'
check_matches "$log" '^systemctl stop ouroboros-runner.service$' 'the agent had been stopped'
check_equals 'systemctl start ouroboros-runner.service' "$(printf '%s\n' "$log" | tail -n 1)" \
  'and is started again, last, so the machine is not left without one'
check_matches "$out" 'starting the agent that was running before' 'and the output says so'

printf '\nA fresh install that fails\n'
reset
: >"$STUB_LOG"
# shellcheck disable=SC2086
out=$(DESTDIR="$root" INSTALL_TTY="$work/no-tty" PATH="$work/bin:$PATH" \
  STUB_KERNEL=Linux STUB_MACHINE=x86_64 STUB_SYSTEMCTL_FAIL=daemon-reload \
  sh "$SCRIPT" $ENROLL_FLAGS </dev/null 2>&1)
status=$?
log=$(cat "$STUB_LOG")
check_equals 1 "$status" 'a fresh install that fails reports it'
check_not_matches "$log" '^systemctl start' 'and starts nothing: there was no agent before it'

# ---------------------------------------------------------------------------
# macOS
# ---------------------------------------------------------------------------

printf '\nmacOS on Apple silicon\n'
reset
STUB_KERNEL=Darwin STUB_MACHINE=arm64
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
check_equals 0 "$status" "the one-liner installs on darwin/arm64 (output: $out)"
check_matches "$log" "/ouroboros-runner-darwin-arm64\$" 'with the darwin binary'
check_exists "$PLIST" 'a launchd daemon is installed'
check_missing "$UNIT" 'and no systemd unit'
check_contains "$PLIST" '<string>dev.ouroboros.runner</string>' 'labelled dev.ouroboros.runner'
check_contains "$PLIST" '<key>RunAtLoad</key>' 'which starts at boot'
check_equals 1 "$(awk '/<key>KeepAlive<\/key>/ { k = 1 } k && /<key>SuccessfulExit<\/key>/ { s = 1; next } s && /<false\/>/ { print 1; exit }' "$PLIST")" \
  'and restarts on failure (KeepAlive, SuccessfulExit false)'
check_contains "$PLIST" '<key>ThrottleInterval</key>' 'at most every ThrottleInterval'
check_contains "$PLIST" '<string>builder</string>' 'runs as the account that installed it'
check_contains "$PLIST" '<string>/Users/builder</string>' "with that account's HOME, for Docker Desktop"
check_contains "$PLIST" '<string>/usr/local/bin/ouroboros-runner</string>' 'running the installed binary'
check_equals 'run --state-dir /var/lib/ouroboros-runner' \
  "$(sed -n '/<key>ProgramArguments<\/key>/,/<\/array>/p' "$PLIST" | sed -n 's|.*<string>\(.*\)</string>.*|\1|p' | sed '1d' | tr '\n' ' ' | sed 's/ $//')" \
  'with the same run arguments as the systemd unit'
check_contains "$PLIST" '/Library/Logs/ouroboros-runner/runner.log' 'logging to /Library/Logs'
check_matches "$log" "^chown root:wheel $PLIST\$" 'the plist is owned by root, as launchd requires'
check_matches "$log" '^launchctl enable system/dev.ouroboros.runner$' 'the daemon is enabled'
check_matches "$log" "^launchctl bootstrap system $PLIST\$" 'and loaded'
check_matches "$out" 'tail -f /Library/Logs/ouroboros-runner/runner.log' 'and it names where the logs are'

printf '\nA Rosetta shell on Apple silicon\n'
reset
STUB_KERNEL=Darwin STUB_MACHINE=x86_64
# shellcheck disable=SC2086
out=$(DESTDIR="$root" INSTALL_TTY="$work/no-tty" PATH="$work/bin:$PATH" \
  STUB_KERNEL=Darwin STUB_MACHINE=x86_64 STUB_TRANSLATED=1 \
  sh "$SCRIPT" $ENROLL_FLAGS </dev/null 2>&1)
status=$?
log=$(cat "$STUB_LOG")
check_equals 0 "$status" "an x86_64 shell under Rosetta installs the arm64 build (output: $out)"
check_matches "$log" "/ouroboros-runner-darwin-arm64\$" 'the darwin/arm64 binary'

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

printf '\nUninstalling, with nobody to ask\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS --server-ca "$work/ca.pem"
run_install --uninstall
check_equals 0 "$status" "--uninstall succeeds (output: $out)"
check_matches "$log" '^systemctl disable --now ouroboros-runner.service$' 'the service is stopped and disabled'
check_missing "$UNIT" 'the unit is removed'
check_missing "$INSTALLED" 'the binary is removed'
check_missing "$root/etc/ouroboros-runner" 'the installed CA is removed'
check_exists "$STATE/runner.json" 'the state directory is kept: nobody said to remove it'
check_matches "$out" "kept       /var/lib/ouroboros-runner" 'and the output says it was kept'
check_matches "$out" 'sudo rm -rf /var/lib/ouroboros-runner' 'and how to remove it'
check_matches "$out" 'certificate stays valid until it expires' 'and that the certificate stays valid until it is revoked'

printf '\nUninstalling, answering yes\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
printf 'y\n' >"$work/tty-yes"
TTY_FILE="$work/tty-yes" run_install --uninstall
check_equals 0 "$status" "--uninstall succeeds (output: $out)"
check_matches "$out" 'Remove /var/lib/ouroboros-runner too\?' 'it asks before removing the identity'
check_missing "$STATE" 'and removes it on a yes'
check_missing "$UNIT" 'the unit is gone'
check_missing "$INSTALLED" 'the binary is gone'

printf '\nUninstalling, answering no\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
printf 'n\n' >"$work/tty-no"
TTY_FILE="$work/tty-no" run_install --uninstall
check_equals 0 "$status" "--uninstall succeeds (output: $out)"
check_exists "$STATE/runner.json" 'a no keeps the state directory'

printf '\nUninstalling with --purge\n'
reset
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
run_install --uninstall --purge
check_equals 0 "$status" "--uninstall --purge succeeds (output: $out)"
check_missing "$STATE" 'the state directory is removed without asking'
check_equals '' "$(find "$root" -type f)" 'and nothing the install wrote is left behind'

printf '\nUninstalling a macOS install\n'
reset
STUB_KERNEL=Darwin STUB_MACHINE=arm64
# shellcheck disable=SC2086
run_install $ENROLL_FLAGS
run_install --uninstall --purge
check_equals 0 "$status" "--uninstall --purge succeeds on macOS (output: $out)"
check_matches "$log" '^launchctl bootout system/dev.ouroboros.runner$' 'the daemon is unloaded'
check_missing "$PLIST" 'the plist is removed'
check_missing "$root/Library/Logs/ouroboros-runner" 'and its logs'
check_equals '' "$(find "$root" -type f)" 'and nothing the install wrote is left behind'

printf '\nUninstalling what was never installed\n'
reset
run_install --uninstall
check_equals 0 "$status" "--uninstall on a clean machine succeeds (output: $out)"
check_not_matches "$log" '^systemctl ' 'and touches no service'

check_summary
