import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@aiolivetv/core', () => ({
  createLogger: () => ({ error: logError }),
  APIError: class extends Error {
    statusCode = 500;
    constructor(public code: string) {
      super('Internal Server Error');
    }
  },
  constants: {
    ErrorCode: {
      INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
      BAD_REQUEST: 'BAD_REQUEST',
      RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    },
  },
  StremioTransformer: { createDynamicError: vi.fn() },
}));

import { APIError, constants } from '@aiolivetv/core';
import { errorMiddleware } from './errors.js';

function response() {
  const json = vi.fn();
  const res = { status: vi.fn(), json };
  res.status.mockReturnValue(res);
  return res;
}

describe('error middleware logging', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs an unexpected error once with its original stack and preserves the 500 response', () => {
    const error = new Error('Upstream unavailable');
    const res = response();
    errorMiddleware(error, {} as Request, res as unknown as Response, vi.fn());
    expect(logError).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(error);
    expect(logError.mock.calls[0][0].stack).toContain('Upstream unavailable');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal Server Error',
        },
      })
    );
  });

  it('does not log expected API errors', () => {
    const res = response();
    errorMiddleware(
      new APIError(constants.ErrorCode.INTERNAL_SERVER_ERROR),
      {} as Request,
      res as unknown as Response,
      vi.fn()
    );
    expect(logError).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('preserves validation responses without unexpected error logs', () => {
    const parsed = z.string().safeParse(1);
    if (parsed.success) throw new Error('Expected invalid input');
    const res = response();
    errorMiddleware(
      parsed.error,
      {} as Request,
      res as unknown as Response,
      vi.fn()
    );
    expect(logError).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ message: 'Invalid Request' }),
      })
    );
  });
});
