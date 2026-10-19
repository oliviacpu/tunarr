import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { ServerOptions } from '../globals.ts';
import {
  ScanWorkerProtocolVersion,
  WorkerStartData,
} from '../types/worker_schemas.ts';
import { workerEntryUrl, workerStartData } from './TunarrSubprocessService.ts';

describe('workerStartData', () => {
  const defaults = { port: 8000 } as unknown as ServerOptions;

  test('without workerData from the caller: server options, role and version', () => {
    expect(workerStartData(undefined, 'scan', () => defaults)).toEqual({
      serverOptions: defaults,
      role: 'scan',
      protocolVersion: ScanWorkerProtocolVersion,
    });
  });

  test("keeps the caller's workerData, and still sets the role and version", () => {
    const data = workerStartData(
      { note: 'from the caller', role: 'pool' },
      'scan',
      () => defaults,
    );

    expect(data).toEqual({
      note: 'from the caller',
      serverOptions: defaults,
      role: 'scan',
      protocolVersion: ScanWorkerProtocolVersion,
    });
    // What start-worker reads from it
    expect(WorkerStartData.parse(structuredClone(data))).toEqual({
      role: 'scan',
      protocolVersion: ScanWorkerProtocolVersion,
    });
  });

  test("keeps the caller's own server options", () => {
    const own = { port: 9000 };
    const fallback = vi.fn(() => defaults);

    expect(
      workerStartData({ serverOptions: own }, 'pool', fallback).serverOptions,
    ).toBe(own);
    expect(fallback).not.toHaveBeenCalled();
  });

  test('workerData that is not an object is replaced', () => {
    expect(workerStartData('scan', 'scan', () => defaults)).toEqual({
      serverOptions: defaults,
      role: 'scan',
      protocolVersion: ScanWorkerProtocolVersion,
    });
  });
});

describe('WorkerStartData', () => {
  test.each([
    ['no workerData', undefined],
    ['no role', { serverOptions: {} }],
    ['an unknown role', { role: 'transcode' }],
  ])('a worker started with %s is a pool worker', (_label, workerData) => {
    expect(WorkerStartData.parse(workerData).role).toBe('pool');
  });
});

/**
 * The Windows cases here run on any platform.
 *
 * `new URL()` parsing is defined by the WHATWG URL spec, not by the host OS, so
 * a Windows-shaped path misparses identically on Linux. That makes the bug this
 * guards against reproducible in CI without a Windows runner.
 */
describe('workerEntryUrl', () => {
  test('produces a file: URL for a POSIX absolute path', () => {
    const url = workerEntryUrl('/opt/tunarr/dist/bundle.cjs');

    expect(url.protocol).toBe('file:');
    expect(url.href).toBe('file:///opt/tunarr/dist/bundle.cjs');
  });

  test('round-trips a real absolute path back to the same path', () => {
    const entry = path.resolve(process.cwd(), 'dist', 'bundle.cjs');

    expect(workerEntryUrl(entry).protocol).toBe('file:');
  });

  describe('the resolution that used to be here', () => {
    // Regression guard. Restoring `new URL(entryPath, import.meta.url)` would
    // reintroduce a bug that only ever showed up in the packaged Windows build,
    // where process.argv[1] is a drive-letter path.
    const base = 'file:///opt/tunarr/dist/bundle.cjs';

    test.each([
      ['backslashes', 'C:\\Program Files\\Tunarr\\bundle.cjs'],
      ['forward slashes', 'C:/Program Files/Tunarr/bundle.cjs'],
    ])(
      'new URL() parses a Windows path with %s as a "c:" scheme, not a file URL',
      (_label, windowsPath) => {
        const wrong = new URL(windowsPath, base);

        // The drive letter is taken as the URL scheme, so the base is ignored
        // entirely and Worker is handed something it will not accept.
        expect(wrong.protocol).toBe('c:');
        expect(wrong.protocol).not.toBe('file:');
      },
    );

    test('a POSIX path is why this went unnoticed — it resolves fine', () => {
      expect(new URL('/opt/tunarr/dist/bundle.cjs', base).protocol).toBe(
        'file:',
      );
    });
  });
});
