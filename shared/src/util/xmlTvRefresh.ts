/**
 * How the scheduled full guide rebuild's timer and the guide's length fit
 * together. Each rebuild writes `programmingHours` (EPG Hours) of guide from
 * when it runs, and nothing adds to it before the next rebuild, so the guide
 * has to last until then. Shared so the server's check and schedule and the
 * settings page agree.
 */

/**
 * The time between scheduled rebuilds for a refresh timer, in hours: the timer
 * rounded to a whole hour, at least 1 and at most 24. The rebuilds are hours of
 * the day, so a timer of 24 hours or more rebuilds once a day.
 */
export function xmlTvRefreshIntervalHours(refreshHours: number): number {
  return Math.min(24, Math.max(1, Math.round(refreshHours)));
}

/**
 * The shortest guide, in hours, that lasts until the next scheduled rebuild:
 * two hours longer than the time between rebuilds, covering two-hour seasonal
 * rollbacks such as Antarctica/Troll as well as the usual one-hour change.
 */
export function minimumXmlTvGuideHours(refreshHours: number): number {
  return xmlTvRefreshIntervalHours(refreshHours) + 2;
}

/**
 * The time between the rebuilds the server schedules, in hours: the refresh
 * timer's, shortened when the guide is too short to last that long (settings
 * saved before a timer had to fit in the guide), so the guide never runs out.
 */
export function xmlTvScheduledIntervalHours(settings: {
  refreshHours: number;
  programmingHours: number;
}): number {
  const longestTheGuideCovers = Math.max(
    1,
    Math.floor(effectiveXmlTvGuideHours(settings.programmingHours)) - 2,
  );
  return Math.min(
    xmlTvRefreshIntervalHours(settings.refreshHours),
    longestTheGuideCovers,
  );
}

// Old settings allowed guides shorter than the minimum hourly schedule can cover.
export function effectiveXmlTvGuideHours(programmingHours: number): number {
  return Math.max(minimumXmlTvGuideHours(1), programmingHours);
}
