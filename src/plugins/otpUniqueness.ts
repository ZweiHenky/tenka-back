import { APIError, createAuthMiddleware } from 'better-auth/api';

export async function assertPhoneNotRegistered(ctx: {
  body?: { phoneNumber?: string };
  context: {
    adapter: {
      findOne: (args: {
        model: string;
        where: Array<{ field: string; value: string }>;
      }) => Promise<unknown>;
    };
  };
}): Promise<void> {
  const phoneNumber = ctx.body?.phoneNumber;
  if (!phoneNumber) return;

  const existing = await ctx.context.adapter.findOne({
    model: 'user',
    where: [{ field: 'phoneNumber', value: phoneNumber }],
  });

  if (existing) {
    throw APIError.from('BAD_REQUEST', {
      code: 'PHONE_NUMBER_EXIST',
      message: 'Phone number already exists',
    });
  }
}

export function preventOtpForRegisteredPhone() {
  return {
    id: 'prevent-otp-for-registered-phone',
    hooks: {
      before: [
        {
          matcher: (c: { path?: string }) => c.path === '/phone-number/send-otp',
          handler: createAuthMiddleware(assertPhoneNotRegistered),
        },
      ],
    },
  };
}
