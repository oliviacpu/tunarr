import type { IChannelDB } from '@/db/interfaces/IChannelDB.js';
import type { ISettingsDB } from '@/db/interfaces/ISettingsDB.js';
import type { ChannelOrmWithTranscodeConfig } from '@/db/schema/derivedTypes.js';
import type { HlsOptions } from '@/ffmpeg/builder/constants.js';
import type { EventService } from '@/services/EventService.js';
import type { OnDemandChannelService } from '@/services/OnDemandChannelService.js';
import type { Logger } from '@/util/logging/LoggerFactory.js';
import type { DeepRequired } from 'ts-essentials';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConcatSession } from './ConcatSession.ts';
import type { HlsSessionOptions } from './hls/HlsSession.ts';

// Mock modules that create circular dependency chains through Inversify
vi.mock('@/services/EventService.js', () => ({
  EventService: vi.fn(),
}));

vi.mock('@/services/OnDemandChannelService.js', () => ({
  OnDemandChannelService: vi.fn(),
}));

// Must be imported after the mocks are set up
const { SessionManager } = await import('./SessionManager.ts');
const { BaseHlsSession } = await import('./hls/BaseHlsSession.ts');

// ---------------------------------------------------------------------------
// Stub session: a minimal HlsSession-like object that lets us control
// start/stop behaviour and manually emit events.
// ---------------------------------------------------------------------------

class StubHlsSession extends BaseHlsSession<HlsSessionOptions> {
  public readonly sessionType: 'hls' | 'hls_direct_v2';

  constructor(
    channel: ChannelOrmWithTranscodeConfig,
    options: HlsSessionOptions,
  ) {
    super(channel, options);
    this.sessionType = options.streamMode;
  }

  protected getHlsOptions(): DeepRequired<HlsOptions> {
    return {
      hlsDeleteThreshold: 3,
      streamNameFormat: 'stream.m3u8',
      subtitleStreamNameFormat: 'subs.m3u8',
      segmentNameFormat: 'data%06d.ts',
      segmentBaseDirectory: '/tmp/test-sessions',
      streamBasePath: 'test',
      streamBaseUrl: '/test/',
      hlsTime: 4,
      hlsListSize: 0,
      deleteThreshold: null,
      appendSegments: true,
    };
  }

  markError() {
    this.state = 'error';
  }

  // Skip all real startup work — just mark as started
  protected override async startInternal() {
    this.state = 'started';
  }

  protected override async stopInternal() {
    this.state = 'stopped';
  }

  // Skip waiting for stream files
  protected override async waitForStreamReady() {
    const { Result } = await import('@/types/result.js');
    return Result.success(void 0);
  }

  // Use the real Session.isStale() implementation so staleness
  // tests exercise the actual threshold logic.
}

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const noopLogger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
  setBindings: vi.fn(),
  child: () => noopLogger,
  bindings: () => ({}),
} as unknown as Logger;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const channelUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeChannel(): ChannelOrmWithTranscodeConfig {
  return {
    uuid: channelUuid,
    number: 1,
    subtitlesEnabled: true,
    transcodeConfig: { videoFormat: 'h264' },
  } as unknown as ChannelOrmWithTranscodeConfig;
}

function makeSessionManager(
  hlsFactory: (
    channel: ChannelOrmWithTranscodeConfig,
    options: HlsSessionOptions,
  ) => StubHlsSession,
  concatFactory = vi.fn(),
) {
  const channelDB: Partial<IChannelDB> = {
    getChannelOrm: vi.fn().mockResolvedValue(makeChannel()),
  };

  const onDemandService: Partial<OnDemandChannelService> = {
    resumeChannel: vi.fn().mockResolvedValue(undefined),
    pauseChannel: vi.fn().mockResolvedValue(undefined),
  };

  const eventService: Partial<EventService> = {
    push: vi.fn(),
  };

  const settingsDB: Partial<ISettingsDB> = {
    ffmpegSettings: vi.fn().mockReturnValue({
      transcodeDirectory: '/tmp/test-sessions',
      hdhrClosedCaptions: true,
      hlsSegmentSeconds: 3,
      hlsInitialSegmentCount: 2,
    }),
  };

  // Construct SessionManager directly, bypassing Inversify
  const manager = new SessionManager(
    channelDB,
    onDemandService,
    hlsFactory as unknown as ConstructorParameters<typeof SessionManager>[2],
    vi.fn(), // hlsSlowerSessionFactory — not used in these tests
    concatFactory, // concatSessionFactory
    eventService,
    settingsDB,
  );

  // Override the @InjectLogger() property with a noop mock so
  // tests don't require an initialized LoggerFactory.
  (manager as any).logger = noopLogger;

  return manager;
}

