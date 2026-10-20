import type {
  RegisteredRouter,
  ShouldBlockFn,
  UseBlockerOpts,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderWithProviders } from '@/test/utils';
import UnsavedNavigationAlert from './UnsavedNavigationAlert';

type BlockerOpts = UseBlockerOpts<RegisteredRouter, true>;
type BlockerArgs = Parameters<ShouldBlockFn>[0];
type BlockerLocation = BlockerArgs['next'];

const { useBlockerMock } = vi.hoisted(() => ({
  useBlockerMock: vi.fn((_opts: BlockerOpts) => ({
    status: 'idle' as const,
    current: undefined,
    next: undefined,
    action: undefined,
    proceed: undefined,
    reset: undefined,
  })),
}));

vi.mock('@tanstack/react-router', () => ({
  useBlocker: useBlockerMock,
}));

const programmingPage: Extract<
  BlockerLocation,
  { fullPath: '/channels/$channelId/programming' }
> = {
  routeId: '/channels_/$channelId/programming/',
  fullPath: '/channels/$channelId/programming',
  pathname: '/channels/abc/programming',
  params: { channelId: 'abc' },
  search: {},
};

const addProgrammingPage: Extract<
  BlockerLocation,
  { fullPath: '/channels/$channelId/programming/add' }
> = {
  routeId: '/channels_/$channelId/programming/add',
  fullPath: '/channels/$channelId/programming/add',
  pathname: '/channels/abc/programming/add',
  params: { channelId: 'abc' },
  search: {},
};

const channelEditPage: Extract<
  BlockerLocation,
  { fullPath: '/channels/$channelId/edit' }
> = {
  routeId: '/channels_/$channelId/edit/',
  fullPath: '/channels/$channelId/edit',
  pathname: '/channels/abc/edit',
  params: { channelId: 'abc' },
  search: {},
};

const xmltvSettingsPage: Extract<
  BlockerLocation,
  { fullPath: '/settings/xmltv' }
> = {
  routeId: '/settings/xmltv',
  fullPath: '/settings/xmltv',
  pathname: '/settings/xmltv',
  params: {},
  search: {},
};

function lastBlockerOpts(): BlockerOpts {
  const call = useBlockerMock.mock.lastCall;
  if (call === undefined) {
    throw new Error('UnsavedNavigationAlert did not call useBlocker');
  }
  return call[0];
}

// Mirrors how @tanstack/history's beforeunload handler reads the option: it
// treats an unset value as enabled and never consults shouldBlockFn.
function beforeUnloadPromptEnabled(opts: BlockerOpts): boolean {
  const enabled = opts.enableBeforeUnload ?? true;
  return typeof enabled === 'function' ? enabled() : enabled;
}

async function shouldBlock(
  opts: BlockerOpts,
  next: BlockerLocation,
  current: BlockerLocation = programmingPage,
): Promise<boolean> {
  return await opts.shouldBlockFn({
    action: 'PUSH',
    current,
    next,
  });
}

describe('UnsavedNavigationAlert', () => {
  beforeEach(() => {
    useBlockerMock.mockClear();
  });

  describe('browser beforeunload prompt', () => {
    test('is off when the form is clean', () => {
      renderWithProviders(<UnsavedNavigationAlert isDirty={false} />);

      expect(beforeUnloadPromptEnabled(lastBlockerOpts())).toBe(false);
    });

    test('is on when the form is dirty', () => {
      renderWithProviders(<UnsavedNavigationAlert isDirty={true} />);

      expect(beforeUnloadPromptEnabled(lastBlockerOpts())).toBe(true);
    });

    test('follows isDirty as it changes', () => {
      const { rerender } = renderWithProviders(
        <UnsavedNavigationAlert isDirty={false} />,
      );
      expect(beforeUnloadPromptEnabled(lastBlockerOpts())).toBe(false);

      rerender(<UnsavedNavigationAlert isDirty={true} />);
      expect(beforeUnloadPromptEnabled(lastBlockerOpts())).toBe(true);

      rerender(<UnsavedNavigationAlert isDirty={false} />);
      expect(beforeUnloadPromptEnabled(lastBlockerOpts())).toBe(false);
    });

    test('is off for a clean form even with exempt paths', () => {
      renderWithProviders(
        <UnsavedNavigationAlert
          isDirty={false}
          exceptTargetPaths={['/channels/$channelId/programming/add']}
        />,
      );

      expect(beforeUnloadPromptEnabled(lastBlockerOpts())).toBe(false);
    });
  });

  describe('in-app navigation blocking', () => {
    test('uses the resolver so the dialog can ask the user', () => {
      renderWithProviders(<UnsavedNavigationAlert isDirty={true} />);

      expect(lastBlockerOpts().withResolver).toBe(true);
    });

    test('does not block when the form is clean', async () => {
      renderWithProviders(<UnsavedNavigationAlert isDirty={false} />);

      await expect(
        shouldBlock(lastBlockerOpts(), xmltvSettingsPage),
      ).resolves.toBe(false);
    });

    test('blocks when the form is dirty', async () => {
      renderWithProviders(<UnsavedNavigationAlert isDirty={true} />);

      await expect(
        shouldBlock(lastBlockerOpts(), xmltvSettingsPage),
      ).resolves.toBe(true);
    });

    test('lets a dirty form navigate to an exempt path', async () => {
      renderWithProviders(
        <UnsavedNavigationAlert
          isDirty={true}
          exceptTargetPaths={['/channels/$channelId/programming/add']}
        />,
      );

      await expect(
        shouldBlock(lastBlockerOpts(), addProgrammingPage),
      ).resolves.toBe(false);
    });

    test('lets a dirty form change only the query string of its page, such as a tab', async () => {
      renderWithProviders(<UnsavedNavigationAlert isDirty={true} />);

      await expect(
        shouldBlock(
          lastBlockerOpts(),
          { ...channelEditPage, search: { tab: 'flex' } },
          channelEditPage,
        ),
      ).resolves.toBe(false);
    });

    test('still blocks a dirty form going to the same route of another entity', async () => {
      renderWithProviders(<UnsavedNavigationAlert isDirty={true} />);

      await expect(
        shouldBlock(
          lastBlockerOpts(),
          {
            ...channelEditPage,
            pathname: '/channels/def/edit',
            params: { channelId: 'def' },
          },
          channelEditPage,
        ),
      ).resolves.toBe(true);
    });

    test('still blocks a dirty form going anywhere else', async () => {
      renderWithProviders(
        <UnsavedNavigationAlert
          isDirty={true}
          exceptTargetPaths={['/channels/$channelId/programming/add']}
        />,
      );

      await expect(
        shouldBlock(lastBlockerOpts(), xmltvSettingsPage),
      ).resolves.toBe(true);
    });
  });
});
