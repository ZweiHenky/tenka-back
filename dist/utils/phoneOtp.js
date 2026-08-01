"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPhoneOtpDelivery = createPhoneOtpDelivery;
function createPhoneOtpDelivery(mode) {
    return async (phone, code) => {
        if (mode === 'disabled') {
            throw new Error('Phone OTP delivery provider is not configured');
        }
        const suffix = phone.replace(/\D/g, '').slice(-2);
        console.info(`[phone-number] OTP for phone ending ${suffix || 'unknown'}: ${code}`);
    };
}
//# sourceMappingURL=phoneOtp.js.map