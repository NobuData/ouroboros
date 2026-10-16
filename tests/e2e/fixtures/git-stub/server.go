// The e2e suite's git host (#991, AG.7): smart HTTP over the fixture repositories, with one of
// them behind basic auth.
//
// Four things it answers, and nothing else:
//
//	GET  /healthz                         compose's probe
//	GET  /heads/<owner>/<name>            the repository's HEAD commit, forty hex characters —
//	                                      what the build test submits as the commit to build
//	GET  /refs/<owner>/<name>             the repository's branches, `<branch> <sha>` per line —
//	                                      how a leg sees a pushed run branch without a clone (#1314)
//	*    /<owner>/<name>.git/...          git's smart HTTP protocol, served by `git http-backend`
//
// A repository whose name is in `-private` requires `Authorization: Basic` with the configured
// user and password; anything else gets a `401` with a `WWW-Authenticate` challenge, which is
// what makes an anonymous clone of it fail the way GitHub fails one — so the runner's sentence
// for that case is exercised by a real refusal.
//
// **Pushes are served, and judged by the repositories** (#1314, DI.5). Each bare repository is
// built with `http.receivepack true` and an `update` hook (build-repos.sh) that accepts a ref
// under `refs/heads/ouro/run-*` and refuses every other one — the default branch first — with a
// sentence the client prints as a `remote:` line. The server adds nothing to that policy: a
// push reaches `git http-backend` like a fetch does, and the hook is what decides.
//
// Stdlib only. `net/http/cgi` runs `git http-backend` per request, as every smart-HTTP server
// does; `GIT_HTTP_EXPORT_ALL` lets it serve a bare repository without a `git-daemon-export-ok`
// marker, and the repositories are built with `uploadpack.allowAnySHA1InWant` so a fetch of a
// bare commit — the runner's first attempt — is served.
package main

import (
	"crypto/subtle"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/cgi"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
)

// repoPath is `/<owner>/<name>.git/...` — the first two segments name the repository.
var repoPath = regexp.MustCompile(`^/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)\.git(/.*)?$`)

// headPath is `/heads/<owner>/<name>`.
var headPath = regexp.MustCompile(`^/heads/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)$`)

// refsPath is `/refs/<owner>/<name>`.
var refsPath = regexp.MustCompile(`^/refs/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)$`)

func main() {
	root := flag.String("root", "/srv/repos", "where the bare repositories live, as <owner>/<name>.git")
	listen := flag.String("listen", ":8080", "the address to serve on")
	private := flag.String("private",
		envOr("GIT_STUB_PRIVATE", "acme-robotics/helios-console,acme-robotics/helios-greeter"),
		"comma-separated <owner>/<name> repositories that require basic auth")
	user := flag.String("user", envOr("GIT_STUB_USER", "x-access-token"), "the basic-auth user")
	password := flag.String("password", envOr("GIT_STUB_PASSWORD", ""), "the basic-auth password")
	flag.Parse()

	backend, err := exec.LookPath("git-http-backend")
	if err != nil {
		backend = filepath.Join(gitExecPath(), "git-http-backend")
	}

	guarded := map[string]bool{}
	for _, slug := range strings.Split(*private, ",") {
		if slug = strings.TrimSpace(slug); slug != "" {
			guarded[slug] = true
		}
	}

	handler := &gitStub{
		root:     *root,
		backend:  backend,
		guarded:  guarded,
		user:     *user,
		password: *password,
	}

	server := &http.Server{Addr: *listen, Handler: handler}
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, syscall.SIGTERM, os.Interrupt)
		<-stop
		_ = server.Close()
	}()

	log.Printf("git-stub: serving %s on %s (private: %s)", *root, *listen, *private)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

type gitStub struct {
	root     string
	backend  string
	guarded  map[string]bool
	user     string
	password string
}

func (s *gitStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/healthz":
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintln(w, "ok")
	case headPath.MatchString(r.URL.Path):
		m := headPath.FindStringSubmatch(r.URL.Path)
		s.head(w, r, m[1], m[2])
	case refsPath.MatchString(r.URL.Path):
		m := refsPath.FindStringSubmatch(r.URL.Path)
		s.refs(w, r, m[1], m[2])
	case repoPath.MatchString(r.URL.Path):
		m := repoPath.FindStringSubmatch(r.URL.Path)
		s.git(w, r, m[1], m[2])
	default:
		http.NotFound(w, r)
	}
}

// head answers the repository's HEAD commit, so the suite submits a sha it did not hard-code.
func (s *gitStub) head(w http.ResponseWriter, r *http.Request, owner, name string) {
	dir := filepath.Join(s.root, owner, name+".git")
	if _, err := os.Stat(dir); err != nil {
		http.NotFound(w, r)
		return
	}
	out, err := exec.Command("git", "--git-dir", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		http.Error(w, "rev-parse failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write(out)
}

// refs answers the repository's branches, one `<branch> <sha>` per line — so a leg can see that a
// run branch landed (or that the default branch did not move) without cloning anything.
func (s *gitStub) refs(w http.ResponseWriter, r *http.Request, owner, name string) {
	dir := filepath.Join(s.root, owner, name+".git")
	if _, err := os.Stat(dir); err != nil {
		http.NotFound(w, r)
		return
	}
	out, err := exec.Command("git", "--git-dir", dir, "for-each-ref",
		"--format=%(refname:short) %(objectname)", "refs/heads").Output()
	if err != nil {
		http.Error(w, "for-each-ref failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write(out)
}

// git serves the smart HTTP protocol — fetches and pushes alike; the repository's update hook
// is the push policy — behind basic auth for a guarded repository.
func (s *gitStub) git(w http.ResponseWriter, r *http.Request, owner, name string) {
	if s.guarded[owner+"/"+name] && !s.authorized(r) {
		w.Header().Set("WWW-Authenticate", `Basic realm="git-stub"`)
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}

	handler := &cgi.Handler{
		Path: s.backend,
		Env: []string{
			"GIT_PROJECT_ROOT=" + s.root,
			"GIT_HTTP_EXPORT_ALL=1",
			"REMOTE_USER=" + s.user,
		},
	}
	handler.ServeHTTP(w, r)
}

// authorized is a constant-time check of the basic credential.
func (s *gitStub) authorized(r *http.Request) bool {
	user, password, ok := r.BasicAuth()
	if !ok || s.password == "" {
		return false
	}
	userOK := subtle.ConstantTimeCompare([]byte(user), []byte(s.user)) == 1
	passOK := subtle.ConstantTimeCompare([]byte(password), []byte(s.password)) == 1
	return userOK && passOK
}

// gitExecPath is where git keeps its sub-commands — `git-http-backend` among them.
func gitExecPath() string {
	out, err := exec.Command("git", "--exec-path").Output()
	if err != nil {
		return "/usr/libexec/git-core"
	}
	return strings.TrimSpace(string(out))
}

// envOr is an environment variable, or a default when it is unset.
func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
