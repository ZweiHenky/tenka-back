import { describe, expect, it } from 'vitest';
import { createWaitlistSchema } from './validator';

describe('createWaitlistSchema', () => {
  it('trims valid input and accepts every optional enum', () => {
    expect(createWaitlistSchema.parse({
      email: '  Person@Example.com  ',
      role: 'ORGANIZADOR',
      source: 'LANDING_PRICING',
      consent: true,
    })).toEqual({
      email: 'Person@Example.com',
      role: 'ORGANIZADOR',
      source: 'LANDING_PRICING',
      consent: true,
    });
  });

  it.each([
    [{ email: 'not-an-email', consent: true }],
    [{ email: `${'a'.repeat(250)}@test.com`, consent: true }],
    [{ email: 'person@example.com', consent: false }],
    [{ email: 'person@example.com', consent: true, role: 'ADMINISTRADOR' }],
    [{ email: 'person@example.com', consent: true, source: 'OTHER' }],
    [{ email: 'person@example.com', consent: true, unexpected: true }],
  ])('rejects invalid or non-contract input %#', (input) => {
    expect(createWaitlistSchema.safeParse(input).success).toBe(false);
  });
});
