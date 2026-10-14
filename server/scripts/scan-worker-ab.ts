/**
 * A/B benchmark for running library scans in a worker thread.
 *
 * Answers one question: while a library scans, does the server keep answering
 * requests on time? better-sqlite3 is synchronous, so a scan on the main thread
 * blocks it for every query and write, and the main thread also serves HLS
 * segments and the HDHomeRun stream. With TUNARR_SCAN_IN_WORKER the scan runs
 * in its own worker thread and the main thread should barely notice it.
 *
 * Both arms run the worker pool at the same size, so the only difference is
 * where the scan runs. Each trial runs the arms in alternating order (A B, then
 * B A), so a machine that gets busier partway through doesn't favour one arm.
 *
 * Each run boots a fresh copy of a migrated database, creates a local movie
 * source over --clips hard-linked copies of one short clip, and measures until
 * the initial scan has finished, plus a settle window for the duration
 * reconcile that follows it on the main thread.
 *
 * Probe latency depends on the machine as much as the server: on a busy
 * machine the server and this process wait for a CPU, and that shows up as
 * stalls in both arms. So the verdict rests on what doesn't:
 *
 * - Main-thread CPU: the CPU time the scan adds to the server's main thread
 *   (from `ps -M` on macOS, /proc on Linux). The worker arm must add at most
 *   10% of what the in-process arm does.
 * - Write-lock wait: a second connection times BEGIN IMMEDIATE every 50 ms,
 *   as a main-thread write would wait on the scan's transaction. Its p99 must
 *   stay under --slow-threshold.
 * - Worst cases (the probe's worst stall, the longest write wait) are judged
 *   against --max-stall only when this process's own event loop kept up,
 *   i.e. the machine was quiet enough for them to mean something.
 *
 * This runs outside vitest because a worker re-executes process.argv[1], which
 * under vitest is vitest's own entry point.
 *
 *   pnpm bench:scan-worker
 *   pnpm bench:scan-worker -- --clips 3000 --trials 1
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import type { ProbeSummary } from '../src/util/probeStats.ts';
import { summarizeProbes } from '../src/util/probeStats.ts';

// pnpm forwards the `--` separator itself, and parseArgs reads everything
// after a `--` as positionals
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    clips: { type: 'string', default: '1500' },
    trials: { type: 'string', default: '2' },
    'pool-size': { type: 'string', default: '2' },
    'probe-interval': { type: 'string', default: '10' },
    'slow-threshold': { type: 'string', default: '25' },
    'max-stall': { type: 'string', default: '100' },
    port: { type: 'string', default: '18097' },
    'search-port': { type: 'string', default: '18098' },
    'keep-logs': { type: 'boolean', default: false },
  },
});

const CLIPS = Number.parseInt(values.clips, 10);
const TRIALS = Number.parseInt(values.trials, 10);
const POOL_SIZE = Number.parseInt(values['pool-size'], 10);
const PROBE_INTERVAL_MS = Number.parseInt(values['probe-interval'], 10);
const SLOW_THRESHOLD_MS = Number.parseInt(values['slow-threshold'], 10);
const MAX_STALL_MS = Number.parseInt(values['max-stall'], 10);
const PORT = Number.parseInt(values.port, 10);
const SEARCH_PORT = Number.parseInt(values['search-port'], 10);
const HOST = '127.0.0.1';

const BOOT_TIMEOUT_MS = 240_000;
const SCAN_TIMEOUT_MS = 30 * 60_000;
/**
 * Probing continues this long after the scan finishes. The coordinator
 * reconciles program durations on the main thread after every job, in both
 * arms, and that work belongs in the measurement.
 */
const SETTLE_MS = 5_000;
// Idle probing before the scan, for the latency and CPU baselines
const BASELINE_MS = 5_000;

type Arm = 'in-process' | 'worker';

type RunResult = {
  arm: Arm;
  scanMs: number;
  // CPU time the scan added to the server's main thread: what it used while
  // the scan ran, less what answering the probe costs at idle
  mainCpuMs: number | undefined;
  // How long a write had to wait for the write lock while the scan ran
  writeWait: ProbeSummary;
  // How far this process's own event loop fell behind: the share of probe
  // latency that is the machine being busy, not the server
  benchLagMaxMs: number;
  probe: ProbeSummary;
  baseline: ProbeSummary;
  programs: number;
};

