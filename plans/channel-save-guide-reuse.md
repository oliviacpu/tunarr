# A channel save rewrites only that channel's guide entries

## Problem

Saving a channel (`PUT /api/channels/:id`) paused the Live TV the server was streaming.

- **2026-10-16, the deployment:** with the owner watching channel 1, a local artwork update saved
  each channel with a new offline picture. The latency probe saw 6 requests over 250 ms, the worst 1.05 s, all while
  the affected channel was being saved (4 s on that server).
- **2026-10-14:** editing channels in the web UI paused Live TV ("Live TV pauses while editing").

## What a save does on the main thread

Timed with temporary logs per step of the handler, on a copy of the deployment's database (6 channels, a 72 h guide,
784 guide programs), saving the affected channel's offline picture:

| Step                                             |      ms |
| ------------------------------------------------ | ------: |
| load channel, lineup config, transcode config    |       1 |
| `updateChannel` (one transaction)                |    4–29 |
| `guideService.updateCachedChannel` → XMLTV write | 181–426 |
| M3U cache, response                              |       2 |

Inside the XMLTV write:

| Part                                                                   |      ms |
| ---------------------------------------------------------------------- | ------: |
| fetch every guide program with its relations (`getGuideProgramsByIds`) | 133–382 |
| materialize guide items                                                |       1 |
| publish artwork                                                        |       3 |
| serialize (2.6 MB)                                                     |   34–43 |
| write the file                                                         |       5 |

So a save of one channel refetched every guide program of every channel with all its relations. On a laptop that is
a few hundred ms in yielding chunks; on the shared server, whose disk cache is often cold, single chunks blocked the
main thread for up to a second.

## Change

- **`XmlTvWriter`:** `write(channels, { reuse, onRendered })`. A channel in `reuse` keeps the programmes an earlier
  write rendered for it: no render, no artwork publish. Each rendered channel is reported to `onRendered`.
  `serialize` builds the same document from the same two pieces (one channel's programmes, then the assembly), so its
  output is unchanged.
- **`TvGuideService.writeXmlTvInternal`:** remembers each channel's rendered programmes, with the guide entry, channel
  object and programs array they came from, the render settings (XMLTV settings, credit-images flag), and each
  redirect target's presence, name and number. A redirect not followed at build time renders from its target at
  write time (Codex on PR #26); a followed one has copied the target's programmes.
  - **Reused** while all of these are the same: a guide rebuild assigns a new guide entry, and a channel save
    (`updateCachedChannel`) a new channel object.
  - **Fetched and rendered:** only the rest. Channels that leave the guide are forgotten.
- **Trade-off:** a program edited since (a scan) reaches an unchanged channel's entries at its next guide rebuild (the
  scheduled XMLTV refresh), as it did when nothing was saved. Before, any channel save refreshed every channel's
  program details as a side effect. Documented in `docs/configure/channels/epg.md`.

## Not changed

- The save's response, and every other step of the handler.
- A start-time change still regenerates that channel's lineup (`RegenerateChannelLineupCommand`), then writes through
  the same path.

## Tests

- `XmlTvWriter.test.ts`:
  - a full write reports every channel and matches `serialize`;
  - a reused channel keeps its programmes, isn't rendered and publishes no artwork.
- `TvGuideService.test.ts`:
  - after a full build, a channel save fetches and renders only that channel and reuses the other;
  - a rebuild or a render-settings change renders every channel again;
  - a channel with an unresolved redirect is rendered again when its target appears, is renumbered or leaves;
  - a followed redirect stays reused when its target is renumbered.

## Measurement

`server/scripts/guide-refresh-ab.ts --action save` (new), against a copy of the deployment's database
(`--template-dir`), arms switched by a temporary `TUNARR_BENCH_REUSE` check (removed), medians of 3 trials:

| Save                                        | reuse off | reuse on |
| ------------------------------------------- | --------: | -------: |
| offline picture: wall-clock                 |    199 ms |    46 ms |
| offline picture: probe p99                  |   17.6 ms |   4.3 ms |
| start time (lineup regenerated): wall-clock |    236 ms |    60 ms |
| start time: probe p99                       |   31.1 ms |   4.2 ms |

Stalls over 25 ms: 25–63 ms in the start-time arm with reuse off, none with it on. A laptop; the shared server is
slower and its disk cache colder, so its stalls are larger, as is the share removed.