const connection = { ip: '127.0.0.1' };

describe('SessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['hls', 'hls_direct_v2'] as const)(
    'passes configured segment settings into %s sessions',
    async (streamMode) => {
      const created: HlsSessionOptions[] = [];
      const manager = makeSessionManager((channel, options) => {
        created.push(options);
        return new StubHlsSession(channel, options);
      });
      await manager.getOrCreateHlsSession(channelUuid, 'token', connection, {
        streamMode,
      });
      expect(created[0]).toMatchObject({
        streamMode,
        segmentSeconds: 3,
        initialSegmentCount: 2,
      });
    },
  );

  it('inherits a live wrapper caption decision instead of rereading changed settings', async () => {
    const created: HlsSessionOptions[] = [];
    const manager = makeSessionManager((channel, options) => {
      created.push(options);
      return new StubHlsSession(channel, options);
    });
    const originalGet = manager.getSession.bind(manager);
    vi.spyOn(manager, 'getSession').mockImplementation((channelId, mode) =>
      mode === 'hls_concat'
        ? ({
            captionsEnabled: false,
            stoppingOrStopped: false,
          } as unknown as ConcatSession)
        : originalGet(channelId, mode),
    );
    await manager.getOrCreateHlsSession(channelUuid, 'token', connection, {
      streamMode: 'hls',
    });
    expect(created[0]?.captionsEnabled).toBe(false);
  });

  it('ignores a stopped wrapper when a new session chooses captions', async () => {
    const created: HlsSessionOptions[] = [];
    const manager = makeSessionManager((channel, options) => {
      created.push(options);
      return new StubHlsSession(channel, options);
    });
    const originalGet = manager.getSession.bind(manager);
    vi.spyOn(manager, 'getSession').mockImplementation((channelId, mode) =>
      mode === 'hls_concat'
        ? ({
            captionsEnabled: false,
            stoppingOrStopped: true,
          } as unknown as ConcatSession)
        : originalGet(channelId, mode),
    );
    await manager.getOrCreateHlsSession(channelUuid, 'token', connection, {
      streamMode: 'hls',
    });
    expect(created[0]?.captionsEnabled).toBe(true);
  });

  describe('session replacement race condition', () => {
    it('replaces a stopping session with one that has its own directory', async () => {
      class SlowStopHlsSession extends StubHlsSession {
        readonly stopGate = Promise.withResolvers<void>();

        protected override async stopInternal() {
          await this.stopGate.promise;
        }
      }

      const sessions: SlowStopHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new SlowStopHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, 'token-a', connection, {
        streamMode: 'hls',
      });
      const sessionA = sessions[0];
      expect(sessionA).toBeDefined();
      if (!sessionA) return;

      // Simulates an ffmpeg that has not exited yet.
      const stopA = sessionA.stop();
      await vi.waitFor(() => expect(sessionA.state).toBe('stopping'));

      await manager.getOrCreateHlsSession(channelUuid, 'token-b', connection, {
        streamMode: 'hls',
      });
      const sessionB = sessions[1];
      expect(sessionB).toBeDefined();
      if (!sessionB) return;

      expect(manager.getHlsSession(channelUuid)).toBe(sessionB);
      expect(sessionB.workingDirectory).not.toBe(sessionA.workingDirectory);

      sessionA.stopGate.resolve();
      await stopA;
      expect(sessionA.state).toBe('stopped');
      sessionA.emit('cleanup');
      expect(manager.getHlsSession(channelUuid)).toBe(sessionB);
    });

    it('endSession does not block a tune-in while the old session stops', async () => {
      class SlowStopHlsSession extends StubHlsSession {
        readonly stopGate = Promise.withResolvers<void>();

        protected override async stopInternal() {
          await this.stopGate.promise;
        }
      }

      const sessions: SlowStopHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new SlowStopHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, 'token-a', connection, {
        streamMode: 'hls',
      });
      const sessionA = sessions[0];
      expect(sessionA).toBeDefined();
      if (!sessionA) return;

      const endA = manager.endSession(channelUuid, 'hls');
      await vi.waitFor(() => expect(sessionA.state).toBe('stopping'));
      expect(manager.getHlsSession(channelUuid)).toBeUndefined();

      // Must resolve while Session A's stop is still pending.
      const resultB = await manager.getOrCreateHlsSession(
        channelUuid,
        'token-b',
        connection,
        { streamMode: 'hls' },
      );
      expect(resultB.isSuccess()).toBe(true);
      expect(manager.getHlsSession(channelUuid)).toBe(sessions[1]);

      sessionA.stopGate.resolve();
      await endA;
      expect(sessionA.state).toBe('stopped');
      expect(manager.getHlsSession(channelUuid)).toBe(sessions[1]);
    });

    it('endSessionInBackground resolves before the session finishes stopping', async () => {
      class SlowStopHlsSession extends StubHlsSession {
        readonly stopGate = Promise.withResolvers<void>();

        protected override async stopInternal() {
          await this.stopGate.promise;
        }
      }

      const sessions: SlowStopHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new SlowStopHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, 'token-a', connection, {
        streamMode: 'hls',
      });
      const sessionA = sessions[0];
      expect(sessionA).toBeDefined();
      if (!sessionA) return;

      // Would hang if this awaited the stop, which is gated below.
      await manager.endSessionInBackground(sessionA);

      expect(manager.getHlsSession(channelUuid)).toBeUndefined();
      await vi.waitFor(() => expect(sessionA.state).toBe('stopping'));

      sessionA.stopGate.resolve();
      await vi.waitFor(() => expect(sessionA.state).toBe('stopped'));
    });

    it('stop event from Session A does not delete Session B at the same key', async () => {
      // Track which sessions the factory creates so we can reference them
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      // Create Session A
      const resultA = await manager.getOrCreateHlsSession(
        channelUuid,
        'token-a',
        connection,
        { streamMode: 'hls' },
      );
      expect(resultA.isSuccess()).toBe(true);
      const sessionA = sessions[0]!;
      expect(manager.getHlsSession(channelUuid)).toBe(sessionA);

      // End Session A through the manager (simulates user stopping stream)
      await manager.endSession(channelUuid, 'hls');
      expect(manager.getHlsSession(channelUuid)).toBeUndefined();

      // Create Session B at the same key (user starts stream again)
      const resultB = await manager.getOrCreateHlsSession(
        channelUuid,
        'token-b',
        connection,
        { streamMode: 'hls' },
      );
      expect(resultB.isSuccess()).toBe(true);
      const sessionB = sessions[1]!;
      expect(sessionB).not.toBe(sessionA);
      expect(manager.getHlsSession(channelUuid)).toBe(sessionB);

      // Session A's delayed 'stop' event fires (stale event from the old session)
      sessionA.emit('stop');

      // Session B must still be in the map — the identity guard prevents deletion
      expect(manager.getHlsSession(channelUuid)).toBe(sessionB);
    });

    it('cleanup event from Session A does not delete Session B at the same key', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      // Create Session A
      await manager.getOrCreateHlsSession(channelUuid, 'token-a', connection, {
        streamMode: 'hls',
      });
      const sessionA = sessions[0]!;

      // End Session A
      await manager.endSession(channelUuid, 'hls');

      // Create Session B
      await manager.getOrCreateHlsSession(channelUuid, 'token-b', connection, {
        streamMode: 'hls',
      });
      const sessionB = sessions[1]!;
      expect(manager.getHlsSession(channelUuid)).toBe(sessionB);

      // Session A's delayed 'cleanup' event fires
      sessionA.emit('cleanup');

      // Session B must still be in the map
      expect(manager.getHlsSession(channelUuid)).toBe(sessionB);
    });

    it('stop event from the current session DOES remove it from the map', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, 'token-a', connection, {
        streamMode: 'hls',
      });
      const sessionA = sessions[0]!;
      expect(manager.getHlsSession(channelUuid)).toBe(sessionA);

      // The session's own stop event should still clean up normally
      sessionA.emit('stop');

      expect(manager.getHlsSession(channelUuid)).toBeUndefined();
    });

    it('cleanup event from the current session DOES remove it from the map', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, 'token-a', connection, {
        streamMode: 'hls',
      });
      const sessionA = sessions[0]!;
      expect(manager.getHlsSession(channelUuid)).toBe(sessionA);

      sessionA.emit('cleanup');

      expect(manager.getHlsSession(channelUuid)).toBeUndefined();
    });
  });

  describe('connection staleness and recovery', () => {
    it('session is not stale when heartbeat is within threshold', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, '10.0.0.1', connection, {
        streamMode: 'hls',
      });
      const session = sessions[0]!;

      // Heartbeat was just recorded by getOrCreateHlsSession → addConnection
      expect(session.isStale()).toBe(false);

      // Advance 60 seconds — well within the 120s default threshold
      vi.advanceTimersByTime(60_000);
      session.recordHeartbeat('10.0.0.1');
      expect(session.isStale()).toBe(false);
    });

    it('session becomes stale when heartbeat exceeds threshold', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, '10.0.0.1', connection, {
        streamMode: 'hls',
      });
      const session = sessions[0]!;

      // Advance past the 120s default threshold
      vi.advanceTimersByTime(121_000);
      expect(session.isStale()).toBe(true);
    });

    it('ghost heartbeat: recordHeartbeat after staleness removal does not prevent cleanup', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, '10.0.0.1', connection, {
        streamMode: 'hls',
      });
      const session = sessions[0]!;

      // Advance past staleness threshold
      vi.advanceTimersByTime(121_000);

      // removeStaleConnections drops the connection
      expect(session.isStale()).toBe(true);
      // Connection is now gone from #connections
      expect(session.isKnownConnection('10.0.0.1')).toBe(false);

      // Client sends a segment request → recordHeartbeat is called
      // but this is a "ghost heartbeat" — it updates #heartbeats only
      session.recordHeartbeat('10.0.0.1');

      // Session is STILL stale because #connections is empty
      expect(session.isStale()).toBe(true);
    });

    it('addConnection after staleness removal restores the session', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, '10.0.0.1', connection, {
        streamMode: 'hls',
      });
      const session = sessions[0]!;

      // Advance past staleness threshold
      vi.advanceTimersByTime(121_000);

      // Connection removed by staleness check
      expect(session.isStale()).toBe(true);
      expect(session.isKnownConnection('10.0.0.1')).toBe(false);

      // The fix: fragment route checks isKnownConnection and re-adds
      session.addConnection('10.0.0.1', { ip: '10.0.0.1' });
      session.recordHeartbeat('10.0.0.1');

      // Session is no longer stale
      expect(session.isStale()).toBe(false);
      expect(session.isKnownConnection('10.0.0.1')).toBe(true);
    });

    it('cleanupStaleSessions does not kill session with re-added connection', async () => {
      const sessions: StubHlsSession[] = [];
      const manager = makeSessionManager((channel, options) => {
        const s = new StubHlsSession(channel, options);
        sessions.push(s);
        return s;
      });

      await manager.getOrCreateHlsSession(channelUuid, '10.0.0.1', connection, {
        streamMode: 'hls',
      });
      const session = sessions[0]!;

      // Advance past staleness threshold
      vi.advanceTimersByTime(121_000);

      // First cleanup pass: marks as stale, removes connection
      manager.cleanupStaleSessions();

      // Simulate the fix: client requests a segment, connection is re-added
      session.addConnection('10.0.0.1', { ip: '10.0.0.1' });
      session.recordHeartbeat('10.0.0.1');

      // Grace period elapses (15s default)
      vi.advanceTimersByTime(16_000);

      // Session should still be in the manager — cleanup was aborted
      // because #connections is non-empty when the timer fires
      expect(manager.getHlsSession(channelUuid)).toBe(session);
    });
  });
});

