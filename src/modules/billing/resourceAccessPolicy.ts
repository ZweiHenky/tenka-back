import type { ResourceAccessDecision } from './resourceAccessResolver';

export type ManagementCapability =
  | 'CREATE_LEAGUE'
  | 'CREATE_DIVISION'
  | 'MANAGE_DIVISION'
  | 'MANAGE_LEAGUE'
  | 'ADD_SHARED_RESOURCE'
  | 'MANAGE_SHARED_RESOURCE'
  | 'WRITE_RESULT'
  | 'DELETE_RESOURCE';

export function wouldAllowManagementCapability(
  decision: ResourceAccessDecision,
  capability: ManagementCapability,
): boolean {
  if (decision.access === 'FULL') return true;
  if (capability === 'DELETE_RESOURCE') return decision.access !== 'BLOCKED';
  if (decision.access !== 'LIMITED_SETUP') return false;
  return capability === 'CREATE_LEAGUE' || capability === 'CREATE_DIVISION';
}
