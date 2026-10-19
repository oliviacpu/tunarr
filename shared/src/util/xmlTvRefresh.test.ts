import { describe, expect, test } from 'vitest';
import {
  minimumXmlTvGuideHours,
  xmlTvRefreshIntervalHours,
  xmlTvScheduledIntervalHours,
} from './xmlTvRefresh.js';

describe('xmlTvRefreshIntervalHours', () => {
  test('is the timer in whole hours, from 1 to 24', () => {
    expect(xmlTvRefreshIntervalHours(4)).toBe(4);
    expect(xmlTvRefreshIntervalHours(12.5)).toBe(13);
    expect(xmlTvRefreshIntervalHours(0)).toBe(1);
    expect(xmlTvRefreshIntervalHours(-3)).toBe(1);
  });

  test('a timer of 24 hours or more rebuilds once a day', () => {
    expect(xmlTvRefreshIntervalHours(24)).toBe(24);
    expect(xmlTvRefreshIntervalHours(48)).toBe(24);
  });
});

describe('minimumXmlTvGuideHours', () => {
  test('is two hours longer than the time between rebuilds', () => {
    expect(minimumXmlTvGuideHours(4)).toBe(6);
    expect(minimumXmlTvGuideHours(12)).toBe(14);
    // Rounded up to 13 hours between rebuilds
    expect(minimumXmlTvGuideHours(12.5)).toBe(15);
    expect(minimumXmlTvGuideHours(0)).toBe(3);
  });

  test('a 26-hour guide covers any timer of a day or more', () => {
    expect(minimumXmlTvGuideHours(24)).toBe(26);
    expect(minimumXmlTvGuideHours(48)).toBe(26);
  });
});

describe('xmlTvScheduledIntervalHours', () => {
  test("is the timer's when the guide lasts long enough", () => {
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 4, programmingHours: 12 }),
    ).toBe(4);
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 10, programmingHours: 12 }),
    ).toBe(10);
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 48, programmingHours: 72 }),
    ).toBe(24);
  });

  test('is shortened to two hours less than the guide when the guide is too short', () => {
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 12, programmingHours: 12 }),
    ).toBe(10);
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 24, programmingHours: 12 }),
    ).toBe(10);
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 24, programmingHours: 12.5 }),
    ).toBe(10);
  });

  test('is never under an hour', () => {
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 4, programmingHours: 1 }),
    ).toBe(1);
    expect(
      xmlTvScheduledIntervalHours({ refreshHours: 4, programmingHours: 0 }),
    ).toBe(1);
  });

  test('is shortened exactly when the guide is under the minimum', () => {
    // From a 3-hour guide: under that, the hourly floor applies
    for (let refreshHours = 1; refreshHours <= 30; refreshHours++) {
      for (
        let programmingHours = 3;
        programmingHours <= 30;
        programmingHours++
      ) {
        const scheduled = xmlTvScheduledIntervalHours({
          refreshHours,
          programmingHours,
        });
        const context = `every ${refreshHours} h with a ${programmingHours} h guide`;
        expect(
          scheduled < xmlTvRefreshIntervalHours(refreshHours),
          context,
        ).toBe(programmingHours < minimumXmlTvGuideHours(refreshHours));
        // The guide lasts until the next rebuild, an hour late
        expect(scheduled + 2, context).toBeLessThanOrEqual(programmingHours);
      }
    }
  });
});
