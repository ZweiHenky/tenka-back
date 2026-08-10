import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhoneOtpDelivery, type TwilioOtpConfig } from './phoneOtp';

const twilioConfig: TwilioOtpConfig = {
  accountSid: 'AC-test',
  authToken: 'token-test',
  fromNumber: '+15551234567',
};

const { createTwilioMessage } = vi.hoisted(() => ({ createTwilioMessage: vi.fn() }));

vi.mock('twilio', () => ({
  __esModule: true,
  default: vi.fn(() => ({ messages: { create: createTwilioMessage } })),
}));

afterEach(() => vi.restoreAllMocks());

describe('phone OTP delivery', () => {
  it('logs the code but masks the phone in console mode', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await createPhoneOtpDelivery('console')('+52 55 1234 5678', '123456');

    expect(log).toHaveBeenCalledWith('[phone-number] OTP for phone ending 78: 123456');
    expect(log.mock.calls.flat().join(' ')).not.toContain('5512345678');
  });

  it('fails without logging in disabled mode', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(createPhoneOtpDelivery('disabled')('+52 55 1234 5678', '123456')).rejects.toThrow(
      'Phone OTP delivery provider is not configured',
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('fails when twilio mode is used without config', async () => {
    await expect(createPhoneOtpDelivery('twilio')('+52 55 1234 5678', '123456')).rejects.toThrow(
      'Twilio configuration is missing',
    );
  });

  it('sends the OTP via Twilio with to, from and the code', async () => {
    createTwilioMessage.mockResolvedValueOnce({ sid: 'SM123' });
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await createPhoneOtpDelivery('twilio', twilioConfig)('+52 55 1234 5678', '123456');

    expect(createTwilioMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+52 55 1234 5678',
        from: twilioConfig.fromNumber,
        body: expect.stringContaining('123456'),
      }),
    );
    expect(log).toHaveBeenCalledWith('[phone-number] OTP sent via Twilio to phone ending 78 (sid SM123)');
    expect(log.mock.calls.flat().join(' ')).not.toContain('5512345678');
  });
});
