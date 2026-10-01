import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ configureRawQuerySchema: vi.fn() }));

vi.mock('../../utils/rawDatabaseSchema', () => ({
  configureRawQuerySchema: mocks.configureRawQuerySchema,
}));

import { truncateIntegrationBillingData } from './cleanup';

function transaction(schema: string) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ schema }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
  };
}

describe('integration cleanup safety', () => {
  beforeEach(() => vi.clearAllMocks());

  it('configures and verifies the integration schema before destructive SQL', async () => {
    const tx = transaction('tenka_integration');

    await truncateIntegrationBillingData(tx as never);

    expect(mocks.configureRawQuerySchema).toHaveBeenCalledWith(tx);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('TRUNCATE TABLE "billing_accounts" CASCADE');
  });

  it.each(['public', 'preview', ''])('rejects destructive cleanup in schema %j', async (schema) => {
    const tx = transaction(schema);

    await expect(truncateIntegrationBillingData(tx as never)).rejects.toThrow(
      'Destructive integration cleanup requires the tenka_integration schema',
    );
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
