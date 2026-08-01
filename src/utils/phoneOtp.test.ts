import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhoneOtpDelivery } from './phoneOtp';

afterEach(() => vi.restoreAllMocks());

describe('phone OTP delivery', () => {
  it('logs the code but masks the phone outside production', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await createPhoneOtpDelivery('console')('+52 55 1234 5678', '123456');

    expect(log).toHaveBeenCalledWith('[phone-number] OTP for phone ending 78: 123456');
    expect(log.mock.calls.flat().join(' ')).not.toContain('5512345678');
  });

  it('fails without logging in production', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(createPhoneOtpDelivery('disabled')('+52 55 1234 5678', '123456')).rejects.toThrow(
      'Phone OTP delivery provider is not configured',
    );
    expect(log).not.toHaveBeenCalled();
  });
});
