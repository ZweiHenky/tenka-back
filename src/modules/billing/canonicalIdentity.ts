import type { PrismaClient } from '../../generated/prisma/client';
import { AppError, NotFoundError } from '../../utils/errors';

type IdentityClient = Pick<PrismaClient, 'billingAccount'>;

function invalidCanonicalIdentity(): AppError {
  return new AppError(
    409,
    'La identidad canonica de billing no es valida',
    'BILLING_CANONICAL_IDENTITY_INVALID',
  );
}

export async function assertCanonicalBillingIdentity(
  billingAccountId: string,
  client: IdentityClient,
): Promise<void> {
  const account = await client.billingAccount.findUnique({
    where: { id: billingAccountId },
    select: {
      id: true,
      detachedAt: true,
      providerIdentities: {
        where: { kind: 'CANONICAL' },
        select: { revenueCatAppUserId: true, status: true, retiredAt: true },
      },
    },
  });
  if (!account) throw new NotFoundError('Cuenta de billing');
  if (account.providerIdentities.length !== 1) throw invalidCanonicalIdentity();

  const identity = account.providerIdentities[0];
  const attachedIdentityIsValid = account.detachedAt === null
    && identity.status === 'ACTIVE' && identity.retiredAt === null;
  const detachedIdentityIsValid = account.detachedAt !== null
    && identity.status === 'RETIRED' && identity.retiredAt !== null;
  if (identity.revenueCatAppUserId !== account.id
    || (!attachedIdentityIsValid && !detachedIdentityIsValid)) {
    throw invalidCanonicalIdentity();
  }
}
