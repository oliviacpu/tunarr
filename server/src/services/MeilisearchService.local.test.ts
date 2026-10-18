import fs from 'node:fs/promises';
import path from 'node:path';
import tmp from 'tmp-promise';
import { instance, mock } from 'ts-mockito';
import type { ISettingsDB } from '../db/interfaces/ISettingsDB.ts';
import { MediaSourceDB } from '../db/mediaSourceDB.ts';
import type { GlobalOptions, ServerOptions } from '../globals.ts';
import { fileExists } from '../util/fsUtil.ts';
import { ChildProcessHelper } from '../util/ChildProcessHelper.ts';
import { FileSystemService } from './FileSystemService.ts';
import { MeilisearchService } from './MeilisearchService.ts';
import { SearchParser } from './search/SearchParser.ts';

// The search server Tunarr starts must refuse requests without its key:
// otherwise anything that can reach localhost (other users of a shared
// machine, other containers on the host network) can read and change the
// index. Runs the real binary (server/bin/meilisearch, or
// TUNARR_MEILISEARCH_PATH).
// The orphaned-process sweep uses find-process, whose default export this test
// build doesn't resolve the way the bundle does. Nothing is orphaned here.
vi.mock('find-process', () => ({
  default: { default: () => Promise.resolve([]) },
}));

const binary =
  process.env['TUNARR_MEILISEARCH_PATH'] ??
  path.join(process.cwd(), 'bin', 'meilisearch');

describe.skipIf(!(await fileExists(binary)))(
  'MeilisearchService with a real Meilisearch',
  () => {
    let dir: tmp.DirectoryResult;
    let services: MeilisearchService[];

    beforeEach(async () => {
      dir = await tmp.dir({ unsafeCleanup: true });
      services = [];
    });

    afterEach(async () => {
      for (const service of services) {
        service.stop();
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      await dir.cleanup();
    });

    function makeService() {
      const options = { databaseDirectory: dir.path } as ServerOptions;
      const settings = {
        systemSettings: () => ({
          logging: { logsDirectory: dir.path },
          server: {
            searchSettings: {
              snapshotIntervalHours: 24,
              maxIndexingMemory: undefined,
            },
          },
        }),
      } as unknown as ISettingsDB;
      const service = new MeilisearchService(
        options,
        settings,
        new ChildProcessHelper(),
        new FileSystemService(options as unknown as GlobalOptions),
        new SearchParser(instance(mock(MediaSourceDB))),
      );
      services.push(service);
      return service;
    }

    test('refuses requests without its key, and keeps the key across restarts', async () => {
      const first = makeService();
      await first.start();

      const keyPath = path.join(dir.path, 'meilisearch-master-key');
      const key = (await fs.readFile(keyPath, 'utf-8')).trim();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      // Readable by Tunarr's user only
      expect((await fs.stat(keyPath)).mode & 0o777).toBe(0o600);

      const url = `http://localhost:${first.getPort()}/indexes`;
      expect((await fetch(url)).status).toBe(401);
      expect(
        (await fetch(url, { headers: { Authorization: 'Bearer wrong' } }))
          .status,
      ).toBe(403);
      // Tunarr's own client sends the key
      await expect(first.client().getIndexes()).resolves.toBeDefined();

      first.stop();
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const second = makeService();
      await second.start();
      expect((await fs.readFile(keyPath, 'utf-8')).trim()).toBe(key);
      await expect(second.client().getIndexes()).resolves.toBeDefined();
    });
  },
);
