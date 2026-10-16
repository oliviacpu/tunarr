# Test channel 99: its own settings, good test clips, hidden from friends

## Context

Testing caption options today changes them for everyone. Caption appearance, alignment, overlap handling and the test
pattern are global FFmpeg settings, so trying a magenta box changed the captions on every channel, for the owner and
friends alike.

The user asked for a dedicated test channel to "enable it, tune in, let us test all kinds of different options with
good test data". Their choices:
- **Settings:** the test channel has its own settings.
- **Number:** channel 99, always in the guide.
- **Friends:** it must be invisible to friends, and the user OK'd hiding it through the iptvtunerr proxy.
- **Test clips:** captions, audio, video and transitions.

What exists (from exploration):
- **Per-channel settings:** none for captions. The pattern to copy is the per-channel `audioTracks` JSON column
  (`types/src/schemas/channelSchema.ts:189-247`, `server/src/db/schema/Channel.ts:52`, migration 0053).
- **Hiding:** Tunarr's only exclusion flag is `stealth`, which drops a channel from the HDHR lineup and M3U, so Plex
  couldn't map it at all. That's no use for "owner sees it, friends don't". Friends get Live TV only through the proxy,
  so the proxy is where to hide it.
- **Test clips:**
  - Clip generators: `.claude/skills/stream-repro/scripts/repro.mjs` (`LAYOUTS`, `makeClips`) and
    `e2e/fixture/media.ts`. Neither writes realistic sidecar subtitles or HDR.
  - HDR fixtures: `server/src/testing/ffmpeg/fixtures/*hdr10*`.
  - Caption cue sets: the golden set in `Cea608Encoder.golden.test.ts:21-55`, `CaptionTestSamples` in
    `CaptionTestPattern.ts:19-110`, and the ASS style, `\pos` and `\move` snippets in `ProgramCaptions.test.ts` and
    `Cea608Encoder.test.ts`.
- **Box:**
  - `~/media/test-clips` would sit outside every Plex library, while Tunarr already mounts `~/media` read-only.
  - `build_grid.py` leaves channels outside `CHANNELS` alone, but its `--map-plex` would drop 99.
  - `audio_test_channel.py` has working code for Plex channel mapping (DVR 4, device 1, `PUT
    /media/grabbers/devices/1/channelmap`).
  - A channel-map change ends any playing Live TV session, so mapping happens only when nobody watches.

## Part A: per-channel caption settings (Tunarr fork PR)

- **Schema:** new nullable JSON channel field `captions`:
  `{ testPattern?: boolean; alignment?: CaptionAlignment; appearance?: Partial<CaptionAppearance> }`.
  - Validate it with the existing enums in `types/src/schemas/settingsSchemas.ts:78,144-170`.
  - Add a migration (0054), the repository and converters, following `audioTracks`.
  - Absent fields fall back to the global settings.
- **Where it's applied:**
  - `FfmpegStreamFactory.ts:749-751`: the test pattern runs when `ffmpegSettings.hdhrCaptionTestPattern ||
    channel.captions?.testPattern`.
  - `HlsSession.addCaptions` (`HlsSession.ts:528-560`): appearance =
    `{...global hdhrCaptionAppearance, ...channel.captions?.appearance}`, and alignment = channel override ?? global.
    Use the existing `resolveAppearance` (`Cea608Encoder.ts:347-358`).
  - `FfmpegStreamFactory.ts:741-742`: the no-captions notice gets the same merge, so a small `channelCaptionAppearance(settings, channel)` helper serves both.
  - The global `hdhrClosedCaptions` stays the master switch.
