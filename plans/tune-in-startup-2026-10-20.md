# Tune-in startup and switching — 2026-10-20

Implemented on `fix/tune-in-startup`, based on `7fa9b6c1`. No deployment changes.

## Changes

- Share successful version probes across callers, cache by binary path for one hour, and seed FFmpeg at startup.
- Retain startup failures and their causes, replace unusable sessions, and match delayed teardown to instance identity.
- Bind wrappers to backing-session identities; do not discard a new wrapper before its first internal HLS request.
- Preserve initial output bytes, release late acquisitions after client cancellation, and remove each viewer's listeners.
- Wait for output outside the channel mutex. Bound silent HTTP startup to 20 seconds and retire an unused timed-out wrapper.
- Log lock/construction/setup/readiness phases and instance IDs. Keep existing HLS settings and late-audio probing protection.

Deliver as separate review units: version cache; session lifecycle; HTTP attachment; reproduction tooling and results.
Each unit stays below the contribution policy's design-size thresholds; there are no cross-package interface changes,
new dependencies, migrations, or new top-level features. Codex wrote the implementation, tests, and this report.

## Evidence

The remote install already uses 2-second HLS segments, one initial segment, a 10-second wrapper burst, and a 16-thread
read-ahead limit. Rotated logs include 10.9/13.0-second first-byte times and a 23-second no-byte failure. They span older
releases and two hosts; they do not establish that every failure still occurs in the current release.

Local A/B: Node 22.20.0, FFmpeg 9.0.2, software H.264 at 640×360, synthetic 12-second clips; HLS settings 2/1/10.
The same enhanced stream-repro harness ran serially against the unchanged base and this worktree. Each run alternated
100 requests between two channels, including six cold starts and ten second-viewer attachments.

| Measurement                        |     Base |  Patched |
| ---------------------------------- | -------: | -------: |
| Startup failures                   |    0/100 |    0/100 |
| Median first byte, all requests    |     5 ms |     5 ms |
| p95 first byte, all requests       | 1,124 ms |   848 ms |
| Median first byte, six cold starts |   985 ms | 666.5 ms |
| Listener-leak warnings             |  Present |     None |

Artifacts: `/private/tmp/tunarr-tunein-before-100/report.json` and
`/private/tmp/tunarr-tunein-fixed-100b/report.json`, with sibling server logs and captures.
This is one local A/B, not proof of the 25% production/Apple TV improvement target. Warm joins begin mid-GOP;
ffprobe logs missing-PPS warnings until the next keyframe. Captures also flag initial A/V timestamp offsets
(base −168 ms, patched −128 ms). Those are not resolved by these startup changes.

Reproduce from the repository with the stream-repro skill:

```sh
node .claude/skills/stream-repro/scripts/repro.mjs --mode hdhr --tune-ins 100 \
  --clip-seconds 12 --seconds 30 --resolution 640x360 \
  --ffmpeg-setting hlsSegmentSeconds=2 --ffmpeg-setting hlsInitialSegmentCount=1 \
  --ffmpeg-setting hlsTsInitialBurstSeconds=10 \
  --ffmpeg-setting ffmpegExecutablePath=/opt/homebrew/bin/ffmpeg \
  --ffmpeg-setting ffprobeExecutablePath=/opt/homebrew/bin/ffprobe --out /private/tmp/tune-in-repro
```

Additional multi-audio run: 20 switches, zero startup failures/restarts, English and Japanese AAC tracks retained
through the 32-second capture. It flagged repeated audio PTS at one boundary and a −135 ms initial A/V offset;
those findings remain outside this change. Artifact: `/private/tmp/tunarr-tunein-fixed-multiaudio/report.json`.

The fixture is local media, not a Plex source. Apple TV playback and deployment CPU/I/O contention remain untested.
After deployment, record 30 Apple TV switches with the channel, request timestamp, time to first picture, and error;
correlate with Tunarr and Plex logs. Do not infer client startup time from server first-byte time.


## Final validation

- Streaming, caption, API, version-cache, stream-factory, and pipeline regressions: **37 files, 795 tests passed**.
- Server build typecheck, changed-file branch lint, `git diff --check`, and reproduction-script syntax check passed.
- A caption run with sidecar subtitles decoded **18 displayed captions / 216 non-padding pairs**, with no session
  restarts. Artifact: `/private/tmp/tunarr-tunein-fixed-caption-sidecars/report.json`. The first embedded-subtitle
  fixture had not extracted its cues, so its padding-only output was not counted as visible-caption validation.
- Main checkout remains untouched; implementation is in the separate worktree. No image release, deployment,
  Plex restart, or remote configuration write was performed. Apple TV acceptance remains pending deployment.


## Review follow-ups

Independent PR review identified and regression-tested two additional races: obsolete stop callbacks during the
asynchronous replacement lookup, and timeout retirement racing a newly registered viewer. Replaced instances now
remain excluded from pause callbacks; connection registration and conditional idle retirement share the channel lock.
The updated streaming/API/pipeline regression run passes **799 tests**, including both program-session and wrapper replacement gaps.

The measurement harness now averages both middle observations for even sample counts; four Node tests cover even,
odd, empty, and zero-valued samples. Recomputing the saved A/B medians leaves the table above unchanged.
