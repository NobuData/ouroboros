package farmtest

import (
	"crypto/subtle"
	"net/http"
	"net/http/cgi" // #nosec G504 -- git http-backend is a CGI program; the Httpoxy fix predates every Go this module builds with
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// GitAvailable reports whether a git binary is on PATH — what every test of the source
// checkout ([#991]) needs, and skips without.
//
// [#991]: https://github.com/NobuData/ouroboros/issues/991
func GitAvailable() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

// httpBackend is git's smart-HTTP server, `git-http-backend`, found in git's exec path — or
// empty on an installation that ships without it (Alpine's `git` package keeps it in
// `git-daemon`).
func httpBackend() string {
	out, err := exec.Command("git", "--exec-path").Output()
	if err != nil {
		return ""
	}
	path := filepath.Join(strings.TrimSpace(string(out)), "git-http-backend")
	if _, err := os.Stat(path); err != nil {
		return ""
	}
	return path
}

// GitHost is a repository served over smart HTTP — `git http-backend` behind net/http/cgi —
// the way GitHub serves one, on a loopback port. It stands in for the customer's git host
// in tests of the checkout ([#991]): a public repository, or a private one behind HTTP basic
// authentication.
//
// [#991]: https://github.com/NobuData/ouroboros/issues/991
type GitHost struct {
	// URL is the repository's clone URL.
	URL string
	// Commit is the one commit the repository holds — what an offer pins.
	Commit string
	// Ref is the branch that points at it.
	Ref string
	// Username and Password are what a private host requires; empty for a public one.
	Username, Password string

	server *httptest.Server
}

// NewGitHost makes a repository with one commit — a README and nothing else — and serves it.
// With a password it requires basic authentication on every request, answering 401 without
// one, as GitHub does for a private repository.
func NewGitHost(t *testing.T, username, password string) *GitHost {
	t.Helper()
	if !GitAvailable() {
		t.Skip("git is not on PATH")
	}
	backend := httpBackend()
	if backend == "" {
		t.Skip("git-http-backend is not installed beside git")
	}
	root := t.TempDir()
	work := filepath.Join(root, "work")
	bare := filepath.Join(root, "repos", "acme", "helios.git")
	git := func(dir string, args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...) // #nosec G204 -- a test fixture over its own arguments
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid",
			"GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid",
			"GIT_AUTHOR_DATE=2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE=2026-01-01T00:00:00Z",
			"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "HOME="+root)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	if err := os.MkdirAll(work, 0o750); err != nil {
		t.Fatal(err)
	}
	git(work, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(work, "README.md"), []byte("# helios\n\nA fixture repository.\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git(work, "add", "README.md")
	git(work, "commit", "-q", "-m", "fixture")
	commit := git(work, "rev-parse", "HEAD")
	git(root, "clone", "-q", "--bare", work, bare)
	// The checkout asks for the commit itself first; GitHub serves one, and so does this host.
	git(bare, "config", "uploadpack.allowAnySHA1InWant", "true")
	git(bare, "update-server-info")

	handler := &cgi.Handler{
		Path: backend,
		Env: []string{
			"GIT_PROJECT_ROOT=" + filepath.Join(root, "repos"),
			"GIT_HTTP_EXPORT_ALL=1",
			"GIT_CONFIG_NOSYSTEM=1",
			"HOME=" + root,
		},
	}
	host := &GitHost{Commit: commit, Ref: "refs/heads/main", Username: username, Password: password}
	host.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if password != "" {
			user, pass, ok := r.BasicAuth()
			if !ok || subtle.ConstantTimeCompare([]byte(user), []byte(username)) != 1 ||
				subtle.ConstantTimeCompare([]byte(pass), []byte(password)) != 1 {
				w.Header().Set("WWW-Authenticate", `Basic realm="helios"`)
				http.Error(w, "authentication required", http.StatusUnauthorized)
				return
			}
		}
		handler.ServeHTTP(w, r)
	}))
	t.Cleanup(host.server.Close)
	host.URL = host.server.URL + "/acme/helios.git"
	return host
}

// Close stops the host early — a test of a host that went away.
func (h *GitHost) Close() { h.server.Close() }

// Askpass writes a program that answers git the way the agent's executable does in askpass
// mode: the username or the password from the two environment variables the checkout sets.
// For tests that drive the checkout without the agent binary.
func Askpass(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "askpass")
	script := "#!/bin/sh\ncase \"$1\" in\n  Username*) printf '%s\\n' \"$OUROBOROS_RUNNER_GIT_USERNAME\" ;;\n" +
		"  Password*) printf '%s\\n' \"$OUROBOROS_RUNNER_GIT_PASSWORD\" ;;\n  *) exit 1 ;;\nesac\n"
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil { // #nosec G306 -- an executable fixture
		t.Fatal(err)
	}
	return path
}
