import type { ProgramExternalIdType } from '@/db/custom_types/ProgramExternalIdType.js';
import { KEYS } from '@/types/inject.js';
import type { Maybe } from '@/types/util.js';
import { isNonEmptyString } from '@/util/index.js';
import { inject, injectable } from 'inversify';
import type { Kysely } from 'kysely';
import { chunk, isEmpty, uniq } from 'lodash-es';
import { throttledAccumulate, throttledLoop } from '../../util/seq.ts';
import { databaseFileWarmer } from '../databaseFileWarmer.ts';
import type { ProgramExternalId } from '../schema/ProgramExternalId.ts';
import { ProgramGroupingType } from '../schema/ProgramGrouping.ts';
import type { DB } from '../schema/db.ts';
import type {
  ProgramGroupingOrmWithRelations,
  ProgramOrmWithExternalIds,
  ProgramWithRelationsOrm,
} from '../schema/derivedTypes.ts';
import type { DrizzleDBAccess } from '../schema/index.ts';
import {
  GuideProgramRelations,
  GuideProgramRelationsWithCreditArtwork,
  GuideShowRelations,
  GuideShowRelationsWithCreditArtwork,
  LineupProgramRelations,
  MaterializedProgramRelations,
  ProgramStreamRelations,
  StreamProgramRelations,
} from './programRelations.ts';

// Programs per guide query. One query is one synchronous slice of the event
// loop, and its cost is the database pages it reads: the 811 programs of the
// shared server's 72-hour guide read about 6,000 pages, 400 to 2,500 per query
// of 200, which took 12 to 76 s per query at that disk's 30 ms per read. A
// quarter of that bounds the slice when the file cache is cold anyway, and
// costs nothing measurable when it is warm.
export const GuideFetchBatchSize = 50;

export type GuideProgramsFetchOptions = {
  includeCreditArtwork: boolean;
  // Read the database file into the operating system's file cache first (see
  // databaseFileWarmer), so the queries never wait on the disk. Guide builds
  // set it; it runs at most once per cooldown.
  readDatabaseIntoFileCache?: boolean;
};

@injectable()
export class BasicProgramRepository {
  constructor(
    @inject(KEYS.Database) private db: Kysely<DB>,
    @inject(KEYS.DrizzleDB) private drizzleDB: DrizzleDBAccess,
  ) {}

  async getProgramById(id: string): Promise<Maybe<ProgramOrmWithExternalIds>> {
    return this.drizzleDB.query.program.findFirst({
      where: (fields, { eq }) => eq(fields.uuid, id),
      with: {
        ...MaterializedProgramRelations,
        ...ProgramStreamRelations,
      },
    });
  }

  async getLineupProgramById(
    id: string,
  ): Promise<Maybe<ProgramOrmWithExternalIds>> {
    return this.drizzleDB.query.program.findFirst({
      where: (fields, { eq }) => eq(fields.uuid, id),
      with: LineupProgramRelations,
    });
  }

  async getStreamProgramById(
    id: string,
  ): Promise<Maybe<ProgramOrmWithExternalIds>> {
    return this.drizzleDB.query.program.findFirst({
      where: (fields, { eq }) => eq(fields.uuid, id),
      with: StreamProgramRelations,
    });
  }

  async getProgramExternalIds(
    id: string,
    externalIdTypes?: ProgramExternalIdType[],
  ): Promise<ProgramExternalId[]> {
    return await this.db
      .selectFrom('programExternalId')
      .selectAll()
      .where('programExternalId.programUuid', '=', id)
      .$if(!isEmpty(externalIdTypes), (qb) =>
        qb.where('programExternalId.sourceType', 'in', externalIdTypes!),
      )
      .execute();
  }

  async getShowIdFromTitle(title: string): Promise<Maybe<string>> {
    const matchedGrouping = await this.db
      .selectFrom('programGrouping')
      .select('uuid')
      .where('title', '=', title)
      .where('type', '=', ProgramGroupingType.Show)
      .executeTakeFirst();

    return matchedGrouping?.uuid;
  }

