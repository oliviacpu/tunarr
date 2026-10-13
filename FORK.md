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

### Tag the output audio's language (2026-10-13)

- **What you saw:** Tunarr's streams carried no audio language, so Plex logged every program as foreign-language audio
  ("foreign film") and couldn't match audio or subtitle language preferences.
- **Cause:** the stream selector picks the audio track knowing its ISO 639-2 language, but `AudioStream` had no field
  for it and the audio pipeline wrote no stream metadata.
- **Fix:** `AudioStream` carries `language`, `FfmpegStreamFactory` sets it from the selected track's
  `languageCodeISO6392`, and `BasePipelineBuilder.buildAudioPipeline` writes `-metadata:s:a:0 language=<code>`
  (`AudioLanguageOutputOption`) when it's a valid 3-letter code. MPEG-TS turns this into the stream's ISO 639 language
  descriptor, and it survives the `.ts` remux (checked with ffmpeg 7). Test: `BasePipelineBuilder.test.ts`.
- **Upstream:** not sent.

### Pick the software encoder's preset in the transcode config (2026-10-13)

- **What you saw:** software H.264/HEVC always encoded with `-preset veryfast`. Transcode configs have a `videoPreset`
  field, but the settings page didn't show it and the stream code ignored it. Trying a faster preset meant rewriting
  ffmpeg's command line outside Tunarr.
- **Cause:** `FfmpegPlaybackParamsCalculator` hard-coded `VideoPresets.VeryFast` for hardware acceleration "none".
- **Fix:** the calculator uses the transcode config's preset when it's a known libx264/libx265 preset, and keeps
  `veryfast` when it's empty or unknown, so existing configs behave as before. The transcode config page shows a **Video
  Preset** dropdown (ultrafast to medium) under Video Options when Hardware Acceleration is Software and the format is
  H.264 or HEVC. A change takes effect when the next ffmpeg process starts; no restart. Hardware encoders are unchanged.
  Files: `server/src/ffmpeg/FfmpegPlaybackParamsCalculator.ts`, `server/src/ffmpeg/builder/constants.ts`,
  `web/src/components/settings/ffmpeg/TranscodeConfigVideoSettingsForm.tsx`. Tests:
  `FfmpegPlaybackParamsCalculator.test.ts`.
- **Upstream:** not sent.

### The transcode config's thread count now limits the encoder (2026-10-13)

- **What you saw:** setting **Thread count** in a transcode config didn't limit how many threads libx264 used. On a box
  with many cores, or a tight per-user thread limit, each watched channel still started about 1.5x the visible cores
  in encoder threads.
- **Cause:** the value was written only as a global `-threads N` before the inputs, which ffmpeg applies to the first
  input's decoder. `PipelineOptions.encoderThreadCount` was filled in for the main transcode path but never read, and
  the offline, error and `hls_slower` concat sessions didn't pass it at all.
- **Fix:** `Libx264Encoder` takes an optional thread count and writes it as the output option `-threads:v N`;
  `BasePipelineBuilder.setupEncoder` passes `pipelineOptions.encoderThreadCount`, and `FfmpegStreamFactory` now sets it
  for the offline, error and `hls_slower` concat sessions too. The decoder's `-threads` is unchanged. 0 still means
  "let ffmpeg decide". Tests: `Libx264Encoder.test.ts`, `SoftwarePipelineBuilder.test.ts`.
- **Upstream:** not sent.

### 10-bit sources no longer come out as H.264 High 10 (2026-10-13)

- **What you saw:** 10-bit sources (most x265/HEVC files, HDR or not) were transcoded to H.264 **High 10** on the
  software (no GPU) pipeline. Almost no player decodes High 10, so those programs failed or fell back to another
  transcode. It had to be worked around outside Tunarr by adding `-pix_fmt yuv420p` to the ffmpeg command.
- **Cause:** `SoftwarePipelineBuilder.setupVideoFilters` started its frame state from the desired output state without
  the source's pixel format, so it believed frames were already `yuv420p`. `setPixelFormat` then saw no difference and
  never added `-pix_fmt yuv420p`, and libx264 encoded the decoder's `yuv420p10le` frames as High 10. The Nvidia, QSV and
  VAAPI builders already seed the state with `videoStream.pixelFormat`. Tone mapping hid the bug for HDR sources,
  because its filter chain ends in `format=yuv420p`.
- **Fix:** seed the software pipeline's starting state with `videoStream.pixelFormat`, as the hardware builders do
  (`server/src/ffmpeg/builder/pipeline/software/SoftwarePipelineBuilder.ts`). Test:
  `SoftwarePipelineBuilder.test.ts` (a 10-bit source gets `-pix_fmt yuv420p`; an 8-bit source gets no conversion).
- **Upstream:** not sent. Related: upstream PR #1559 (an unconditional `-pix_fmt yuv420p`) was closed on the grounds
  that the pipeline builder already forces 8-bit output; on the software path it didn't.
