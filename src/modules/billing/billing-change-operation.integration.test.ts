import { afterEach, describe, expect, test } from 'vitest';
import { prisma } from '../../config/database';
import { truncateIntegrationBillingData } from '../../test/integration/cleanup';

const PREFIX = 'it-billing-change-operation';
const HASH = 'a'.repeat(64);

async function seedVerifiedEvidence() {
  await prisma.billingCatalogRelease.create({
    data: {
      id: `${PREFIX}-release`, version: `${PREFIX}-v1`, environment: 'PREVIEW',
      products: {
        create: [
          {
            id: 'source', logicalProductId: 'tenka_capacity_3', store: 'GOOGLE',
            storeProductId: 'tenka_capacity_3', basePlanId: 'monthly',
            revenueCatOfferingId: 'capacity_3', revenueCatPackageId: '$rc_monthly',
            revenueCatProductIdentifier: 'tenka_capacity_3:monthly', capacity: 3,
            billingInterval: 'MONTHLY', intervalMonths: 1,
          },
          {
            id: 'intermediate', logicalProductId: 'tenka_capacity_6', store: 'GOOGLE',
            storeProductId: 'tenka_capacity_6', basePlanId: 'monthly',
            revenueCatOfferingId: 'capacity_6', revenueCatPackageId: '$rc_monthly',
            revenueCatProductIdentifier: 'tenka_capacity_6:monthly', capacity: 6,
            billingInterval: 'MONTHLY', intervalMonths: 1,
          },
          {
            id: 'target', logicalProductId: 'tenka_capacity_6', store: 'GOOGLE',
            storeProductId: 'tenka_capacity_6', basePlanId: 'annual',
            revenueCatOfferingId: 'capacity_6', revenueCatPackageId: '$rc_annual',
            revenueCatProductIdentifier: 'tenka_capacity_6:annual', capacity: 6,
            billingInterval: 'ANNUAL', intervalMonths: 12,
          },
        ],
      },
    },
  });
  const account = await prisma.billingAccount.create({
    data: { id: `${PREFIX}-account`, ownerUserIdSnapshot: `${PREFIX}-owner` },
  });
  const [chain, otherChain, appleChain] = await Promise.all([
    prisma.billingProviderSubscriptionChain.create({
      data: {
        id: `${PREFIX}-chain`, billingAccountId: account.id,
        store: 'GOOGLE', providerChainReference: `${PREFIX}-google`,
      },
    }),
    prisma.billingProviderSubscriptionChain.create({
      data: {
        id: `${PREFIX}-other-chain`, billingAccountId: account.id,
        store: 'GOOGLE', providerChainReference: `${PREFIX}-other-google`,
      },
    }),
    prisma.billingProviderSubscriptionChain.create({
      data: {
        id: `${PREFIX}-apple-chain`, billingAccountId: account.id,
        store: 'APPLE', providerChainReference: `${PREFIX}-apple`,
      },
    }),
  ]);
  return { account, chain, otherChain, appleChain };
}

async function createVerifiedChangeEvidence(input: {
  accountId: string;
  operationId: string;
  chainId: string;
  purpose: 'PRODUCT_CHANGE_FIRST_STEP' | 'PRODUCT_CHANGE_FINAL_STEP';
  suffix: string;
}) {
  const finalStep = input.purpose === 'PRODUCT_CHANGE_FINAL_STEP';
  const attempt = await prisma.billingCheckoutAttempt.create({
    data: {
      id: `${PREFIX}-attempt-${input.suffix}`, billingAccountId: input.accountId,
      changeOperationId: input.operationId, purpose: input.purpose,
      store: 'GOOGLE', catalogReleaseIdSnapshot: `${PREFIX}-release`,
      logicalProductIdSnapshot: 'tenka_capacity_6',
      billingIntervalSnapshot: finalStep ? 'ANNUAL' : 'MONTHLY',
      targetCapacitySnapshot: 6, offeringIdSnapshot: 'capacity_6',
      packageIdSnapshot: finalStep ? '$rc_annual' : '$rc_monthly',
      storeProductIdSnapshot: 'tenka_capacity_6', basePlanIdSnapshot: finalStep ? 'annual' : 'monthly',
      revenueCatProductIdentifierSnapshot: finalStep ? 'tenka_capacity_6:annual' : 'tenka_capacity_6:monthly',
      idempotencyKey: `${PREFIX}-attempt-${input.suffix}-key`, requestFingerprint: HASH, startedAt: new Date(),
    },
  });
  return prisma.billingVerification.create({
    data: {
      id: `${PREFIX}-verification-${input.suffix}`, billingAccountId: input.accountId, checkoutAttemptId: attempt.id,
      store: 'GOOGLE', idempotencyKey: `${PREFIX}-verification-${input.suffix}-key`, requestFingerprint: HASH,
      providerSubscriptionChainId: input.chainId, status: 'VERIFIED', requestedAt: new Date(),
      verifiedAt: new Date(),
    },
  });
}

