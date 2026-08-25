import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ accept: vi.fn() }));

vi.mock('./service', () => ({ waitlistService: { accept: mocks.accept } }));

import { WAITLIST_ACCEPTED_MESSAGE, waitlistController } from './controller';

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
}

describe('waitlistController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accept.mockResolvedValue(undefined);
  });

  it('returns the fixed accepted response without PII or creation state', async () => {
    const req = { body: { email: '  Person@Example.com ', consent: true } } as Request;
    const res = response();
    const next = vi.fn() as NextFunction;

    await waitlistController.create(req, res, next);

    expect(mocks.accept).toHaveBeenCalledWith({ email: 'Person@Example.com', consent: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: undefined,
      message: WAITLIST_ACCEPTED_MESSAGE,
    });
    const body = vi.mocked(res.json).mock.calls[0][0];
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('created');
    expect(next).not.toHaveBeenCalled();
  });

  it('sends strict validation failures through the shared error path', async () => {
    const res = response();
    const next = vi.fn() as NextFunction;

    await waitlistController.create({
      body: { email: 'person@example.com', consent: true, extra: 'rejected' },
    } as Request, res, next);

    expect(mocks.accept).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
  });
});
