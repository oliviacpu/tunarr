import { describe, expect, test } from 'vitest';
import type { DocsPage } from './docsLinks.ts';
import { DocsPages, docsUrl } from './docsLinks.ts';

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

// The page mkdocs serves at a path: "a/b/" is a/b/index.md or a/b.md
function docsPageAt(pagePath: string): string | undefined {
  const dir = pagePath.replace(/\/$/, '');
  return DocsMarkdown.get(`${dir}/index.md`) ?? DocsMarkdown.get(`${dir}.md`);
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
    expect(pagePath).toMatch(/\/$/);
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

  test('builds links on the docs site', () => {
    expect(docsUrl('channelStreamMode')).toBe(
      'https://tunarr.com/configure/channels/transcoding/#stream-mode',
    );
  });
});
