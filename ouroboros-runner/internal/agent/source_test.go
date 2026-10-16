package agent

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/NobuData/ouroboros/ouroboros-runner/internal/conn"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/exec"
	"github.com/NobuData/ouroboros/ouroboros-runner/internal/farmtest"
)

// The source checkout through the agent (#991): a job on a private repository redeems its
// ticket once, with the ticket as the bearer, checks the pinned commit out and runs in that
// tree — and neither the ticket nor the credential appears in the agent's log or the job's.
// A ticket the control plane refuses is a job that never starts.

const (
	fixturePassword = "ghp_fixtureSecret0000000000000000000009"              // #nosec G101 -- a fixture, not a credential
	fixtureTicket   = "ouro_src_Hq2vN8mZkT4wRa6LpY3sD9fJ1cB5eU0gXiKoMt7PyVz" // #nosec G101 -- a fixture
)

// withGit is a configuration whose runner has git and an askpass program.
func withGit(t *testing.T) func(*Config) {
	t.Helper()
	askpass := farmtest.Askpass(t)
	return func(c *Config) {
		c.Capabilities.Git = true
		c.Git = exec.Git{Askpass: askpass}
	}
}

// repositoryOffer adjusts an offer to name the host's repository, with a ticket when asked.
func repositoryOffer(host *farmtest.GitHost, ticket bool) func(map[string]any) {
	return func(p map[string]any) {
		repository := map[string]any{"url": host.URL, "ref": host.Ref, "commit": host.Commit}
		if ticket {
			repository["credential"] = map[string]any{
				"path":       "/api/v1/farm/jobs/0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6/source-credential",
				"token":      fixtureTicket,
				"expires_at": "2026-09-18T12:15:15.000Z",
			}
		}
		p["repository"] = repository
	}
}

func TestAPrivateRepositoryIsRedeemedCheckedOutAndRun(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "x-access-token", fixturePassword)
	farm := farmtest.NewFarm(t)
	farm.SetSourceCredential("x-access-token", fixturePassword)

	// The executor reads the tree the checkout left, from the workspace Execute is handed.
	var readme, seenWorkspace string
	container := &fakeExecutor{kind: conn.ExecutorContainer}
	container.produce = func(workspace string) error {
		seenWorkspace = workspace
		body, err := os.ReadFile(filepath.Join(workspace, "README.md")) // #nosec G304 -- the job's workspace
		readme = string(body)
		return err
	}
	dir := enrolled(t, farm, false)
	h := start(t, farm, dir, func(c *Config) {
		withGit(t)(c)
		c.Executors[conn.ExecutorContainer] = container
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })
	if hello := h.farm.Observe().Hellos[0]; !hello.Capabilities.Git {
		t.Fatalf("the hello does not report git: %+v", hello.Capabilities)
	}

	offerJob(t, farm, 1, conn.ExecutorContainer, repositoryOffer(host, true))
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	finish := finishes(t, observed)[0]
	if finish.Outcome != conn.OutcomeSucceeded || finish.Error != nil {
		t.Fatalf("finish: %+v %+v\n%s", finish, finish.Error, h.logs)
	}
	if !strings.Contains(readme, "# helios") || seenWorkspace == "" {
		t.Errorf("the command did not run in the checked-out tree: %q", readme)
	}
	if len(observed.Sources) != 1 || observed.Sources[0].Authorization != "Bearer "+fixtureTicket ||
		observed.Sources[0].Job != "0199a1f2-6b3c-7d4e-8f50-61a2b3c4d5e6" {
		t.Errorf("the ticket was redeemed as %+v", observed.Sources)
	}
	// Accept, the fetch phase around the checkout, start, finish — and the fetch before the start.
	if !slices.Equal(observed.JobFrames, []conn.Type{conn.TypeJobAccept, conn.TypeJobProgress, conn.TypeJobProgress,
		conn.TypeJobStart, conn.TypeJobFinish}) {
		t.Errorf("job frames: %v", observed.JobFrames)
	}
	for _, progress := range observed.Progress {
		if progress.Phase != conn.PhaseFetch {
			t.Errorf("progress phase: %+v", progress)
		}
	}
	var log strings.Builder
	for _, chunk := range observed.Chunks {
		log.WriteString(decodeChunk(t, chunk))
	}
	if !strings.Contains(log.String(), "ouroboros-runner: checking out "+host.URL) {
		t.Errorf("the job log does not say what was checked out:\n%s", log.String())
	}
	for name, text := range map[string]string{"the agent's log": h.logs.String(), "the job's log": log.String()} {
		if strings.Contains(text, fixturePassword) {
			t.Errorf("the credential reached %s", name)
		}
		if strings.Contains(text, fixtureTicket) {
			t.Errorf("the ticket reached %s", name)
		}
	}
}

