import { isNonEmptyString, search } from '@tunarr/shared/util';
import { inject, injectable } from 'inversify';
import { SmartCollectionsDB } from '../../db/SmartCollectionsDB.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import Fixer from './fixer.ts';

@injectable()
export class FixSmartCollectionFilters extends Fixer {
  @InjectLogger() declare protected readonly logger: Logger;

  constructor(
    @inject(SmartCollectionsDB) private smartCollectionDB: SmartCollectionsDB,
  ) {
    super();
  }

  protected async runInternal(): Promise<void> {
    const allCollections = await this.smartCollectionDB.getAllRaw();

    for (const collection of allCollections) {
      if (!isNonEmptyString(collection.filter)) {
        continue;
      }

      if (!(await this.parses(collection.filter))) {
        if (isNonEmptyString(collection.keywords)) {
          this.logger.warn(
            'Collection %s has keywords set but an unparseable filter. It will not work as expected.',
            collection.name,
          );
          continue;
        }

        // Collections saved before keywords had their own column kept free
        // text in the filter column.
        this.logger.debug(
          'Updating smart collection %s which had an unparseable filter',
          collection.name,
        );
        await this.smartCollectionDB.updateStoredQuery(collection.uuid, {
          filter: null,
          keywords: collection.filter,
        });
        continue;
      }

      // Earlier versions of this fixer copied filters they couldn't parse
      // into keywords and left the filter in place. Filters that name a
      // field by its index path (`genres.name`) didn't parse then, and do
      // now. Keywords like that are one of those copies, run as a full text
      // search that matches the wrong programs. Other keywords that parse,
      // such as `genre:horror`, may be what the user typed, so they stay.
      if (
        isNonEmptyString(collection.keywords) &&
        search.usesIndexPathFieldName(collection.keywords) &&
        (await this.parses(collection.keywords))
      ) {
        this.logger.info(
          'Clearing keywords of smart collection %s: they are a filter expression, not search keywords',
          collection.name,
        );
        await this.smartCollectionDB.updateStoredQuery(collection.uuid, {
          keywords: null,
        });
      }
    }
  }

  private async parses(query: string) {
    return (
      await this.smartCollectionDB.parseSearchQueryString(query)
    ).isSuccess();
  }
}
