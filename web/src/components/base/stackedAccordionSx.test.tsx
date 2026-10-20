import { renderWithProviders, screen } from '@/test/utils';
import { Accordion, AccordionSummary } from '@mui/material';
import { describe, expect, test } from 'vitest';
import { stackedAccordionSx } from './stackedAccordionSx.ts';

const accordionOf = (title: string) => {
  const root = screen.getByText(title).closest('.MuiAccordion-root');
  if (root === null) {
    throw new Error(`No accordion holds ${title}`);
  }
  return root;
};

describe('stackedAccordionSx', () => {
  test('neighbouring accordions share one border line', () => {
    renderWithProviders(
      <div>
        {['First', 'Second', 'Third'].map((title) => (
          <Accordion key={title} disableGutters sx={stackedAccordionSx}>
            <AccordionSummary>{title}</AccordionSummary>
          </Accordion>
        ))}
      </div>,
    );

    // The theme draws a full border on each; the ones after the first lose
    // their top edge, where the previous accordion's bottom edge already is
    expect(getComputedStyle(accordionOf('First')).borderTopWidth).toBe('1px');
    expect(getComputedStyle(accordionOf('Second')).borderTopWidth).toMatch(
      /^0(px)?$/,
    );
    expect(getComputedStyle(accordionOf('Third')).borderTopWidth).toMatch(
      /^0(px)?$/,
    );
    expect(getComputedStyle(accordionOf('Second')).borderBottomWidth).toBe(
      '1px',
    );
  });
});
