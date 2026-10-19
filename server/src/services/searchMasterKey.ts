import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

export async function loadSearchMasterKey(file: string, canCreate: boolean) {
  const existing = await fs.readFile(file, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  });
  const key = existing.trim();
  if (key.length >= 16) {
    if (canCreate) await fs.chmod(file, 0o600);
    return { key, created: false };
  }
  if (!canCreate) {
    throw new Error(
      `No Meilisearch key at ${file}; the main thread creates it`,
    );
  }

  const replacement = randomBytes(32).toString('hex');
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, replacement, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return { key: replacement, created: true };
}