describe('tune-in recovery', () => {
  test.each(['endSession', 'endSessionInBackground'] as const)(
    '%s of an old instance preserves its replacement',
    async (method) => {
      const manager = makeSessionManager(
        (channel, opts) => new StubHlsSession(channel, opts),
      );
      const old = (
        await manager.getOrCreateHlsSession(channelUuid, 'old', connection)
      ).get();
      await manager.endSession(old);
      const current = (
        await manager.getOrCreateHlsSession(channelUuid, 'new', connection)
      ).get();
      await manager[method](old);
      expect(manager.getHlsSession(channelUuid)).toBe(current);
      expect(current.started).toBe(true);
      await manager.endSession(current);
    },
  );

  test('an errored session is replaced instead of reused', async () => {
    const manager = makeSessionManager(
      (channel, opts) => new StubHlsSession(channel, opts),
    );
    const old = (
      await manager.getOrCreateHlsSession(channelUuid, 'old', connection)
    ).get();
    (old as unknown as StubHlsSession).markError();
    const result = await manager.getOrCreateHlsSession(
      channelUuid,
      'new',
      connection,
    );
    expect(result.isSuccess()).toBe(true);
    expect(result.get()).not.toBe(old);
    await manager.endSession(result.get());
  });

  test('a wrapper waiting for its first backing session survives a second tune', async () => {
    class Wrapper extends ConcatSession {
      protected override async startInternal() {}
      protected override async stopInternal() {
        this.emit('stop');
      }
    }
    const factory = vi.fn((channel, opts) => new Wrapper(channel, opts));
    const manager = makeSessionManager(
      (channel, opts) => new StubHlsSession(channel, opts),
      factory,
    );
    const options = { sessionType: 'hls_concat', audioOnly: false } as const;
    const one = (
      await manager.getOrCreateConcatSession(
        channelUuid,
        'one',
        connection,
        options,
      )
    ).get();
    const two = (
      await manager.getOrCreateConcatSession(
        channelUuid,
        'two',
        connection,
        options,
      )
    ).get();
    expect(two).toBe(one);
    expect(factory).toHaveBeenCalledOnce();
    await manager.endSession(one);
  });

  test('a wrapper bound to a missing backing instance is replaced', async () => {
    class Wrapper extends ConcatSession {
      protected override async startInternal() {}
      protected override async stopInternal() {
        this.emit('stop');
      }
    }
    const factory = vi.fn((channel, opts) => new Wrapper(channel, opts));
    const manager = makeSessionManager(
      (channel, opts) => new StubHlsSession(channel, opts),
      factory,
    );
    const options = { sessionType: 'hls_concat', audioOnly: false } as const;
    const old = (
      await manager.getOrCreateConcatSession(
        channelUuid,
        'one',
        connection,
        options,
      )
    ).get();
    old.underlyingSessionId = 'previous-backing-instance';
    const current = (
      await manager.getOrCreateConcatSession(
        channelUuid,
        'two',
        connection,
        options,
      )
    ).get();
    expect(current).not.toBe(old);
    expect(current.started).toBe(true);
    await manager.endSession(current);
  });
});

