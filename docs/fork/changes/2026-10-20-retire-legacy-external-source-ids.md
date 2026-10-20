### Retire legacy external source columns safely (2026-10-20, PR #122)

**What you saw:** External-ID rows retained legacy source-name columns alongside media-source UUIDs. Compatibility queries still read those names, and startup normally backfilled them only after migrations ran. Three existing tables were missing from the Drizzle schema index.

**Cause:** The source-ID transition left both representations live. Simply dropping the old columns would discard the identifiers needed to backfill old rows before the startup fixer could run.

**Fix:** A single generated and registered migration resolves source-dependent external IDs by source UUID/name and type, backfills their media-source IDs transactionally, then removes the obsolete indexes and columns. Source-independent identifiers can keep null media-source IDs. Missing or ambiguous sources stop the migration with table/count diagnostics; uniqueness failures roll back the entire migration. Runtime converters, lookups, replacements, and fixers use the replacement IDs. Root program/grouping backfills remain in the startup fixer because they use retained columns and relationships. Clip fallbacks and MikroORM history remain intact; the three existing tables are registered with Drizzle.

The live legacy transcode-default factory is retired. The runtime fixer uses the current Drizzle factory with the same stored values; the exact old factory is frozen in a migration-only helper, and its historical migration changes only that import. Existing-install startup now synchronizes MikroORM history before applying migrations, then checks the current connection for remaining migrations and stops if any failed, so runtime code never proceeds after an incomplete schema upgrade.

**Tests:** Upgrade fixtures cover null source IDs, source-name and UUID resolution, independent and already-resolved IDs, unresolved/ambiguous rollback in both tables, uniqueness rollback after an earlier backfill, retained clip fallbacks, post-migration root backfills, exact default values, bootstrap failure on unresolved data, and an actual MikroORM-only bootstrap. A backup of the repository's existing dev fixture is migrated separately with unchanged row counts and no foreign-key errors. Final build, lint, typecheck, and server-suite results are in the PR.

**Upstream:** No upstream issue; approved fork audit P2 (PR #85).
