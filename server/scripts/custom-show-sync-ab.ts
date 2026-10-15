/**
 * A/B benchmark for running custom show syncs in a scan worker.
 *
 * A sync lists a Plex playlist, scans each item into the database, then
 * replaces the show's content. better-sqlite3 is synchronous, so on the main
 * thread that work holds up the requests it serves (HLS segments, the
 * HDHomeRun stream). With TUNARR_SCAN_IN_WORKER the sync runs in a scan
 * worker instead.
 *
 * Each run boots a fresh server, adds a Plex media source that points at a
 * stand-in Plex server (tests/support/fakePlexServer.mjs, in a worker thread
 * of this process), then measures two syncs of a --movies long playlist:
 *
 * - first sync: creating a synced custom show imports every movie;
 * - resync: Sync Now on the unchanged playlist, as the hourly sync does.
 *
 * Arms alternate within a trial (A B, then B A). As in scan-worker-ab.ts, the
 * verdict rests on what a busy machine doesn't distort: the main-thread CPU
 * each sync adds (the worker arm must add at most 10% of the in-process arm's)
 * and, when this process's own loop kept up, the worst probe stall.
 *
 * Runs outside vitest, because a worker re-executes process.argv[1].
 *
 *   pnpm bench:custom-show-sync
 *   pnpm bench:custom-show-sync -- --movies 3000 --trials 2
 */
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import type { ProbeSummary } from '../src/util/probeStats.ts';
import { summarizeProbes } from '../src/util/probeStats.ts';
import type { FakePlex } from '../tests/support/fakePlex.ts';
import { startFakePlex } from '../tests/support/fakePlex.ts';

// pnpm forwards the `--` separator itself, and parseArgs reads everything
// after a `--` as positionals
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    movies: { type: 'string', default: '1000' },
    trials: { type: 'string', default: '1' },
    'pool-size': { type: 'string', default: '2' },
    'probe-interval': { type: 'string', default: '10' },
    'slow-threshold': { type: 'string', default: '25' },
    'max-stall': { type: 'string', default: '100' },
    port: { type: 'string', default: '18197' },
    'search-port': { type: 'string', default: '18198' },
    'keep-logs': { type: 'boolean', default: false },
  },
});

const MOVIES = Number.parseInt(values.movies, 10);
const TRIALS = Number.parseInt(values.trials, 10);
const POOL_SIZE = Number.parseInt(values['pool-size'], 10);
const PROBE_INTERVAL_MS = Number.parseInt(values['probe-interval'], 10);
const SLOW_THRESHOLD_MS = Number.parseInt(values['slow-threshold'], 10);
const MAX_STALL_MS = Number.parseInt(values['max-stall'], 10);
const PORT = Number.parseInt(values.port, 10);
const SEARCH_PORT = Number.parseInt(values['search-port'], 10);
const HOST = '127.0.0.1';

const BOOT_TIMEOUT_MS = 240_000;
// Idle probing before each sync, for the CPU baseline
const BASELINE_MS = 3_000;
// Probing after each sync, for work it leaves behind
const SETTLE_MS = 2_000;

type Arm = 'in-process' | 'worker';
type Phase = 'first sync' | 'resync';
const Phases: Phase[] = ['first sync', 'resync'];

type PhaseResult = {
  wallMs: number;
  // CPU time the sync added to the server's main thread
  mainCpuMs: number | undefined;
  probe: ProbeSummary;
  // How far this process's own loop fell behind
  benchLagMaxMs: number;
};

type RunResult = { arm: Arm } & Record<Phase, PhaseResult>;

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await delay(250);
  }
  return false;
}

function startServer(dataDir: string, scanInWorker: boolean) {
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
        // Debug logging is written on the main thread and would show up as
        // probe latency
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
  method: 'GET' | 'POST',
  route: string,
  body?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://${HOST}:${PORT}/api${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30 * 60_000),
  });
  return { status: res.status, text: await res.text() };
}

// A keep-alive agent, so connection setup isn't charged to probe latency
const probeAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });

// `/api/xmltv-last-refresh` is an in-memory lookup: its latency is the
// server's event loop being unavailable
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
 * Probes on a fixed cadence, timing each call from when it was due: a stall
 * between two probes only delays the next send.
 */
function startProbe(): { stop: () => Promise<ProbeSummary> } {
  const samples: number[] = [];
  let failures = 0;
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
      samples.push(Math.max(0, completedAt - dueAt));
      intendedAt = Math.max(completedAt, dueAt + PROBE_INTERVAL_MS);
    }
  })();
  return {
    stop: async () => {
      stopped = true;
      await loop;
      return summarizeProbes(samples, failures, SLOW_THRESHOLD_MS);
    },
  };
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

