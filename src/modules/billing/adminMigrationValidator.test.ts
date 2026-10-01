import { describe, expect, it } from 'vitest';
import { billingMigrationAdminListQuerySchema } from './adminMigrationValidator';

describe('billing migration administration validation', () => {
  it('defaults to every migration status and the standard page size', () => {
    expect(billingMigrationAdminListQuerySchema.parse({})).toEqual({
      status: [
        'PREPARED',
        'SELECTION_REQUIRED',
        'SELECTED',
        'PURCHASED',
        'APPLIED',
        'REPLACED',
      ],
      limit: 25,
    });
  });

  it('trims and deduplicates comma-separated statuses', () => {
    expect(billingMigrationAdminListQuerySchema.parse({
      status: ' SELECTED,PREPARED,SELECTED, PURCHASED ',
    })).toEqual({
      status: ['SELECTED', 'PREPARED', 'PURCHASED'],
      limit: 25,
    });
  });

  it.each([
    ['status', { status: 'SELECTED,INVALID' }],
    ['deadline', { deadline: 'EXPIRED' }],
    ['limit below the minimum', { limit: 0 }],
    ['limit above the maximum', { limit: 101 }],
    ['non-integer limit', { limit: 1.5 }],
    ['unknown fields', { unexpected: true }],
  ])('rejects invalid %s', (_name, query) => {
    expect(billingMigrationAdminListQuerySchema.safeParse(query).success).toBe(false);
  });
});
