// Package artifacts gets a finished job's results off this machine ([#330], decision T4).
//
// After a job's command ends — and before its workspace is removed — the agent collects the
// files its offer's `upload.globs` match and sends them to the control plane over a
// **job-scoped HTTPS request**, never the control WebSocket: one large rig capture on the
// socket that carries heartbeats would degrade exactly the channel that decides whether a
// runner looks alive.
//
//	job ends ─▶ Collect(workdir, globs, caps)      — which files, capped, checksummed here
//	         ─▶ Uploader.Upload(offer.upload, …)   — manifest + files, multipart, retried
//	         ─▶ job.finish                         — only once the manifest is closed
//
// Three rules shape it:
//
//   - Nothing leaves the workspace. A glob is relative to the job's working directory, a
//     symlink is never followed (a link to /etc/shadow is listed as skipped, not read), and a
//     `..` never matches.
//   - Nothing is dropped silently. A file past the per-file cap is sent cut to the cap and
//     marked truncated; a file past the per-job cap or the file limit, or one that cannot be
//     read, is listed in the manifest as skipped, with the reason. The page renders both.
//   - The token goes to the control plane and nowhere else. The offer names a path, which is
//     resolved against the URL the agent already dials, so a dispatch cannot aim the token at
//     another host; and it is never logged.
//
// [#330]: https://github.com/NobuData/ouroboros/issues/330
package artifacts
