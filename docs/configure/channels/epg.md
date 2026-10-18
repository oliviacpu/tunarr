# EPG

Tunarr generates an [XMLTV](https://wiki.xmltv.org/index.php/XMLTVFormat)-formatted Electronic Program Guide (EPG) for all active channels. This guide data can be consumed by media clients (Plex, Jellyfin, Emby, Channels DVR, etc.) to display program schedules and metadata alongside the live stream.

## XMLTV Output

Tunarr writes XMLTV data to an `.xml` file in the data directory, but clients should always consume it via the API endpoint rather than reading the file directly:

```
http://<tunarr-host>:<port>/api/xmltv.xml
```

The full URL is also available in the Tunarr web UI under **Settings > HDHR / M3U**. Point your client's guide data source at this URL to populate the program guide.

### When the guide is updated

- **The whole guide** is rebuilt on the schedule in **Settings > XMLTV** and when you refresh it there. The schedule is
  the **Refresh Timer** counted from the **First Refresh of the Day** (server time): a 4 hour timer from 03:00 rebuilds
  at 03:00, 07:00, 11:00, 15:00, 19:00 and 23:00, and a 24 hour timer from 03:00 once a day at 03:00. The defaults,
  every 4 hours from 00:00, rebuild at midnight and every 4 hours after. A full rebuild reads every program in the
  guide window, so on a busy server pick an hour when nobody watches. Saving these settings moves the schedule at once
  and rebuilds the guide straight away.
- **Saving a channel** updates that channel's entries straight away. The other channels keep the entries they already had, so a change to a program's details since then, from a library scan for example, appears at the next scheduled rebuild. Rebuilding every channel on each save made Live TV pause while channels were saved.
- **Changing an XMLTV setting** updates every channel at the next write.

## Program Metadata

Tunarr populates the XMLTV output with program metadata sourced from your media libraries, including:

- Program title and episode title
- Description / plot summary
- Air date and year
- Content rating
- Cast and crew credits
- **Genres** — included under the XMLTV `<category>` tag, sourced from the genre metadata attached to each program in your media library. Clients that display genre information in their guide (e.g., Channels DVR) will pick these up automatically.

!!! info
    Genre data is only available for programs that have genre metadata in the originating media source. If a program's entry in your media server has no genres attached, the `<category>` tag will not be present for that program in the XMLTV output.