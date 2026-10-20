import { renderWithProviders, screen } from '@/test/utils';
import { describe, expect, test } from 'vitest';
import { ChannelEditorTabs, useChannelTabLabels } from './channelFieldTabs.ts';

function TabLabels() {
  const labels = useChannelTabLabels();
  return (
    <ul>
      {ChannelEditorTabs.map((tab) => (
        <li key={tab} data-tab={tab}>
          {labels[tab]}
        </li>
      ))}
    </ul>
  );
}

describe('useChannelTabLabels', () => {
  test('labels the channel editor tabs in the words people use', () => {
    renderWithProviders(<TabLabels />);

    const items = screen.getAllByRole('listitem');
    expect(
      items.map((item) => [item.dataset['tab'], item.textContent]),
    ).toEqual([
      ['properties', 'Properties'],
      ['flex', 'Flex'],
      ['guide', 'Guide'],
      ['streaming', 'Streaming'],
      ['watermark', 'Watermark'],
    ]);
  });
});
