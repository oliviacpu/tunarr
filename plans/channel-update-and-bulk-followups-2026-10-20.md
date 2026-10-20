# Channel update preservation and batched channel actions

Status: **C7a approved by Olivia Hunter on 2026-10-20; C7b and C7c remain proposed and held**.
Olivia approved "C7a first; hold batching" while reviewing draft PR #149. These are the held
C7 follow-ups from `ui-waves-handoff.md`, beyond the approved UI-only bulk-action row.
S5 global subtitle defaults remain a separate feature and design.

## Problem

Code inspection at `0eba0856` confirms two problems; this is not a claim of a reproduced
production data-loss incident:

- `BasicChannelRepository.updateChannel` deletes filler attachments and subtitle preferences
  even when the optional request properties are omitted. `ChannelsPage` compensates by fetching
  the full channel before changing stealth. That read/replace also allows a concurrent edit to
  be overwritten by the stale full object.
- The table sends one channel update or deletion per selected channel. Each route rewrites
  XMLTV and regenerates M3U independently. Client `settleEach` already reports individual
  failures, so a replacement must retain that visibility.

The legacy `{ error }` response-reader correction is an independent small client fix. It does
not require changing server errors or bundling this API work with it.

## Approach

### C7a: preserve omitted channel relations

Keep the existing PUT route and property names. For `fillerCollections` and
`subtitlePreferences`, omission preserves existing rows; an explicit `[]` clears them;
nonempty arrays replace them. The current subtitle write schema rejects `[]`, and the editor
serializes a cleared list as `undefined`; change both together so an intentional clear sends
and accepts `[]`. Keep unrelated edits omitted rather than converting them into clears.
Reject malformed rows through the write schema. Do not add
PATCH or make every channel property optional. Keep start-time omission and on-demand behavior
unchanged, along with the client's current preservation workaround until the later batch PR.

Replace relation rows only when that property is present, within the existing immediate
transaction. An empty subtitle list must delete without attempting an empty insert. Preserve
relation IDs when the property is absent. Do not rename the existing `langugeCode` wire key.
S5's future channel-mode work must build on and test these omission semantics separately.

### C7b: batch stealth changes

Proposed new route: `POST /api/channels/bulk/stealth`, body `{ ids, stealth }`.
`ids` contains 1–100 distinct UUIDs; duplicates or malformed input reject the entire request
with HTTP 400 before mutation. The limit is a proposed bound, not an existing API guarantee.

Update only `channel.stealth`; never synthesize a full channel update. Resolve IDs and update
existing channels within an immediate transaction. Missing IDs receive per-item failures;
an already matching value is a successful no-op. If the transaction fails, report no committed
successes. No lineup, start-time, on-demand position, attachment or subtitle row is changed.

After commit, update cached guide metadata for the changed channels and write XMLTV once,
then regenerate M3U once. Add a bounded multi-channel guide-service operation rather than
calling the single-channel route N times. Preserve the guide's existing locking and write
serialization. No-op batches do not rewrite derived files.

### C7c: batch channel deletion

Proposed new route: `POST /api/channels/bulk/delete`, body `{ ids }`, with the same validation.
Process deletions sequentially through a narrowly scoped checked deletion operation, preserving
the existing lineup marking/restoration and redirect-reference handling. The current helpers
suppress some filesystem and redirect-cleanup errors; their resolved promises are insufficient
proof of successful cleanup. Report success at the boundary of committed channel-row removal,
with separate cleanup outcomes. A pre-commit marking failure must leave the channel intact;
a transaction failure attempts restoration and reports any restoration failure separately.
Post-commit redirect cleanup failure must not claim that the channel still exists. Continue
after an individual failure; do not claim the filesystem and SQLite form one atomic transaction.
Keep the existing single-channel endpoint and its behavior intact.

Remove successful IDs from the cached guide in one operation and write XMLTV once; regenerate
M3U once. Perform no derived refresh if nothing was deleted. Preserve existing viewer/session
behavior; stopping streams or changing deletion recovery is outside this proposal.

### Results and partial failures

