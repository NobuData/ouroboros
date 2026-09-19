package exec

import (
	"errors"
	"syscall"
	"time"
)

// A job's processes are one PROCESS GROUP: the command is started as the leader of a new
// group (Setpgid), and everything it spawns — make, the compilers make runs, the linkers
// they run — inherits that group unless it deliberately leaves. Signalling the negative
// of the group id signals every member at once, which is what "terminate the process tree"
// means here: not the leader and whatever it chooses to pass the signal on to, but all of
// them.
//
// Two limits, stated rather than papered over. A process that calls setsid(2) or
// setpgid(2) to leave the group — a daemon detaching itself, which is what daemons are
// for — is no longer the job's, exactly as it would not be under any other CI agent's
// shell executor. And a process in uninterruptible sleep dies when the kernel lets it,
// not when SIGKILL is sent; the wait for it is bounded, so the agent does not hang with it.

// pollInterval is how often a group is checked for having emptied after a signal.
const pollInterval = 20 * time.Millisecond

// killWait bounds the wait for a group to empty after SIGKILL, which cannot be ignored but
// can be delayed by a process in uninterruptible sleep.
const killWait = 5 * time.Second

// procAttr is the attributes a job's leader is started with: a new process group of its
// own, whose id is the leader's pid.
func procAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setpgid: true} }

// groupAlive reports whether any process is still in the group. Signal 0 checks without
// signalling: ESRCH is an empty group, and EPERM is a member this user may not signal —
// which is still a member.
func groupAlive(pgid int) bool {
	err := syscall.Kill(-pgid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// signalGroup sends a signal to every process in the group. A group that has already
// emptied is not an error.
func signalGroup(pgid int, signal syscall.Signal) {
	_ = syscall.Kill(-pgid, signal)
}

// terminateGroup ends every process in a job's group: SIGTERM, a grace period for them to
// exit cleanly — a compiler flushing an object file, a test rig releasing a board — and
// then SIGKILL for whatever is left.
//
// It returns as soon as the group is empty, so a job whose processes exit promptly on
// SIGTERM costs milliseconds rather than the whole grace.
//
//   - pgid is the group, which is the leader's pid. It must be positive: 0 and negative
//     values mean other groups to kill(2).
//   - grace is how long SIGTERM is given.
func terminateGroup(pgid int, grace time.Duration) {
	if pgid <= 0 || !groupAlive(pgid) {
		return
	}
	signalGroup(pgid, syscall.SIGTERM)
	if waitEmpty(pgid, grace) {
		return
	}
	signalGroup(pgid, syscall.SIGKILL)
	waitEmpty(pgid, killWait)
}

// waitEmpty polls until the group has no members or the timeout passes, and reports
// whether it emptied.
func waitEmpty(pgid int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for groupAlive(pgid) {
		if !time.Now().Before(deadline) {
			return false
		}
		time.Sleep(pollInterval)
	}
	return true
}
