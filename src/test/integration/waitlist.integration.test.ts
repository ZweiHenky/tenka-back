import { afterAll, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { WAITLIST_CONSENT_NOTICE_VERSION, waitlistService } from '../../modules/waitlist/service';

const emailNormalized = `waitlist-integration-${Date.now()}@example.com`;

describe('waitlist against PostgreSQL', () => {
  afterAll(async () => {
    await prisma.waitlistEntry.deleteMany({ where: { emailNormalized } });
  });

  test('concurrent case variants create exactly one normalized entry', async () => {
    await Promise.all(Array.from({ length: 6 }, (_, index) => waitlistService.accept({
      email: index % 2 === 0 ? emailNormalized.toUpperCase() : emailNormalized,
      role: 'ORGANIZADOR',
      source: 'LANDING_HERO',
      consent: true,
    })));

    await expect(prisma.waitlistEntry.count({ where: { emailNormalized } })).resolves.toBe(1);
    await expect(prisma.waitlistEntry.findUnique({ where: { emailNormalized } })).resolves.toMatchObject({
      emailNormalized,
      role: 'ORGANIZADOR',
      source: 'LANDING_HERO',
      consentNoticeVersion: WAITLIST_CONSENT_NOTICE_VERSION,
    });
  });
});