// A probe slower than the threshold, and when it was due (epoch ms)
type SlowProbe = { at: number; ms: number };

function log(msg: string) {
  console.log(msg);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await delay(intervalMs);
  }
  return false;
}

// Where a binary is on this machine; undefined if not installed
function which(binary: string): string | undefined {
  try {
    return execFileSync('which', [binary]).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

/** One short clip, hard-linked into CLIPS movie folders. */
async function makeMedia(mediaDir: string): Promise<string> {
  const source = path.join(mediaDir, 'source.mkv');
  execFileSync('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y'],
    ...['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440'],
    ...['-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'],
    source,
  ]);
  const moviesDir = path.join(mediaDir, 'movies');
  for (let i = 1; i <= CLIPS; i++) {
    const name = `Bench Movie ${String(i).padStart(5, '0')} (2001)`;
    await fs.mkdir(path.join(moviesDir, name), { recursive: true });
    await fs.link(source, path.join(moviesDir, name, `${name}.mkv`));
  }
  return moviesDir;
}

function startServer(
  dataDir: string,
  scanInWorker: boolean,
): { child: ChildProcessWithoutNullStreams; getOutput: () => string } {
  let output = '';
  const child = spawn(
    path.resolve('node_modules/.bin/tsx'),
    [
      'src/index.ts',
      'server',
      '--database',
      dataDir,
      '--port',
      String(PORT),
      '--hide_banner',
    ],
    {
      // Own process group, so teardown reaches meilisearch too
      detached: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        TUNARR_USE_WORKER_POOL: 'true',
        TUNARR_WORKER_POOL_SIZE: String(POOL_SIZE),
        TUNARR_SCAN_IN_WORKER: scanInWorker ? 'true' : 'false',
        // Debug logging is formatted and written on the main thread and would
        // show up as probe latency
        TUNARR_LOG_LEVEL: 'info',
        TUNARR_DATABASE_PATH: dataDir,
        TUNARR_BIND_ADDR: HOST,
        TUNARR_SEARCH_PORT: String(SEARCH_PORT),
      },
    },
  );
  const collect = (c: Buffer) => (output += c.toString());
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return { child, getOutput: () => output };
}

/** Signals the server's whole process group, so meilisearch goes down with it. */
function signalGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
) {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* nothing left to signal */
    }
  }
}

async function stopServer(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) {
    return;
  }
  signalGroup(child, 'SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((r) => child.once('exit', () => r(true))),
    delay(15_000).then(() => false),
  ]);
  if (!exited) {
    signalGroup(child, 'SIGKILL');
    await delay(500);
  }
}

async function api(
  method: 'GET' | 'POST' | 'PUT',
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://${HOST}:${PORT}/api${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, text: await res.text() };
}

// A keep-alive agent, so connection setup isn't charged to probe latency
const probeAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });

/**
 * One probe request. `/api/xmltv-last-refresh` is an in-memory lookup with no
 * database access, so its latency is the event loop being unavailable.
 */
