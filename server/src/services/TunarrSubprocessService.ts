import { injectable } from 'inversify';
import { pathToFileURL } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { container } from '../container.ts';
import type { ServerOptions } from '../globals.ts';
import { globalOptions, serverOptions } from '../globals.ts';
import type { WorkerRole } from '../types/worker_schemas.ts';
import { ScanWorkerProtocolVersion } from '../types/worker_schemas.ts';
import { isDev } from '../util/index.ts';
import { MeilisearchService } from './MeilisearchService.ts';

@injectable()
export class TunarrSubprocessService {
  constructor() {}

  // A worker re-executes this process's own entry point (see workerArgv)
  createWorker(opts: WorkerOptions = {}, role: WorkerRole = 'pool') {
    const entry = process.argv[1];
    if (entry === undefined) {
      throw new Error('Cannot start a worker: no entry script in process.argv');
    }
    return new TsWorker(
      entry,
      {
        ...opts,
        argv: workerArgv(),
      },
      role,
    );
  }
}

/**
 * Builds the argv a worker is started with.
 *
 * The global options must be passed as real flags, not only through
 * `workerData`. A worker re-executes the CLI entry point, and its yargs
 * middleware calls `setGlobalOptions` — which is `once()`-guarded — before any
 * command handler runs. Whatever the middleware resolves is therefore final. If
 * the database directory is not on the worker's argv, yargs falls back to its
 * default (`TUNARR_DATABASE_PATH` or the platform default) and the worker
 * opens, migrates and writes to a completely different database than the server
 * that spawned it.
 */
function workerArgv(): string[] {
  const opts = globalOptions();
  const argv = [
    '--hide_banner',
    'start-worker',
    '--database',
    opts.databaseDirectory,
  ];

  // Omitted when unset. The worker then resolves the level the same way the
  // server did, from the environment or the logger default. Forwarding a
  // concrete level here would override that.
  if (opts.log_level !== undefined) {
    argv.push('--log_level', opts.log_level);
  }

  return argv;
}

/**
 * Converts the entry script path into a URL a Worker will accept.
 *
 * Must not be `new URL(entryPath, import.meta.url)`. `process.argv[1]` is a
 * filesystem path, not a URL, and on Windows an absolute one begins with a
 * drive letter: `new URL('C:\\Tunarr\\bundle.cjs', base)` parses `C:` as the
 * scheme and yields a `c:` URL rather than resolving against the base at all.
 * Worker rejects that, so the packaged Windows build could never spawn a
 * worker. `pathToFileURL` does the platform-correct conversion.
 */
export function workerEntryUrl(entryPath: string): URL {
  return pathToFileURL(entryPath);
}

/**
 * The workerData a worker starts with: the caller's, if it passed any, plus the
 * server options (unless the caller passed its own), the role and the scan
 * protocol version. The role is always set. A worker without one starts as a
 * pool worker, which says it started and then ignores the scan it's sent.
 */
export function workerStartData(
  given: unknown,
  role: WorkerRole,
  defaultServerOptions: () => ServerOptions,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof given === 'object' && given !== null && !Array.isArray(given)
      ? { ...given }
      : {};
  return {
    ...base,
    serverOptions: base.serverOptions ?? defaultServerOptions(),
    role,
    protocolVersion: ScanWorkerProtocolVersion,
  };
}

class TsWorker extends Worker {
  constructor(
    filename: string,
    options: WorkerOptions = {},
    role: WorkerRole = 'pool',
  ) {
    options.workerData = workerStartData(options.workerData, role, () => ({
      ...serverOptions(),
      searchPort: container
        .get<MeilisearchService>(MeilisearchService)
        .getPort(),
    }));

    if (isDev) {
      super(
        `import('tsx/esm/api').then(({ register }) => { register(); import('${workerEntryUrl(filename).href}') })`,
        {
          ...options,
          eval: true,
        },
      );
    } else {
      super(workerEntryUrl(filename), options);
    }
  }
}
