import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  format: 'json',
  output: [] as string[],
  ring: [] as string[],
}));

vi.mock('../config/bootstrap.js', () => ({
  bootstrap: {
    get logFormat() {
      return fixture.format;
    },
    logLevel: 'info',
  },
}));
vi.mock('../config/index.js', () => ({ config: { logging: {} } }));
vi.mock('./ring-buffer.js', () => ({
  logRingBuffer: { push: (line: string) => fixture.ring.push(line) },
}));
vi.mock('pino', async (importOriginal) => {
  const { default: real } = await importOriginal<{
    default: typeof import('pino');
  }>();
  const replacement = Object.assign(
    (...args: Parameters<typeof real>) => real(...args),
    real,
    {
      destination: () =>
        new Writable({
          write(chunk, _encoding, done) {
            fixture.output.push(chunk.toString());
            done();
          },
        }),
    }
  );
  return { default: replacement };
});

beforeEach(() => {
  vi.resetModules();
  fixture.output.length = 0;
  fixture.ring.length = 0;
});

describe('log URL redaction', () => {
  it.each(['json', 'text'])(
    'protects %s output and the dashboard',
    async (format) => {
      fixture.format = format;
      const stdout = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk) => {
          fixture.output.push(String(chunk));
          return true;
        });
      try {
        const { createLogger } = await import('./logger.js');
        const logger = createLogger('test').child({
          url: 'redis://fake-user:fake-password@localhost:6379',
        });
        logger.error(
          {
            err: new Error('https://example.test/?token=fake-token'),
          },
          'Connecting to redis://fake-user:fake-password@localhost:6379'
        );

        for (const lines of [fixture.output, fixture.ring]) {
          expect(lines.length).toBeGreaterThan(0);
          const text = lines.join('');
          expect(text).not.toContain('fake-user');
          expect(text).not.toContain('fake-password');
          expect(text).not.toContain('fake-token');
          expect(text).toContain('<redacted>');
          expect(text).toContain('localhost:6379');
        }
        expect(() => JSON.parse(fixture.ring[0])).not.toThrow();
      } finally {
        stdout.mockRestore();
      }
    }
  );
});
