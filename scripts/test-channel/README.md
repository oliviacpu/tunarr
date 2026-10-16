# Test channel media

`make-test-media.mjs` makes the generated clips for a test channel: one place to try caption, audio and video options
without touching the channels people watch (fork plan: `plans/test-channel-99.md`).

```sh
node scripts/test-channel/make-test-media.mjs --out ~/test-media \
  --ffmpeg /path/to/jellyfin-ffmpeg --ffprobe /path/to/jellyfin-ffprobe [--only 01,04] [--font file.ttf]
```

- **Needs:**
  - ffmpeg with libx264, libx265, zscale, drawtext and the ac3/eac3/aac encoders (jellyfin-ffmpeg has all of them);
  - macOS `say` with the Samantha (English) and Kyoko (Japanese) voices.
- **Output:** `<name>.mkv` with a sidecar `<name>.en.srt` or `<name>.en.ass` where the clip has subtitles, and
  `manifest.json` listing what ffprobe found for each clip (tracks, languages, colour tags, HDR side data, interlacing).
  The full set is 20 clips, about 22 minutes and 540 MB, and builds in about two minutes on an M-series Mac.
- **On screen:** every clip shows a big label saying what it tests, a running clock and a frame counter, so a problem can
  be reported as "01-captions-srt at 0:57, frame 1710". The caption clips also show which case is playing.
- **Speech:** the caption clips speak every subtitle line at its start time, so caption timing can be judged by ear.

| Clip | Tests |
| --- | --- |
| 01-captions-srt (2:32) | SRT: a line on screen from the first frame (a caption under way at a program boundary), plain lines, italics/underline, ♪, long wrapping lines, top/middle/right placement, overlapping lines, a sign over dialogue, fast dialogue, short gaps between lines (box colour), accents and symbols, a very short line, a quiet stretch |
| 02-captions-ass (1:18) | ASS: styles (bottom/top/left/right/middle), `\pos`, `\move`, `\an` override, italics/underline, a `\p1` drawing (dropped), a sign over dialogue, `\N`, ♪, a layered duplicate, `*Default` and an unknown style |
| 03-captions-none | no subtitles: the "No captions for this program" note |
| 04-audio-eng-jpn | AC3 5.1 English + AC3 5.1 Japanese, each saying its language |
| 05-audio-51-speakers | AC3 5.1: each speaker says its name, the LFE hums |
| 06-audio-stereo-lr | AAC stereo: "Left" left, "Right" right |
| 07-audio-english-only | E-AC3 English only (a channel's Japanese slot should repeat it) |
| 08-audio-44k | AAC at 44.1 kHz |
| 09-video-hdr10 | HEVC Main 10, BT.2020 PQ, mastering display and content light metadata |
| 10-video-hlg | HEVC Main 10, BT.2020 HLG |
| 11-video-sdr-10bit | HEVC Main 10, BT.709 |
| 12-video-interlaced-2997i | 720x480 29.97i, top field first |
| 13-16 | 23.976, 25, 29.97 and 59.94 fps |
| 17-video-anamorphic | 720x480, SAR 32:27 (16:9) |
| 18-20 transitions | 30 s clips back to back: 720p30 AAC, 1080p23.976 AC3 5.1 eng+jpn with subtitles from its first frame, 480p29.97 AAC 44.1 kHz |

**Interlacing:** Matroska's field-order flag reads back as `tb` for the interlaced clip (an ffmpeg muxer quirk), so the
manifest reports the frames' own flags, which are interlaced and top field first.

**Test-channel use:** put the clips in a folder outside your media server's libraries and add it to Tunarr as a local
"other videos" source. Local libraries pick up `<name>.en.srt` / `<name>.en.ass` sidecars. Then build a channel from
them, with HLS mode, subtitles on, and for example audio tracks `eng, jpn`.
