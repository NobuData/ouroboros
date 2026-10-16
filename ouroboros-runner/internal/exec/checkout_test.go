package exec

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/secret"
)

// The source checkout (#991), against a repository served over smart HTTP the way GitHub
// serves one: the pinned commit arrives and HEAD is it; a private repository without a
// credential fails with the sentence that names the fix; one with a credential clones, and
// the credential is nowhere afterwards; a ref that moved on cannot change what is built.

// workspaceFor is an empty workspace for one checkout.
func workspaceFor(t *testing.T) string {
	t.Helper()
	dir, _, err := (&Workspaces{Root: filepath.Join(t.TempDir(), "work")}).Create("job_01KE7J4EZ3204KQXMHJRPQPWQ6")
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// captured is a job log a test reads back: the three streams, and all of them together.
type captured struct {
	stdout, stderr, runner bytes.Buffer
}

func (c *captured) output() Output {
	return Output{Stdout: &c.stdout, Stderr: &c.stderr, Runner: &c.runner}
}

func (c *captured) all() string { return c.stdout.String() + c.stderr.String() + c.runner.String() }

// head is the commit a workspace's HEAD is at.
func head(t *testing.T, workspace string) string {
	t.Helper()
	result := runGit(context.Background(), "git", workspace, gitEnvironment(workspace, Git{}, nil), Output{}, "rev-parse", "HEAD")
	if result.err != nil {
		t.Fatalf("rev-parse HEAD: %v\n%s", result.err, result.stderr.String())
	}
	return result.text()
}

func TestCheckoutPutsThePinnedCommitInTheWorkspace(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "", "")
	workspace := workspaceFor(t)
	log := &captured{}

	source := Source{URL: host.URL, Ref: host.Ref, Commit: host.Commit}
	if err := Checkout(context.Background(), Git{}, workspace, source, log.output()); err != nil {
		t.Fatalf("checkout: %v\n%s", err, log.all())
	}
	if got := head(t, workspace); got != host.Commit {
		t.Errorf("HEAD is %s, want %s", got, host.Commit)
	}
	readme, err := os.ReadFile(filepath.Join(workspace, "README.md"))
	if err != nil || !strings.Contains(string(readme), "# helios") {
		t.Errorf("the tree was not checked out: %v %q", err, readme)
	}
	if !strings.Contains(log.runner.String(), "ouroboros-runner: checking out "+host.URL+" at "+host.Commit+" ("+host.Ref+")\n") {
		t.Errorf("the job log does not say what was checked out:\n%s", log.runner.String())
	}
}

func TestCheckoutOfAPrivateRepositoryWithoutACredentialSaysSo(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "x-access-token", "ghp_fixtureSecret0000000000000000000001")
	workspace := workspaceFor(t)
	log := &captured{}

	err := Checkout(context.Background(), Git{}, workspace, Source{URL: host.URL, Ref: host.Ref, Commit: host.Commit}, log.output())
	var reason *Failure
	if !errors.As(err, &reason) || reason.Code != CodeCheckoutFailed || reason.Detail != refusedAnonymous {
		t.Fatalf("checkout: %v", err)
	}
	if !strings.Contains(log.runner.String(), "checkout failed — "+refusedAnonymous) {
		t.Errorf("the job log does not carry the sentence:\n%s", log.runner.String())
	}
	if _, err := os.Stat(filepath.Join(workspace, "README.md")); !errors.Is(err, os.ErrNotExist) {
		t.Error("a refused checkout left a tree")
	}
}