function probeOnce(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: '/api/xmltv-last-refresh',
        agent: probeAgent,
        timeout: 30_000,
      },
      (res) => {
        res.resume();
        res.once('end', () =>
          resolve(res.statusCode !== undefined && res.statusCode < 400),
        );
      },
    );
    req.once('error', () => resolve(false));
    req.once('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Probes on a fixed cadence and records each call's latency from when it was
 * due, not when it was sent: a stall between two probes only delays the next
 * send, and a player waiting on its next segment waits from when it asked.
 * `mark()` splits the idle baseline from the loaded period.
 */
function startProbe(): {
  mark: () => void;
  stop: () => Promise<{
    baseline: ProbeSummary;
    loaded: ProbeSummary;
    slow: SlowProbe[];
  }>;
} {
  const samples: number[] = [];
  const slow: SlowProbe[] = [];
  let failures = 0;
  let baselineFailures = 0;
  let splitAt: number | undefined;
  let stopped = false;

  const loop = (async () => {
    let intendedAt = performance.now();
    while (!stopped) {
      const now = performance.now();
      if (now < intendedAt) {
        await delay(intendedAt - now);
      }
      const dueAt = intendedAt;
      if (!(await probeOnce())) {
        failures++;
      }
      const completedAt = performance.now();
      const ms = Math.max(0, completedAt - dueAt);
      samples.push(ms);
      if (splitAt !== undefined && ms > SLOW_THRESHOLD_MS) {
        slow.push({ at: Date.now() - (completedAt - dueAt), ms });
      }
      intendedAt = Math.max(completedAt, dueAt + PROBE_INTERVAL_MS);
    }
  })();

  return {
    mark: () => {
      splitAt = samples.length;
      baselineFailures = failures;
    },
    stop: async () => {
      stopped = true;
      await loop;
      const split = splitAt ?? 0;
      return {
        baseline: summarizeProbes(
          samples.slice(0, split),
          baselineFailures,
          SLOW_THRESHOLD_MS,
        ),
        loaded: summarizeProbes(
          samples.slice(split),
          failures - baselineFailures,
          SLOW_THRESHOLD_MS,
        ),
        slow,
      };
    },
  };
}

const WRITE_PROBE_INTERVAL_MS = 50;

/**
 * Times how long a write has to wait for the database's write lock, the way a
 * main-thread write would (play history is recorded at every program start).
 * In the worker arm the scan holds the lock in another thread, and a write
 * from the main thread sleeps in SQLite's busy handler until it is free,
 * blocking that thread without using any CPU.
 *
 * It runs in a thread of its own, because better-sqlite3 waits synchronously
 * and would stall this process's HTTP probe.
 */
function startWriteProbe(dbFile: string): {
  stop: () => Promise<SlowProbe[]>;
} {
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const Sqlite = require(workerData.module);
    const db = new Sqlite(workerData.file, { timeout: 5000 });
    const samples = [];
    let stopping = false;
    parentPort.on('message', () => (stopping = true));
    const tick = () => {
      if (stopping) {
        db.close();
        parentPort.postMessage(samples);
        return;
      }
      const at = Date.now();
      const started = performance.now();
      try {
        db.exec('BEGIN IMMEDIATE');
        db.exec('ROLLBACK');
      } catch {
        // Still waited the whole busy timeout
      }
      samples.push({ at, ms: performance.now() - started });
      setTimeout(tick, workerData.intervalMs);
    };
    tick();
    `,
    {
      eval: true,
      workerData: {
        file: dbFile,
        module: createRequire(import.meta.url).resolve('better-sqlite3'),
        intervalMs: WRITE_PROBE_INTERVAL_MS,
      },
    },
  );
  const samples = new Promise<SlowProbe[]>((resolve, reject) => {
    worker.once('message', (m: SlowProbe[]) => resolve(m));
    worker.once('error', reject);
  });
  return {
    stop: async () => {
      worker.postMessage('stop');
      const result = await samples;
      await worker.terminate();
      return result;
    },
  };
}

type LibrarySummary = {
  id: string;
  lastScannedAt?: number | null;
  isLocked?: boolean;
};

async function getLibrary(
  sourceId: string,
): Promise<LibrarySummary | undefined> {
  const sources = JSON.parse((await api('GET', '/media-sources')).text) as {
    id: string;
    libraries: LibrarySummary[];
  }[];
  return sources.find((s) => s.id === sourceId)?.libraries[0];
}

async function runArm(
  arm: Arm,
  templateDir: string,
  moviesDir: string,
): Promise<RunResult> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-scan-ab-'));
  await fs.cp(templateDir, dataDir, { recursive: true });

  log(`\n[${arm}] starting server`);
  const { child, getOutput } = startServer(dataDir, arm === 'worker');

  try {
    if (
      !(await waitFor(
        () => /Tunarr is ready/.test(getOutput()),
        BOOT_TIMEOUT_MS,
      ))
    ) {
      throw new Error(`[${arm}] server never became ready`);
    }
    // Pool workers boot after the server serves; their start-up is not part
    // of the scan
    await waitFor(
      () =>
        (getOutput().match(/Tunarr worker started/g) ?? []).length >= POOL_SIZE,
      120_000,
    );
    // Let boot-time background work drain
    await delay(3_000);

    const pid = serverPid();
    const probe = startProbe();
    const cpuAtStart = pid !== undefined ? mainThreadCpuMs(pid) : undefined;
    const baselineStartedAt = performance.now();
    // Long enough to measure what the probe alone costs the main thread
    await delay(BASELINE_MS);
    probe.mark();
    const writeProbe = startWriteProbe(path.join(dataDir, 'db.db'));
    const benchLag = monitorEventLoopDelay({ resolution: 10 });
    benchLag.enable();

    const cpuBefore = pid !== undefined ? mainThreadCpuMs(pid) : undefined;
    const startedAt = performance.now();
    const idleCpuRate =
      cpuAtStart !== undefined && cpuBefore !== undefined
        ? (cpuBefore - cpuAtStart) / (startedAt - baselineStartedAt)
        : undefined;
    const createdAt = Date.now();
    const created = await api('POST', '/media-sources', {
      type: 'local',
      name: 'Bench movies',
      mediaType: 'movies',
      paths: [moviesDir],
      pathReplacements: [],
    });
    if (created.status >= 300) {
      await probe.stop();
      throw new Error(
        `[${arm}] media source create returned ${created.status}: ${created.text.slice(0, 300)}`,
      );
    }
    const sourceId = (JSON.parse(created.text) as { id: string }).id;

    // Done when the library has a scan time and the coordinator's lock,
    // held for the whole job, is released
    let libraryId: string | undefined;
    const finished = await waitFor(
      async () => {
        const library = await getLibrary(sourceId);
        libraryId = library?.id;
        return (
          library !== undefined &&
          library.lastScannedAt !== undefined &&
          library.lastScannedAt !== null &&
          !library.isLocked
        );
      },
      SCAN_TIMEOUT_MS,
      500,
    );
    const scanMs = performance.now() - startedAt;
    const finishedAt = Date.now();
    benchLag.disable();
    const benchLagMaxMs = benchLag.max / 1e6;
    const writeWaits = (await writeProbe.stop()).filter(
      (w) => w.at >= createdAt && w.at < finishedAt,
    );
    const writeWait = summarizeProbes(
      writeWaits.map((w) => w.ms),
      0,
      SLOW_THRESHOLD_MS,
    );
    const cpuAfter = pid !== undefined ? mainThreadCpuMs(pid) : undefined;
    const mainCpuMs =
      cpuBefore !== undefined &&
      cpuAfter !== undefined &&
      idleCpuRate !== undefined
        ? Math.max(0, cpuAfter - cpuBefore - idleCpuRate * scanMs)
        : undefined;
    await delay(SETTLE_MS);
    const { baseline, loaded, slow } = await probe.stop();
    if (!finished || libraryId === undefined) {
      throw new Error(
        `[${arm}] scan did not finish within ${SCAN_TIMEOUT_MS} ms`,
      );
    }

    // Counted after the probe stops: listing every program is real work on the
    // main thread
    const programs = (
      JSON.parse(
        (await api('GET', `/media-libraries/${libraryId}/programs`)).text,
      ) as unknown[]
    ).length;
    if (programs !== CLIPS) {
      throw new Error(
        `[${arm}] the library has ${programs} programs, expected ${CLIPS}. ` +
          `A scan that skipped files would make its numbers look better than they are.`,
      );
    }

    // Make sure each arm measured what it says it did
    const output = getOutput();
    const inWorker = /Scanning local media source[^\n]*"worker":true/.test(
      output,
    );
    if (arm === 'worker' && !inWorker) {
      throw new Error(`[worker] the scan did not run in a scan worker`);
    }
    if (arm === 'in-process' && inWorker) {
      throw new Error(`[in-process] the scan ran in a scan worker`);
    }

    log(
      `[${arm}] ${programs} programs in ${(scanMs / 1000).toFixed(1)} s; ` +
        `worst stall ${loaded.maxMs.toFixed(0)} ms, p99 ${loaded.p99Ms.toFixed(1)} ms, ` +
        `${loaded.slowCount} probes over ${SLOW_THRESHOLD_MS} ms, ` +
        `main thread CPU ${mainCpuMs !== undefined ? `${(mainCpuMs / 1000).toFixed(1)} s` : 'unknown'}`,
    );
    log(
      `[${arm}] a write waited up to ${writeWait.maxMs.toFixed(0)} ms for the lock ` +
        `(p99 ${writeWait.p99Ms.toFixed(1)} ms, ${writeWait.slowCount} of ${writeWait.count} over ${SLOW_THRESHOLD_MS} ms); ` +
        `this process's own loop lagged up to ${benchLagMaxMs.toFixed(0)} ms`,
    );
    // Where the slow probes fell: a worker arm spends its first seconds
    // starting the worker, and the duration reconcile runs after every scan
    const scanStartedAt = logTime(
      output,
      /Scanning local media source/,
      createdAt,
    );
    log(
      `[${arm}] slow probes ${phase(slow, createdAt, scanStartedAt, 'before the scan starts')}; ` +
        `${phase(slow, scanStartedAt, finishedAt, 'during it')}; ` +
        `${phase(slow, finishedAt, Infinity, 'after it')}`,
    );
    return {
      arm,
      scanMs,
      mainCpuMs,
      writeWait,
      benchLagMaxMs,
      probe: loaded,
      baseline,
      programs,
    };
  } finally {
    await stopServer(child);
    if (values['keep-logs']) {
      const p = path.join(os.tmpdir(), `tunarr-scan-ab-${arm}.log`);
      await fs.writeFile(p, getOutput());
      log(`[${arm}] log: ${p}`);
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
}

// The PID listening on the server port: tsx runs the server in a child
function serverPid(): number | undefined {
  try {
    const out = execFileSync('lsof', [
      '-nP',
      `-iTCP:${PORT}`,
      '-sTCP:LISTEN',
      '-t',
    ]).toString();
    const pid = Number.parseInt(out.trim().split('\n')[0] ?? '', 10);
    return Number.isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
}

/**
 * CPU time (user + system) the process's main thread has used, in ms.
 *
 * Unlike probe latency, this doesn't depend on how busy the machine is: a main
 * thread that waits for a CPU is slow to answer but uses no CPU time. It shows
 * how much of the scan's work lands on the thread that serves streams.
 */
function mainThreadCpuMs(pid: number): number | undefined {
  try {
    if (process.platform === 'darwin') {
      // The first thread `ps -M` lists is the main thread
      const line = execFileSync('ps', ['-M', '-p', String(pid)])
        .toString()
        .split('\n')[1];
      const times = line?.match(/([\d:.]+)\s+([\d:.]+)\s+\S/);
      if (times?.[1] === undefined || times[2] === undefined) {
        return undefined;
      }
      return clockMs(times[1]) + clockMs(times[2]);
    }
    if (process.platform === 'linux') {
      // The main thread's task has the process's own PID. utime and stime are
      // fields 14 and 15, in clock ticks; the command (field 2) may hold spaces
      const stat = execFileSync('cat', [`/proc/${pid}/task/${pid}/stat`])
        .toString()
        .split(') ')[1]
        ?.split(' ');
      const ticks = Number(stat?.[11]) + Number(stat?.[12]);
      const hz = Number(execFileSync('getconf', ['CLK_TCK']).toString());
      return Number.isNaN(ticks) ? undefined : (ticks / hz) * 1000;
    }
  } catch {
    // Measured where possible; the probe numbers stand on their own
  }
  return undefined;
}

// [h:]mm:ss.cc as ps prints it, in ms
function clockMs(clock: string): number {
  return (
    clock
      .split(':')
      .reduce((total, part) => total * 60 + Number.parseFloat(part), 0) * 1000
  );
}

// The time of the first log line matching pattern, or fallback
function logTime(output: string, pattern: RegExp, fallback: number): number {
  // eslint-disable-next-line no-control-regex
  const line = output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .find((l) => pattern.test(l));
  const stamp = line?.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)/)?.[1];
  return stamp !== undefined ? Date.parse(stamp) : fallback;
}

