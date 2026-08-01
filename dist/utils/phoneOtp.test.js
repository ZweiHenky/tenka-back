"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const phoneOtp_1 = require("./phoneOtp");
(0, vitest_1.afterEach)(() => vitest_1.vi.restoreAllMocks());
(0, vitest_1.describe)('phone OTP delivery', () => {
    (0, vitest_1.it)('logs the code but masks the phone outside production', async () => {
        const log = vitest_1.vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await (0, phoneOtp_1.createPhoneOtpDelivery)('console')('+52 55 1234 5678', '123456');
        (0, vitest_1.expect)(log).toHaveBeenCalledWith('[phone-number] OTP for phone ending 78: 123456');
        (0, vitest_1.expect)(log.mock.calls.flat().join(' ')).not.toContain('5512345678');
    });
    (0, vitest_1.it)('fails without logging in production', async () => {
        const log = vitest_1.vi.spyOn(console, 'info').mockImplementation(() => undefined);
        await (0, vitest_1.expect)((0, phoneOtp_1.createPhoneOtpDelivery)('disabled')('+52 55 1234 5678', '123456')).rejects.toThrow('Phone OTP delivery provider is not configured');
        (0, vitest_1.expect)(log).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=phoneOtp.test.js.map