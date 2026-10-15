import { Worker } from 'node:worker_threads';

export type FakePlex = {
  /** Base URL to use as the Plex media source's `uri`. */
  url: string;
  /** Plex's library section key for the movies (a library's externalKey). */
  sectionId: number;
  /** Plex rating key of the playlist holding every movie. */
  playlistId: string;
  movieCount: number;
  close: () => Promise<void>;
};

/**
 * Starts a stand-in Plex server with `movieCount` movies in one section and
 * one playlist (fakePlexServer.mjs). It runs in a worker thread, so answering
 * the requests of the code under test doesn't land on the thread being
 * measured.
 */
export async function startFakePlex(movieCount: number): Promise<FakePlex> {
  const sectionId = 1;
  const playlistId = '90001';
  const worker = new Worker(new URL('./fakePlexServer.mjs', import.meta.url), {
    workerData: { movieCount, sectionId, playlistId },
  });
  const url = await new Promise<string>((resolve, reject) => {
    worker.once('message', (message: { type: string; url: string }) =>
      resolve(message.url),
    );
    worker.once('error', reject);
    worker.once('exit', (code) =>
      reject(new Error(`Fake Plex server exited with code ${code}`)),
    );
  });
  return {
    url,
    sectionId,
    playlistId,
    movieCount,
    close: async () => {
      const exited = new Promise<void>((resolve) =>
        worker.once('exit', () => resolve()),
      );
      worker.postMessage('close');
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref()),
      ]);
      await worker.terminate();
    },
  };
}