func TestARefusedTicketIsAJobThatNeverStarts(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "x-access-token", fixturePassword)
	farm := farmtest.NewFarm(t)
	farm.AnswerSources(farmtest.RefuseSource)
	container := &fakeExecutor{kind: conn.ExecutorContainer}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) {
		withGit(t)(c)
		c.Executors[conn.ExecutorContainer] = container
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	offerJob(t, farm, 1, conn.ExecutorContainer, repositoryOffer(host, true))
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	finish := finishes(t, observed)[0]
	if finish.Outcome != conn.OutcomeErrored || finish.Error == nil || finish.Error.Code != exec.CodeCheckoutFailed ||
		finish.Error.Detail != "the control plane refused the source credential" || finish.ExitCode != nil {
		t.Errorf("finish: %+v %+v", finish, finish.Error)
	}
	if len(observed.Starts) != 0 || len(container.jobs()) != 0 {
		t.Error("a job whose ticket was refused was started")
	}
	if len(observed.Sources) != 1 {
		t.Errorf("a refusal was retried: %d redemptions", len(observed.Sources))
	}
	var log strings.Builder
	for _, chunk := range observed.Chunks {
		log.WriteString(decodeChunk(t, chunk))
	}
	if !strings.Contains(log.String(), "checkout failed — the control plane refused the source credential") {
		t.Errorf("the job's log does not say why it did not run:\n%s", log.String())
	}
	if h.agent.workload.InFlight() != 0 {
		t.Errorf("%d jobs still held", h.agent.workload.InFlight())
	}
}

func TestATransientRedemptionFailureIsRetried(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "x-access-token", fixturePassword)
	farm := farmtest.NewFarm(t)
	farm.SetSourceCredential("x-access-token", fixturePassword)
	farm.AnswerSources(farmtest.FailSource)
	container := &fakeExecutor{kind: conn.ExecutorContainer}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) {
		withGit(t)(c)
		c.Executors[conn.ExecutorContainer] = container
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	offerJob(t, farm, 1, conn.ExecutorContainer, repositoryOffer(host, true))
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if finish := finishes(t, observed)[0]; finish.Outcome != conn.OutcomeSucceeded {
		t.Errorf("finish: %+v %+v", finish, finish.Error)
	}
	if len(observed.Sources) != 2 {
		t.Errorf("a 503 was not retried once: %d redemptions", len(observed.Sources))
	}
}

func TestAPublicRepositoryClonesWithoutATicket(t *testing.T) {
	t.Parallel()
	host := farmtest.NewGitHost(t, "", "")
	farm := farmtest.NewFarm(t)
	container := &fakeExecutor{kind: conn.ExecutorContainer}
	h := start(t, farm, enrolled(t, farm, false), func(c *Config) {
		withGit(t)(c)
		c.Executors[conn.ExecutorContainer] = container
	})
	h.until("the connection", func(o farmtest.Observed) bool { return len(o.Heartbeats) >= 1 })

	offerJob(t, farm, 1, conn.ExecutorContainer, repositoryOffer(host, false))
	observed := h.until("the finish", func(o farmtest.Observed) bool { return len(o.Finishes) == 1 })

	if finish := finishes(t, observed)[0]; finish.Outcome != conn.OutcomeSucceeded {
		t.Errorf("finish: %+v %+v", finish, finish.Error)
	}
	if len(observed.Sources) != 0 {
		t.Errorf("an anonymous clone redeemed a ticket: %+v", observed.Sources)
	}
	if ran := container.jobs()[0]; ran.Source == nil || ran.Source.Commit != host.Commit || ran.Source.Credential != nil {
		t.Errorf("the job's source: %+v", ran.Source)
	}
}
