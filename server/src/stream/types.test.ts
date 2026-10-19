import { describe, expect, it } from 'vitest';
import { HttpStreamSource } from './types.ts';

describe('HttpStreamSource.redact', () => {
  it('redacts credential headers and query-string tokens', () => {
    const source = new HttpStreamSource(
      'http://plex:32400/photo?X-Plex-Token=abc123',
      {
        'X-Plex-Token': 'abc123',
        Authorization: 'Bearer abc123',
        Accept: 'image/*',
      },
    );

    source.redact();

    expect(source.path).toBe('http://plex:32400/photo?X-Plex-Token=REDACTED');
    expect(source.extraHeaders).toEqual({
      'X-Plex-Token': 'REDACTED',
      Authorization: 'REDACTED',
      Accept: 'image/*',
    });
  });

  it('redacts every key form, whatever its case', () => {
    const source = new HttpStreamSource(
      'http://jf:8096/Videos/1/stream?ApiKey=abc123&x-emby-token=def456',
    );

    source.redact();

    expect(source.path).toBe(
      'http://jf:8096/Videos/1/stream?ApiKey=REDACTED&x-emby-token=REDACTED',
    );
  });
});
