"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPhoneOtpDelivery = createPhoneOtpDelivery;
function createPhoneOtpDelivery(mode, twilioConfig) {
    return async (phone, code) => {
        if (mode === 'disabled') {
            throw new Error('Phone OTP delivery provider is not configured');
        }
        const suffix = phone.replace(/\D/g, '').slice(-2) || 'unknown';
        if (mode === 'twilio') {
            if (!twilioConfig) {
                throw new Error('Twilio configuration is missing');
            }
            const { default: Twilio } = await Promise.resolve().then(() => __importStar(require('twilio')));
            const client = Twilio(twilioConfig.accountSid, twilioConfig.authToken);
            const message = await client.messages.create({
                body: `Tenka: tu código de verificación es ${code}. No lo compartas con nadie.`,
                to: phone,
                from: twilioConfig.fromNumber,
            });
            console.info(`[phone-number] OTP sent via Twilio to phone ending ${suffix} (sid ${message.sid})`);
            return;
        }
        console.info(`[phone-number] OTP for phone ending ${suffix}: ${code}`);
    };
}
//# sourceMappingURL=phoneOtp.js.map