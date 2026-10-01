import { z } from 'zod';

const migrationStatuses = [
  'PREPARED', 'SELECTION_REQUIRED', 'SELECTED', 'PURCHASED', 'APPLIED', 'REPLACED',
] as const;
const deadlineStates = ['OVERDUE', 'UPCOMING', 'NONE'] as const;

export const billingMigrationAdminSummaryQuerySchema = z.object({}).strict();

export const billingMigrationAdminParamsSchema = z.object({
  billingAccountId: z.string().trim().min(1).max(255),
}).strict();

export const billingMigrationAdminListQuerySchema = z.object({
  status: z.string().trim().optional().transform((value, context) => {
    if (!value) return [...migrationStatuses];
    const statuses = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
    if (statuses.length === 0
      || statuses.some((item) => !migrationStatuses.includes(item as typeof migrationStatuses[number]))) {
      context.addIssue({ code: 'custom', message: 'status contiene un valor no permitido' });
      return z.NEVER;
    }
    return statuses as Array<typeof migrationStatuses[number]>;
  }),
  deadline: z.enum(deadlineStates).optional(),
  cursor: z.string().trim().min(1).max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export type BillingMigrationAdminListQuery = z.output<typeof billingMigrationAdminListQuerySchema>;
