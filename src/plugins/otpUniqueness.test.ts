import { describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import { assertPhoneNotRegistered } from './otpUniqueness';

type FindOne = (args: {
  model: string;
  where: Array<{ field: string; value: string }>;
}) => Promise<unknown>;

function makeCtx(findOne: FindOne, phoneNumber?: string) {
  return {
    body: phoneNumber === undefined ? {} : { phoneNumber },
    context: { adapter: { findOne } },
  };
}

function mockFindOne(result: unknown): FindOne {
  return vi.fn().mockResolvedValue(result) as unknown as FindOne;
}

describe('assertPhoneNotRegistered', () => {
  it('allows sending the OTP when the phone is not registered', async () => {
    const findOne = mockFindOne(null);

    await expect(assertPhoneNotRegistered(makeCtx(findOne, '+5215512345678'))).resolves.toBeUndefined();

    expect(findOne).toHaveBeenCalledWith({
      model: 'user',
      where: [{ field: 'phoneNumber', value: '+5215512345678' }],
    });
  });

  it('rejects with PHONE_NUMBER_EXIST when the phone is already registered', async () => {
    const findOne = mockFindOne({ id: 'existing-user' });

    await expect(assertPhoneNotRegistered(makeCtx(findOne, '+5215512345678'))).rejects.toThrow(APIError);
    try {
      await assertPhoneNotRegistered(makeCtx(findOne, '+5215512345678'));
    } catch (error) {
      const apiError = error as APIError;
      expect(apiError.statusCode).toBe(400);
      expect(apiError.body).toMatchObject({ code: 'PHONE_NUMBER_EXIST' });
    }
  });

  it('does not query the database when no phone number is provided', async () => {
    const findOne = mockFindOne(null);

    await expect(assertPhoneNotRegistered(makeCtx(findOne))).resolves.toBeUndefined();

    expect(findOne).not.toHaveBeenCalled();
  });
});
