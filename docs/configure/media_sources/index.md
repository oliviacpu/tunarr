# Media Sources

Tunarr finds media to use in channels from one or more "Media Sources". You can connect multiple media servers and use content from any of them when building your channels.

<div class="grid cards" markdown>

-   **[Plex](plex.md)**

    ---

    Connect your Plex Media Server to access your movies, TV shows, and other media.

-   **[Jellyfin](jellyfin.md)**

    ---

    Connect your Jellyfin server to use its media libraries in your channels.

-   **[Emby](emby.md)**

    ---

    Connect your Emby server to access its media content.

-   **[Local Media](local/index.md)**

    ---

    Use media files directly from your local filesystem without a media server.

</div>

## How Media Sources Work

When you add a media source, Tunarr will scan its libraries and index the available content. This allows you to:

- Browse and search media when adding programming to channels
- Automatically detect metadata like titles, episode numbers, and artwork
- Keep your channel programming in sync when media is added or removed

!!! tip
    You can add multiple media sources of the same type. For example, you could connect two different Plex servers and use content from both.

## Scheduled Scans

Tunarr rescans every enabled library on a timer. Set it under **Settings > Library** as **Rescan Interval (hours)**, 6 by default. The interval counts from midnight, so every 6 hours scans at 00:30, 06:30, 12:30 and 18:30. Scans start at half past the hour so they don't overlap the hourly check of each media server's library list. An interval of 24 or more scans once a day, at 00:30. Collections from Plex, Jellyfin and Emby, and [synced Custom Shows](../library/custom-shows.md), sync on the same interval, on the hour.

A new interval takes effect when you save it, with no restart. The Scanner page shows when the next scan will run, and **System > Tasks** lists the next run of every scheduled task. The interval must be a whole number of hours, 1 or more.
