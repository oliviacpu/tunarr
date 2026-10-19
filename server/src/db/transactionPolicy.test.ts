import glob from 'fast-glob';
import fs from 'node:fs/promises';

test('production code does not introduce implicit DEFERRED transactions', async () => {
  const files = await glob('src/**/*.ts', {
    ignore: [
      '**/*.test.ts',
      'src/testing/**',
      'src/generated/**',
      'src/migration/**',
    ],
  });
  const violations: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    if (
      /\.transaction\s*\(\s*\)\s*\.\s*execute\s*\(/.test(source) ||
      /(['"`])BEGIN(?:\s+DEFERRED)?(?:\s+TRANSACTION)?\1/i.test(source)
    ) {
      violations.push(file);
    }
  }
  expect(
    violations,
    'Use configured Drizzle transactions or explicit BEGIN IMMEDIATE',
  ).toEqual([]);
});