test('obsolete teardown cannot pause an on-demand channel during replacement lookup', async () => {
  const manager = makeSessionManager(
    (channel, opts) => new StubHlsSession(channel, opts),
  );
  const internals = manager as unknown as {
    channelDB: IChannelDB;
    onDemandChannelService: OnDemandChannelService;
  };
  const old = (
    await manager.getOrCreateHlsSession(channelUuid, 'old', connection)
  ).get();
  old.removeConnection('old');
  const pause = vi.spyOn(internals.onDemandChannelService, 'pauseChannel');
  pause.mockClear();
  (old as unknown as StubHlsSession).markError();
  let release: (channel: ChannelOrmWithTranscodeConfig) => void = () => {};
  const lookup = new Promise<ChannelOrmWithTranscodeConfig>((resolve) => {
    release = resolve;
  });
  const query = vi
    .spyOn(internals.channelDB, 'getChannelOrm')
    .mockReturnValueOnce(lookup);
  query.mockClear();
  const replacement = manager.getOrCreateHlsSession(
    channelUuid,
    'new',
    connection,
  );
  await vi.waitFor(() => expect(query).toHaveBeenCalled());
  expect(manager.getHlsSession(channelUuid)).toBeUndefined();
  old.emit('stop');
  await Promise.resolve();
  expect(pause).not.toHaveBeenCalled();
  release(makeChannel());
  const current = (await replacement).get();
  expect(current).not.toBe(old);
  await manager.endSession(current);
});

