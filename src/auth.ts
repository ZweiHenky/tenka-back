import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { expo } from "@better-auth/expo"
import { phoneNumber } from "better-auth/plugins/phone-number"
import { importPKCS8, SignJWT } from "jose"
import { prisma } from "./config/database"
import { env, getCorsAllowedOrigins } from "./config/env"
import { createPhoneOtpDelivery } from "./utils/phoneOtp"
import { preventOtpForRegisteredPhone } from "./plugins/otpUniqueness"

const isProduction = env.APP_ENV === "production"
const deliverPhoneOtp = createPhoneOtpDelivery(env.PHONE_OTP_MODE, {
  accountSid: env.TWILIO_ACCOUNT_SID as string,
  authToken: env.TWILIO_AUTH_TOKEN as string,
  fromNumber: env.TWILIO_PHONE_NUMBER as string,
})

async function generateAppleClientSecret(clientId: string, teamId: string, keyId: string, privateKey: string): Promise<string> {
  const key = await importPKCS8(privateKey, "ES256")
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 180 * 24 * 60 * 60)
    .sign(key)
}

const appleConfigured = Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY)

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
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
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    ...(appleConfigured
      ? {
          apple: async () => ({
            clientId: env.APPLE_CLIENT_ID as string,
            clientSecret: await generateAppleClientSecret(
              env.APPLE_CLIENT_ID as string,
              env.APPLE_TEAM_ID as string,
              env.APPLE_KEY_ID as string,
              env.APPLE_PRIVATE_KEY as string,
            ),
            ...(env.APPLE_APP_BUNDLE_IDENTIFIER ? { appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER } : {}),
          }),
        }
      : {}),
  },
  trustedOrigins: [
    "tenka://",
    "https://appleid.apple.com",
    ...getCorsAllowedOrigins(),
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
    expo(),
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => deliverPhoneOtp(phone, code),
      expiresIn: 5 * 60,
      allowedAttempts: 5,
      phoneNumberValidator: (phone) => /^\+[1-9]\d{7,14}$/.test(phone),
    }),
    preventOtpForRegisteredPhone(),
  ],
})