// CPU time (user + system) the process's main thread has used, in ms
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
      // utime and stime of the main thread's task, in clock ticks
      const stat = execFileSync('cat', [`/proc/${pid}/task/${pid}/stat`])
        .toString()
        .split(') ')[1]
        ?.split(' ');
      const ticks = Number(stat?.[11]) + Number(stat?.[12]);
      const hz = Number(execFileSync('getconf', ['CLK_TCK']).toString());
      return Number.isNaN(ticks) ? undefined : (ticks / hz) * 1000;
    }
  } catch {
    // The probe numbers stand on their own
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

/** Measures one sync: probe, main-thread CPU and this process's own lag. */
async function measure(
  pid: number | undefined,
  sync: () => Promise<{ status: number; text: string }>,
): Promise<PhaseResult & { response: { status: number; text: string } }> {
  const cpu = () => (pid !== undefined ? mainThreadCpuMs(pid) : undefined);
  // What the probe alone costs the main thread
  const idleProbe = startProbe();
  const idleCpu = cpu();
  const idleStarted = performance.now();
  await delay(BASELINE_MS);
  const idleCpuEnd = cpu();
  const idleRate =
    idleCpu !== undefined && idleCpuEnd !== undefined
      ? (idleCpuEnd - idleCpu) / (performance.now() - idleStarted)
      : undefined;
  await idleProbe.stop();

  const probe = startProbe();
  const benchLag = monitorEventLoopDelay({ resolution: 10 });
  benchLag.enable();
  const cpuBefore = cpu();
  const started = performance.now();
  const response = await sync();
  const wallMs = performance.now() - started;
  const cpuAfter = cpu();
  await delay(SETTLE_MS);
  const summary = await probe.stop();
  benchLag.disable();
  const mainCpuMs =
    cpuBefore !== undefined && cpuAfter !== undefined && idleRate !== undefined
      ? Math.max(0, cpuAfter - cpuBefore - idleRate * wallMs)
      : undefined;
  return {
    wallMs,
    mainCpuMs,
    probe: summary,
    benchLagMaxMs: benchLag.max / 1e6,
    response,
  };
}

function contentCount(text: string): number {
  return (JSON.parse(text) as { contentCount: number }).contentCount;
}

async function runArm(arm: Arm, plex: FakePlex): Promise<RunResult> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tunarr-cs-ab-'));
  console.log(`\n[${arm}] starting server`);
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
    // Pool workers boot after the server serves
    await waitFor(
      () =>
        (getOutput().match(/Tunarr worker started/g) ?? []).length >= POOL_SIZE,
      120_000,
    );
    const source = await api('POST', '/media-sources', {
      type: 'plex',
      name: 'Bench Plex',
      uri: plex.url,
      accessToken: 'bench-token',
      // Set, so the server doesn't look the user up on plex.tv
      userId: 'bench-user',
      username: 'bench',
      sendPlayStatusUpdates: false,
      sendGuideUpdates: false,
      index: 0,
      pathReplacements: [],
    });
    if (source.status >= 300) {
      throw new Error(
        `[${arm}] media source create returned ${source.status}: ${source.text.slice(0, 300)}`,
      );
    }
    const mediaSourceId = (JSON.parse(source.text) as { id: string }).id;
    // Let boot-time background work drain
    await delay(3_000);

    const pid = serverPid();
    const first = await measure(pid, () =>
      api('POST', '/custom-shows', {
        name: 'Bench playlist',
        programs: [],
        syncMediaSourceId: mediaSourceId,
        syncMediaSourceType: 'plex',
        syncExternalPlaylistId: plex.playlistId,
      }),
    );
    if (first.response.status !== 201) {
      throw new Error(`[${arm}] create returned ${first.response.status}`);
    }
    const showId = (JSON.parse(first.response.text) as { id: string }).id;
    const resync = await measure(pid, () =>
      api('POST', `/custom-shows/${showId}/sync`),
    );
    if (resync.response.status !== 200) {
      throw new Error(
        `[${arm}] Sync Now returned ${resync.response.status}: ${resync.response.text.slice(0, 300)}`,
      );
    }

    // A sync that dropped items would make its numbers look better
    for (const [phase, result] of [
      ['first sync', first],
      ['resync', resync],
    ] as const) {
      const count = contentCount(result.response.text);
      if (count !== MOVIES) {
        throw new Error(
          `[${arm}] ${phase} left ${count} programs in the show, expected ${MOVIES}`,
        );
      }
    }
    // Make sure each arm measured what it says it did
    const inWorker = /Syncing custom show[^\n]*"worker":true/.test(getOutput());
    if (arm === 'worker' && !inWorker) {
      throw new Error('[worker] the sync did not run in a scan worker');
    }
    if (arm === 'in-process' && inWorker) {
      throw new Error('[in-process] the sync ran in a scan worker');
    }

    for (const [phase, result] of [
      ['first sync', first],
      ['resync', resync],
    ] as const) {
      console.log(
        `[${arm}] ${phase}: ${(result.wallMs / 1000).toFixed(1)} s; ` +
          `worst stall ${result.probe.maxMs.toFixed(0)} ms, p99 ${result.probe.p99Ms.toFixed(1)} ms, ` +
          `${result.probe.slowCount} probes over ${SLOW_THRESHOLD_MS} ms, ` +
          `main thread CPU ${result.mainCpuMs !== undefined ? `${(result.mainCpuMs / 1000).toFixed(2)} s` : 'unknown'}`,
      );
    }
    return { arm, 'first sync': first, resync };
  } finally {
    await stopServer(child);
    if (values['keep-logs']) {
      const p = path.join(os.tmpdir(), `tunarr-cs-ab-${arm}.log`);
      await fs.writeFile(p, getOutput());
      console.log(`[${arm}] log: ${p}`);
    }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
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
  return `${label.padEnd(28)} ${a.padStart(13)} ${b.padStart(13)}`;
}

