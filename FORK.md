# About this fork

This is a personal fork of [chrisbenincasa/tunarr](https://github.com/chrisbenincasa/tunarr), built into a Docker image
for one self-hosted deployment. It follows upstream's `main` and adds the targeted fixes and features listed below.
Upstream's own documentation, `CLAUDE.md` and `AGENTS.md` still apply.

## Builds

- Images are built only for tags named `oliviacpu-…`, by date: `oliviacpu-2026.10.13`, with `.2` for a second one the same
  day. Pushes to `main` build nothing (`.github/workflows/fork-image.yml`). To release:
  `git tag oliviacpu-2026.10.13 && git push origin oliviacpu-2026.10.13`.
- Each build pushes `ghcr.io/oliviacpu/tunarr:<tag>`, `:sha-<commit>` and `:latest` (always the newest) for
  linux/amd64, and creates a GitHub Release for the tag. Its notes list what's new since the previous `oliviacpu-` tag and
  every fork commit on top of upstream. To roll back, deploy an older release's `:<tag>` image.
- The version Tunarr reports is `<upstream version>-<tag>`, e.g. `2026.10.2-oliviacpu-2026.10.13`.
- Upstream updates come in with `git fetch upstream && git merge upstream/main`.

## Changes in this fork

Newest first. Each one is its own commit with a test, so it could be sent upstream later on its own
(`git cherry-pick <commit>` onto a branch from `upstream/main`).

<!-- Entry format:
### Short title (YYYY-MM-DD, commit)
- **What you saw:** the symptom.
- **Cause:** what in the code produced it.
- **Fix:** what changed, with the files.
- **Upstream:** not sent / issue or PR link.
-->
