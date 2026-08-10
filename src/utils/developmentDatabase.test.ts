import { afterEach, describe, expect, it } from 'vitest';
import { createDevelopmentPrismaClient } from './developmentDatabase';

const originalAuth = process.env.DEVELOPMENT_SCRIPT_AUTH;

describe('createDevelopmentPrismaClient', () => {
  afterEach(() => {
    if (originalAuth === undefined) delete process.env.DEVELOPMENT_SCRIPT_AUTH;
    else process.env.DEVELOPMENT_SCRIPT_AUTH = originalAuth;
  });

  it('blocks direct execution before creating a database client', () => {
    delete process.env.DEVELOPMENT_SCRIPT_AUTH;
    expect(() => createDevelopmentPrismaClient()).toThrow('Direct database script execution is disabled');
  });

  it('rejects an invalid script authorization', () => {
    process.env.DEVELOPMENT_SCRIPT_AUTH = 'invalid';
    expect(() => createDevelopmentPrismaClient()).toThrow('Direct database script execution is disabled');
  });
});
