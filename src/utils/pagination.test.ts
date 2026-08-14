import { describe, expect, it } from 'vitest';
import { parsePagination } from './pagination';

describe('parsePagination', () => {
  it('returns bounded database offsets', () => {
    expect(parsePagination({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25, skip: 50, take: 25 });
  });

  it.each([
    {},
    { page: '1' },
    { page: '0', limit: '10' },
    { page: '1', limit: '101' },
    { page: 'one', limit: '10' },
  ])('rejects missing or invalid pagination: %j', (query) => {
    expect(() => parsePagination(query)).toThrow('page y limit son obligatorios');
  });
});
