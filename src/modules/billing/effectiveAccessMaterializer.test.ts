import { describe, expect, it } from 'vitest';
import { effectiveAccessMaterializerInternals } from './effectiveAccessMaterializer';

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assignment-1',
    assignedAt: new Date('2026-09-01T12:00:00Z'),
    divisionId: 'division-1',
    divisionIdSnapshot: 'division-1',
    divisionNameSnapshot: 'Division 1',
    leagueIdSnapshot: 'league-1',
    leagueNameSnapshot: 'League 1',
    ownerUserIdSnapshot: 'user-1',
    slotNumber: 2,
    ...overrides,
  };
}

describe('effective access rollover planner', () => {
  it('preserves sparse slots when capacity is equal or higher', () => {
    expect(effectiveAccessMaterializerInternals.planRolloverAssignments([
      assignment({ id: 'a', slotNumber: 2 }),
      assignment({ id: 'b', slotNumber: 5, divisionId: 'division-2', divisionIdSnapshot: 'division-2' }),
    ], 5, 6)).toMatchObject([
      { id: 'a', slotNumber: 2, assignmentSource: 'PERIOD_ROLLOVER' },
      { id: 'b', slotNumber: 5, assignmentSource: 'PERIOD_ROLLOVER' },
    ]);
  });

  it('uses oldest assignment then stable id for downgrade fallback', () => {
    expect(effectiveAccessMaterializerInternals.planRolloverAssignments([
      assignment({ id: 'z', slotNumber: 1, assignedAt: new Date('2026-09-03T00:00:00Z') }),
      assignment({ id: 'b', slotNumber: 4, divisionId: 'division-2', divisionIdSnapshot: 'division-2' }),
      assignment({ id: 'a', slotNumber: 5, divisionId: 'division-3', divisionIdSnapshot: 'division-3' }),
    ], 5, 2)).toMatchObject([
      { id: 'a', slotNumber: 1, assignmentSource: 'RENEWAL_FALLBACK' },
      { id: 'b', slotNumber: 2, assignmentSource: 'RENEWAL_FALLBACK' },
    ]);
  });

  it('never rolls a deleted division into another period', () => {
    expect(effectiveAccessMaterializerInternals.planRolloverAssignments([
      assignment({ divisionId: null }),
    ], 2, 2)).toEqual([]);
  });
});

describe('effective access transition classification', () => {
  const providerPeriodStart = new Date('2026-10-01T12:00:00Z');

  it('treats first purchases and free-to-paid transitions as purchases', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: null,
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(true);
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: providerPeriodStart,
      providerPeriodStart,
      hasActiveFreeGrant: true,
    })).toBe(true);
  });

  it('keeps overlapping and adjacent paid periods continuous even when processed late', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: providerPeriodStart,
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(false);
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: new Date('2026-10-02T12:00:00Z'),
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(false);
  });

  it('treats a strict gap as a repurchase regardless of current provider chain', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: false,
      predecessorAccessEnd: new Date(providerPeriodStart.getTime() - 1),
      providerPeriodStart,
      hasActiveFreeGrant: false,
    })).toBe(true);
  });

  it('does not reclassify an active paid period because of inconsistent free state', () => {
    expect(effectiveAccessMaterializerInternals.isPurchaseTransition({
      hasCurrentPeriod: true,
      predecessorAccessEnd: new Date('2026-09-01T12:00:00Z'),
      providerPeriodStart,
      hasActiveFreeGrant: true,
    })).toBe(false);
  });
});
