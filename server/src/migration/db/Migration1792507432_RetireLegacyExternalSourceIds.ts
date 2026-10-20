import { sql } from 'drizzle-orm';
import { CompiledQuery } from 'kysely';
import type { TunarrDatabaseMigrationWithDrizzle } from '../DirectMigrationProvider.ts';
import { makeMigrationFromSqlFile } from './util.ts';

const Tables = ['program_external_id', 'program_grouping_external_id'] as const;
type ExternalIdTable = (typeof Tables)[number];
type ResolutionDiagnostics = { unresolved: number; ambiguous: number };

function resolutionDiagnosticsSql(table: ExternalIdTable): string {
  return `SELECT
    coalesce(sum(candidate_count = 0), 0) AS unresolved,
    coalesce(sum(candidate_count > 1), 0) AS ambiguous
  FROM (
    SELECT (SELECT count(*) FROM media_source AS source
      WHERE source.type = legacy.source_type
        AND (source.uuid = legacy.external_source_id OR source.name = legacy.external_source_id)
    ) AS candidate_count
    FROM ${table} AS legacy
    WHERE legacy.media_source_id IS NULL AND legacy.source_type IN ('plex', 'jellyfin', 'emby')
  )`;
}

function validateResolution(
  table: ExternalIdTable,
  diagnostics: ResolutionDiagnostics,
) {
  if (diagnostics.unresolved > 0 || diagnostics.ambiguous > 0) {
    throw new Error(
      `Cannot retire ${table}.external_source_id: ${diagnostics.unresolved} unresolved and ${diagnostics.ambiguous} ambiguous source-dependent identifiers. Restore or disambiguate the media sources using the previous version, then retry the upgrade. Legacy identifiers have been preserved.`,
    );
  }
}

const migration = makeMigrationFromSqlFile(
  './sql/0057_retire_legacy_external_source_ids.sql',
);

export default {
  ...migration,
  async up(db) {
    for (const table of Tables) {
      const { rows } = await db.executeQuery<ResolutionDiagnostics>(
        CompiledQuery.raw(resolutionDiagnosticsSql(table)),
      );
      const diagnostics = rows[0];
      if (diagnostics === undefined)
        throw new Error(`Missing resolution diagnostics for ${table}`);
      validateResolution(table, diagnostics);
    }
    await migration.up(db);
  },
  upDrizzle(db) {
    for (const table of Tables) {
      const diagnostics = db.get<ResolutionDiagnostics>(
        sql.raw(resolutionDiagnosticsSql(table)),
      );
      if (diagnostics === undefined)
        throw new Error(`Missing resolution diagnostics for ${table}`);
      validateResolution(table, diagnostics);
    }
    migration.upDrizzle(db);
  },
} satisfies TunarrDatabaseMigrationWithDrizzle;
