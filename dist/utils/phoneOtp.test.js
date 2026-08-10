"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const phoneOtp_1 = require("./phoneOtp");
const twilioConfig = {
    accountSid: 'AC-test',
    authToken: 'token-test',
    fromNumber: '+15551234567',
};
const { createTwilioMessage } = vitest_1.vi.hoisted(() => ({ createTwilioMessage: vitest_1.vi.fn() }));
vitest_1.vi.mock('twilio', () => ({
    __esModule: true,
    default: vitest_1.vi.fn(() => ({ messages: { create: createTwilioMessage } })),
}));
(0, vitest_1.afterEach)(() => vitest_1.vi.restoreAllMocks());
(0, vitest_1.describe)('phone OTP delivery', () => {
    (0, vitest_1.it)('logs the code but masks the phone in console mode', async () => {
        const log = vitest_1.vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await (0, phoneOtp_1.createPhoneOtpDelivery)('console')('+52 55 1234 5678', '123456');
        (0, vitest_1.expect)(log).toHaveBeenCalledWith('[phone-number] OTP for phone ending 78: 123456');
        (0, vitest_1.expect)(log.mock.calls.flat().join(' ')).not.toContain('5512345678');
    });
    (0, vitest_1.it)('fails without logging in disabled mode', async () => {
        const log = vitest_1.vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await (0, vitest_1.expect)((0, phoneOtp_1.createPhoneOtpDelivery)('disabled')('+52 55 1234 5678', '123456')).rejects.toThrow('Phone OTP delivery provider is not configured');
        (0, vitest_1.expect)(log).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('fails when twilio mode is used without config', async () => {
        await (0, vitest_1.expect)((0, phoneOtp_1.createPhoneOtpDelivery)('twilio')('+52 55 1234 5678', '123456')).rejects.toThrow('Twilio configuration is missing');
    });
    (0, vitest_1.it)('sends the OTP via Twilio with to, from and the code', async () => {
        createTwilioMessage.mockResolvedValueOnce({ sid: 'SM123' });
        const log = vitest_1.vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await (0, phoneOtp_1.createPhoneOtpDelivery)('twilio', twilioConfig)('+52 55 1234 5678', '123456');
        (0, vitest_1.expect)(createTwilioMessage).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            to: '+52 55 1234 5678',
            from: twilioConfig.fromNumber,
            body: vitest_1.expect.stringContaining('123456'),
        }));
        (0, vitest_1.expect)(log).toHaveBeenCalledWith('[phone-number] OTP sent via Twilio to phone ending 78 (sid SM123)');
        (0, vitest_1.expect)(log.mock.calls.flat().join(' ')).not.toContain('5512345678');
    });
});
//# sourceMappingURL=phoneOtp.test.js.map