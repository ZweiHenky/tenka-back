import { describe, expect, it } from 'vitest';
import { getCorsAllowedOrigins, parseBackendEnv } from './env';

const validEnv = {
  APP_ENV: 'local', NODE_ENV: 'test', PORT: '3000',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/app',
  BETTER_AUTH_SECRET: 'a'.repeat(32), BETTER_AUTH_URL: 'http://localhost:3000',
  GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret',
  ONESIGNAL_APP_ID: 'onesignal-app-id', ONESIGNAL_REST_API_KEY: 'onesignal-rest-api-key',
  CLOUDINARY_CLOUD_NAME: 'cloud-name', CLOUDINARY_API_KEY: 'cloudinary-api-key',
  CLOUDINARY_API_SECRET: 'cloudinary-api-secret', PHONE_OTP_MODE: 'console',
  SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
} as const;

describe('parseBackendEnv', () => {
  it('parses and normalizes a valid environment', () => {
    expect(parseBackendEnv(validEnv)).toMatchObject({ APP_ENV: 'local', NODE_ENV: 'test', PORT: 3000 });
  });

  it.each([
    'DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET', 'ONESIGNAL_APP_ID', 'ONESIGNAL_REST_API_KEY',
    'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  ])('requires %s', (name) => {
    expect(() => parseBackendEnv({ ...validEnv, [name]: undefined })).toThrow(name);
  });

  it.each(['0', '65536', 'not-a-port'])('rejects invalid PORT %s', (port) => {
    expect(() => parseBackendEnv({ ...validEnv, PORT: port })).toThrow('PORT');
  });

  it('rejects non-PostgreSQL database URLs', () => {
    expect(() => parseBackendEnv({ ...validEnv, DATABASE_URL: 'https://db.example.com' })).toThrow('DATABASE_URL');
  });

  it('allows ngrok in local and preview environments', () => {
    expect(parseBackendEnv({ ...validEnv, BETTER_AUTH_URL: 'https://demo.ngrok-free.app' }).APP_ENV).toBe('local');
    expect(parseBackendEnv({ ...validEnv, APP_ENV: 'preview', PHONE_OTP_MODE: 'disabled', BETTER_AUTH_URL: 'https://demo.ngrok-free.app' }).APP_ENV).toBe('preview');
  });

  it('allows console OTP only locally', () => {
    expect(() => parseBackendEnv({ ...validEnv, APP_ENV: 'preview' })).toThrow('PHONE_OTP_MODE');
    expect(() => parseBackendEnv({ ...validEnv, APP_ENV: 'production', BETTER_AUTH_URL: 'https://api.example.com' })).toThrow('PHONE_OTP_MODE');
  });

  it('allows twilio OTP outside local when the twilio vars are set', () => {
    const withTwilio = {
      ...validEnv,
      APP_ENV: 'preview',
      PHONE_OTP_MODE: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      TWILIO_PHONE_NUMBER: '+15551234567',
    };
    expect(parseBackendEnv(withTwilio).PHONE_OTP_MODE).toBe('twilio');
    expect(() => parseBackendEnv({ ...validEnv, PHONE_OTP_MODE: 'twilio' })).toThrow('TWILIO_ACCOUNT_SID');
    expect(() => parseBackendEnv({
      ...withTwilio,
      TWILIO_ACCOUNT_SID: undefined,
    })).toThrow('TWILIO_ACCOUNT_SID');
    expect(() => parseBackendEnv({
      ...withTwilio,
      TWILIO_AUTH_TOKEN: undefined,
    })).toThrow('TWILIO_AUTH_TOKEN');
    expect(() => parseBackendEnv({
      ...withTwilio,
      TWILIO_PHONE_NUMBER: undefined,
    })).toThrow('TWILIO_PHONE_NUMBER');
  });

  it('rejects an invalid twilio phone number', () => {
    expect(() => parseBackendEnv({
      ...validEnv,
      PHONE_OTP_MODE: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
      TWILIO_AUTH_TOKEN: 'twilio-auth-token',
      TWILIO_PHONE_NUMBER: '15551234567',
    })).toThrow('TWILIO_PHONE_NUMBER');
  });

  it.each([
    'http://api.example.com', 'https://localhost:3000', 'https://127.0.0.1',
    'https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.1.1',
    'https://demo.ngrok-free.app', 'https://demo.ngrok.io',
  ])('rejects unstable production auth URL %s', (url) => {
    expect(() => parseBackendEnv({ ...validEnv, APP_ENV: 'production', PHONE_OTP_MODE: 'disabled', BETTER_AUTH_URL: url })).toThrow('BETTER_AUTH_URL');
  });

  it('accepts a stable public production auth URL', () => {
    const parsed = parseBackendEnv({ ...validEnv, APP_ENV: 'production', NODE_ENV: 'production', PHONE_OTP_MODE: 'disabled', BETTER_AUTH_URL: 'https://api.example.com', CORS_ALLOWED_ORIGINS: 'https://app.example.com' });
    expect(parsed.APP_ENV).toBe('production');
  });

  it('parses an explicit CORS allowlist', () => {
    const parsed = parseBackendEnv({ ...validEnv, CORS_ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:8081' });
    expect(getCorsAllowedOrigins(parsed)).toEqual(['https://app.example.com', 'http://localhost:8081']);
  });

  it.each(['*', 'not-an-origin'])('rejects invalid CORS origin %s', (origin) => {
    expect(() => parseBackendEnv({ ...validEnv, CORS_ALLOWED_ORIGINS: origin })).toThrow('CORS_ALLOWED_ORIGINS');
  });

  it('requires HTTPS CORS origins in production', () => {
    expect(() => parseBackendEnv({
      ...validEnv,
      APP_ENV: 'production',
      NODE_ENV: 'production',
      PHONE_OTP_MODE: 'disabled',
      BETTER_AUTH_URL: 'https://api.example.com',
      CORS_ALLOWED_ORIGINS: 'http://app.example.com',
    })).toThrow('CORS_ALLOWED_ORIGINS');
  });

  it('validates body limits and HTTP timeout ordering', () => {
    expect(() => parseBackendEnv({ ...validEnv, JSON_BODY_LIMIT: 'unlimited' })).toThrow('JSON_BODY_LIMIT');
    expect(() => parseBackendEnv({ ...validEnv, HTTP_HEADERS_TIMEOUT_MS: '4000', HTTP_KEEP_ALIVE_TIMEOUT_MS: '5000' })).toThrow('HTTP_HEADERS_TIMEOUT_MS');
  });

  it('does not echo rejected values', () => {
    const secretValue = 'short-sensitive-value';
    try {
      parseBackendEnv({ ...validEnv, BETTER_AUTH_SECRET: secretValue });
      throw new Error('expected parsing to fail');
    } catch (error) {
      expect((error as Error).message).not.toContain(secretValue);
    }
  });
});
