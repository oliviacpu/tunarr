# Library

Configure library scans and search indexing under **Settings > Library** (`/web/settings/library`). The old `/web/settings/scanner` address redirects here.

The rescan interval applies when saved, and the page shows the next scheduled scan. See [Scheduled Scans](../media_sources/index.md#scheduled-scans) for timing and related collection syncs. Manage connections separately under **Sources**.

## Search indexing

**Search snapshot interval (hours)** sets how often Meilisearch saves its index snapshot. **Indexing memory limit (bytes)** sets the memory budget for indexing; leave it empty to use Meilisearch's default. Both settings show **Restart required** because Tunarr passes them to Meilisearch at startup. The scan interval still applies immediately.

`TUNARR_SEARCH_MAX_MEMORY` takes precedence over the saved memory limit. The setting is stored in bytes, as described in the [Meilisearch configuration reference](https://www.meilisearch.com/docs/resources/self_hosting/configuration/reference#max-indexing-memory).
