# System

The System section covers Tunarr's core infrastructure settings including backup management, logging configuration, and other server-level options.

## Sections

<div class="grid cards" markdown>

-   **[Backup & Restore](backup.md)**

    ---

    Configure automatic backups, manage backup retention, and learn how to restore your Tunarr installation from a backup.

-   **[Logging](logging.md)**

    ---

    Configure log levels, log file rotation, and learn how to access logs for troubleshooting.

-   **[Troubleshooting](../../misc/troubleshooting.md)**

    ---

    Diagnose streaming issues for individual programs by analyzing the full transcoding pipeline.

</div>

## Quick Links

- [Environment Variables](../../getting-started/run.md#configuration) - Server, logging, and search configuration via environment variables
- [FAQ](../../misc/faq.md) - Frequently asked questions including the Meilisearch `data.ms` file

## Settings-file compatibility

Settings files upgrade to version 2 on startup. Unused Plex streaming settings (`plexStream`) and XMLTV image caching (`xmltv.enableImageCache`) are removed while active settings are preserved. The retired `/api/plex-settings` endpoints are no longer available.
