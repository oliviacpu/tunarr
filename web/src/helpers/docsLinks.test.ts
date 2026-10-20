import { describe, expect, test } from 'vitest';
import type { DocsPage } from './docsLinks.ts';
import { DocsPages, docsUrl } from './docsLinks.ts';
import bugReportTemplate from '../../../.github/ISSUE_TEMPLATE/bug_report.yaml?raw';

// Every docs page in the repository, keyed by its path under docs/
const DocsSource = '../../../docs/';
const DocsMarkdown = new Map(
  Object.entries(
    import.meta.glob<string>('../../../docs/**/*.md', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([file, markdown]) => [file.slice(DocsSource.length), markdown]),
);

function docsPageAt(pagePath: string): string | undefined {
  return DocsMarkdown.get(pagePath);
}

// Python-Markdown's toc slugify, which mkdocs uses for heading anchors
function slugify(heading: string): string {
  return (
    heading
      .normalize('NFKD')
      // Python encodes to ASCII and drops the rest
      .replace(/[^ -~]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, '-')
  );
}

function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    const heading = inFence ? null : /^#{1,6}\s+(.*?)\s*$/.exec(line);
    if (heading?.[1] === undefined) {
      continue;
    }
    const explicitId = /\{#([\w-]+)\}$/.exec(heading[1]);
    anchors.add(explicitId?.[1] ?? slugify(heading[1]));
  }
  return anchors;
}

const pages = Object.entries(DocsPages) as [DocsPage, string][];

describe('DocsPages', () => {
  test.each(pages)('%s points at a page in docs/', (_, path) => {
    const [pagePath] = path.split('#');
    expect(pagePath).toMatch(/\.md$/);
    expect(docsPageAt(pagePath ?? '')).toBeDefined();
  });

  test.each(pages.filter(([, path]) => path.includes('#')))(
    '%s links to a heading on that page',
    (_, path) => {
      const [pagePath, anchor] = path.split('#');
      const markdown = docsPageAt(pagePath ?? '');
      if (markdown === undefined) {
        throw new Error(`No docs page for ${path}`);
      }
      expect([...headingAnchors(markdown)]).toContain(anchor);
    },
  );

  test('anchors follow the docs site slugs', () => {
    expect(slugify('Closed Captions for HDHomeRun Clients')).toBe(
      'closed-captions-for-hdhomerun-clients',
    );
    expect(slugify('Audio & Subtitles')).toBe('audio-subtitles');
    expect(slugify('Caption appearance (experimental)')).toBe(
      'caption-appearance-experimental',
    );
  });

  test('builds links to the fork documentation source', () => {
    expect(docsUrl('channelStreamMode')).toBe(
      'https://github.com/oliviacpu/tunarr/blob/main/docs/configure/channels/transcoding.md#stream-mode',
    );
  });
});

test('the fork issue form searches and assigns the fork owner', () => {
  expect(bugReportTemplate).toContain(
    'https://github.com/oliviacpu/tunarr/issues',
  );
  expect(bugReportTemplate).toContain('  - oliviacpu');
  expect(bugReportTemplate).not.toContain('chrisbenincasa/tunarr/issues');
  expect(bugReportTemplate).not.toContain('  - chrisbenincasa');
});
