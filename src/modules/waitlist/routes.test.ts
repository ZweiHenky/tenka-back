import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  limiter: vi.fn((_req, _res, next) => next()),
  create: vi.fn(),
}));

vi.mock('../../middlewares/rateLimits', () => ({ waitlistLimiter: mocks.limiter }));
vi.mock('./controller', () => ({ waitlistController: { create: mocks.create } }));

import { waitlistRouter } from './routes';

describe('waitlist route', () => {
  it('mounts POST / with only its dedicated limiter and public controller', () => {
    const layer = (waitlistRouter as any).stack.find((entry: any) =>
      entry.route?.path === '/' && entry.route?.methods?.post,
    );

    expect(layer).toBeDefined();
    expect(layer.route.stack.map((entry: any) => entry.handle)).toEqual([
      mocks.limiter,
      mocks.create,
    ]);
  });
});
