import { ThemeProvider, createTheme } from '@mui/material';
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
  test.each(['light', 'dark'] as const)(
    'uses the %s theme divider for a compact sliver',
    (mode) => {
      const divider =
        mode === 'light'
          ? 'rgba(12, 34, 56, 0.25)'
          : 'rgba(210, 220, 230, 0.5)';
      const theme = createTheme({ palette: { mode, divider } });
      renderWithProviders(
        <ThemeProvider theme={theme}>
          <TvGuideItem
            left={0}
            width={1}
            compact
            cellStyle={typeStyle(schemePalette(mode), 'flex')}
          >
            sliver
          </TvGuideItem>
        </ThemeProvider>,
      );
      expect(getComputedStyle(screen.getByText('sliver')).boxShadow).toBe(
        `inset -1px 0 0 ${divider}`,
      );
    },
  );

  test('fills a program with its ramp colour and the primary text colour', () => {
    const style = renderItem({});
    const content = typeStyle(palette, 'content', 'show.a');
    expect(style.backgroundColor).toBe(toRgb(content.background));
    expect(style.outline).not.toContain('dashed');
    expect(style.cursor).toBe('default');
  });

  test('draws the ring it is given', () => {
    const style = renderItem({ ringColor: palette.primary.main });
    expect(style.boxShadow).toContain(palette.primary.main);
  });

  test('draws no ring without one', () => {
    const style = renderItem({});
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
  function renderCell(
    type: GuideCellType,
    pixelWidth: number | undefined,
    nowPlaying = false,
  ) {
    return renderWithProviders(
      <TvGuideCell
        left={0}
        width={20}
        pixelWidth={pixelWidth}
        nowPlaying={nowPlaying}
        cellStyle={typeStyle(palette, type, 'show.a')}
        title="The Title"
        subtitle="S01E01 - Pilot"
      />,
    );
  }

  test('puts a movie icon before a movie title in a 100px cell', () => {
    renderCell('movie', 100);
    expect(screen.getByTestId('MovieIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('TvIcon')).not.toBeInTheDocument();
    expect(screen.getByText('The Title')).toBeInTheDocument();
  });

  test('puts a TV icon before an episode title in a 100px cell', () => {
    renderCell('episode', 100);
    expect(screen.getByTestId('TvIcon')).toBeInTheDocument();
    expect(screen.queryByTestId('MovieIcon')).not.toBeInTheDocument();
    expect(screen.getByText('The Title')).toBeInTheDocument();
  });

  test('puts an arrow before a redirect title in a 100px cell', () => {
    renderCell('redirect', 100);
    expect(screen.getByTestId('ArrowForwardIcon')).toBeInTheDocument();
  });

  test('draws no icon on a flex gap', () => {
    const { container } = renderCell('flex', 100);
    expect(container.querySelector('svg')).toBeNull();
  });

  test('keeps the text but drops the icon in a 40px cell', () => {
    const { container } = renderCell('movie', 40);
    expect(screen.getByText('The Title')).toBeInTheDocument();
    expect(screen.getByText('S01E01 - Pilot')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  test('draws no icon or text on a sliver, and keeps the title as a tooltip', () => {
    const { container } = renderCell('movie', 16);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText('The Title')).not.toBeInTheDocument();
    expect(screen.getByTitle('The Title')).toBeInTheDocument();
  });

  test('rings the now-playing cell in the primary colour', () => {
    const { container } = renderCell('movie', 100, true);
    const cell = container.firstElementChild;
    if (cell === null) {
      throw new Error('The cell did not render');
    }
    expect(getComputedStyle(cell).boxShadow).toContain(palette.primary.main);
  });

  test('does not ring a cell that is not on air', () => {
    const { container } = renderCell('movie', 100, false);
    const cell = container.firstElementChild;
    if (cell === null) {
      throw new Error('The cell did not render');
    }
    expect(getComputedStyle(cell).boxShadow).not.toContain(
      palette.primary.main,
    );
  });

  test('shows text without the icon before the grid is measured', () => {
    const { container } = renderCell('movie', undefined);
    expect(screen.getByText('The Title')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });
});
