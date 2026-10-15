import { isNonEmptyString } from '@tunarr/shared/util';
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
        // Collections saved before keywords had their own column kept free
        // text in the filter column. Migration 0037 gave them NULL keywords,
        // and the API has written a string there ever since. Any other
        // filter is a structured one that should stay a filter, even if it
        // doesn't parse.
        if (collection.keywords !== null) {
          this.logger.warn(
            'Collection %s has an unparseable filter. It will not work as expected.',
            collection.name,
          );
          continue;
        }

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
      // into keywords (`keywords: collection.filter`) and left the filter in
      // place. Now that the filter parses, that copy runs as a full text
      // search that matches the wrong programs. Only an exact copy is proof
      // of that: keywords that differ from the filter may be what the user
      // typed, even if they look like a filter, so they stay.
      if (collection.keywords === collection.filter) {
        this.logger.info(
          'Clearing keywords of smart collection %s: they are a copy of its filter',
          collection.name,
        );
        // An empty string, not NULL, which marks collections saved before
        // the keywords column.
        await this.smartCollectionDB.updateStoredQuery(collection.uuid, {
          keywords: '',
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