  async updateProgramDuration(
    programId: string,
    duration: number,
  ): Promise<void> {
    await this.db
      .updateTable('program')
      .where('uuid', '=', programId)
      .set({
        duration,
      })
      .executeTakeFirst();
  }

  async getProgramsByIds(
    ids: string[] | readonly string[],
    batchSize: number = 500,
  ): Promise<ProgramOrmWithExternalIds[]> {
    return await throttledAccumulate(
      chunk(uniq(ids), batchSize),
      async (idChunk) => {
        return await this.drizzleDB.query.program.findMany({
          where: (fields, { inArray }) => inArray(fields.uuid, idChunk),
          with: MaterializedProgramRelations,
        });
      },
    );
  }

  async getGuideProgramsByIds(
    ids: string[] | readonly string[],
    {
      includeCreditArtwork,
      readDatabaseIntoFileCache = false,
    }: GuideProgramsFetchOptions,
    batchSize: number = GuideFetchBatchSize,
  ): Promise<ProgramWithRelationsOrm[]> {
    // better-sqlite3 is synchronous, so awaiting a query never lets other
    // requests in. Yield between chunks so the load runs as short slices.
    // Each slice is only short while the database's pages are in memory:
    // reading them in first keeps them from becoming disk waits.
    if (readDatabaseIntoFileCache && ids.length > 0) {
      await databaseFileWarmer.warm();
    }
    const programs: Omit<ProgramWithRelationsOrm, 'show'>[] = [];
    await throttledLoop(chunk(uniq(ids), batchSize), async (idChunk) => {
      const res = includeCreditArtwork
        ? await this.drizzleDB.query.program.findMany({
            where: (fields, { inArray }) => inArray(fields.uuid, idChunk),
            with: GuideProgramRelationsWithCreditArtwork,
          })
        : await this.drizzleDB.query.program.findMany({
            where: (fields, { inArray }) => inArray(fields.uuid, idChunk),
            with: GuideProgramRelations,
          });
      programs.push(...res);
    });

    // Each show loads once and is shared by its episodes.
    const showIds = uniq(
      programs.flatMap(({ tvShowUuid }) =>
        isNonEmptyString(tvShowUuid) ? [tvShowUuid] : [],
      ),
    );
    const showsById = new Map<string, ProgramGroupingOrmWithRelations>();
    await throttledLoop(chunk(showIds, batchSize), async (idChunk) => {
      const res = includeCreditArtwork
        ? await this.drizzleDB.query.programGrouping.findMany({
            where: (fields, { inArray }) => inArray(fields.uuid, idChunk),
            with: GuideShowRelationsWithCreditArtwork,
          })
        : await this.drizzleDB.query.programGrouping.findMany({
            where: (fields, { inArray }) => inArray(fields.uuid, idChunk),
            with: GuideShowRelations,
          });
      for (const show of res) {
        showsById.set(show.uuid, show);
      }
    });

    return programs.map((program) => ({
      ...program,
      show: isNonEmptyString(program.tvShowUuid)
        ? (showsById.get(program.tvShowUuid) ?? null)
        : null,
    }));
  }

  async getLineupProgramsByIds(
    ids: string[] | readonly string[],
    batchSize: number = 500,
  ): Promise<ProgramOrmWithExternalIds[]> {
    return await throttledAccumulate(
      chunk(uniq(ids), batchSize),
      async (idChunk) => {
        return await this.drizzleDB.query.program.findMany({
          where: (fields, { inArray }) => inArray(fields.uuid, idChunk),
          with: LineupProgramRelations,
        });
      },
    );
  }

  /**
   * Given an array of program IDs, return the set of those IDs which exist in
   * the database.
   */
  async filterNonExistentProgramIds(
    programIds: string[],
  ): Promise<Set<string>> {
    const uniqIds = uniq(programIds);
    if (uniqIds.length === 0) {
      return new Set();
    }

    const promises = chunk(programIds, 500).map((programChunk) =>
      this.drizzleDB.query.program.findMany({
        where: (fields, { inArray }) => inArray(fields.uuid, programChunk),
        columns: {
          uuid: true,
        },
      }),
    );

    const allPrograms = await Promise.all(promises);

    return new Set([...allPrograms.flat().map(({ uuid }) => uuid)]);
  }
}