test('stale wrapper teardown cannot pause an on-demand channel during replacement lookup', async () => {
  class Wrapper extends ConcatSession {
    protected override async startInternal() {}
    protected override async stopInternal() {
      this.emit('stop');
    }
  }
  const factory = vi.fn((channel, opts) => new Wrapper(channel, opts));
  const manager = makeSessionManager(
    (channel, opts) => new StubHlsSession(channel, opts),
    factory,
  );
  const internals = manager as unknown as {
    channelDB: IChannelDB;
    onDemandChannelService: OnDemandChannelService;
  };
  const options = { sessionType: 'hls_concat', audioOnly: false } as const;
  const old = (
    await manager.getOrCreateConcatSession(
      channelUuid,
      'old',
      connection,
      options,
    )
  ).get();
  old.removeConnection('old');
  old.underlyingSessionId = 'missing';
  const pause = vi.spyOn(internals.onDemandChannelService, 'pauseChannel');
  pause.mockClear();
  let release: (channel: ChannelOrmWithTranscodeConfig) => void = () => {};
  const lookup = new Promise<ChannelOrmWithTranscodeConfig>((resolve) => {
    release = resolve;
  });
  const query = vi
    .spyOn(internals.channelDB, 'getChannelOrm')
    .mockReturnValueOnce(lookup);
  query.mockClear();
  const replacement = manager.getOrCreateConcatSession(
    channelUuid,
    'new',
    connection,
    options,
  );
  await vi.waitFor(() => expect(query).toHaveBeenCalled());
  expect(old.stopped).toBe(true);
  expect(pause).not.toHaveBeenCalled();
  release(makeChannel());
  const current = (await replacement).get();
  expect(current).not.toBe(old);
  await manager.endSession(current);
});

