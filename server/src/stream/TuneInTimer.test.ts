import { CountingPassThrough, TuneInTimer } from './TuneInTimer.ts';

describe('TuneInTimer', () => {
  test('marks are measured from the start and keep their first value', () => {
    let t = 1000;
    const timer = new TuneInTimer(() => t);
    t = 1012.4;
    timer.mark('session');
    t = 3834.6;
    timer.mark('first byte');
    t = 9000;
    timer.mark('first byte'); // ignored: already marked
    expect(timer.ms('session')).toBe(12);
    expect(timer.ms('first byte')).toBe(2835);
    expect(timer.ms('never')).toBeUndefined();
    expect(timer.has('session')).toBe(true);
    expect(timer.elapsedMs()).toBe(8000);
    expect(timer.summary()).toBe('session 12 ms, first byte 2835 ms');
  });
});

describe('CountingPassThrough', () => {
  test('counts bytes and reports the first chunk once', async () => {
    let firsts = 0;
    const stream = new CountingPassThrough(() => firsts++);
    const out: Buffer[] = [];
    stream.on('data', (c: Buffer) => out.push(c));
    const done = new Promise((resolve) => stream.on('end', resolve));
    stream.write(Buffer.alloc(188));
    stream.write('abc');
    stream.end(Buffer.alloc(376));
    await done;
    expect(stream.bytes).toBe(188 + 3 + 376);
    expect(firsts).toBe(1);
    expect(Buffer.concat(out).length).toBe(188 + 3 + 376);
  });
});
