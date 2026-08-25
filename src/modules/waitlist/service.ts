import { waitlistRepository } from './repository';
import type { CreateWaitlistInput } from './validator';

export const WAITLIST_CONSENT_NOTICE_VERSION = 'v1';

export const waitlistService = {
  async accept(data: CreateWaitlistInput): Promise<void> {
    await waitlistRepository.create({
      email: data.email,
      emailNormalized: data.email.toLowerCase(),
      role: data.role,
      source: data.source,
      consentAt: new Date(),
      consentNoticeVersion: WAITLIST_CONSENT_NOTICE_VERSION,
    });
  },
};
