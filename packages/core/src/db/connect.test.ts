import { afterEach, describe, expect, it } from 'vitest';
import { createDriver } from './connect.js';

const ORIGINAL_VERCEL = process.env.VERCEL;

afterEach(() => {
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
});

describe('createDriver', () => {
  it('rejects SQLite on Vercel', () => {
    process.env.VERCEL = '1';
    expect(() => createDriver('sqlite://./data/db.sqlite')).toThrow(
      /SQLite is not supported on Vercel/
    );
  });
});
