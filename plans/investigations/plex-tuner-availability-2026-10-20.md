# Plex tuner availability — 2026-10-20

Read-only inspection; no service restarts, deployment edits, or DVR changes.

## Verified

- Tunarr runs release `2026.10.3-oliviacpu-2026.10.20.2`; Plex runs `1.43.4.10903`.
- At 02:30:20 local time, Plex's request to `http://127.0.0.1:27180/discover.json` failed with connection refused.
  Plex then marked its Tunarr DVR device dead. At 02:30:52 it reported that Plex Tuner Service had exited three
  times in under 60 seconds and gave up.
- During this inspection, `/discover.json` and `/lineup_status.json` on that same address both returned HTTP 200.
  Discovery advertises loopback URLs, suitable for Plex and Tunarr on this host.
- Older Plex logs repeatedly report grabber Error 16 and input-open failures. These establish failures, not their cause.
- The `Plex Tuner Service` executable is absent from the current install and every retained Plex release checked.
  Its separate log is dated 2021. This does not establish a new package regression or prove that this auxiliary
  service is required for the working HDHomeRun path.

## Recommendation

Treat the connection refusal as a startup-order/availability incident, independent of tune-in code races.
For the next controlled deployment, verify Tunarr's discovery endpoint from the Plex host before starting/restarting
Plex, then confirm the existing DVR device rediscovers Tunarr and can tune. If it stays dead, collect fresh Plex
request/grabber logs before changing the DVR configuration. Do not delete/recreate the DVR as a first step.

If the auxiliary Tuner Service still repeatedly exits while discovery works, compare the installed package with
Whatbox's supported Plex distribution and ask the host about the omitted executable; do not copy a binary from an
older release. No automatic supervisor, restart loop, or package replacement is warranted from this evidence.

This explains the recorded discovery failure. It does not yet explain every failed Apple TV switch, or establish
how much time Plex adds between Tunarr's first byte and the first displayed frame.
