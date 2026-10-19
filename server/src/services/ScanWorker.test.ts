import { randomUUID } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type {
  ScanJob,
  ScanOutcome,
  ScanWorkerMessage,
} from '../types/worker_schemas.ts';
import { ScanWorkerProtocolVersion } from '../types/worker_schemas.ts';
import { ScanWorker } from './ScanWorker.ts';
import { MediaSourceProgressService } from './scanner/MediaSourceProgressService.ts';
import type { ScanJobExecutor } from './scanner/ScanJobExecutor.ts';

const job: ScanJob = { kind: 'library', libraryId: 'lib1', force: false };

function makeSut(
  run: (job: ScanJob, signal: AbortSignal) => Promise<ScanOutcome>,
  { mainProtocolVersion }: { mainProtocolVersion?: number } = {},
) {
  const progress = new MediaSourceProgressService();
  const executor = { run: vi.fn(run) };
  const worker = new ScanWorker(
    executor as unknown as ScanJobExecutor,
    progress,
  );
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  Object.defineProperty(worker, 'logger', { value: logger });
  const { port1, port2 } = new MessageChannel();
  const received: ScanWorkerMessage[] = [];
  port2.on('message', (message: ScanWorkerMessage) => received.push(message));
  const exit = vi.fn();
  worker.start(port1, { exit, mainProtocolVersion });
  const send = (message: unknown) => port2.postMessage(message);
  const close = () => {
    port1.close();
    port2.close();
  };
  return { progress, executor, received, send, exit, close, logger };
}

const ofType = <T extends ScanWorkerMessage['type']>(
  received: ScanWorkerMessage[],
  type: T,
) =>
  received.filter(
    (m): m is Extract<ScanWorkerMessage, { type: T }> => m.type === type,
  );

describe('ScanWorker', () => {
  let close: () => void = () => {};

  afterEach(() => {
    close();
  });

  test('says it started, runs a job and reports its outcome', async () => {
    const sut = makeSut(() => Promise.resolve('completed'));
    close = sut.close;
    const jobId = randomUUID();

    sut.send({ type: 'scan', jobId, job });

    await vi.waitFor(() =>
      expect(ofType(sut.received, 'scan-done')).toEqual([
        { type: 'scan-done', jobId, outcome: 'completed' },
      ]),
    );
    expect(sut.received[0]).toMatchObject({
      type: 'event',
      eventType: 'started',
    });
    expect(sut.executor.run).toHaveBeenCalledWith(job, expect.any(AbortSignal));
  });

  test("relays the job's progress, one message per whole percent", async () => {
    let progress: MediaSourceProgressService | undefined;
    const sut = makeSut(() => {
      progress?.scanStarted('lib1');
      progress?.scanProgress('lib1', 10.2);
      progress?.scanProgress('lib1', 10.4);
      progress?.scanProgress('lib1', Number.NaN);
      progress?.scanProgress('lib1', 11);
      progress?.scanEnded('lib1');
      return Promise.resolve('completed');
    });
    progress = sut.progress;
    close = sut.close;
    const jobId = randomUUID();

    sut.send({ type: 'scan', jobId, job });

    await vi.waitFor(() =>
      expect(ofType(sut.received, 'scan-done')).toHaveLength(1),
    );
    expect(
      ofType(sut.received, 'scan-progress').map((m) => [
        m.event,
        m.percentComplete,
      ]),
    ).toEqual([
      ['started', undefined],
      ['progress', 10],
      ['progress', 11],
      ['ended', undefined],
    ]);
  });

  test('reports a job that throws', async () => {
    const sut = makeSut(() => Promise.reject(new Error('server went away')));
    close = sut.close;
    const jobId = randomUUID();

    sut.send({ type: 'scan', jobId, job });

    await vi.waitFor(() =>
      expect(ofType(sut.received, 'scan-failed')).toEqual([
        { type: 'scan-failed', jobId, message: 'server went away' },
      ]),
    );
  });

  test('a cancel aborts the running job', async () => {
    const sut = makeSut(
      (_job, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve('canceled'));
        }),
    );
    close = sut.close;
    const jobId = randomUUID();

    sut.send({ type: 'scan', jobId, job });
    await vi.waitFor(() => expect(sut.executor.run).toHaveBeenCalled());
    sut.send({ type: 'cancel', jobId: randomUUID() }); // another job: ignored
    sut.send({ type: 'cancel', jobId });

    await vi.waitFor(() =>
      expect(ofType(sut.received, 'scan-done')).toEqual([
        { type: 'scan-done', jobId, outcome: 'canceled' },
      ]),
    );
  });

  test('refuses a second job while one is running', async () => {
    let finish: (outcome: ScanOutcome) => void = () => {};
    const sut = makeSut(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    close = sut.close;
    const first = randomUUID();
    const second = randomUUID();

    sut.send({ type: 'scan', jobId: first, job });
    await vi.waitFor(() => expect(sut.executor.run).toHaveBeenCalled());
    sut.send({ type: 'scan', jobId: second, job });

    await vi.waitFor(() =>
      expect(ofType(sut.received, 'scan-failed').map((m) => m.jobId)).toEqual([
        second,
      ]),
    );
    finish('completed');
    await vi.waitFor(() =>
      expect(ofType(sut.received, 'scan-done').map((m) => m.jobId)).toEqual([
        first,
      ]),
    );
    expect(sut.executor.run).toHaveBeenCalledTimes(1);
  });

  test('ignores malformed requests and exits on shutdown', async () => {
    const sut = makeSut(() => Promise.resolve('completed'));
    close = sut.close;

    sut.send({ type: 'scan', jobId: 'not-a-uuid', job });
    sut.send({ hello: 'world' });
    sut.send({ type: 'shutdown' });

    await vi.waitFor(() => expect(sut.exit).toHaveBeenCalledWith(0));
    expect(sut.executor.run).not.toHaveBeenCalled();
  });

  describe('protocol version', () => {
    test("says it started with this build's version", async () => {
      const sut = makeSut(() => Promise.resolve('completed'), {
        mainProtocolVersion: ScanWorkerProtocolVersion,
      });
      close = sut.close;

      await vi.waitFor(() =>
        expect(sut.received[0]).toMatchObject({
          type: 'event',
          eventType: 'started',
          protocolVersion: ScanWorkerProtocolVersion,
        }),
      );
      expect(sut.logger.warn).not.toHaveBeenCalled();
    });

    test("says so when the main thread's version differs", async () => {
      const sut = makeSut(() => Promise.resolve('completed'), {
        mainProtocolVersion: ScanWorkerProtocolVersion + 1,
      });
      close = sut.close;

      await vi.waitFor(() => expect(sut.received).toHaveLength(1));
      expect(sut.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('protocol'),
        ScanWorkerProtocolVersion + 1,
        ScanWorkerProtocolVersion,
      );
      // Its own version still goes out; the main thread decides
      expect(sut.received[0]).toMatchObject({
        protocolVersion: ScanWorkerProtocolVersion,
      });
    });
  });
});