function operationData(billingAccountId: string, providerSubscriptionChainId: string, suffix = 'main') {
  return {
    id: `${PREFIX}-${suffix}`,
    billingAccountId,
    providerSubscriptionChainId,
    store: 'GOOGLE' as const,
    idempotencyKey: `${PREFIX}-${suffix}-key`,
    requestFingerprint: HASH,
    type: 'GOOGLE_TWO_STEP' as const,
    sourceVariantId: 'source',
    intermediateVariantId: 'intermediate',
    targetVariantId: 'target',
  };
}

afterEach(async () => {
  await prisma.$transaction(async (tx) => {
    await truncateIntegrationBillingData(tx);
    await tx.billingProductCatalog.deleteMany({ where: { catalogReleaseId: `${PREFIX}-release` } });
    await tx.billingCatalogRelease.deleteMany({ where: { id: `${PREFIX}-release` } });
  });
});

describe('billing change operation database invariants', () => {
  test('enforces normalized identity plus GOOGLE account and store membership', async () => {
    const { account, chain, otherChain, appleChain } = await seedVerifiedEvidence();

    await expect(prisma.billingChangeOperation.create({
      data: { ...operationData(account.id, chain.id, 'spaced-key'), idempotencyKey: ' spaced-key ' },
    })).rejects.toThrow();
    await expect(prisma.billingChangeOperation.create({
      data: { ...operationData(account.id, chain.id, 'uppercase-hash'), requestFingerprint: 'A'.repeat(64) },
    })).rejects.toThrow();
    await expect(prisma.billingChangeOperation.create({
      data: { ...operationData(account.id, appleChain.id, 'apple'), store: 'APPLE' },
    })).rejects.toThrow();

    const foreignAccount = await prisma.billingAccount.create({
      data: { id: `${PREFIX}-foreign-account`, ownerUserIdSnapshot: `${PREFIX}-foreign-owner` },
    });
    await expect(prisma.billingChangeOperation.create({
      data: operationData(foreignAccount.id, chain.id, 'foreign-account'),
    })).rejects.toThrow('chain must match account and store');
    await prisma.billingChangeOperation.create({ data: operationData(account.id, chain.id, 'active-main') });
    await expect(prisma.billingChangeOperation.create({
      data: operationData(account.id, otherChain.id, 'active-other-chain'),
    })).rejects.toThrow();
  });

  test('allows ordered progression and binds first verification exactly once', async () => {
    const { account, chain } = await seedVerifiedEvidence();
    const operation = await prisma.billingChangeOperation.create({
      data: operationData(account.id, chain.id),
    });

    await expect(prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { status: 'ABANDONED', version: { increment: 1 } },
    })).rejects.toThrow();
    await prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { status: 'DRAFT', lastErrorCode: 'RETRY', version: { increment: 1 } },
    });
    await prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { status: 'FIRST_PURCHASE_PENDING', version: { increment: 1 } },
    });
    await prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { status: 'FIRST_VERIFICATION_PENDING', version: { increment: 1 } },
    });
    const verification = await createVerifiedChangeEvidence({
      accountId: account.id, operationId: operation.id, chainId: chain.id,
      purpose: 'PRODUCT_CHANGE_FIRST_STEP', suffix: 'first',
    });

    const mismatchAccount = await prisma.billingAccount.create({
      data: { id: `${PREFIX}-mismatch-account`, ownerUserIdSnapshot: `${PREFIX}-mismatch-owner` },
    });
    const mismatchOperationChain = await prisma.billingProviderSubscriptionChain.create({
      data: {
        billingAccountId: mismatchAccount.id, store: 'GOOGLE',
        providerChainReference: `${PREFIX}-mismatch-operation-chain`,
      },
    });
    const mismatchEvidenceChain = await prisma.billingProviderSubscriptionChain.create({
      data: {
        billingAccountId: mismatchAccount.id, store: 'GOOGLE',
        providerChainReference: `${PREFIX}-mismatch-evidence-chain`,
      },
    });
    const mismatched = await prisma.billingChangeOperation.create({
      data: operationData(mismatchAccount.id, mismatchOperationChain.id, 'mismatched-evidence'),
    });
    await prisma.billingChangeOperation.update({
      where: { id: mismatched.id }, data: { status: 'FIRST_PURCHASE_PENDING', version: { increment: 1 } },
    });
    await prisma.billingChangeOperation.update({
      where: { id: mismatched.id }, data: { status: 'FIRST_VERIFICATION_PENDING', version: { increment: 1 } },
    });
    const mismatchedVerification = await createVerifiedChangeEvidence({
      accountId: mismatchAccount.id, operationId: mismatched.id, chainId: mismatchEvidenceChain.id,
      purpose: 'PRODUCT_CHANGE_FIRST_STEP', suffix: 'mismatched',
    });
    await expect(prisma.billingChangeOperation.update({
      where: { id: mismatched.id },
      data: { status: 'FIRST_VERIFIED', firstVerificationId: mismatchedVerification.id, version: { increment: 1 } },
    })).rejects.toThrow('verification must be verified evidence');

    await prisma.billingChangeOperation.update({
      where: { id: operation.id },
      data: { status: 'FIRST_VERIFIED', firstVerificationId: verification.id, version: { increment: 1 } },
    });
    await expect(prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { firstVerificationId: null, version: { increment: 1 } },
    })).rejects.toThrow('first verification is immutable');
    await prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { status: 'SECOND_STEP_PENDING', version: { increment: 1 } },
    });

    const scheduledAt = new Date('2026-10-07T12:00:00Z');
    const secondVerification = await createVerifiedChangeEvidence({
      accountId: account.id, operationId: operation.id, chainId: chain.id,
      purpose: 'PRODUCT_CHANGE_FINAL_STEP', suffix: 'final',
    });
    await expect(prisma.billingChangeOperation.update({
      where: { id: operation.id },
      data: {
        status: 'ABANDONED', abandonIdempotencyKey: `${PREFIX}-abandon-key`,
        abandonRequestFingerprint: HASH, version: { increment: 1 },
      },
    })).rejects.toThrow('active final attempt cannot be abandoned');
    await expect(prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { status: 'COMPLETED', completedAt: scheduledAt, version: { increment: 1 } },
    })).rejects.toThrow();
    await prisma.billingChangeOperation.update({
      where: { id: operation.id },
      data: {
        status: 'SCHEDULED', scheduledAt,
        secondVerificationId: secondVerification.id, version: { increment: 1 },
      },
    });
    await expect(prisma.billingChangeOperation.update({
      where: { id: operation.id },
      data: { scheduledAt: new Date('2026-10-07T12:00:02Z'), version: { increment: 1 } },
    })).rejects.toThrow('scheduled timestamp is immutable');
    await prisma.billingChangeOperation.update({
      where: { id: operation.id },
      data: { status: 'COMPLETED', completedAt: new Date('2026-10-07T11:59:59Z'), version: { increment: 1 } },
    });
    await expect(prisma.billingChangeOperation.update({
      where: { id: operation.id }, data: { lastErrorCode: null, version: { increment: 1 } },
    })).rejects.toThrow('terminal billing change operation');
    await expect(prisma.billingChangeOperation.delete({ where: { id: operation.id } }))
      .rejects.toThrow('cannot be deleted');
  }, 30_000);
});
