import { describe, expect, it } from 'vitest';
import type { ManagementAccess, ResourceAccessDecision } from './resourceAccessResolver';
import {
  type ManagementCapability,
  wouldAllowManagementCapability,
} from './resourceAccessPolicy';

const capabilities: ManagementCapability[] = [
  'CREATE_LEAGUE',
  'CREATE_DIVISION',
  'MANAGE_DIVISION',
  'MANAGE_LEAGUE',
  'ADD_SHARED_RESOURCE',
  'MANAGE_SHARED_RESOURCE',
  'WRITE_RESULT',
  'DELETE_RESOURCE',
];

function decision(access: ManagementAccess): ResourceAccessDecision {
  return {
    access,
    reason: access === 'FULL' ? 'FREE' : access === 'BLOCKED' ? 'INVALID_BILLING_EVIDENCE' : 'UNASSIGNED',
    basis: 'FREE',
    resourceType: 'DIVISION',
  };
}

describe('resource access capability policy', () => {
  it('allows every declared capability with full access', () => {
    for (const capability of capabilities) {
      expect(wouldAllowManagementCapability(decision('FULL'), capability)).toBe(true);
    }
  });

  it('limits setup access to creating the initial league or division', () => {
    for (const capability of capabilities) {
      expect(wouldAllowManagementCapability(decision('LIMITED_SETUP'), capability)).toBe(
        capability === 'CREATE_LEAGUE' || capability === 'CREATE_DIVISION' || capability === 'DELETE_RESOURCE',
      );
    }
  });

  it('keeps only top-level deletion available in read-only access', () => {
    for (const capability of capabilities) {
      expect(wouldAllowManagementCapability(decision('READ_ONLY'), capability)).toBe(capability === 'DELETE_RESOURCE');
    }
  });

  it('denies every capability when billing evidence is blocked', () => {
    for (const capability of capabilities) {
      expect(wouldAllowManagementCapability(decision('BLOCKED'), capability)).toBe(false);
    }
  });
});
