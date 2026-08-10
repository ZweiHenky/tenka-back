"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const api_1 = require("better-auth/api");
const otpUniqueness_1 = require("./otpUniqueness");
function makeCtx(findOne, phoneNumber) {
    return {
        body: phoneNumber === undefined ? {} : { phoneNumber },
        context: { adapter: { findOne } },
    };
}
function mockFindOne(result) {
    return vitest_1.vi.fn().mockResolvedValue(result);
}
(0, vitest_1.describe)('assertPhoneNotRegistered', () => {
    (0, vitest_1.it)('allows sending the OTP when the phone is not registered', async () => {
        const findOne = mockFindOne(null);
        await (0, vitest_1.expect)((0, otpUniqueness_1.assertPhoneNotRegistered)(makeCtx(findOne, '+5215512345678'))).resolves.toBeUndefined();
        (0, vitest_1.expect)(findOne).toHaveBeenCalledWith({
            model: 'user',
            where: [{ field: 'phoneNumber', value: '+5215512345678' }],
        });
    });
    (0, vitest_1.it)('rejects with PHONE_NUMBER_EXIST when the phone is already registered', async () => {
        const findOne = mockFindOne({ id: 'existing-user' });
        await (0, vitest_1.expect)((0, otpUniqueness_1.assertPhoneNotRegistered)(makeCtx(findOne, '+5215512345678'))).rejects.toThrow(api_1.APIError);
        try {
            await (0, otpUniqueness_1.assertPhoneNotRegistered)(makeCtx(findOne, '+5215512345678'));
        }
        catch (error) {
            const apiError = error;
            (0, vitest_1.expect)(apiError.statusCode).toBe(400);
            (0, vitest_1.expect)(apiError.body).toMatchObject({ code: 'PHONE_NUMBER_EXIST' });
        }
    });
    (0, vitest_1.it)('does not query the database when no phone number is provided', async () => {
        const findOne = mockFindOne(null);
        await (0, vitest_1.expect)((0, otpUniqueness_1.assertPhoneNotRegistered)(makeCtx(findOne))).resolves.toBeUndefined();
        (0, vitest_1.expect)(findOne).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=otpUniqueness.test.js.map