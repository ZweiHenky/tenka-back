import { z } from 'zod';
import { ValidationError } from './errors';

export const MAX_PAGE_SIZE = 100;

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE),
});

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}

export function parsePagination(query: unknown): Pagination {
  const parsed = paginationSchema.safeParse(query);
  if (!parsed.success) {
    throw new ValidationError(`page y limit son obligatorios; deben ser enteros positivos y limit no puede superar ${MAX_PAGE_SIZE}`);
  }
  return {
    ...parsed.data,
    skip: (parsed.data.page - 1) * parsed.data.limit,
    take: parsed.data.limit,
  };
}