test('conditional retirement preserves a viewer registered while startup held the channel lock', async () => {
  const manager = makeSessionManager(
    (channel, opts) => new StubHlsSession(channel, opts),
  );
  const session = (
    await manager.getOrCreateHlsSession(channelUuid, 'old', connection)
  ).get();
  session.removeConnection('old');
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(session, 'started', 'get').mockReturnValue(false);
  const startup = vi.spyOn(session, 'start').mockImplementation(() => ready);
  const stop = vi.spyOn(session, 'stop');
  const joining = manager.getOrCreateHlsSession(channelUuid, 'new', connection);
  await vi.waitFor(() => expect(startup).toHaveBeenCalled());
  const retiring = manager.endSessionInBackground(session, { ifUnused: true });
  release();
  expect((await joining).isSuccess()).toBe(true);
  await retiring;
  expect(manager.getHlsSession(channelUuid)).toBe(session);
  expect(session.isKnownConnection('new')).toBe(true);
  expect(stop).not.toHaveBeenCalled();
  await manager.endSession(session);
});

test('conditional retirement still removes an unused session', async () => {
  const manager = makeSessionManager(
    (channel, opts) => new StubHlsSession(channel, opts),
  );
  const session = (
    await manager.getOrCreateHlsSession(channelUuid, 'old', connection)
  ).get();
  session.removeConnection('old');
  await manager.endSessionInBackground(session, { ifUnused: true });
  expect(manager.getHlsSession(channelUuid)).toBeUndefined();
});

