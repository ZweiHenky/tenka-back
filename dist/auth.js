"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = void 0;
const better_auth_1 = require("better-auth");
const prisma_1 = require("better-auth/adapters/prisma");
const expo_1 = require("@better-auth/expo");
const phone_number_1 = require("better-auth/plugins/phone-number");
const jose_1 = require("jose");
const database_1 = require("./config/database");
const env_1 = require("./config/env");
const phoneOtp_1 = require("./utils/phoneOtp");
const otpUniqueness_1 = require("./plugins/otpUniqueness");
const isProduction = env_1.env.APP_ENV === "production";
const deliverPhoneOtp = (0, phoneOtp_1.createPhoneOtpDelivery)(env_1.env.PHONE_OTP_MODE, {
    accountSid: env_1.env.TWILIO_ACCOUNT_SID,
    authToken: env_1.env.TWILIO_AUTH_TOKEN,
    fromNumber: env_1.env.TWILIO_PHONE_NUMBER,
});
async function generateAppleClientSecret(clientId, teamId, keyId, privateKey) {
    const key = await (0, jose_1.importPKCS8)(privateKey, "ES256");
    const now = Math.floor(Date.now() / 1000);
    return new jose_1.SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: keyId })
        .setIssuer(teamId)
        .setSubject(clientId)
        .setAudience("https://appleid.apple.com")
        .setIssuedAt(now)
        .setExpirationTime(now + 180 * 24 * 60 * 60)
        .sign(key);
}
const appleConfigured = Boolean(env_1.env.APPLE_CLIENT_ID && env_1.env.APPLE_TEAM_ID && env_1.env.APPLE_KEY_ID && env_1.env.APPLE_PRIVATE_KEY);
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
        ...(appleConfigured
            ? {
                apple: async () => ({
                    clientId: env_1.env.APPLE_CLIENT_ID,
                    clientSecret: await generateAppleClientSecret(env_1.env.APPLE_CLIENT_ID, env_1.env.APPLE_TEAM_ID, env_1.env.APPLE_KEY_ID, env_1.env.APPLE_PRIVATE_KEY),
                    ...(env_1.env.APPLE_APP_BUNDLE_IDENTIFIER ? { appBundleIdentifier: env_1.env.APPLE_APP_BUNDLE_IDENTIFIER } : {}),
                }),
            }
            : {}),
    },
    trustedOrigins: [
        "tenka://",
        "https://appleid.apple.com",
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
        (0, otpUniqueness_1.preventOtpForRegisteredPhone)(),
    ],
});
//# sourceMappingURL=auth.js.map