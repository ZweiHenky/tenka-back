"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertPhoneNotRegistered = assertPhoneNotRegistered;
exports.preventOtpForRegisteredPhone = preventOtpForRegisteredPhone;
const api_1 = require("better-auth/api");
async function assertPhoneNotRegistered(ctx) {
    const phoneNumber = ctx.body?.phoneNumber;
    if (!phoneNumber)
        return;
    const existing = await ctx.context.adapter.findOne({
        model: 'user',
        where: [{ field: 'phoneNumber', value: phoneNumber }],
    });
    if (existing) {
        throw api_1.APIError.from('BAD_REQUEST', {
            code: 'PHONE_NUMBER_EXIST',
            message: 'Phone number already exists',
        });
    }
}
function preventOtpForRegisteredPhone() {
    return {
        id: 'prevent-otp-for-registered-phone',
        hooks: {
            before: [
                {
                    matcher: (c) => c.path === '/phone-number/send-otp',
                    handler: (0, api_1.createAuthMiddleware)(assertPhoneNotRegistered),
                },
            ],
        },
    };
}
//# sourceMappingURL=otpUniqueness.js.map