- **Web:**
  - Pull the caption controls in `FfmpegSettingsPage.tsx:576-866` out into a `CaptionAppearanceFields` component.
  - The global page keeps using it.
  - The channel editor (`ChannelTranscodingConfig.tsx`, beside `ChannelAudioTracksField`) gets a "Captions for this
    channel" section: a "Use own caption settings" switch, which shows the same fields seeded from the global values,
    plus a per-channel test-pattern switch.
  - Two buttons: **Copy to all channels** (writes this channel's values to the global settings) and **Reset to
    global**.
- **Tests:**
  - schema;
  - merge precedence: channel over global, and missing fields fall back;
  - the factory turns the test pattern on per channel;
  - HlsSession uses the channel override;
  - golden snapshot unchanged with no override;
  - web field.
- **Docs and process:** `docs/configure/ffmpeg` and the channel docs, a FORK.md entry, then regenerate OpenAPI and the
  web client.

## Part B: hide channel 99 from friends (iptvtunerr fork PR, `/Users/olivia/Source/iptvtunerr`)

**Telling friends from the owner.** "Owner token" can't mean "the owner": the owner's Mac, Plex Web and other devices
each sign in with their own token. The capture shows 4 device tokens from the home address, which the proxy elevates
exactly like a friend's. Friends are the tokens on plex.tv's share list, which `-live-viewers` already fetches
(`liveviewers.go`). So for each response, judging the caller's own token:
1. It's the owner token: owner.
2. It's on the share list: friend, remembered as such so an empty or bad list can't un-friend anyone.
3. It isn't on a share list fetched after the token was first seen: one of the owner's devices.
4. Unsettled, or no token: hide (fail closed) and refresh the share list, waiting at most about 2 s.

The tracker in `liveviewers.go` is created when either feature is on. Its "settled" test uses the last successful
fetch, so one failed plex.tv fetch doesn't hide 99 from the owner.

**Flag.**
- `-hide-live-channel 99`, repeatable, plus `-hide-live-channel-debug`.
- It requires `-elevate-live-tv` and an owner token.
- "99" resolves to Tunarr's id `C99.114.tunarr.com` (`server/src/util/channels.ts:6-15`) through a lazily cached
  `/livetv/dvrs` channel map, like `FetchDVRLabelMap` in `labelmap.go:112-188`.

**Refusing tunes.** In `ServeHTTP` after the block check (`proxy.go:469-473`), a non-owner request that names the
hidden channel (`/livetv/dvrs/<n>/channels/<id>/…`, including `tune`) gets a 404 and never reaches Plex. Audit
`deny_hidden_channel`; it doesn't count as a bad attempt.

**Filtering responses.** A new step `hideLiveChannelEntries`, after `recordAcceptedLiveViewer` (`proxy.go:574`), runs
for non-owner 200 JSON/XML responses on provider-scoped, `/livetv/`, `/media/grabbers/` and `/media/subscriptions`
paths. It follows `scrubOwnerToken`'s read, transform and restore pattern (`proxy.go:734-782`, `readBody`/`restoreBody`
at :1796-1842).
- It matches only the dedicated fields: `vcn`, `channelVcn`, `lineupIdentifier`, `deviceIdentifier`, `identifier`
  (number), and `id`, `gridKey`, `key`, `channelIdentifier`, `channelKey` (identifier).