func TestCheckoutWithACredentialClonesAndKeepsItNowhere(t *testing.T) {
	t.Parallel()
	const password = "ghp_fixtureSecret0000000000000000000002" // #nosec G101 -- a fixture, not a credential
	host := farmtest.NewGitHost(t, "x-access-token", password)
	workspace := workspaceFor(t)
	log := &captured{}
	git := Git{Askpass: farmtest.Askpass(t)}
	source := Source{URL: host.URL, Ref: host.Ref, Commit: host.Commit,
		Credential: &SourceCredential{Username: "x-access-token", Password: secret.Secret(password)}}

	if err := Checkout(context.Background(), git, workspace, source, log.output()); err != nil {
		t.Fatalf("checkout: %v\n%s", err, log.all())
	}
	if got := head(t, workspace); got != host.Commit {
		t.Errorf("HEAD is %s, want %s", got, host.Commit)
	}
	if strings.Contains(log.all(), password) {
		t.Error("the credential reached the job log")
	}
	// Nowhere under the workspace: not the tree, not .git/config, not a hook or a stored helper.
	err := filepath.WalkDir(workspace, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		body, err := os.ReadFile(path) // #nosec G304 G122 -- the test's own workspace, made moments ago
		if err != nil {
			return err
		}
		if bytes.Contains(body, []byte(password)) {
			t.Errorf("the credential is in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	config, _ := os.ReadFile(filepath.Join(workspace, ".git", "config"))
	if strings.Contains(strings.ToLower(string(config)), "credential") {
		t.Errorf(".git/config names a credential:\n%s", config)
	}
}

func TestCheckoutWithARefusedCredentialSaysSo(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "x-access-token", "ghp_fixtureSecret0000000000000000000003")
	workspace := workspaceFor(t)
	source := Source{URL: host.URL, Ref: host.Ref, Commit: host.Commit,
		Credential: &SourceCredential{Username: "x-access-token", Password: "ghp_theWrongOne000000000000000000000000"}} // #nosec G101 -- a fixture

	err := Checkout(context.Background(), Git{Askpass: farmtest.Askpass(t)}, workspace, source, Output{})
	var reason *Failure
	if !errors.As(err, &reason) || reason.Detail != refusedCredential {
		t.Fatalf("checkout: %v", err)
	}
}

func TestCheckoutRefusesACommitTheRefNoLongerPointsAt(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "", "")
	workspace := workspaceFor(t)
	// A commit the remote does not have: the ref moved past it, or never pointed at it.
	moved := "4c1d9e7b2a6f8035e1d7c9b4a2f6e8d0c3b5a719"

	err := Checkout(context.Background(), Git{}, workspace, Source{URL: host.URL, Ref: host.Ref, Commit: moved}, Output{})
	var reason *Failure
	if !errors.As(err, &reason) || reason.Code != CodeCheckoutFailed || reason.Detail != pinnedCommitMoved(host.Ref, moved) {
		t.Fatalf("checkout: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workspace, "README.md")); !errors.Is(err, os.ErrNotExist) {
		t.Error("a checkout whose commit was not what the ref holds left the ref's tree in place")
	}
}

func TestCheckoutNeedsAnAskpassProgramForACredential(t *testing.T) {
	t.Parallel()
	err := Checkout(context.Background(), Git{}, t.TempDir(), Source{URL: "https://example.invalid/r.git", Ref: "refs/heads/main",
		Commit: "4c1d9e7b2a6f8035e1d7c9b4a2f6e8d0c3b5a719", Credential: &SourceCredential{Password: "x"}}, Output{})
	var reason *Failure
	if !errors.As(err, &reason) || !strings.Contains(reason.Detail, "askpass") {
		t.Fatalf("checkout: %v", err)
	}
}

func TestCheckoutReportsAMissingGit(t *testing.T) {
	err := Checkout(context.Background(), Git{Binary: filepath.Join(t.TempDir(), "no-git")}, t.TempDir(),
		Source{URL: "https://example.invalid/r.git", Ref: "refs/heads/main", Commit: "4c1d9e7b2a6f8035e1d7c9b4a2f6e8d0c3b5a719"}, Output{})
	var reason *Failure
	if !errors.As(err, &reason) || reason.Code != CodeCheckoutFailed || !strings.HasPrefix(reason.Detail, "git init failed") {
		t.Fatalf("checkout: %v", err)
	}
}

// TestRunChecksOutBeforePreparing is the checkout inside Runner.Run: the source arrives
// before the executor prepares, the fetch phase is reported around it, and a checkout that
// fails is `errored` under its code with the command never run.
func TestRunChecksOutBeforePreparing(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "", "")
	var sawReadme bool
	executor := &scripted{
		prepare: func(context.Context, Progress) error { return nil },
		execute: func(context.Context) (int, error) { return 0, nil },
	}
	events := &recorder{}
	runner := &Runner{Workspaces: &Workspaces{Root: filepath.Join(t.TempDir(), "work")}}
	job := Job{ID: jobID(1), Kind: conn.ExecutorShell, Command: []string{"make"}, Workdir: "/", Env: []string{},
		Timeout: time.Minute, Source: &Source{URL: host.URL, Ref: host.Ref, Commit: host.Commit}}
	// The workspace is removed after the run; look while the command "runs".
	executor.execute = func(context.Context) (int, error) {
		_, err := os.Stat(filepath.Join(events.workspace, "README.md"))
		sawReadme = err == nil
		return 0, nil
	}

	result := runner.Run(context.Background(), executor, job, Output{}, events)
	if result.Outcome != conn.OutcomeSucceeded || result.Error != nil {
		t.Fatalf("result: %+v", result)
	}
	if !sawReadme {
		t.Error("the command did not run in the checked-out tree")
	}
	if len(events.fetching) != 2 || events.fetching[0] != 0 || events.fetching[1] != 100 {
		t.Errorf("fetch progress: %v", events.fetching)
	}

	// A checkout that fails: errored, its code, no Started, no Execute.
	executed := false
	failing := &scripted{execute: func(context.Context) (int, error) { executed = true; return 0, nil }}
	events = &recorder{}
	job.Source = &Source{URL: host.URL, Ref: host.Ref, Commit: "4c1d9e7b2a6f8035e1d7c9b4a2f6e8d0c3b5a719"}
	result = runner.Run(context.Background(), failing, job, Output{}, events)
	if result.Outcome != conn.OutcomeErrored || result.Error == nil || result.Error.Code != CodeCheckoutFailed ||
		result.ExitCode != nil || !events.started.IsZero() || executed {
		t.Errorf("a failed checkout: %+v %+v executed=%t", result, result.Error, executed)
	}
}