test.each([
  'lookup rejection',
  'missing channel',
  'factory exception',
] as const)(
  'failed replacement pauses an unwatched channel: %s',
  async (failure) => {
    let failFactory = false;
    const manager = makeSessionManager((channel, opts) => {
      if (failFactory) throw new Error('factory failed');
      return new StubHlsSession(channel, opts);
    });
    const internals = manager as unknown as {
      channelDB: IChannelDB;
      onDemandChannelService: OnDemandChannelService;
    };
    const old = (
      await manager.getOrCreateHlsSession(channelUuid, 'old', connection)
    ).get();
    old.removeConnection('old');
    (old as unknown as StubHlsSession).markError();
    const pause = vi.spyOn(internals.onDemandChannelService, 'pauseChannel');
    pause.mockClear();
    if (failure === 'lookup rejection')
      vi.spyOn(internals.channelDB, 'getChannelOrm').mockRejectedValueOnce(
        new Error('lookup failed'),
      );
    if (failure === 'missing channel')
      vi.spyOn(internals.channelDB, 'getChannelOrm').mockResolvedValueOnce(
        undefined,
      );
    failFactory = failure === 'factory exception';
    const result = await manager.getOrCreateHlsSession(
      channelUuid,
      'new',
      connection,
    );
    expect(result.isFailure()).toBe(true);
    expect(pause).toHaveBeenCalledOnce();
    old.emit('stop');
    expect(pause).toHaveBeenCalledOnce();
  },
);

test('a failed replacement preserves another active session on the channel', async () => {
  const manager = makeSessionManager(
    (channel, opts) => new StubHlsSession(channel, opts),
  );
  const internals = manager as unknown as {
    channelDB: IChannelDB;
    onDemandChannelService: OnDemandChannelService;
  };
  const old = (
    await manager.getOrCreateHlsSession(channelUuid, 'old', connection)
  ).get();
  const other = (
    await manager.getOrCreateHlsSession(channelUuid, 'other', connection, {
      streamMode: 'hls_direct_v2',
    })
  ).get();
  old.removeConnection('old');
  (old as unknown as StubHlsSession).markError();
  const pause = vi.spyOn(internals.onDemandChannelService, 'pauseChannel');
  pause.mockClear();
  vi.spyOn(internals.channelDB, 'getChannelOrm').mockRejectedValueOnce(
    new Error('lookup failed'),
  );
  expect(
    (
      await manager.getOrCreateHlsSession(channelUuid, 'new', connection)
    ).isFailure(),
  ).toBe(true);
  old.emit('stop');
  expect(pause).not.toHaveBeenCalled();
  expect(other.started).toBe(true);
  await manager.endSession(other);
});

test('a failed stale-wrapper replacement pauses its unwatched channel', async () => {
  class Wrapper extends ConcatSession {
    protected override async startInternal() {}
    protected override async stopInternal() {
      this.emit('stop');
    }
  }
  const manager = makeSessionManager(
    (channel, opts) => new StubHlsSession(channel, opts),
    vi.fn((channel, opts) => new Wrapper(channel, opts)),
  );
  const internals = manager as unknown as {
    channelDB: IChannelDB;
    onDemandChannelService: OnDemandChannelService;
  };
  const options = { sessionType: 'hls_concat', audioOnly: false } as const;
  const old = (
    await manager.getOrCreateConcatSession(
      channelUuid,
      'old',
      connection,
      options,
    )
  ).get();
  old.removeConnection('old');
  old.underlyingSessionId = 'missing';
  const pause = vi.spyOn(internals.onDemandChannelService, 'pauseChannel');
  pause.mockClear();
  vi.spyOn(internals.channelDB, 'getChannelOrm').mockRejectedValueOnce(
    new Error('lookup failed'),
  );
  expect(
    (
      await manager.getOrCreateConcatSession(
        channelUuid,
        'new',
        connection,
        options,
      )
    ).isFailure(),
  ).toBe(true);
  expect(pause).toHaveBeenCalledOnce();
});