function phase(slow: SlowProbe[], from: number, to: number, label: string) {
  const inPhase = slow.filter((p) => p.at >= from && p.at < to);
  const max = Math.max(0, ...inPhase.map((p) => p.ms));
  return `${label}: ${inPhase.length} (worst ${max.toFixed(0)} ms)`;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const at = (i: number) => sorted[i] ?? 0;
  return sorted.length % 2 === 0 ? (at(mid - 1) + at(mid)) / 2 : at(mid);
}

function row(label: string, a: string, b: string): string {
  return `${label.padEnd(26)} ${a.padStart(14)} ${b.padStart(14)}`;
}

/** Prints the comparison; returns whether the worker arm passed. */
function report(inProcess: RunResult[], worker: RunResult[]): boolean {
  const stat = (pick: (r: RunResult) => number) => ({
    a: median(inProcess.map(pick)),
    b: median(worker.map(pick)),
  });
  const ms = (n: number, digits = 0) => `${n.toFixed(digits)} ms`;
  const sec = (n: number) => `${(n / 1000).toFixed(1)} s`;

  const scan = stat((r) => r.scanMs);
  const baseMax = stat((r) => r.baseline.maxMs);
  const p99 = stat((r) => r.probe.p99Ms);
  const max = stat((r) => r.probe.maxMs);
  const slow = stat((r) => r.probe.slowCount);
  const fails = stat((r) => r.probe.failures);
  const lag = stat((r) => r.benchLagMaxMs);
  const waitMax = stat((r) => r.writeWait.maxMs);
  const waitP99 = stat((r) => r.writeWait.p99Ms);
  const cpuKnown = [...inProcess, ...worker].every(
    (r) => r.mainCpuMs !== undefined,
  );
  const cpu = stat((r) => r.mainCpuMs ?? 0);

  console.log(`\n${'='.repeat(58)}`);
  console.log('Scan worker A/B');
  console.log(
    `${CLIPS} clips, pool size ${POOL_SIZE}, probe every ${PROBE_INTERVAL_MS} ms, slow above ${SLOW_THRESHOLD_MS} ms`,
  );
  console.log(`median of ${inProcess.length} trials`);
  console.log('='.repeat(58));
  console.log(row('', 'in-process', 'worker'));
  console.log('-'.repeat(58));
  console.log(row('scan wall-clock', sec(scan.a), sec(scan.b)));
  console.log(
    row(
      'main-thread CPU for scan',
      cpuKnown ? sec(cpu.a) : '?',
      cpuKnown ? sec(cpu.b) : '?',
    ),
  );
  console.log(row('write-lock wait, max', ms(waitMax.a), ms(waitMax.b)));
  console.log(row('write-lock wait, p99', ms(waitP99.a, 1), ms(waitP99.b, 1)));
  console.log('-'.repeat(58));
  console.log(row('probe, idle max', ms(baseMax.a), ms(baseMax.b)));
  console.log(row('probe p99', ms(p99.a, 1), ms(p99.b, 1)));
  console.log(row('probe, worst stall', ms(max.a), ms(max.b)));
  console.log(
    row(`probes over ${SLOW_THRESHOLD_MS} ms`, `${slow.a}`, `${slow.b}`),
  );
  console.log(row('probe failures', `${fails.a}`, `${fails.b}`));
  console.log(row("this process's loop lag", ms(lag.a), ms(lag.b)));
  console.log('-'.repeat(58));

  const failures: string[] = [];

  // The scan's work leaves the main thread. CPU time doesn't depend on how
  // busy the machine is, so this holds on a loaded laptop too.
  if (!cpuKnown) {
    console.log('main-thread CPU: not measurable on this platform');
  } else if (cpu.a < 500) {
    console.log(
      `main-thread CPU: the in-process scan used only ${ms(cpu.a)}; use more --clips to compare`,
    );
  } else {
    const share = cpu.b / cpu.a;
    console.log(
      `main-thread CPU: the worker arm's main thread did ${(share * 100).toFixed(1)}% of the in-process arm's scan work`,
    );
    if (share > 0.1) {
      failures.push(
        `the worker arm's main thread still did ${(share * 100).toFixed(0)}% of the scan's work (at most 10%)`,
      );
    }
  }

  // A main-thread write waits for the scan's transaction to finish, and
  // better-sqlite3 waits synchronously
  console.log(
    `write-lock wait: during a worker scan, p99 ${ms(waitP99.b, 1)}, worst ${ms(waitMax.b)}`,
  );
  if (waitP99.b >= SLOW_THRESHOLD_MS) {
    failures.push(
      `a write's p99 wait for the worker's transaction was ${ms(waitP99.b, 1)} (under ${SLOW_THRESHOLD_MS} ms expected)`,
    );
  }

  // Worst cases include how promptly this machine schedules the server, this
  // process and its write probe. If this process's own loop lagged past the
  // slow threshold, the machine was too busy for them to say anything about
  // the server.
  if (lag.a > SLOW_THRESHOLD_MS || lag.b > SLOW_THRESHOLD_MS) {
    console.log(
      `worst cases: not judged; this process's own loop lagged up to ${ms(Math.max(lag.a, lag.b))}, ` +
        `so the machine is too busy. Rerun on an idle machine.`,
    );
  } else {
    if (waitMax.b >= MAX_STALL_MS) {
      failures.push(
        `a write waited ${ms(waitMax.b)} for the worker's transaction (under ${MAX_STALL_MS} ms expected)`,
      );
    }
    console.log(
      `latency: worst stall ${ms(max.a)} in-process, ${ms(max.b)} with the worker`,
    );
    if (max.b >= MAX_STALL_MS) {
      failures.push(
        `the worker arm's worst stall is ${ms(max.b)} (under ${MAX_STALL_MS} ms expected)`,
      );
    }
    if (max.b > max.a) {
      failures.push(
        `the worker arm stalled more than in-process (${ms(max.b)} vs ${ms(max.a)})`,
      );
    }
  }
  if (fails.a > 0 || fails.b > 0) {
    failures.push('some probes failed, so the timings are suspect');
  }

  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.join('; ')}`);
    return false;
  }
  console.log('\nPASS');
  return true;
}

async function main() {
  const ffmpeg = which('ffmpeg');
  const ffprobe = which('ffprobe');
  if (ffmpeg === undefined || ffprobe === undefined) {
    throw new Error('ffmpeg and ffprobe must be on the PATH');
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-scan-ab-'));
  const templateDir = path.join(workDir, 'template');
  const mediaDir = path.join(workDir, 'media');
  await fs.mkdir(templateDir);
  await fs.mkdir(mediaDir);

  try {
    log(`Making ${CLIPS} clips...`);
    const moviesDir = await makeMedia(mediaDir);

    // Boot once to run migrations and point the FFmpeg settings at this
    // machine's binaries (the scanner probes every file)
    log('Preparing the template database...');
    const { child, getOutput } = startServer(templateDir, false);
    try {
      if (
        !(await waitFor(
          () => /Tunarr is ready/.test(getOutput()),
          BOOT_TIMEOUT_MS,
        ))
      ) {
        throw new Error('template server never became ready');
      }
      const current = JSON.parse(
        (await api('GET', '/ffmpeg-settings')).text,
      ) as Record<string, unknown>;
      const saved = await api('PUT', '/ffmpeg-settings', {
        ...current,
        ffmpegExecutablePath: ffmpeg,
        ffprobeExecutablePath: ffprobe,
      });
      if (saved.status >= 300) {
        throw new Error(`ffmpeg settings update returned ${saved.status}`);
      }
    } finally {
      await stopServer(child);
    }

    const inProcess: RunResult[] = [];
    const worker: RunResult[] = [];
    for (let trial = 1; trial <= TRIALS; trial++) {
      log(`\n--- trial ${trial}/${TRIALS} ---`);
      const order: Arm[] =
        trial % 2 === 1 ? ['in-process', 'worker'] : ['worker', 'in-process'];
      for (const arm of order) {
        const result = await runArm(arm, templateDir, moviesDir);
        (arm === 'worker' ? worker : inProcess).push(result);
      }
    }

    if (!report(inProcess, worker)) {
      process.exitCode = 1;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
