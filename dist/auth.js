"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
const better_auth_1 = require("better-auth");
const prisma_1 = require("better-auth/adapters/prisma");
const expo_1 = require("@better-auth/expo");
const phone_number_1 = require("better-auth/plugins/phone-number");
const database_1 = require("./config/database");
const env_1 = require("./config/env");
const phoneOtp_1 = require("./utils/phoneOtp");
const isProduction = env_1.env.APP_ENV === "production";
const deliverPhoneOtp = (0, phoneOtp_1.createPhoneOtpDelivery)(env_1.env.PHONE_OTP_MODE);
exports.auth = (0, better_auth_1.betterAuth)({
    baseURL: env_1.env.BETTER_AUTH_URL,
    secret: env_1.env.BETTER_AUTH_SECRET,
    database: (0, prisma_1.prismaAdapter)(database_1.prisma, {
        provider: "postgresql",
    }),
    user: {
        additionalFields: {
            rol: {
                type: "string",
            },
            showPhoneInPublicLeague: {
                type: "boolean",
                defaultValue: false,
            },
        },
    },
    emailAndPassword: {
        enabled: false,
    },
    account: {
        accountLinking: {
            enabled: true,
            trustedProviders: ["google"]
        },
    },
    socialProviders: {
        google: {
            clientId: env_1.env.GOOGLE_CLIENT_ID,
            clientSecret: env_1.env.GOOGLE_CLIENT_SECRET,
        },
    },
    trustedOrigins: [
        "tenka://",
        ...(0, env_1.getCorsAllowedOrigins)(),
        ...(!isProduction ? ["exp://localhost:*/**", "exp://127.0.0.1:*/**", "exp://192.168.*.*:*/**"] : []),
    ],
    session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
    },
    advanced: {
        useSecureCookies: isProduction,
        defaultCookieAttributes: {
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax",
        },
    },
    plugins: [
        (0, expo_1.expo)(),
        (0, phone_number_1.phoneNumber)({
            sendOTP: async ({ phoneNumber: phone, code }) => deliverPhoneOtp(phone, code),
            expiresIn: 5 * 60,
            allowedAttempts: 5,
            phoneNumberValidator: (phone) => /^\+[1-9]\d{7,14}$/.test(phone),
        }),
    ],
});
//# sourceMappingURL=auth.js.map