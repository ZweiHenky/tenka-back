import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('./repository', () => ({ waitlistRepository: { create: mocks.create } }));

import { WAITLIST_CONSENT_NOTICE_VERSION, waitlistService } from './service';

describe('waitlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue(undefined);
  });

  it('normalizes email server-side and records consent metadata', async () => {
    const before = Date.now();

    await waitlistService.accept({
      email: 'Person@Example.COM',
      role: 'AFICIONADO',
      source: 'LANDING_FINAL_CTA',
      consent: true,
    });

    const data = mocks.create.mock.calls[0][0];
    expect(data).toMatchObject({
      email: 'Person@Example.COM',
      emailNormalized: 'person@example.com',
      role: 'AFICIONADO',
      source: 'LANDING_FINAL_CTA',
      consentNoticeVersion: WAITLIST_CONSENT_NOTICE_VERSION,
    });
    expect(data.consentAt).toBeInstanceOf(Date);
    expect(data.consentAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('uses the same normalized key and generic void result for duplicate submissions', async () => {
    await expect(waitlistService.accept({ email: 'PERSON@example.com', consent: true })).resolves.toBeUndefined();
    await expect(waitlistService.accept({ email: 'person@EXAMPLE.COM', consent: true })).resolves.toBeUndefined();

    expect(mocks.create.mock.calls.map(([data]) => data.emailNormalized))
      .toEqual(['person@example.com', 'person@example.com']);
  });
});
