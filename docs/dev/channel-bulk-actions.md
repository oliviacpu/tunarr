# Channel bulk actions

`POST /api/channels/bulk/stealth` changes guide visibility without replacing
other channel settings. Send 1–100 distinct channel UUIDs and a boolean `stealth`:

```http
POST /api/channels/bulk/stealth
Content-Type: application/json

{
  "ids": ["e08f348e-3df1-44f3-833b-68e93cb98593"],
  "stealth": true
}
```

Malformed, duplicate, empty or oversized ID lists return HTTP 400 with
`{ "message": "..." }` before changing any channel. A valid batch returns HTTP
200 with a result for each input ID, in the same order:

```json
{
  "results": [
    { "id": "e08f348e-3df1-44f3-833b-68e93cb98593", "success": true }
  ],
  "refresh": { "xmltv": "succeeded", "m3u": "succeeded" }
}
```

A missing channel has `success: false`, `statusCode: 404` and a display-safe
`message`. An operation failure uses status code 500 inside its item result.
Already matching channels succeed without another write. The stealth changes
share an immediate transaction; if it fails, the response reports no committed
successes. Other fields, filler/subtitle preferences and lineup files are preserved.

After committed changes, the server requests one XMLTV publication and one M3U
refresh. These run independently and each reports `succeeded` or `failed`.
When nothing changes, both report `not_needed`. A publication failure does not
undo channel changes or change successful item results into failures. Refresh
the affected guide/playlist after resolving the publication problem.

For more than 100 IDs, send sequential chunks. Publication happens once per
changed chunk. After a lost or invalid response, refetch channel state before
deciding what to do next: the server may have committed changes even if the
caller did not receive confirmation. Do not automatically replay the mutation.
Keep confirmed earlier results separate from the current unknown chunk and
later chunks that were never sent.

Existing single-channel endpoints remain available. Filler lists, custom shows
and smart collections keep their existing individual operations.

## Channel deletion

`POST /api/channels/bulk/delete` accepts `{ "ids": [...] }` with the same
1–100 distinct UUID validation and ordered per-item results. Deletions run
sequentially. An individual failure does not prevent later IDs from being tried.

Every item also includes a `cleanup` result:

```json
{
  "results": [
    {
      "id": "e08f348e-3df1-44f3-833b-68e93cb98593",
      "success": true,
      "cleanup": {
        "status": "failed",
        "message": "Unable to remove channel redirects"
      }
    }
  ],
  "refresh": { "xmltv": "succeeded", "m3u": "succeeded" }
}
```

Here the channel was deleted, but redirect cleanup failed. `success: true`
means the channel-row removal committed; it does not promise that every later
cleanup or publication succeeded. Cleanup uses `succeeded`, `failed` with a
safe message, or `not_needed` when no cleanup was necessary. A pre-commit
database failure reports a failed item and any separate lineup-restoration
failure. SQLite and lineup files are not one atomic transaction.

After at least one committed deletion, XMLTV and M3U are each refreshed once,
independently. When nothing is deleted, both report `not_needed`. A cleanup or
publication failure is not a reason to automatically replay deletion. After a
lost response, refetch and distinguish unknown from unattempted channels as
described above. Existing single-channel deletion remains compatible.