- **What it drops, by shape (found in the recorder's real requests and owner-token GETs):**

  | Response | What's dropped |
  | --- | --- |
  | `lineups/dvr/channels` | `Channel` entries |
  | grid, hubs (discover, onnow, onlater), `all`, `sections/N/all`, `metadata`, `library/search`, `livetv/sessions` | `Media` airings (an item left with none goes too), matching `Channel` tags, and `SearchResult`s |
  | `/livetv/dvrs` | `ChannelMapping` |
  | `/media/grabbers/devices/1/channels` | `DeviceChannel` |
  | `/livetv/epg/lineupchannels` | `Lineup.Channel` |

- **Formats:** JSON is a generic walk (with `UseNumber`), and the body is re-encoded only if something changed. XML
  needs a small element tree, because `rewriteTokens` only edits attributes.
- **Fix-ups:** `size`, `totalSize` and `X-Plex-Container-Total-Size`; drop the `X-Plex-Content-*-Length` headers; add
  `Cache-Control: private, no-store`.
- **Gzip:** kept.

**Checking it without a friend's token.**
- Log lines `plexlabelproxy_hide outcome=removed|owner_kept|leak_suspect`, with counts and the viewer label. The leak
  check searches the body for the identifier, title and call sign after filtering.
- Counters in the summary line (`proxy.go:1411-1468`).
- An owner-only preview header, `X-Iptvtunerr-View-As: friend`, applies the friend view. It is checked against the
  owner token in constant time, and the Director strips it before the request reaches Plex.

**Code.** New `hidechannels.go` (matcher, channel-map cache, owner test, JSON and XML filters, leak check). Changes in
`proxy.go`, `liveviewers.go` and `cmd/iptv-tunerr/cmd_plex_label_proxy.go` (a new repeatable flag type).

**Tests** (`hidechannels_test.go`, fixtures in `testdata/hidechannels/`, anonymised, JSON and XML, with an item airing
on both 2 and 99):
- a friend never sees 99, with gzip handled and counts and headers right;
- owner and owner-device responses are unchanged;
- an unsettled token is hidden;
- a tune for 99 gets 404 and never reaches Plex, while channel 2 and the owner's 99 go through;
- the preview header works for the owner only and is never forwarded;
- off by default;
- logs carry no raw tokens.

Then the fork's process (FORK.md, AGENTS.md): one commit, FORK.md, `memory-bank/task_history.md` and
`current_task.md`, `known_issues.md` for the gaps, and the runbook section in
`docs/runbooks/plex-live-tv-entitlement-proxy.md`.

**Known gaps** (written down, accepted):
- A show airing only on 99 still lists under Shows/Favourites with no airings.
- WebSocket notifications aren't filtered.
- Plex Home members other than the owner would see 99; today the Home is only the owner.
- An owner device is hidden from 99 for about a minute after its token is first seen, and while plex.tv is down.

**Deploy:** `deploy_proxy.sh <tag> <fallback> -hide-live-channel=99` when nobody watches, **before** channel 99 exists in
Plex, so no friend's app ever caches it. Then add `plexlabelproxy_hide` to `livetv_capture.py`'s filter so friends'
`removed=` lines are recorded.

## Part C: test clips and the channel (box tooling plus a generator in the fork)

**Three sources of test data** (user: "We can download, generate, or otherwise get whatever test clips and data you
need"):

1. **The user's own library**, used straight from Plex with no copies. `test_channel.py pick` queries Tunarr's database
   read-only for short programs with a given property and adds them to 99's lineup. Examples:
   - a dual-audio anime episode (eng + jpn) with an ASS sidecar using styles and `\pos`;
   - a Max Headroom episode (an interlaced DVD source, deinterlaced);
   - an HDR10 episode or film;
   - an E-AC3 5.1 episode;
   - a fast-dialogue sitcom episode with an `.en.sdh.srt`;
   - a commercial from the Commercials library.
2. **Free-licence downloads** (CC-BY or published test files; attribution kept in a README next to the clips; stored
   privately on the box in `~/media/test-clips/open/`):
   - **Netflix Open Content:** *Meridian*, HDR10 with 5.1, at 1080p to keep it small; *Sparks* if useful.
   - **Blender open films:** *Sintel*, *Tears of Steel* and *Cosmos Laundromat*, with their official subtitles in
     several languages. That's real timed dialogue for caption timing and multi-language subtitle selection.
   - **Jellyfin's test-videos set:** short HEVC 10-bit HDR10/HLG and other codec samples.
   Download them on the box straight from the official hosts, with checksums where published, and trim them to 2–5 min
   excerpts with ffmpeg so the channel's loop stays short.
3. **Generated clips** for the precise checks below.

- **Generator**, a script in the fork (`scripts/test-channel/make-test-media.mjs`, reusing `repro.mjs`'s clip
  approach). It runs on the Mac with jellyfin-ffmpeg 8.1.3 (scratchpad `jf/ffmpeg`, which has x265 and zscale) and
  macOS `say` for spoken audio.
- **Every clip:** a big burned-in label saying what it tests (e.g. "AUDIO: ENG + JPN · 5.1"), a running clock and frame
  counter (`drawtext`), and motion to judge judder. Labels let the user report problems precisely, e.g. "sample 12 at
  0:41" (user: "label everything"). About 1–3 min at 720p, to keep the upload small.
- **Default captions on 99:** the clips' own subtitles. The numbered test pattern is the channel's per-channel switch,
  off by default (user's choice).
- **Captions** (other_videos clips with sidecar `<name>.en.srt` / `.en.ass`; local sidecars work since fork PR #21):
  - **SRT:** italics, underline, ♪ lines, long wrapping lines, `{\an8}`/`{\an5}`/`{\an3}`, overlapping lines
    (together and apart), fast-dialogue bursts, a cue under way at a program start, accented characters (the golden
    cue set), and short gaps between cues (the magenta-box case).
  - **ASS:** styles (top/left/right), `\pos`, `\move`, a `\p1` drawing.
  - A clip with no subtitles, for the "No captions" notice.
- **Audio:**
  - English + Japanese tracks that say their language aloud: `say -v Samantha` and `say -v Kyoko`, looped with a label.
  - A 5.1 clip naming each speaker; stereo only; one clip with English only (the switchable-audio fallback); AC3,
    E-AC3 and AAC; 44.1 kHz.
- **Video:** HDR10 (HEVC 10-bit, smpte2084/bt2020), HLG, 10-bit SDR HEVC, interlaced 29.97i (tff), 23.976/25/29.97/59.94
  fps, anamorphic 720x480 (SAR 32:27).
- **Transitions:** 30 s clips back to back with different layouts, a flex gap (channel card and gap music), and one of
  the Plex Commercials library's ads.
- **Upload** to `~/media/test-clips` on the box, outside the Plex libraries.
- **`~/tests/tunarr-tools/test_channel.py build|remove|status`**, modelled on `audio_test_channel.py`:
  - Creates a local media source "Test clips" (`POST /api/media-sources`, other_videos) and waits for its scan.
  - Creates channel 99 "Test": HLS mode, subtitles on, the default transcode config, `audioTracks` `eng, jpn`, its
    own `captions` override, and a TEST card and gap music.
  - Sets a fixed looping lineup of the clips with flex gaps (`POST /api/channels/:id/programming`).
- **Plex mapping:** map 1–6 + 99 once while nobody watches, reusing `map_plex` from `audio_test_channel.py`.
  - `build_grid.py`: add `EXTRA_MAPPED = ['99']` so `--map-plex` keeps it.
  - `interstitials.py`: a `config/offline/ch99.png` TEST card.
- **Box docs** (`~/docs/tunarr.md`): how to use it, including that friends can't see it.

## Experiment once 99 exists: "Original" and "Test" caption tracks

The user asked: "The subtitle tracks could be like 'Original' and 'Test' for that channel too?"
- **Today:** Plex Live TV reads one CEA-608 caption channel (CC1) from the tuner stream and names the track after the
  video's language (fork, 2026-10-14). There is no free label.
- **Candidate second tracks:**
  - CEA-608 has four channels: CC1 and CC2 share field 1 (2 characters per frame between them); CC3 and CC4 share
    field 2.
  - CC2 costs CC1 bandwidth, but decoders that read only field 1 would still see it. CC3 has its own bandwidth, but
    needs a decoder that reads field 2.
  - CEA-708 has several services with language tags.
- **Unknown:** whether Plex's players (Apple TV, Mac) offer any of them as a second track.
- **Experiment:** on 99, keep the clip's subtitles on CC1 and put the test pattern on CC2, then on CC3 (a small encoder
  option behind the channel's `captions` setting). Tune on the Apple TV and Plex Mac each time and look at the CC menu.
- **If one shows:** make it a real option, "Original" on CC1 and "Test" on whichever channel works, with whatever labels
  Plex allows. Prefer CC3 if both work, since it leaves CC1 its full bandwidth.
- **If not:** drop it, and the per-channel test-pattern switch stays the way to flip.

## Rollout order

0. Copy this plan to `plans/test-channel-99.md` (the repo's naming), part of Part A's PR.
1. Part A PR, review, release, deploy when nobody watches.
2. Part B PR, review, release, proxy deploy when nobody watches. This must be live before step 4, so friends never see
   99.
3. Generate and upload the clips; `test_channel.py build` (the Tunarr side only; nobody is interrupted).
4. Map 99 into Plex once nobody watches.
5. The user tunes 99 on the Apple TV and Plex Mac.

## Verification

- **Part A:**
  - unit tests;
  - the golden snapshot unchanged;
  - stream-repro with `--channel-setting captions={...}` decoding a captioned clip with jellyfin-ffmpeg: the override
    applies on that channel only, while another channel keeps the global look.
- **Part B:**
  - the unit tests over fixture responses (owner, owner device, friend, unsettled);
  - on the box after deploy, curl with the owner token plus the preview header against lineups, grid and tune: no
    `C99.114`, and the tune gets 404;
  - the owner's own guide shows 99 (`owner_kept present>0`);
  - friends' `removed=` lines appear in the recorder.
- **Part C:**
  - `ffprobe` checks of each generated clip (tracks, language tags, HDR side data, field order);
  - after the build, Tunarr's channel 99 streams with `eng` + `jpn` audio and captions; probe the HDHR `.ts`, as done
    for Anime;
  - the owner sees 99 in Plex;
  - the proxy's debug log shows 99 hidden from friends' guide requests.

## Also to resume after approval (paused by plan mode, separate from this plan)

- Channel saves no longer rewrite every channel's guide: done in a worktree. Commit, PR and Codex still to do.
- PR #24, subtitle self-heal: one Codex finding to fix (skip program ids already handled in the hourly pass).
- PR #25, small cleanups: reword the last commit's body for commitlint, then re-request Codex.
- Magenta box going black at the end of a line: the cause is FFmpeg's clear-screen code resetting the box colour
  mid-load. The fix is planned; code, tests and sample 39 still to do.
- Delete `/tmp/.x` on the box: an 89-byte Plex 400 page the proxy design agent's probe left behind, with no token in it.
- Box docs (`~/docs/tunarr.md`, `~/docs/apps.md` Bazarr): record the `.hi` to `.en.sdh` fix.
  - **Result:** 925 files renamed; undo list `~/backups/subs-sdh-2026-10-16.json`.
  - **Bazarr:** `hi_extension` is now `sdh`; backup `config.yaml.bak-2026-10-16-sdh`.
  - **Counts:** Tunarr went from 921 rows tagged Hindi to 0, and from 516 programs with no English sidecar to 0. Sonarr
    has 3,780 subtitle files recorded as English and 0 as Hindi.
  - **The 29 copies agent:** 10 orphaned subtitles re-paired; 26 copies left, which are legitimate.
