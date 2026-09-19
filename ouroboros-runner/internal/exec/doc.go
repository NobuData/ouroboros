// Package exec runs a job: the container and shell executors, the workspace that is
// created for a job and removed after it, and cancellation ([#246], decision B4).
//
// # Two executors, one agent
//
// Mockup 08's fleet has machines that can run containers and machines that cannot — a
// macOS build host, a hardware-in-the-loop rig wired to physical boards — so a pool owns an
// executor kind rather than the farm standardising on containers:
//
//   - [Container] runs the command in the pool's pinned image, through the Docker Engine
//     API on the same daemon socket the `hello` probe pings (Docker, or Podman's compatible
//     API). A missing image is pulled first, with its progress reported, because a first
//     pull of a large SDK image is minutes of apparent silence otherwise.
//   - [Shell] runs the command directly on the host, in a directory made for the job.
//
// Both are driven by [Runner.Run], which owns what they share: the workspace, the job's
// wall-clock budget, cancellation, how the ending is classified, and cleanup.
//
// # The trust model
//
// The shell executor runs commands directly on the customer's machine, with no sandbox.
// That is correct for this product and it is stated here rather than implied: **the
// tenant's machine runs the tenant's command** — a machine the tenant enrolled into the
// tenant's own farm, running the build command the tenant's pool was configured with,
// exactly as it would under any self-hosted CI agent. The container executor is the same
// trust with a filesystem boundary, not an isolation boundary: a container shares the
// host's kernel, and untrusted code is [#267]'s question, not this package's.
//
// What this package does promise is that the implementation does not WIDEN that trust by
// accident. Four rules, each enforced in code and each tested:
//
//  1. ARGV-EXEC ONLY. A job's command is an argv array and is executed as one — never
//     joined into a string, never handed to `sh -c`. Server-supplied data is therefore never
//     shell-expanded: `$(id)`, `;`, `*` and backticks arrive at the program as the literal
//     characters. (A pool whose command IS `sh -c …` has chosen a shell, in its own
//     configuration; the agent never chooses one for it.) A container's command is the
//     exec-form CMD, which the daemon also runs without a shell.
//  2. THE ENVIRONMENT IS AN ALLOW-LIST, NOT AN INHERITANCE. A job's environment is exactly
//     the variables its offer carried whose names the pool allow-lists ([Scrub]) — nothing
//     from the agent's own process, which holds the runner's state-directory path and
//     whatever the service manager put there. No PATH either, unless the pool allows one:
//     the command's own name is found on the agent's PATH, and what the command runs after
//     that is its own business.
//  3. THE JOB OWNS ONE DIRECTORY, AND THE SERVER CANNOT NAME ANOTHER. Every job gets a fresh
//     workspace under `<state-dir>/work/<job id>`. A shell job's `workdir` is resolved
//     INSIDE it — a leading `/` is the workspace root and a `..` is refused — so no offer can
//     choose where on the host a command runs or which directory cleanup removes. A
//     container job's workspace is bind-mounted at its `workdir`, and nothing else of the
//     host is.
//  4. NOTHING OUTLIVES THE JOB. The shell executor starts the command as the leader of a
//     new process group and, however the job ends, signals the whole group: SIGTERM, then
//     SIGKILL after the grace period. A build that spawns a compiler farm leaves no
//     orphans — not when it is cancelled, and not when its leader exits and leaves children
//     behind. The container executor gets the same from the daemon: `stop` is SIGTERM, then
//     SIGKILL after the grace, and a container's processes do not survive its PID 1.
//
// # What a job produces
//
// Logs only — there is no artefact collection in the MVP. A job's stdout and stderr go to
// an [Output], which the agent connects to the log shipper ([#247]).
//
// [#246]: https://github.com/NobuData/ouroboros/issues/246
// [#247]: https://github.com/NobuData/ouroboros/issues/247
// [#267]: https://github.com/NobuData/ouroboros/issues/267
package exec
