import { z } from 'zod';
import { WAITLIST_ROLES, WAITLIST_SOURCES } from './entity';

export const createWaitlistSchema = z.object({
  email: z.string().trim().max(254).email(),
  role: z.enum(WAITLIST_ROLES).optional(),
  source: z.enum(WAITLIST_SOURCES).optional(),
  consent: z.literal(true),
}).strict();

export type CreateWaitlistInput = z.output<typeof createWaitlistSchema>;
