import path from 'node:path';

// Ports sit away from the dev defaults (8000, 5173, 7700) so the suite can
// run while a dev server is up. Each parallel worktree can choose an offset.
const portOffset = Number(process.env.TUNARR_E2E_PORT_OFFSET ?? 0);
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 47535) {
  throw new Error('TUNARR_E2E_PORT_OFFSET must be an integer from 0 to 47535');
}

export const SERVER_PORT = 18000 + portOffset;
export const SEARCH_PORT = 17700 + portOffset;
export const WEB_PORT = 15173 + portOffset;

export const SERVER_URL = `http://localhost:${SERVER_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

export const E2E_ROOT = path.resolve(import.meta.dirname, '..');
export const REPO_ROOT = path.resolve(E2E_ROOT, '..');
export const DATA_DIR = path.join(E2E_ROOT, '.data');
export const DB_DIR = path.join(DATA_DIR, 'db');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');

// Written by the seed step and read by the specs.
export const FIXTURE_IDS_FILE = path.join(DATA_DIR, 'fixture.json');
