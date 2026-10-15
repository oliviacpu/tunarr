import type {
  ProgramCanonicalIdLookupResult,
  ProgramGroupingCanonicalIdLookupResult,
} from '@/db/interfaces/IProgramDB.js';
import { KEYS } from '@/types/inject.js';
import { sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import type { Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/sqlite';
import { last } from 'lodash-es';
import type { Dictionary, StrictExclude } from 'ts-essentials';
import { match } from 'ts-pattern';
import { AllProgramFields } from '../programQueryHelpers.ts';
import type { ProgramType } from '../schema/Program.ts';
import type { ProgramGroupingType } from '../schema/ProgramGrouping.ts';
import type { MediaSourceId, MediaSourceType } from '../schema/base.ts';
import type { DB } from '../schema/db.ts';
import type { DrizzleDBAccess } from '../schema/index.ts';
import { isDefined } from '../../util/index.ts';
import type { ProgramDao } from '../schema/Program.ts';
import { MaterializedProgramRelations } from './programRelations.ts';

function prepareLibraryProgramsPageQuery(drizzleDB: DrizzleDBAccess) {
  return drizzleDB.query.program
    .findMany({
      where: (fields, { and, eq, gt }) =>
        and(
          eq(fields.libraryId, sql.placeholder('libraryId')),
          gt(fields.uuid, sql.placeholder('afterUuid')),
        ),
      orderBy: (fields, { asc }) => asc(fields.uuid),
      limit: sql.placeholder('limit'),
      with: MaterializedProgramRelations,
    })
    .prepare();
}

type LibraryProgramsPageQuery = ReturnType<
  typeof prepareLibraryProgramsPageQuery
>;

@injectable()
export class ProgramSearchRepository {
  constructor(
    @inject(KEYS.Database) private db: Kysely<DB>,
    @inject(KEYS.DrizzleDB) private drizzleDB: DrizzleDBAccess,
  ) {}

  async getProgramsForMediaSource(
    mediaSourceId: MediaSourceId,
    type?: ProgramType,
  ): Promise<ProgramDao[]> {
    return this.db
      .selectFrom('mediaSource')
      .where('mediaSource.uuid', '=', mediaSourceId)
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('program')
            .select(AllProgramFields)
            .$if(isDefined(type), (eb) => eb.where('program.type', '=', type!))
            .whereRef('mediaSource.uuid', '=', 'program.mediaSourceId'),
        ).as('programs'),
      )
      .executeTakeFirst()
      .then((dbResult) => dbResult?.programs ?? []);
  }

  async getMediaSourceLibraryPrograms(libraryId: string) {
    return this.drizzleDB.query.program.findMany({
      where: (fields, { eq }) => eq(fields.libraryId, libraryId),
      with: MaterializedProgramRelations,
    });
  }

  /**
   * One page of {@link getMediaSourceLibraryPrograms}, in uuid order: the
   * programs after `afterUuid` (from the start when undefined). better-sqlite3
   * is synchronous, so a whole large library in one query blocks every other
   * request until it returns; callers page through it and yield in between.
   *
   * The query is prepared once and reused: building and compiling its nested
   * relation subqueries for every page cost about as much as reading the page.
   */
  async getMediaSourceLibraryProgramsPage(
    libraryId: string,
    afterUuid: string | undefined,
    limit: number,
  ) {
    this.libraryProgramsPageQuery ??= prepareLibraryProgramsPageQuery(
      this.drizzleDB,
    );
    return this.libraryProgramsPageQuery.execute({
      libraryId,
      // Every uuid sorts after the empty string.
      afterUuid: afterUuid ?? '',
      limit,
    });
  }

  private libraryProgramsPageQuery?: LibraryProgramsPageQuery;

  async getProgramInfoForMediaSource(
    mediaSourceId: MediaSourceId,
    type: ProgramType,
    parentFilter?: [ProgramGroupingType, string],
  ): Promise<Dictionary<ProgramCanonicalIdLookupResult>> {
    const results = await this.drizzleDB.query.program.findMany({
      where: (fields, { eq, and, isNotNull }) => {
        const parentField = match([type, parentFilter?.[0]])
          .with(['episode', 'show'], () => fields.tvShowUuid)
          .with(['episode', 'season'], () => fields.seasonUuid)
          .with(['track', 'album'], () => fields.albumUuid)
          .with(['track', 'artist'], () => fields.artistUuid)
          .otherwise(() => null);

        return and(
          eq(fields.mediaSourceId, mediaSourceId),
          eq(fields.type, type),
          isNotNull(fields.canonicalId),
          parentField && parentFilter
            ? eq(parentField, parentFilter[1])
            : undefined,
        );
      },
    });

    const grouped: Dictionary<ProgramCanonicalIdLookupResult> = {};
    for (const result of results) {
      if (!result.canonicalId || !result.libraryId) {
        continue;
      }
      grouped[result.externalKey] = {
        canonicalId: result.canonicalId,
        externalKey: result.externalKey,
        libraryId: result.libraryId,
        uuid: result.uuid,
        state: result.state,
      };
    }

    return grouped;
  }

  async getProgramInfoForMediaSourceLibrary(
    mediaSourceLibraryId: string,
    type: ProgramType,
    parentFilter?: [ProgramGroupingType, string],
  ): Promise<Dictionary<ProgramCanonicalIdLookupResult>> {
    const grouped: Dictionary<ProgramCanonicalIdLookupResult> = {};
    for await (const result of this.getProgramInfoForMediaSourceLibraryAsync(
      mediaSourceLibraryId,
      type,
      parentFilter,
    )) {
      grouped[result.externalKey] = {
        canonicalId: result.canonicalId,
        externalKey: result.externalKey,
        libraryId: result.libraryId,
        uuid: result.uuid,
        state: result.state,
      };
    }

    return grouped;
  }

  async *getProgramInfoForMediaSourceLibraryAsync(
    mediaSourceLibraryId: string,
    type: ProgramType,
    parentFilter?: [ProgramGroupingType, string],
  ): AsyncGenerator<ProgramCanonicalIdLookupResult> {
    let lastId: string | undefined;
    for (;;) {
      const page = await this.drizzleDB.query.program.findMany({
        where: (fields, { eq, and, isNotNull, gt }) => {
          const parentField = match([type, parentFilter?.[0]])
            .with(['episode', 'show'], () => fields.tvShowUuid)
            .with(['episode', 'season'], () => fields.seasonUuid)
            .with(['track', 'album'], () => fields.albumUuid)
            .with(['track', 'artist'], () => fields.artistUuid)
            .otherwise(() => null);

          return and(
            eq(fields.libraryId, mediaSourceLibraryId),
            eq(fields.type, type),
            isNotNull(fields.canonicalId),
            parentField && parentFilter
              ? eq(parentField, parentFilter[1])
              : undefined,
            lastId ? gt(fields.uuid, lastId) : undefined,
          );
        },
        orderBy: (fields, ops) => ops.asc(fields.uuid),
        columns: {
          uuid: true,
          canonicalId: true,
          libraryId: true,
          externalKey: true,
          state: true,
        },
        limit: 500,
      });

      if (page.length === 0) {
        return;
      }

      lastId = last(page)?.uuid;
      for (const item of page) {
        yield {
          externalKey: item.externalKey,
          canonicalId: item.canonicalId,
          uuid: item.uuid,
          libraryId: item.libraryId,
          state: item.state,
        };
      }
    }
  }

  async getExistingProgramGroupingDetails(
    mediaSourceLibraryId: string,
    type: ProgramGroupingType,
    sourceType: StrictExclude<MediaSourceType, 'local'>,
    parentFilter?: string,
  ): Promise<Dictionary<ProgramGroupingCanonicalIdLookupResult>> {
    const results = await this.drizzleDB.query.programGrouping.findMany({
      where: (fields, { and, eq, isNotNull }) => {
        const parentField = match(type)
          .with('album', () => fields.artistUuid)
          .with('season', () => fields.showUuid)
          .otherwise(() => null);
        return and(
          eq(fields.libraryId, mediaSourceLibraryId),
          eq(fields.type, type),
          isNotNull(fields.canonicalId),
          parentField && parentFilter
            ? eq(parentField, parentFilter)
            : undefined,
        );
      },
      with: {
        externalIds: {
          where: (fields, { eq }) => eq(fields.sourceType, sourceType),
        },
      },
      columns: {
        uuid: true,
        canonicalId: true,
        libraryId: true,
        externalKey: true,
      },
    });

    const grouped: Dictionary<ProgramGroupingCanonicalIdLookupResult> = {};
    for (const result of results) {
      const key = result.externalKey ?? result.externalIds[0]?.externalKey;
      if (!key) {
        continue;
      }

      grouped[key] = {
        canonicalId: result.canonicalId,
        externalKey: key,
        libraryId: result.libraryId!,
        uuid: result.uuid,
      };
    }

    return grouped;
  }
}
