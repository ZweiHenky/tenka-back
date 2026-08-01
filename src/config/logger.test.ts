import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logger';

describe('logger redaction', () => {
  it('does not serialize authorization, cookie, token, OTP, or phone values', () => {
    let output = '';
    const destination = { write: (chunk: string) => { output += chunk; } };
    const testLogger = pino({ ...loggerOptions, level: 'info' }, destination);
    const secrets = {
      authorization: 'Bearer authorization-secret',
      cookie: 'session=cookie-secret',
      setCookie: 'session=set-cookie-secret',
      token: 'token-secret',
      otp: '123456',
      phoneNumber: '+15551234567',
      telefono: '+525512345678',
    };

    testLogger.info({
      req: { headers: { authorization: secrets.authorization, cookie: secrets.cookie } },
      res: { headers: { 'set-cookie': secrets.setCookie } },
      auth: {
        authorization: secrets.authorization,
        cookie: secrets.cookie,
        token: secrets.token,
        otp: secrets.otp,
        phoneNumber: secrets.phoneNumber,
        telefono: secrets.telefono,
      },
    }, 'sensitive request');

    for (const secret of Object.values(secrets)) expect(output).not.toContain(secret);
    expect(output.match(/\[REDACTED\]/g)?.length).toBe(9);
  });
});
