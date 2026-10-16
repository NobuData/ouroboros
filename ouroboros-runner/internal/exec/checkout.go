package exec

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Git is how a checkout finds git and how git finds its credential ([#991]).
//
// The credential never touches the command line, the clone URL, a file or the job's
// environment. Git is told to ask for it through GIT_ASKPASS, and the program it asks is
// this agent's own executable in askpass mode (`cmd/ouroboros-runner`): run with
// OUROBOROS_RUNNER_ASKPASS=1 it prints the username or the password from two environment
// variables that exist only in the git process's environment, and exits.
//
// [#991]: https://github.com/NobuData/ouroboros/issues/991
type Git struct {
	// Binary is the git executable. Empty looks `git` up on PATH at each checkout.
	Binary string
	// Askpass is the program git runs for a username or a password: this agent's
	// executable, which answers in askpass mode. Required when a source carries a credential.
	Askpass string
}

// The environment the askpass program reads. Named here and in cmd/ouroboros-runner, where
// they are answered; restated rather than imported so that neither package needs the other.
const (
	// EnvAskpass set to "1" tells the agent's executable it is being run by git as GIT_ASKPASS.
	EnvAskpass = "OUROBOROS_RUNNER_ASKPASS"
	// EnvAskpassUsername and EnvAskpassPassword carry the credential to that process.
	EnvAskpassUsername = "OUROBOROS_RUNNER_GIT_USERNAME"
	EnvAskpassPassword = "OUROBOROS_RUNNER_GIT_PASSWORD" // #nosec G101 -- the variable's name, not a credential
)

// The sentences a checkout fails with. The job's log and the `job.finish` detail carry the
// same one, so what an operator reads in the console is what the control plane recorded.
const (
	// refusedAnonymous is a remote that wants a credential the agent was not given.
	refusedAnonymous = "the repository refused the clone: it is private and this workspace has no GitHub token to " +
		"check it out with — connect one under Settings › Sources"
	// refusedCredential is a remote that refused the credential the agent was given.
	refusedCredential = "the repository refused the clone: the workspace's GitHub token was refused"
)

// pinnedCommitMoved is a ref that no longer points at the commit the offer pinned.
func pinnedCommitMoved(ref, commit string) string {
	return fmt.Sprintf("the ref %s no longer points at %s; the build is pinned to the commit and was not run", ref, commit)
}

// Checkout puts source.Commit into workspace: an empty repository, one shallow fetch, a
// detached checkout, and HEAD verified to be the offered commit — so a ref that moved after
// the offer was made cannot change what is built.
//
// Git's own output goes to the job's log, under one runner line saying what is being checked
// out; a failure writes a second runner line with the sentence the finish will carry. Every
// git invocation runs with an environment of its own — PATH, HOME at the workspace, no system
// or user configuration, no terminal prompt and no stored credential helper — so the machine's
// git configuration cannot reach into a build and the build's credential cannot reach out.
//
// The error is a *Failure under CodeCheckoutFailed.
func Checkout(ctx context.Context, git Git, workspace string, source Source, output Output) error {
	runnerLine(output.runner(), "checking out %s at %s (%s)", source.URL, source.Commit, source.Ref)
	err := checkout(ctx, git, workspace, source, output)
	if err != nil {
		runnerLine(output.runner(), "checkout failed — %s", err.Detail)
		return err
	}
	return nil
}

// checkout is the sequence; Checkout frames it.
func checkout(ctx context.Context, git Git, workspace string, source Source, output Output) *Failure {
	binary := git.Binary
	if binary == "" {
		found, err := exec.LookPath("git")
		if err != nil {
			return failure(CodeCheckoutFailed, "git is not on this runner's PATH, so the repository cannot be checked out")
		}
		binary = found
	}
	if source.Credential != nil && git.Askpass == "" {
		return failure(CodeCheckoutFailed, "the source credential could not be presented: the agent has no askpass program")
	}
	env := gitEnvironment(workspace, git, source.Credential)
	run := func(args ...string) *gitResult {
		return runGit(ctx, binary, workspace, env, output, args...)
	}

	if result := run("init", "-q"); result.err != nil {
		return result.failure("init", source)
	}
	if result := run("remote", "add", "origin", source.URL); result.err != nil {
		return result.failure("remote add", source)
	}

	// The commit itself first: the shallowest fetch there is, and immune to the ref moving.
	// A remote that will not serve an unadvertised object gets the ref instead, and the
	// commit is then held to what arrived.
	if result := run("fetch", "-q", "--depth", "1", "origin", source.Commit); result.err != nil {
		if refused := result.refusal(source); refused != nil {
			return refused
		}
		if result := run("fetch", "-q", "--depth", "1", "origin", source.Ref); result.err != nil {
			if refused := result.refusal(source); refused != nil {
				return refused
			}
			if result.mentions("couldn't find remote ref", "not our ref", "unadvertised object") {
				return failure(CodeCheckoutFailed, pinnedCommitMoved(source.Ref, source.Commit))
			}
			return result.failure("fetch", source)
		}
		fetched := run("rev-parse", "FETCH_HEAD")
		if fetched.err != nil {
			return fetched.failure("rev-parse", source)
		}
		if fetched.text() != source.Commit {
			return failure(CodeCheckoutFailed, pinnedCommitMoved(source.Ref, source.Commit))
		}
	}

	if result := run("checkout", "-q", "--detach", source.Commit); result.err != nil {
		return result.failure("checkout", source)
	}
	head := run("rev-parse", "HEAD")
	if head.err != nil {
		return head.failure("rev-parse", source)
	}
	if head.text() != source.Commit {
		return failure(CodeCheckoutFailed, fmt.Sprintf("HEAD is %s after the checkout, not the offered %s", head.text(), source.Commit))
	}
	return checkConfigClean(workspace, source.Credential)
}

// gitEnvironment is the environment every git invocation runs with: this process's PATH so
// git finds its own helpers, HOME at the workspace and no global or system configuration so
// the machine's settings cannot reach the build, no terminal prompt, and — only with a
// credential — the askpass program and what it answers with.
func gitEnvironment(workspace string, git Git, credential *SourceCredential) []string {
	env := []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + workspace,
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_TERMINAL_PROMPT=0",
		"LC_ALL=C",
	}
	if credential != nil {
		env = append(env,
			"GIT_ASKPASS="+git.Askpass,
			EnvAskpass+"=1",
			EnvAskpassUsername+"="+credential.Username,
			EnvAskpassPassword+"="+credential.Password.Reveal(),
		)
	}
	return env
}

// gitResult is one git invocation's ending.
type gitResult struct {
	args   []string
	stdout bytes.Buffer
	stderr bytes.Buffer
	err    error
}

// runGit runs one git subcommand in the workspace, with no credential helper whatever the
// configuration says, copying its output to the job's log as well as keeping it.
func runGit(ctx context.Context, binary, workspace string, env []string, output Output, args ...string) *gitResult {
	result := &gitResult{args: args}
	argv := append([]string{"-c", "credential.helper="}, args...)
	// #nosec G204 -- git, with arguments this package composes; the offer's values are
	// passed as argv, never through a shell.
	cmd := exec.CommandContext(ctx, binary, argv...)
	cmd.Dir = workspace
	cmd.Env = env
	cmd.Stdout = io.MultiWriter(&result.stdout, output.stdout())
	cmd.Stderr = io.MultiWriter(&result.stderr, output.stderr())
	result.err = cmd.Run()
	return result
}

// text is the invocation's standard output, trimmed — a rev-parse's answer.
func (r *gitResult) text() string { return strings.TrimSpace(r.stdout.String()) }

// mentions reports whether git's standard error carries any of the given phrases.
func (r *gitResult) mentions(phrases ...string) bool {
	text := r.stderr.String()
	for _, phrase := range phrases {
		if strings.Contains(text, phrase) {
			return true
		}
	}
	return false
}

// refusal is the failure for a remote that would not let the agent in, or nil when the
// error was something else. Which sentence depends on whether a credential was presented:
// an anonymous clone of a private repository is the workspace's to fix, a refused token the
// token's.
func (r *gitResult) refusal(source Source) *Failure {
	if !r.mentions("Authentication failed", "could not read Username", "terminal prompts disabled",
		"HTTP 401", "HTTP 403", "Invalid username or token", "Permission denied", "Authorization failed") {
		return nil
	}
	if source.Credential == nil {
		return failure(CodeCheckoutFailed, refusedAnonymous)
	}
	return failure(CodeCheckoutFailed, refusedCredential)
}

// failure is the generic sentence for a git step that failed: the step and git's last word.
func (r *gitResult) failure(step string, source Source) *Failure {
	if refused := r.refusal(source); refused != nil {
		return refused
	}
	if errors.Is(r.err, context.Canceled) || errors.Is(r.err, context.DeadlineExceeded) {
		return failure(CodeCheckoutFailed, "git "+step+" was stopped before it finished")
	}
	return failure(CodeCheckoutFailed, fmt.Sprintf("git %s failed: %s", step, lastLine(r.stderr.String())))
}

// lastLine is the last non-empty line of git's standard error, or a stand-in.
func lastLine(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); line != "" {
			return line
		}
	}
	return "no output"
}

// checkConfigClean is the defence in depth: whatever git did, the repository's own
// configuration must carry no credential and no helper that would store one — because that
// file stays in the workspace the command runs in.
func checkConfigClean(workspace string, credential *SourceCredential) *Failure {
	config, err := os.ReadFile(filepath.Join(workspace, ".git", "config")) // #nosec G304 -- the workspace this package created
	if err != nil {
		return failure(CodeCheckoutFailed, "the checkout's configuration could not be read: "+err.Error())
	}
	lowered := strings.ToLower(string(config))
	if strings.Contains(lowered, "credential") || strings.Contains(lowered, "extraheader") ||
		(credential != nil && !credential.Password.Empty() && strings.Contains(string(config), credential.Password.Reveal())) {
		_ = os.Remove(filepath.Join(workspace, ".git", "config"))
		return failure(CodeCheckoutFailed, "the checkout left a credential in the repository's configuration; the tree was not used")
	}
	return nil
}