/** Prints the comparison; returns whether the worker arm passed. */
function report(inProcess: RunResult[], worker: RunResult[]): boolean {
  const ms = (n: number, digits = 0) => `${n.toFixed(digits)} ms`;
  const sec = (n: number) => `${(n / 1000).toFixed(2)} s`;
  const failures: string[] = [];

  console.log(`\n${'='.repeat(56)}`);
  console.log('Custom show sync worker A/B');
  console.log(
    `${MOVIES} movies, pool size ${POOL_SIZE}, probe every ${PROBE_INTERVAL_MS} ms, median of ${inProcess.length} trial(s)`,
  );
  console.log('='.repeat(56));
  console.log(row('', 'in-process', 'worker'));

  for (const phase of Phases) {
    const stat = (pick: (r: PhaseResult) => number) => ({
      a: median(inProcess.map((r) => pick(r[phase]))),
      b: median(worker.map((r) => pick(r[phase]))),
    });
    const wall = stat((r) => r.wallMs);
    const cpuKnown = [...inProcess, ...worker].every(
      (r) => r[phase].mainCpuMs !== undefined,
    );
    const cpu = stat((r) => r.mainCpuMs ?? 0);
    const max = stat((r) => r.probe.maxMs);
    const p99 = stat((r) => r.probe.p99Ms);
    const slow = stat((r) => r.probe.slowCount);
    const fails = stat((r) => r.probe.failures);
    const lag = stat((r) => r.benchLagMaxMs);

    console.log(`-- ${phase} ${'-'.repeat(52 - phase.length)}`);
    console.log(row('wall-clock', sec(wall.a), sec(wall.b)));
    console.log(
      row(
        'main-thread CPU',
        cpuKnown ? sec(cpu.a) : '?',
        cpuKnown ? sec(cpu.b) : '?',
      ),
    );
    console.log(row('probe, worst stall', ms(max.a), ms(max.b)));
    console.log(row('probe p99', ms(p99.a, 1), ms(p99.b, 1)));
    console.log(
      row(`probes over ${SLOW_THRESHOLD_MS} ms`, `${slow.a}`, `${slow.b}`),
    );
    console.log(row("this process's loop lag", ms(lag.a), ms(lag.b)));

    if (fails.a > 0 || fails.b > 0) {
      failures.push(`${phase}: some probes failed`);
    }
    // The sync's work leaves the main thread
    if (cpuKnown && cpu.a >= 200 && cpu.b / cpu.a > 0.1) {
      failures.push(
        `${phase}: the worker arm's main thread still did ${((cpu.b / cpu.a) * 100).toFixed(0)}% of the sync's work (at most 10%)`,
      );
    }
    // Worst cases are judged only when this machine was quiet enough
    if (lag.b <= SLOW_THRESHOLD_MS && max.b >= MAX_STALL_MS) {
      failures.push(
        `${phase}: the worker arm's worst stall is ${ms(max.b)} (under ${MAX_STALL_MS} ms expected)`,
      );
    }
  }
  console.log('-'.repeat(56));

  if (failures.length > 0) {
    console.error(`\nFAIL: ${failures.join('; ')}`);
    return false;
  }
  console.log('\nPASS');
  return true;
}

async function main() {
  console.log(`Starting a stand-in Plex server with ${MOVIES} movies...`);
  const plex = await startFakePlex(MOVIES);
  try {
    const inProcess: RunResult[] = [];
    const worker: RunResult[] = [];
    for (let trial = 1; trial <= TRIALS; trial++) {
      console.log(`\n--- trial ${trial}/${TRIALS} ---`);
      const order: Arm[] =
        trial % 2 === 1 ? ['in-process', 'worker'] : ['worker', 'in-process'];
      for (const arm of order) {
        const result = await runArm(arm, plex);
        (arm === 'worker' ? worker : inProcess).push(result);
      }
    }
    if (!report(inProcess, worker)) {
      process.exitCode = 1;
    }
  } finally {
    await plex.close();
  }
}

await main();