Both proposed batch routes return HTTP 200 after a valid batch is processed, with ordered
per-item results matching input IDs. A result is either `{ id, success: true }` or
`{ id, success: false, statusCode, message }`. Proposed failure codes are 404 for missing IDs
and 500 for failed operations; messages must be safe for display and omit stack traces and
credentials. Whole-request validation failures use the existing `{ message }` error shape.

Report derived publication separately: `refresh.xmltv` and `refresh.m3u` are each
`succeeded`, `failed` or `not_needed`. Try both refreshes independently. A publication failure
must not convert committed channel changes into alleged failures or offer an automatic replay
of deletion. The UI reports the operation outcome and an additional warning when derived
publication or post-commit cleanup fails. A deletion result also reports its cleanup status
separately, including a safe reason on failure. Retrying an operation does not imply
exactly-once behavior.

Add a checked M3U refresh path for batch callers: the existing cache write suppresses errors,
and the file-cache delete path can leave an in-memory value when the disk file is missing.
Clear stale memory independently of disk-file existence, and propagate actual build/write
failures to the batch result. Test those real service failure paths rather than only mocking
`regenerateCache()` to reject. One XMLTV publication per chunk means one request through the
existing serialized publication queue; concurrent requests may share a write. Test an
overlapping scheduled guide build so older cached state cannot overwrite the batch change.

Keep the current confirmation's selection snapshot, busy state, descriptive names, failure
summary and query invalidation. For selections larger than 100, send sequential chunks and
combine per-item results; disclose that publication is once per chunk, not once per arbitrarily
large selection. Do not retry mutation requests automatically after transport failures: refetch
and show that the outcome could not be confirmed. Stop sending subsequent chunks after a lost
response, retaining prior confirmed results and distinguishing unknown IDs from unattempted
IDs. Single-channel UI paths remain compatible.

## Alternatives and scope

- Continuing to GET then PUT full channels preserves the race and repeated publication.
- A generic arbitrary batch API adds unrelated authorization, validation and transaction rules.
- One transaction for all deletions cannot roll back lineup filesystem operations safely.
- Silent asynchronous publication would hide failures after a successful response.
- New bulk-delete routes for filler lists, custom shows and smart collections are deferred:
  their current routes do not each rebuild XMLTV/M3U, so this review found no equivalent
  publication benefit. Retain their current per-item client requests and failure reporting.

No migration, runtime dependency, new page, global subtitle model or scheduling behavior change
is proposed. This work changes a cross-package API contract and therefore needs Olivia's
explicit design approval before implementation under the fork's approval process. That approval
has been given for C7a only; the batch routes and their supporting changes remain unauthorized.

## PR plan and acceptance

| Row | PR                                                                                      | Required evidence                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C7a | Relation preservation, explicit-empty write validation and current-editor serialization | Real repository tests for omitted, empty and replacement values for both relations; absent relation IDs survive; schema accepts explicit empty arrays and rejects malformed rows; editor clear → save → reload removes subtitles while unrelated edits preserve them; start-time and on-demand regressions remain green.                                                                                        |
| C7b | Batch stealth contract, server orchestration and table integration                      | Invalid/duplicate/oversize input causes no writes; mixed existing/missing and no-op IDs; transaction failure; unrelated channel fields and relation IDs unchanged; one XMLTV/M3U publication per changed chunk; independent publication failures; client mixed failures, unknown transport outcome and confirmation/busy behavior.                                                                              |
| C7c | Batch channel deletion contract and table integration                                   | Mixed existing/missing IDs; one deletion fails while others finish; marking failure; transaction failure plus restoration failure; post-commit redirect failure; real M3U disk/memory-cache failures; overlapping scheduled guide publication; committed outcomes stay truthful; no automatic destructive retry; one publication per successful chunk; existing single routes and list bulk actions still work. |

Use separate small PRs in that order, splitting a row further if it exceeds review size.
Build shared types first, regenerate OpenAPI in an empty scratch directory and then regenerate
the web client for API changes; leave historical specifications unchanged. Each PR needs
focused tests, changed-file lint, typechecks, full CI and review of its final head. Add fork
notes and user-facing API documentation with implementation. A later release follows the
existing Whatbox guard; approving this proposal does not itself deploy anything.

## AI use

Codex inspected the current client, routes, repository and guide services, and wrote this
proposal. No implementation of these proposed contracts is included.
