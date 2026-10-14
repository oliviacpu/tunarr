#!/usr/bin/env node
/**
 * Measures how promptly a running Tunarr answers, for checking a deployment
 * while something heavy (a library scan, a guide rebuild) runs.
 *
 * - Probes a URL on a fixed cadence and times each answer from when it was
 *   due, so a stall between two probes counts in full. The default URL,
 *   `/api/xmltv-last-refresh`, is an in-memory lookup, so its latency is the
 *   main thread being unavailable.
 * - With --stream, also reads a channel's MPEG-TS stream the way Plex's tuner
 *   does and times the gaps between chunks. A long gap is what a viewer sees
 *   as a pause, and the stream ending is what Plex reports as a failed tuner.
 *   Reading it starts a real stream session on the server.
 *
 * Plain Node (18 or later), no dependencies, so it runs anywhere Node does.
 * Prints each slow probe and stream gap as it happens, a summary line every
 * --report-every seconds, and a final summary on Ctrl-C or after --duration.
 *
 *   node probe-latency.mjs --url http://127.0.0.1:8000
 *   node probe-latency.mjs --url http://127.0.0.1:8000 \
 *     --stream /stream/channels/1.ts --duration 600
 *
 * Basic auth uses Tunarr's own TUNARR_BASIC_AUTH_USER and
 * TUNARR_BASIC_AUTH_PASSWORD, read from the environment or from a KEY=VALUE
 * file given with --auth-env. Credentials in the URL (http://user:pass@host)
 * work too, but other users on the machine can see them in the process list.
 * They are never printed.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8000' },
    path: { type: 'string', default: '/api/xmltv-last-refresh' },
    interval: { type: 'string', default: '100' },
    slow: { type: 'string', default: '250' },
    stream: { type: 'string' },
    'stream-gap': { type: 'string', default: '1000' },
    duration: { type: 'string', default: '0' },
    'report-every': { type: 'string', default: '60' },
    'auth-env': { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(
    'Options: --url BASE --path /api/xmltv-last-refresh --interval MS --slow MS\n' +
      '         --stream /stream/channels/<n>.ts --stream-gap MS\n' +
      '         --duration SECONDS (0 = until Ctrl-C) --report-every SECONDS\n' +
      '         --auth-env FILE (TUNARR_BASIC_AUTH_USER/PASSWORD lines)',
  );
  process.exit(0);
}

// KEY=VALUE lines, taken literally (no quotes or expansion)
function readEnvFile(file) {
  return Object.fromEntries(
    readFileSync(file, 'utf-8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

const base = new URL(values.url);
const authVars =
  values['auth-env'] !== undefined
    ? readEnvFile(values['auth-env'])
    : process.env;
const auth =
  base.username !== ''
    ? `${decodeURIComponent(base.username)}:${decodeURIComponent(base.password)}`
    : authVars.TUNARR_BASIC_AUTH_USER !== undefined
      ? `${authVars.TUNARR_BASIC_AUTH_USER}:${authVars.TUNARR_BASIC_AUTH_PASSWORD ?? ''}`
      : undefined;
base.username = '';
base.password = '';
const client = base.protocol === 'https:' ? https : http;
const INTERVAL_MS = Number(values.interval);
const SLOW_MS = Number(values.slow);
const STREAM_GAP_MS = Number(values['stream-gap']);
const DURATION_MS = Number(values.duration) * 1000;
const REPORT_EVERY_MS = Number(values['report-every']) * 1000;

const agent = new client.Agent({ keepAlive: true, maxSockets: 1 });

const now = () => new Date().toISOString();

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
    )
  ];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: samples.length,
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
    slow: samples.filter((s) => s > SLOW_MS).length,
  };
}

const fmt = (ms) => `${Math.round(ms)}ms`;

// --- HTTP probe -------------------------------------------------------------

const allSamples = [];
let windowSamples = [];
let failures = 0;
const worst = []; // { at, ms }, the slowest few

function probeOnce() {
  return new Promise((resolve) => {
    const url = new URL(values.path, base);
    const req = client.request(url, { agent, auth, timeout: 30_000 }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode < 400));
    });
    req.once('error', () => resolve(false));
    req.once('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

let stopping = false;

async function probeLoop() {
  let dueAt = performance.now();
  while (!stopping) {
    const wait = dueAt - performance.now();
    if (wait > 0) {
      await delay(wait);
    }
    const due = dueAt;
    const dueWall = Date.now() - (performance.now() - due);
    const ok = await probeOnce();
    const ms = performance.now() - due;
    if (!ok) {
      failures++;
      console.log(`${now()} probe failed after ${fmt(ms)}`);
    }
    allSamples.push(ms);
    windowSamples.push(ms);
    if (ms > SLOW_MS) {
      console.log(`${new Date(dueWall).toISOString()} slow probe ${fmt(ms)}`);
    }
    worst.push({ at: dueWall, ms });
    worst.sort((a, b) => b.ms - a.ms);
    worst.length = Math.min(worst.length, 5);
    dueAt = Math.max(performance.now(), due + INTERVAL_MS);
  }
}

// --- Stream reader ----------------------------------------------------------

let streamReq;
const stream = {
  bytes: 0,
  maxGap: 0,
  windowMaxGap: 0,
  gaps: [], // { at, ms } over STREAM_GAP_MS
  ends: 0,
};

async function streamLoop() {
  while (!stopping) {
    await new Promise((resolve) => {
      const url = new URL(values.stream, base);
      const req = client.get(url, { auth }, (res) => {
        if (res.statusCode >= 400) {
          console.log(`${now()} stream returned ${res.statusCode}`);
          res.resume();
          res.once('end', resolve);
          return;
        }
        console.log(`${now()} stream connected`);
        let last = performance.now();
        res.on('data', (chunk) => {
          const t = performance.now();
          const gap = t - last;
          last = t;
          stream.bytes += chunk.length;
          stream.maxGap = Math.max(stream.maxGap, gap);
          stream.windowMaxGap = Math.max(stream.windowMaxGap, gap);
          if (gap > STREAM_GAP_MS) {
            stream.gaps.push({ at: Date.now(), ms: gap });
            console.log(`${now()} stream gap ${fmt(gap)}`);
          }
        });
        res.once('end', () => {
          if (!stopping) {
            stream.ends++;
            console.log(
              `${now()} stream ended (a tuner would report a failure)`,
            );
          }
          resolve();
        });
        res.once('error', resolve);
      });
      req.once('error', (e) => {
        console.log(`${now()} stream error: ${e.message}`);
        resolve();
      });
      streamReq = req;
    });
    if (!stopping) {
      await delay(1_000);
    }
  }
}

// --- Reporting --------------------------------------------------------------

function windowLine() {
  const s = summarize(windowSamples);
  windowSamples = [];
  let line = `${now()} probes n=${s.n} p50=${fmt(s.p50)} p99=${fmt(s.p99)} max=${fmt(s.max)} slow=${s.slow}`;
  if (values.stream !== undefined) {
    line += ` | stream ${(stream.bytes / 1e6).toFixed(1)}MB maxGap=${fmt(stream.windowMaxGap)}`;
    stream.windowMaxGap = 0;
  }
  console.log(line);
}

function finalReport() {
  const s = summarize(allSamples);
  console.log('\n=== summary ===');
  console.log(
    `probes: n=${s.n} p50=${fmt(s.p50)} p99=${fmt(s.p99)} max=${fmt(s.max)} ` +
      `over ${SLOW_MS}ms: ${s.slow} failed: ${failures}`,
  );
  console.log(
    `slowest: ${worst.map((w) => `${fmt(w.ms)} at ${new Date(w.at).toISOString()}`).join(', ') || '(none)'}`,
  );
  if (values.stream !== undefined) {
    console.log(
      `stream: ${(stream.bytes / 1e6).toFixed(1)}MB, max gap ${fmt(stream.maxGap)}, ` +
        `gaps over ${STREAM_GAP_MS}ms: ${stream.gaps.length}, ended: ${stream.ends}`,
    );
  }
}

async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  clearInterval(reporter);
  streamReq?.destroy();
  await probing;
  finalReport();
  agent.destroy();
  process.exit(0);
}

console.log(
  `${now()} probing ${new URL(values.path, base)} every ${INTERVAL_MS}ms, slow above ${SLOW_MS}ms`,
);
const probing = probeLoop();
if (values.stream !== undefined) {
  void streamLoop();
}
const reporter = setInterval(windowLine, REPORT_EVERY_MS);
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
if (DURATION_MS > 0) {
  setTimeout(() => void stop(), DURATION_MS);
}
