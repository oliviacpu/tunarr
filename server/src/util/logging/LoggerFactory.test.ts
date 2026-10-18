import { getPrettyStreamOpts } from './LoggerFactory.ts';

describe('getPrettyStreamOpts', () => {
  test('prints local time with its offset, never a literal Z', () => {
    const format = getPrettyStreamOpts().translateTime;
    expect(typeof format).toBe('string');
    expect(format).toMatch(/^SYS:/);
    expect(format).not.toContain("'Z'");
    expect(format).toMatch(/ o$/);
  });
});
