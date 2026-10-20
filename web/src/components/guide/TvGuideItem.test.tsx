import { renderWithProviders, screen } from '@/test/utils';
import { describe, expect, test } from 'vitest';
import { schemePalette } from '../../test/contrast.ts';
import { TvGuideCell } from './TvGuideCell.tsx';
import { TvGuideItem } from './TvGuideItem.tsx';
import { type GuideCellType, typeStyle } from './guideColors.ts';

const palette = schemePalette('light');

const toRgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

function renderItem(props: Partial<Parameters<typeof TvGuideItem>[0]>) {
  renderWithProviders(
    <TvGuideItem
      left={10}
      width={20}
      cellStyle={typeStyle(palette, 'content', 'show.a')}
      {...props}
    >
      cell
    </TvGuideItem>,
  );
  return getComputedStyle(screen.getByText('cell'));
}

describe('TvGuideItem', () => {
  test('fills a program with its ramp colour and the primary text colour', () => {
    const style = renderItem({});
    const content = typeStyle(palette, 'content', 'show.a');
    expect(style.backgroundColor).toBe(toRgb(content.background));
    expect(style.outline).not.toContain('dashed');
    expect(style.cursor).toBe('default');
  });

  test('rings the now-playing cell in primary', () => {
    const style = renderItem({ nowPlaying: true });
    expect(style.boxShadow).toContain(palette.primary.main);
  });

  test('does not ring a cell that is not on air', () => {
    const style = renderItem({ nowPlaying: false });
    expect(style.boxShadow).not.toContain(palette.primary.main);
  });

  test('draws a flex gap on the page background with a dashed outline', () => {
    const style = renderItem({ cellStyle: typeStyle(palette, 'flex') });
    expect(style.backgroundColor).toBe(toRgb(palette.background.default));
    expect(style.outline).toBe(`1px dashed ${palette.divider}`);
  });

  test('shows the hand cursor only on cells that open details', () => {
    const style = renderItem({ clickable: true });
    expect(style.cursor).toBe('pointer');
  });
});

describe('TvGuideCell', () => {
  function renderCell(type: GuideCellType, compact = false) {
    return renderWithProviders(
      <TvGuideCell
        left={0}
        width={20}
        compact={compact}
        cellStyle={typeStyle(palette, type, 'show.a')}
        title="The Title"
        subtitle="S01E01 - Pilot"
      />,
    );
  }

  test('puts a movie icon before a movie title', () => {
    renderCell('movie');
    expect(screen.getByTestId('MovieIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('TvIcon')).not.toBeInTheDocument();
    expect(screen.getByText('The Title')).toBeInTheDocument();
  });

  test('puts a TV icon before an episode title', () => {
    renderCell('episode');
    expect(screen.getByTestId('TvIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('MovieIcon')).not.toBeInTheDocument();
  });

  test('puts an arrow before a redirect title', () => {
    renderCell('redirect');
    expect(screen.getByTestId('ArrowForwardIcon')).toBeInTheDocument();
  });

  test('draws no icon on a flex gap', () => {
    const { container } = renderCell('flex');
    expect(container.querySelector('svg')).toBeNull();
  });

  test('draws no icon or text on a sliver, and keeps the title as a tooltip', () => {
    const { container } = renderCell('movie', true);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText('The Title')).not.toBeInTheDocument();
    expect(screen.getByTitle('The Title')).toBeInTheDocument();
  });
});
