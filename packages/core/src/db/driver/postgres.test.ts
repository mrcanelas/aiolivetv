import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DbError } from '../errors.js';

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
    query = fixture.query;
    on() {}
    async connect() {
      return { query: fixture.clientQuery, release: fixture.release };
    }
  },
}));
import { PostgresDriver } from './postgres.js';

beforeEach(() => vi.resetAllMocks());

describe('PostgreSQL connection recovery', () => {
  it('retries one failed read on a new pool request', async () => {
    fixture.query
      .mockRejectedValueOnce(
        new Error('Connection terminated due to connection timeout')
      )
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });
    const driver = new PostgresDriver('postgresql://localhost/test');
    expect(await driver.query('SELECT id FROM users')).toEqual([{ id: 1 }]);
    expect(fixture.query).toHaveBeenCalledTimes(2);
  });

  it('stops after one retry and classifies the connection failure', async () => {
    fixture.query.mockRejectedValue(
      new Error('timeout exceeded when trying to connect')
    );
    const driver = new PostgresDriver('postgresql://localhost/test');
    await expect(driver.query('SELECT id FROM users')).rejects.toMatchObject({
      kind: 'connection',
    });
    expect(fixture.query).toHaveBeenCalledTimes(2);
  });

  it('does not retry writes or non-connection errors', async () => {
    const driver = new PostgresDriver('postgresql://localhost/test');
    fixture.query.mockRejectedValue(
      new Error('Connection terminated unexpectedly')
    );
    await expect(
      driver.query('INSERT INTO users DEFAULT VALUES RETURNING id')
    ).rejects.toBeInstanceOf(DbError);
    expect(fixture.query).toHaveBeenCalledTimes(1);
    fixture.query
      .mockReset()
      .mockRejectedValue({ code: '23505', message: 'duplicate key' });
    await expect(driver.query('SELECT id FROM users')).rejects.toMatchObject({
      kind: 'unique-violation',
    });
    expect(fixture.query).toHaveBeenCalledTimes(1);
  });

  it('does not retry statements inside a transaction', async () => {
    fixture.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const driver = new PostgresDriver('postgresql://localhost/test');
    await expect(
      driver.tx((tx) => tx.query('SELECT id FROM users'))
    ).rejects.toMatchObject({ kind: 'connection' });
    expect(fixture.clientQuery.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SELECT id FROM users',
      'ROLLBACK',
    ]);
    expect(fixture.release).toHaveBeenCalledOnce();
  });
});
