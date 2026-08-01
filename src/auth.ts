import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { expo } from "@better-auth/expo"
import { phoneNumber } from "better-auth/plugins/phone-number"
import { prisma } from "./config/database"
import { env, getCorsAllowedOrigins } from "./config/env"
import { createPhoneOtpDelivery } from "./utils/phoneOtp"

const isProduction = env.APP_ENV === "production"
const deliverPhoneOtp = createPhoneOtpDelivery(env.PHONE_OTP_MODE)

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
  },
  trustedOrigins: [
    "tenka://",
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
  ],
})
